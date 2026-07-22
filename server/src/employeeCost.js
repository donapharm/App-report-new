'use strict';

const persist = require('./persist');
const { VAT_DIVISOR } = require('./analytics');
const employeeCostTemplates = require('./employeeCostTemplates');
const employeeCostUnitGroups = require('./employeeCostUnitGroups');

const CONTRACT_PATH = '/api/integrations/app-report/employee-cost';
const DIMENSION_KEYS = Object.freeze(['c5', 'c7', 'c16', 'c25']);
const PERMANENT_BLOCKED = new Set(['c32', 'c47']);
const DEFAULT_NOTE = 'chưa có dữ liệu chi phí kỳ này';
const DEFAULT_TIMEOUT_MS = 6500;
const DEFAULT_BACKOFF_MS = Object.freeze([2000, 4000]);
const AUDIT_FILE = 'employee_cost_audit';
const AUDIT_LIMIT = 5000;
const DEFAULT_ANNUAL_COLUMN_KEYS = Object.freeze(['c44']);
const DEFAULT_MATCH_WARNING_PERCENT = 90;
const NOTE_KEY = 'c48';

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function parseEmployeeCostKeys(value = process.env.APP_REPORT_EMPLOYEE_COST_KEYS) {
  const employeeToKey = new Map();
  const keyToEmployee = new Map();
  const unusableEmployees = new Set();
  const unusableKeys = new Set();

  for (const raw of String(value || '').split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const separator = entry.indexOf('=');
    const employee = entry.slice(0, separator).trim().toUpperCase();
    const key = entry.slice(separator + 1).trim();
    if (separator < 1 || !/^[A-Z][A-Z0-9._-]{1,31}$/.test(employee) || key.length < 16) continue;

    const previousKey = employeeToKey.get(employee);
    if (previousKey && previousKey !== key) unusableEmployees.add(employee);
    else if (!previousKey) employeeToKey.set(employee, key);

    const previousEmployee = keyToEmployee.get(key);
    if (previousEmployee && previousEmployee !== employee) {
      unusableKeys.add(key);
      unusableEmployees.add(previousEmployee);
      unusableEmployees.add(employee);
    } else if (!previousEmployee) keyToEmployee.set(key, employee);
  }

  for (const employee of unusableEmployees) employeeToKey.delete(employee);
  for (const [employee, key] of employeeToKey) {
    if (unusableKeys.has(key)) employeeToKey.delete(employee);
  }
  return employeeToKey;
}

function normCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normName(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function safeText(value, maxLength = 1000) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeMonth(value) {
  const text = String(value || '').trim();
  let match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  if (match) return `${match[1]}-${match[2]}`;
  match = /^(0[1-9]|1[0-2])\.(\d{4})$/.exec(text);
  return match ? `${match[2]}-${match[1]}` : '';
}

function toUiMonth(value) {
  const month = normalizeMonth(value);
  return month ? `${month.slice(5, 7)}.${month.slice(0, 4)}` : '';
}

function monthsBetween(from, to) {
  const months = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const end = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  for (let cursor = year * 12 + month; cursor <= end; cursor += 1) {
    year = Math.floor((cursor - 1) / 12);
    month = (cursor - 1) % 12 + 1;
    months.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}

function parseMonthRange({ from, to } = {}, now = new Date()) {
  const hasFrom = from != null && String(from).trim() !== '';
  const hasTo = to != null && String(to).trim() !== '';
  if (hasFrom !== hasTo) {
    throw Object.assign(new Error('Phải chọn đủ Từ tháng và Đến tháng'), { status: 400, code: 'EMPLOYEE_COST_RANGE_REQUIRED' });
  }
  const fallback = currentMonth(now);
  const normalizedFrom = hasFrom && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(from).trim()) ? String(from).trim() : (hasFrom ? '' : fallback);
  const normalizedTo = hasTo && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(to).trim()) ? String(to).trim() : (hasTo ? '' : fallback);
  if (!normalizedFrom || !normalizedTo) {
    throw Object.assign(new Error('Kỳ phải có dạng YYYY-MM'), { status: 400, code: 'EMPLOYEE_COST_RANGE_INVALID' });
  }
  if (normalizedFrom > normalizedTo) {
    throw Object.assign(new Error('Từ tháng không được sau Đến tháng'), { status: 400, code: 'EMPLOYEE_COST_RANGE_ORDER' });
  }
  return { from: normalizedFrom, to: normalizedTo, months: monthsBetween(normalizedFrom, normalizedTo) };
}

function configuredAnnualColumnKeys(value = process.env.EMPLOYEE_COST_ANNUAL_COLUMNS) {
  if (value == null) return new Set(DEFAULT_ANNUAL_COLUMN_KEYS);
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return new Set(raw.map((key) => String(key || '').trim().toLowerCase()).filter(isAllowedDynamicKey));
}

function configuredMatchWarningPercent(value = process.env.EMPLOYEE_COST_MATCH_WARN_PCT) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : DEFAULT_MATCH_WARNING_PERCENT;
}

function resolveScopedEmployee({ scope, session, requestedEmp }) {
  const own = normEmp(scope?.empCode || session?.emp_code);
  if (scope?.empCode) return own;
  return normEmp(requestedEmp) || own;
}

function isAllowedDynamicKey(value) {
  const key = String(value || '').trim().toLowerCase();
  const match = /^c(\d+)$/.exec(key);
  if (!match || PERMANENT_BLOCKED.has(key) || DIMENSION_KEYS.includes(key)) return false;
  const position = Number(match[1]);
  return position >= 33 && position <= 46;
}

function sanitizeColumn(raw) {
  if (!raw || !isAllowedDynamicKey(raw.key)) return null;
  const key = String(raw.key).trim().toLowerCase();
  const column = {
    key,
    label: String(raw.label || key).trim().slice(0, 160) || key,
  };
  const pos = Number(raw.pos);
  if (Number.isInteger(pos) && pos >= 33 && pos <= 46) column.pos = pos;
  // Future-compatible formatting is metadata-driven only. The current DataHub
  // contract is percent-only; App Report never infers money from a key/value.
  if (raw.type === 'money' || raw.type === 'percent') column.type = raw.type;
  if (raw.format === 'money' || raw.format === 'percent') column.format = raw.format;
  if (raw.unit === 'VND' || raw.unit === '%') column.unit = raw.unit;
  return column;
}

function sanitizePayload(raw, expectedEmp) {
  const expected = normEmp(expectedEmp);
  const received = normEmp(raw?.empCode);
  if (!expected || received !== expected) {
    return emptyPayload(expected, DEFAULT_NOTE);
  }
  const columns = [];
  const seen = new Set();
  for (const candidate of Array.isArray(raw?.columns) ? raw.columns : []) {
    const column = sanitizeColumn(candidate);
    if (!column || seen.has(column.key)) continue;
    seen.add(column.key);
    columns.push(column);
  }
  columns.sort((a, b) => (a.pos ?? Number(a.key.slice(1))) - (b.pos ?? Number(b.key.slice(1))));

  const rows = (Array.isArray(raw?.rows) ? raw.rows : []).map((source) => {
    const row = {};
    for (const key of DIMENSION_KEYS) {
      if (source && Object.prototype.hasOwnProperty.call(source, key)) row[key] = source[key];
    }
    for (const column of columns) {
      if (source && Object.prototype.hasOwnProperty.call(source, column.key)) row[column.key] = source[column.key];
    }
    const note = safeText(source?.[NOTE_KEY] ?? source?.C48);
    if (note) row[NOTE_KEY] = note;
    return row;
  });

  return {
    empCode: expected,
    columns,
    rows,
    ...(rows.length ? {} : { note: DEFAULT_NOTE }),
  };
}

function emptyPayload(empCode, note = DEFAULT_NOTE) {
  return { empCode: normEmp(empCode), columns: [], rows: [], note };
}

function emptyRangePayload(empCode, range, note = DEFAULT_NOTE) {
  return {
    empCode: normEmp(empCode),
    from: range.from,
    to: range.to,
    periods: range.months.map((period) => ({ ...emptyPayload(empCode, note), period })),
    note,
  };
}

function explicitPeriodOf(value) {
  if (!value || typeof value !== 'object') return '';
  return normalizeMonth(value.period ?? value.month);
}

function adaptPeriodPayload(raw, expectedEmp, range) {
  const expected = normEmp(expectedEmp);
  if (!expected || normEmp(raw?.empCode) !== expected) return null;
  const requested = new Set(range.months);
  const byPeriod = new Map();
  const put = (periodValue, source, inheritedColumns) => {
    const period = normalizeMonth(periodValue);
    if (!period || !requested.has(period) || byPeriod.has(period) || !source || typeof source !== 'object') return false;
    // Some DataHub versions expose { months: { "YYYY-MM": [rows] } }.
    // The object key is an explicit period, so accepting the array does not
    // infer or spread rows across months; top-level columns remain mandatory.
    const block = Array.isArray(source) ? { rows: source } : source;
    const sourceEmp = block.empCode == null ? expected : normEmp(block.empCode);
    if (sourceEmp !== expected) return false;
    const columns = block.columns == null ? inheritedColumns : block.columns;
    if (!Array.isArray(columns) || !Array.isArray(block.rows)) return false;
    const sanitized = sanitizePayload({ empCode: expected, columns, rows: block.rows }, expected);
    byPeriod.set(period, { ...sanitized, period });
    return true;
  };

  const hasPeriods = raw?.periods != null;
  const hasMonths = raw?.months != null;
  if (hasPeriods && hasMonths) return null;
  const collection = hasPeriods ? raw.periods : (hasMonths ? raw.months : null);
  if (collection != null) {
    const entries = Array.isArray(collection) ? collection.map((item) => [explicitPeriodOf(item), item])
      : collection && typeof collection === 'object' ? Object.entries(collection) : null;
    if (!entries) return null;
    for (const [mapPeriod, item] of entries) {
      const explicit = explicitPeriodOf(item);
      if (explicit && normalizeMonth(mapPeriod) && explicit !== normalizeMonth(mapPeriod)) return null;
      if (!put(explicit || mapPeriod, item, raw.columns)) return null;
    }
  } else if (Array.isArray(raw?.rows) && raw.rows.some((row) => row && (row.period != null || row.month != null))) {
    if (!Array.isArray(raw.columns)) return null;
    const grouped = new Map();
    for (const row of raw.rows) {
      const period = explicitPeriodOf(row);
      if (!period || !requested.has(period)) return null;
      const rows = grouped.get(period) || [];
      rows.push(row);
      grouped.set(period, rows);
    }
    for (const [period, rows] of grouped) {
      if (!put(period, { rows }, raw.columns)) return null;
    }
  } else {
    // A payload without an explicit period is safe only when the request itself
    // identifies exactly one month. Never spread legacy rows across a range.
    if (range.months.length !== 1 || !Array.isArray(raw?.columns) || !Array.isArray(raw?.rows)) return null;
    if (!put(range.from, raw)) return null;
  }

  return {
    empCode: expected,
    from: range.from,
    to: range.to,
    periods: range.months.map((period) => byPeriod.get(period) || { ...emptyPayload(expected), period }),
  };
}

function productCodeOf(row = {}) {
  return normCode(row.iit_code ?? row.qlnb_code ?? row.product_code ?? row.c5 ?? row.code
    ?? row.IIT_CODE ?? row.QLNB_CODE ?? row.PRODUCT_CODE);
}

function productNameOf(row = {}) {
  return normName(row.product_name ?? row.c16 ?? row.name
    ?? row.ITEM_NAME ?? row.IIT_NAME ?? row.PRODUCT_NAME ?? row.C16 ?? row.NAME);
}

function unitCodeOf(row = {}) {
  const direct = row.unit_code ?? row.c7 ?? row.UNIT_CODE ?? row.C7;
  if (direct != null && String(direct).trim()) return normCode(direct);
  // Raw App Report uploads expose DONVI as "mã.tên". Only the prefix is the
  // canonical unit code; the full value is retained separately for display.
  const raw = String(row.DONVI ?? row.donvi ?? '').trim();
  return normCode(raw.includes('.') ? raw.split('.', 1)[0] : raw);
}

function addCandidate(map, key, code) {
  if (!key || !code) return;
  const candidates = map.get(key) || new Set();
  candidates.add(code);
  map.set(key, candidates);
}

/**
 * Resolve C16 through the product catalog first, then match revenue by the
 * resulting product code. Raw product names are never used as a revenue key.
 */
function buildProductCatalogIndex(catalogRows = []) {
  const byName = new Map();
  const byUnitName = new Map();
  const byUnitCode = new Map();
  const byCode = new Map();
  for (const row of Array.isArray(catalogRows) ? catalogRows : []) {
    const code = productCodeOf(row);
    const name = productNameOf(row);
    const unit = unitCodeOf(row);
    if (!code) continue;
    const codeRows = byCode.get(code) || [];
    codeRows.push(row);
    byCode.set(code, codeRows);
    if (unit) {
      const unitKey = `${unit}\u001f${code}`;
      const unitRows = byUnitCode.get(unitKey) || [];
      unitRows.push(row);
      byUnitCode.set(unitKey, unitRows);
    }
    if (!name) continue;
    addCandidate(byName, name, code);
    if (unit) addCandidate(byUnitName, `${unit}\u001f${name}`, code);
  }
  return { byName, byUnitName, byUnitCode, byCode };
}

function resolveProductCode(costRow, catalogIndex) {
  const name = productNameOf(costRow);
  const unit = unitCodeOf(costRow);
  const c5 = normCode(costRow?.c5);
  const directRows = c5
    ? (catalogIndex.byUnitCode.get(`${unit}\u001f${c5}`) || catalogIndex.byCode.get(c5))
    : null;
  if (directRows?.length) {
    const canonicalNames = new Set(directRows.map(productNameOf).filter(Boolean));
    if (!name || !canonicalNames.size || canonicalNames.has(name)) return c5;
    return '';
  }
  if (!name) return '';
  const candidates = catalogIndex.byUnitName.get(`${unit}\u001f${name}`) || catalogIndex.byName.get(name);
  if (!candidates?.size) return '';
  if (c5 && candidates.has(c5)) return c5;
  return candidates.size === 1 ? [...candidates][0] : '';
}

function displayValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value != null && String(value).trim() !== '') return value;
  }
  return null;
}

function authoritativeProvinceByUnit(revenueRows = [], catalogRows = []) {
  const candidates = new Map();
  const add = (row) => {
    const unit = unitCodeOf(row);
    const province = safeText(displayValue(row, ['province', 'PROVINCE', 'tinh', 'TINH']), 120);
    const source = String(row?.province_source || '').trim().toLowerCase();
    if (!unit || !province || source === 'inferred') return;
    const values = candidates.get(unit) || new Map();
    values.set(normName(province), province);
    candidates.set(unit, values);
  };
  for (const row of Array.isArray(revenueRows) ? revenueRows : []) add(row);
  for (const row of Array.isArray(catalogRows) ? catalogRows : []) add(row);
  return new Map([...candidates].map(([unit, values]) => [unit, values.size === 1 ? [...values.values()][0] : null]));
}

function canonicalDimensions(revenueRow, unit, product, catalogIndex, provinceByUnit = new Map()) {
  const exactRows = catalogIndex.byUnitCode.get(`${unit}\u001f${product}`) || [];
  const codeRows = catalogIndex.byCode.get(product) || [];
  const catalogRow = exactRows[0] || (codeRows.length === 1 ? codeRows[0] : null);
  const province = safeText(provinceByUnit.get(unit), 120);
  const unitGroup = employeeCostUnitGroups.resolve(unit);
  return {
    c5: product,
    // Hai field chỉ làm metadata lọc backend, không tham gia công thức chi phí.
    // Province chỉ tồn tại khi row/catalog/config chính thức của cùng mã đơn vị
    // có đúng một giá trị; suy tên hoặc nguồn xung đột đều fail closed.
    province,
    unitGroup: unitGroup.key || null,
    unitGroupLabel: unitGroup.label || null,
    c7: safeText(displayValue(revenueRow, ['unit_name', 'c7', 'DONVI', 'TEN_DV']) ?? unit, 240),
    c16: safeText(displayValue(catalogRow, ['product_name', 'c16', 'name', 'ITEM_NAME', 'IIT_NAME', 'PRODUCT_NAME', 'C16', 'NAME'])
      ?? displayValue(revenueRow, ['product_name', 'c16', 'name', 'ITEM_NAME', 'IIT_NAME', 'PRODUCT_NAME', 'C16', 'NAME']) ?? product, 300),
    c25: safeText(displayValue(catalogRow, ['uom', 'c25', 'UOM', 'C25'])
      ?? displayValue(revenueRow, ['uom', 'c25', 'UOM', 'C25']), 80),
    route: safeText(displayValue(revenueRow, ['route', 'tuyen', 'ROUTE', 'TUYEN'])
      ?? displayValue(catalogRow, ['route', 'tuyen', 'ROUTE', 'TUYEN']), 120),
    contractorName: safeText(displayValue(revenueRow, ['contractor_name', 'contractorName', 'CONTRACTOR_NAME'])
      ?? displayValue(catalogRow, ['contractor_name', 'contractorName', 'CONTRACTOR_NAME'])
      ?? displayValue(revenueRow, ['contractor_code', 'contractor', 'CONTRACTOR_CODE'])
      ?? displayValue(catalogRow, ['contractor_code', 'contractor', 'c4', 'CONTRACTOR_CODE', 'C4']), 240),
    strength: safeText(displayValue(revenueRow, ['strength', 'ham_luong', 'c17', 'STRENGTH', 'HAM_LUONG', 'C17'])
      ?? displayValue(catalogRow, ['strength', 'ham_luong', 'c17', 'STRENGTH', 'HAM_LUONG', 'C17']), 2000),
    bidPrice: numericValue(displayValue(revenueRow, ['bid_price', 'c31', 'BID_PRICE', 'C31'])
      ?? displayValue(catalogRow, ['bid_price', 'c31', 'BID_PRICE', 'C31'])),
  };
}

function numericValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function revenueAmountOf(row = {}) {
  const value = row.revenue ?? row.tong_tien ?? row.REVENUE ?? row.TONG_TIEN;
  const revenue = Number(value);
  return Number.isFinite(revenue) ? revenue : null;
}

function revenueBeforeVatOf(revenue, vatDivisor = VAT_DIVISOR) {
  const amount = Number(revenue);
  const divisor = Number(vatDivisor);
  return Number.isFinite(amount) && Number.isFinite(divisor) && divisor > 0 ? amount / divisor : null;
}

function revenueDateOf(row = {}) {
  const raw = displayValue(row, ['date', 'ngay', 'order_date', 'invoice_date', 'DATE']);
  const value = String(raw || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function revenueOrderOf(row = {}) {
  return String(displayValue(row, [
    'source_order', 'order_code', 'order_no', 'order_id', 'ma_don', 'so_don',
    'SOURCE_ORDER', 'ORDER_CODE', 'ORDER_NO', 'ORDER_ID', 'MA_DON', 'SO_DON',
  ]) || '').trim();
}

function revenueLineIdOf(row = {}, index = 0) {
  return String(displayValue(row, ['source_line_id', 'line_id', 'SOURCE_LINE_ID', 'LINE_ID']) || `line-${index + 1}`).trim();
}

function revenueQuantityOf(row = {}) {
  const raw = row.quantity ?? row.so_luong ?? row.QUANTITY ?? row.SO_LUONG;
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildRevenueIndex(revenueRows = [], expectedEmp = '') {
  const index = new Map();
  for (const line of buildRevenueLines(revenueRows, expectedEmp)) {
    const key = `${line.unit}\u001f${line.product}`;
    index.set(key, (index.get(key) || 0) + line.revenue);
  }
  return index;
}

/** Keep every source transaction row. Never aggregate by unit/product. */
function buildRevenueLines(revenueRows = [], expectedEmp = '', period = '') {
  const scopedEmp = normEmp(expectedEmp);
  const expectedPeriod = normalizeMonth(period);
  return (Array.isArray(revenueRows) ? revenueRows : []).map((row, sourceIndex) => {
    const rowEmp = normEmp(row.emp_code ?? row.empCode ?? row.EMP_NUMBER ?? row.MA_NV);
    if (scopedEmp && rowEmp && rowEmp !== scopedEmp) return null;
    const unit = unitCodeOf(row);
    const product = productCodeOf(row);
    const revenue = revenueAmountOf(row);
    if (!unit || !product || revenue == null) return null;
    const date = revenueDateOf(row);
    const datePeriod = date ? date.slice(0, 7) : '';
    const dateReliable = !!date && String(row.date_granularity || '').toLowerCase() !== 'period'
      && (!expectedPeriod || datePeriod === expectedPeriod);
    return {
      source: row,
      sourceIndex,
      unit,
      product,
      revenue,
      revenueBeforeVat: revenueBeforeVatOf(revenue),
      // Slot kỳ cũ có thể gán `dateFrom` làm ngày kỹ thuật dù nguồn không có
      // ngày giao dịch. Chỉ hiển thị ngày khi grain nguồn thực sự là theo ngày.
      date: dateReliable ? date : '',
      dateReliable,
      orderCode: revenueOrderOf(row),
      sourceLineId: revenueLineIdOf(row, sourceIndex),
      quantity: revenueQuantityOf(row),
    };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date)
    || a.orderCode.localeCompare(b.orderCode, 'vi')
    || a.sourceLineId.localeCompare(b.sourceLineId, 'vi')
    || a.sourceIndex - b.sourceIndex);
}

function buildRevenueDetail(revenueRows = [], expectedEmp = '', period = '') {
  const lines = buildRevenueLines(revenueRows, expectedEmp, period);
  const monthly = new Map();
  const daily = new Map();
  const dimensions = new Map();
  const invalidDailyKeys = new Set();
  for (const line of lines) {
    const key = `${line.unit}\u001f${line.product}`;
    monthly.set(key, (monthly.get(key) || 0) + line.revenue);
    if (!dimensions.has(key)) dimensions.set(key, line.source);
    if (!line.dateReliable) {
      invalidDailyKeys.add(key);
      continue;
    }
    const byDate = daily.get(key) || new Map();
    byDate.set(line.date, (byDate.get(line.date) || 0) + line.revenue);
    daily.set(key, byDate);
  }
  for (const key of invalidDailyKeys) daily.delete(key);
  return { lines, monthly, daily, dimensions, invalidDailyKeys };
}

function calculateAmount(revenue, percent) {
  if (percent == null || percent === '') return null;
  const rate = Number(percent);
  if (!Number.isFinite(revenue) || !Number.isFinite(rate)) return null;
  return Math.round(revenue * rate / 100);
}

function calculateDailyAmounts(byDate, percent, monthlyAmount) {
  if (!(byDate instanceof Map) || !byDate.size || monthlyAmount == null) return null;
  const entries = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const amounts = new Map(entries.map(([date, revenue]) => [date, calculateAmount(revenue, percent)]));
  if ([...amounts.values()].some((amount) => amount == null)) return null;
  const sum = [...amounts.values()].reduce((total, amount) => total + amount, 0);
  const lastDate = entries.at(-1)[0];
  amounts.set(lastDate, amounts.get(lastDate) + monthlyAmount - sum);
  return amounts;
}

function percentageSignature(row, columns) {
  const values = [];
  let hasPercentage = false;
  for (const column of columns) {
    const raw = row?.[column.key];
    if (raw == null || raw === '' || !Number.isFinite(Number(raw))) {
      values.push('—');
      continue;
    }
    hasPercentage = true;
    values.push(String(Number(raw)));
  }
  return hasPercentage ? values.join('\u001f') : '';
}

function buildCostLookup(costRows, columns, catalogIndex) {
  const candidates = new Map();
  for (const source of Array.isArray(costRows) ? costRows : []) {
    const product = resolveProductCode(source, catalogIndex);
    const unit = unitCodeOf(source);
    if (!unit || !product) continue;
    const key = `${unit}\u001f${product}`;
    const rows = candidates.get(key) || [];
    rows.push(source);
    candidates.set(key, rows);
  }
  const lookup = new Map();
  for (const [key, rows] of candidates) {
    const signatures = new Set(rows.map((row) => percentageSignature(row, columns)).filter(Boolean));
    // Fail closed only for an ambiguous unit+product timeline. Percentages may
    // legitimately differ between units, so one conflict must never suppress
    // every revenue line for the same product in other units.
    if (signatures.size === 1 && rows.every((row) => percentageSignature(row, columns))) {
      const notes = new Set(rows.map((row) => safeText(row?.[NOTE_KEY])).filter(Boolean));
      lookup.set(key, { ...rows[0], [NOTE_KEY]: notes.size === 1 ? [...notes][0] : null });
    }
  }
  return lookup;
}

function enrichWithRevenue(payload, options = {}) {
  const annualKeys = configuredAnnualColumnKeys(options.annualColumnKeys);
  const threshold = configuredMatchWarningPercent(options.matchWarningPercent);
  const template = employeeCostTemplates.resolveTemplate(payload.empCode, options.templateConfig, options.derivedBaseConfig);
  const upstreamColumns = new Map((payload.columns || []).map((column) => [column.key, column]));
  const columns = template.costColumns.map((key) => ({
    ...(upstreamColumns.get(key) || {}),
    key,
    label: template.costLabels[key] || upstreamColumns.get(key)?.label || key,
    type: 'percent',
    amountKey: `${key}_amount`,
    annual: annualKeys.has(key),
    derivesFrom: template.derivedBases[key] || null,
  }));
  const catalogIndex = buildProductCatalogIndex(options.catalogRows);
  const revenueLines = buildRevenueLines(options.revenueRows, payload.empCode, options.period);
  const provinceByUnit = authoritativeProvinceByUnit(options.revenueRows, options.catalogRows);
  const costLookup = buildCostLookup(payload.rows, columns, catalogIndex);
  const revenueKeys = new Set(revenueLines.map((line) => `${line.unit}\u001f${line.product}`));
  const matchedKeys = new Set();
  let dailyRowsReliable = true;
  const allDates = new Set();

  const rows = revenueLines.map((line) => {
    const lookupKey = `${line.unit}\u001f${line.product}`;
    const source = costLookup.get(lookupKey) || null;
    const percentagesMatched = !!source && columns.length > 0
      && columns.every((column) => source[column.key] != null && source[column.key] !== '' && Number.isFinite(Number(source[column.key])));
    const amounts = {};
    const dailyAmounts = {};
    const percentages = {};
    let rowMonthlyTotal = 0;
    let rowAnnualTotal = 0;
    for (const column of columns) {
      const rawPercent = source?.[column.key];
      const percent = rawPercent == null || rawPercent === '' || !Number.isFinite(Number(rawPercent)) ? null : Number(rawPercent);
      const base = column.derivesFrom ? amounts[column.derivesFrom] : line.revenueBeforeVat;
      const amount = percent == null || base == null ? null : calculateAmount(base, percent);
      percentages[column.key] = percent;
      amounts[column.key] = amount;
      if (amount == null) continue;
      if (column.annual) {
        rowAnnualTotal += amount;
      } else {
        rowMonthlyTotal += amount;
      }
      if (line.dateReliable) {
        if (!dailyAmounts[line.date]) dailyAmounts[line.date] = {};
        dailyAmounts[line.date][column.key] = amount;
        allDates.add(line.date);
      }
    }
    // A configured dependency that cannot be resolved is a financial-data
    // mismatch, even when all percentages exist. Never mark it reliable or
    // fall back to revenue for the derived column.
    const matched = percentagesMatched && columns.every((column) => Number.isFinite(amounts[column.key]));
    if (matched) matchedKeys.add(lookupKey);
    const rowDailyReliable = matched && line.dateReliable;
    if (matched && !rowDailyReliable) dailyRowsReliable = false;
    const dimensions = canonicalDimensions(line.source, line.unit, line.product, catalogIndex, provinceByUnit);
    return {
      ...dimensions,
      orderCode: line.orderCode || null,
      sourceLineId: line.sourceLineId,
      date: line.date || null,
      quantity: line.quantity,
      revenue: line.revenue,
      revenueBeforeVat: line.revenueBeforeVat,
      note: safeText(source?.[NOTE_KEY]),
      ...percentages,
      amounts,
      revenueMatched: matched,
      dailyAmounts: rowDailyReliable ? dailyAmounts : null,
      dayRevenueMatched: rowDailyReliable,
      rowMonthlyTotal: matched ? rowMonthlyTotal : null,
      rowAnnualTotal: matched ? rowAnnualTotal : null,
    };
  });

  // Keep totals stable when one old unit×product aggregate becomes several
  // order-lines. Integer VND rounding is allocated deterministically to the
  // last line of each former aggregate so Σ displayed lines keeps the prior
  // month total and, consequently, Σ day = month.
  const rowsByFormerAggregate = new Map();
  rows.forEach((row, index) => {
    if (!row.revenueMatched) return;
    const key = `${revenueLines[index].unit}\u001f${row.c5}`;
    const group = rowsByFormerAggregate.get(key) || [];
    group.push(row);
    rowsByFormerAggregate.set(key, group);
  });
  for (const group of rowsByFormerAggregate.values()) {
    for (const column of columns) {
      const percent = group[0][column.key];
      const bases = column.derivesFrom
        ? group.map((row) => row.amounts[column.derivesFrom])
        : group.map((row) => row.revenueBeforeVat);
      if (bases.some((base) => !Number.isFinite(base))) continue;
      const target = calculateAmount(bases.reduce((sum, base) => sum + base, 0), percent);
      const currentAmounts = group.map((row) => row.amounts[column.key]);
      if (target == null || currentAmounts.some((amount) => !Number.isFinite(amount))) continue;
      const current = currentAmounts.reduce((sum, amount) => sum + amount, 0);
      const residual = target - current;
      if (!residual) continue;
      const row = group.at(-1);
      row.amounts[column.key] += residual;
      if (column.annual) row.rowAnnualTotal += residual;
      else row.rowMonthlyTotal += residual;
      if (row.dailyAmounts?.[row.date]) row.dailyAmounts[row.date][column.key] += residual;
    }
  }

  const monthlyMatchedTotal = rows.reduce((sum, row) => sum + (row.rowMonthlyTotal || 0), 0);
  const annualMatchedTotal = rows.reduce((sum, row) => sum + (row.rowAnnualTotal || 0), 0);

  // Match quality is measured on unique unit+product keys, while the rendered
  // detail remains at order-line grain. This prevents repeated order lines
  // from distorting the fail-closed 90% coverage threshold.
  const matchedRows = matchedKeys.size;
  const totalRows = revenueKeys.size;
  const hasGroundedRows = totalRows > 0 && columns.length > 0;
  const rate = totalRows ? +(matchedRows / totalRows * 100).toFixed(1) : null;
  const low = rate != null && rate < threshold;
  const annualLabels = columns.filter((column) => column.annual).map((column) => column.label);
  const dailyReliable = hasGroundedRows && !low && dailyRowsReliable && matchedRows === totalRows;
  const dates = dailyReliable ? [...allDates].sort() : [];
  const dayTotals = dates.map((date) => {
    let monthlyTotal = 0;
    let annualTotal = 0;
    for (const row of rows.filter((candidate) => candidate.date === date)) {
      monthlyTotal += row.rowMonthlyTotal || 0;
      annualTotal += row.rowAnnualTotal || 0;
    }
    return { date, monthlyTotal, annualTotal };
  });
  const dayMonthlyTotal = dayTotals.reduce((sum, day) => sum + day.monthlyTotal, 0);
  const dayAnnualTotal = dayTotals.reduce((sum, day) => sum + day.annualTotal, 0);
  const reconciled = dailyReliable && dayMonthlyTotal === monthlyMatchedTotal && dayAnnualTotal === annualMatchedTotal;
  const columnTotals = !hasGroundedRows || low ? null : Object.fromEntries(columns.map((column) => [
    column.key,
    rows.reduce((sum, row) => sum + (Number.isFinite(row.amounts[column.key]) ? row.amounts[column.key] : 0), 0),
  ]));
  const basePayload = { ...payload };
  if (rows.length) delete basePayload.note;
  return {
    ...basePayload,
    period: String(options.period || ''),
    template: {
      key: template.key,
      label: template.label,
      calculationGroup: template.calculationGroup,
      columns: template.columns,
    },
    columns,
    rows,
    match: { matchedRows, totalRows, rate, threshold, low },
    summary: {
      reliable: hasGroundedRows && !low,
      monthlyTotal: !hasGroundedRows || low ? null : monthlyMatchedTotal,
      annualTotal: !hasGroundedRows || low ? null : annualMatchedTotal,
      revenueTotal: rows.reduce((sum, row) => sum + row.revenue, 0),
      revenueBeforeVatTotal: rows.reduce((sum, row) => sum + row.revenueBeforeVat, 0),
      columnTotals,
      annualColumnKeys: columns.filter((column) => column.annual).map((column) => column.key),
      annualLabels,
    },
    daily: {
      reliable: reconciled,
      reason: reconciled ? '' : 'Dữ liệu doanh thu ngày thiếu hoặc không khớp tổng tháng',
      dates: reconciled ? dates : [],
      totals: reconciled ? dayTotals : [],
    },
  };
}

function enrichRangePayload(payload, options = {}) {
  const revenueByPeriod = options.revenueRowsByPeriod || {};
  const catalogByPeriod = options.catalogRowsByPeriod || {};
  const periods = (payload.periods || []).map((periodPayload) => enrichWithRevenue(periodPayload, {
    ...options,
    period: periodPayload.period,
    revenueRows: revenueByPeriod[periodPayload.period] || [],
    catalogRows: catalogByPeriod[periodPayload.period] || [],
  }));
  const totalRows = periods.reduce((sum, period) => sum + period.match.totalRows, 0);
  const matchedRows = periods.reduce((sum, period) => sum + period.match.matchedRows, 0);
  const reliable = periods.length > 0 && periods.every((period) => period.summary.reliable);
  const columnKeys = [...new Set(periods.flatMap((period) => period.columns.map((column) => column.key)))];
  return {
    ...payload,
    template: periods[0]?.template || null,
    periods,
    match: {
      matchedRows,
      totalRows,
      rate: totalRows ? +(matchedRows / totalRows * 100).toFixed(1) : null,
      threshold: configuredMatchWarningPercent(options.matchWarningPercent),
      low: periods.some((period) => period.match.low),
    },
    summary: {
      reliable,
      periodTotal: reliable ? periods.reduce((sum, period) => sum + period.summary.monthlyTotal, 0) : null,
      annualTotal: reliable ? periods.reduce((sum, period) => sum + period.summary.annualTotal, 0) : null,
      revenueTotal: periods.reduce((sum, period) => sum + period.summary.revenueTotal, 0),
      revenueBeforeVatTotal: periods.reduce((sum, period) => sum + period.summary.revenueBeforeVatTotal, 0),
      columnTotals: reliable ? Object.fromEntries(columnKeys.map((key) => [
        key,
        periods.reduce((sum, period) => sum + (period.summary.columnTotals?.[key] || 0), 0),
      ])) : null,
      annualColumnKeys: [...new Set(periods.flatMap((period) => period.summary.annualColumnKeys || []))],
    },
  };
}

function isTransient(error) {
  return error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || error?.code === 'ETIMEDOUT'
    || error?.status === 502;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchEmployeeCost(empCode, options = {}) {
  const baseUrl = resolveDataHubBaseUrl(options.baseUrl);
  const assignmentKey = String(options.assignmentKey ?? process.env.DATA_HUB_ASSIGNMENT_KEY ?? '').trim();
  const employeeCostKeys = parseEmployeeCostKeys(options.employeeCostKeys ?? process.env.APP_REPORT_EMPLOYEE_COST_KEYS);
  const employeeCostKey = employeeCostKeys.get(normEmp(empCode)) || '';
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Math.max(100, Number(options.timeoutMs ?? process.env.APP_REPORT_COST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const backoffMs = options.backoffMs || DEFAULT_BACKOFF_MS;
  const sleepImpl = options.sleepImpl || sleep;
  const range = options.from != null || options.to != null ? parseMonthRange(options) : null;

  // Cost reads require both independent server-side credentials. A missing,
  // malformed, duplicated or reused key fails before any network request.
  if (!baseUrl || !assignmentKey || !employeeCostKey || employeeCostKey === assignmentKey || typeof fetchImpl !== 'function') {
    return { payload: range ? emptyRangePayload(empCode, range) : emptyPayload(empCode, DEFAULT_NOTE), outcome: 'not_configured', attempts: 0 };
  }

  const params = new URLSearchParams({ emp: normEmp(empCode) });
  if (range) {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  const url = `${baseUrl}${CONTRACT_PATH}?${params.toString()}`;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            'x-assignment-key': assignmentKey,
            'x-employee-cost-key': employeeCostKey,
            accept: 'application/json',
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const error = new Error('employee cost upstream failed');
        error.status = response.status;
        throw error;
      }
      const raw = await response.json();
      if (normEmp(raw?.empCode) !== normEmp(empCode)) {
        return { payload: range ? emptyRangePayload(empCode, range) : emptyPayload(empCode, DEFAULT_NOTE), outcome: 'scope_mismatch', attempts };
      }
      if (range) {
        const adapted = adaptPeriodPayload(raw, empCode, range);
        if (!adapted) return { payload: emptyRangePayload(empCode, range), outcome: 'invalid_period_payload', attempts };
        return { payload: adapted, outcome: 'ok', attempts };
      }
      return { payload: sanitizePayload(raw, empCode), outcome: 'ok', attempts };
    } catch (error) {
      const retryIndex = attempts - 1;
      if (isTransient(error) && retryIndex < backoffMs.length) {
        await sleepImpl(backoffMs[retryIndex]);
        continue;
      }
      const unauthorized = error?.status === 401;
      return {
        // FE luôn nhận thông báo rỗng chung; nguyên nhân 401 chỉ nằm trong audit/log admin.
        payload: range ? emptyRangePayload(empCode, range) : emptyPayload(empCode, DEFAULT_NOTE),
        outcome: unauthorized ? 'upstream_unauthorized' : (error?.status ? `upstream_${error.status}` : 'upstream_unavailable'),
        attempts,
      };
    }
  }
}

function resolveDataHubBaseUrl(value) {
  return String(value ?? process.env.DATA_HUB_BASE_URL ?? process.env.DATAHUB_BASE ?? '').trim().replace(/\/$/, '');
}

function auditFilters(value = {}) {
  const output = {};
  for (const key of ['province', 'unitGroup', 'route', 'q', 'sortKey', 'sortDir']) {
    const item = safeText(value?.[key], key === 'q' ? 200 : 120);
    if (item) output[key] = item;
  }
  return output;
}

function writeAudit({ actor, role, empCode, outcome, attempts, match, filters, event = 'view' }) {
  const rows = persist.load(AUDIT_FILE, []);
  const safeFilters = auditFilters(filters);
  rows.push({
    at: new Date().toISOString(),
    event: String(event || 'view'),
    actor: normEmp(actor) || 'UNKNOWN',
    role: String(role || '').toLowerCase() || 'unknown',
    empCode: normEmp(empCode),
    outcome: String(outcome || 'unknown'),
    attempts: Number(attempts || 0),
    ...(Object.keys(safeFilters).length ? { filters: safeFilters } : {}),
    ...(match ? {
      revenueMatch: {
        matchedRows: Number(match.matchedRows || 0),
        totalRows: Number(match.totalRows || 0),
        rate: match.rate == null ? null : Number(match.rate),
        low: !!match.low,
      },
    } : {}),
  });
  persist.save(AUDIT_FILE, rows.slice(-AUDIT_LIMIT));
}

async function getForSession({ session, scope, requestedEmp }, options = {}) {
  const audit = (entry) => {
    try { (options.auditImpl || writeAudit)(entry); }
    catch { console.warn('[employee-cost] audit write failed', { actor: normEmp(session?.emp_code), empCode: entry.empCode }); }
  };
  const empCode = resolveScopedEmployee({ session, scope, requestedEmp });
  const range = options.from != null || options.to != null ? parseMonthRange(options) : null;
  if (!empCode) {
    const result = { payload: range ? emptyRangePayload('', range) : emptyPayload('', DEFAULT_NOTE), outcome: 'missing_emp', attempts: 0 };
    audit({ actor: session?.emp_code, role: session?.role, empCode, event: options.auditEvent || 'view', outcome: result.outcome, attempts: result.attempts, filters: options.auditFilters });
    return result.payload;
  }
  const result = await fetchEmployeeCost(empCode, options);
  // Revenue belongs to App Report and must stay useful even while the DataHub
  // cost timeline is unavailable/not configured. In that state enrichment
  // preserves every order-line and leaves percentages/amounts as null (—).
  if (range && options.revenueRowsByPeriod && options.catalogRowsByPeriod) {
    result.payload = enrichRangePayload(result.payload, options);
  } else if (Array.isArray(options.revenueRows) && Array.isArray(options.catalogRows)) {
    result.payload = enrichWithRevenue(result.payload, options);
  }
  audit({
    actor: session?.emp_code,
    role: session?.role,
    empCode,
    event: options.auditEvent || 'view',
    outcome: result.outcome,
    attempts: result.attempts,
    match: result.payload.match,
    filters: options.auditFilters,
  });
  if (result.outcome !== 'ok') {
    // Deliberately generic: never print response bodies, request headers or token.
    console.warn('[employee-cost] upstream unavailable', { actor: normEmp(session?.emp_code), empCode, outcome: result.outcome, attempts: result.attempts });
  } else if (result.payload.match?.low) {
    console.warn('[employee-cost] revenue match below threshold', {
      actor: normEmp(session?.emp_code), empCode, period: result.payload.period,
      matchedRows: result.payload.match.matchedRows, totalRows: result.payload.match.totalRows,
      rate: result.payload.match.rate, threshold: result.payload.match.threshold,
    });
  }
  return result.payload;
}

module.exports = {
  CONTRACT_PATH,
  DIMENSION_KEYS,
  DEFAULT_NOTE,
  DEFAULT_ANNUAL_COLUMN_KEYS,
  DEFAULT_MATCH_WARNING_PERCENT,
  NOTE_KEY,
  VAT_DIVISOR,
  currentMonth,
  normalizeMonth,
  toUiMonth,
  monthsBetween,
  parseMonthRange,
  parseEmployeeCostKeys,
  resolveScopedEmployee,
  isAllowedDynamicKey,
  sanitizePayload,
  emptyPayload,
  emptyRangePayload,
  adaptPeriodPayload,
  configuredAnnualColumnKeys,
  configuredMatchWarningPercent,
  safeText,
  authoritativeProvinceByUnit,
  buildProductCatalogIndex,
  resolveProductCode,
  buildRevenueIndex,
  buildRevenueLines,
  buildRevenueDetail,
  buildCostLookup,
  calculateAmount,
  revenueBeforeVatOf,
  calculateDailyAmounts,
  enrichWithRevenue,
  enrichRangePayload,
  fetchEmployeeCost,
  resolveDataHubBaseUrl,
  getForSession,
};
