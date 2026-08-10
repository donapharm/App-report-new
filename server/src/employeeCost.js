'use strict';

const persist = require('./persist');
const { VAT_DIVISOR } = require('./analytics');
const employeeCostTemplates = require('./employeeCostTemplates');
const employeeCostUnitGroups = require('./employeeCostUnitGroups');
const rateSnapshot = require('./employeeCostRateSnapshot');
const reconciliationShadow = require('./employeeCostReconciliationShadow');
const reconciliationAllocationV4 = require('./employeeCostReconAllocationV4');

const CONTRACT_PATH = '/api/integrations/app-report/employee-cost';
const DIMENSION_KEYS = Object.freeze(['c5', 'c7', 'c16', 'c25']);
const PERMANENT_BLOCKED = new Set(['c32', 'c47']);
const DEFAULT_NOTE = 'chưa có dữ liệu chi phí kỳ này';
const DEFAULT_TIMEOUT_MS = 6500;
const DEFAULT_BACKOFF_MS = Object.freeze([2000, 4000]);
// ‼ Ngân sách chờ tệ nhất của đường mặc định: 6,5 + 2 + 6,5 + 4 + 6,5 ≈ **25 giây**.
// Nguồn kẹt là NV ngồi nhìn màn hình quay ngần ấy giây rồi mới thấy lỗi — đúng cái
// CEO gọi là "kẹt". Khi ĐÃ CÓ bản lưu tỷ lệ thì không có lý do gì phải chờ như vậy:
// hỏi nhanh, không hỏi lại; quá hạn thì trả số cũ NGAY rồi làm tươi ngầm phía sau.
const FAST_TIMEOUT_MS = 2000;
const VERIFIED_PREFETCH_MAX_AGE_MS = 2 * 60 * 1000;
const backgroundRefreshInFlight = new Map();
/* ‼ NGUỒN KẸT NHƯNG CÒN BẢN % ĐÃ LƯU ⇒ SỐ VẪN DÙNG ĐƯỢC (CEO 09/08/2026).
 *
 * `ok_stale_rates` sinh ra ở `fetchEmployeeCost` khi cửa chi phí DataHub trễ/đứt mà
 * kho `rateSnapshot` còn bản % gần nhất — đúng luật SPEC_COST_RATES_LOCAL_SYNC: *"kẹt
 * thì dùng bản gần nhất và NÓI RA là số cũ"*. Nhưng mọi nơi đọc kết quả đều viết
 * `outcome !== 'ok'`, nên bản cũ vừa khôi phục xong lập tức bị tuyên là "chưa lấy
 * được dữ liệu" — lưới an toàn coi như KHÔNG TỒN TẠI. Đó chính là lý do màn chi phí
 * "khi thì đủ, khi thì thiếu" và bot nhắn tin báo thiếu cho NV mỗi lần nguồn chớp.
 *
 * Một danh sách duy nhất ở đây, mọi nơi hỏi qua `isUsableOutcome`. RIÊNG việc suy ra
 * "kỳ hiệu lực chính xác" (`rateEffectiveFrom`) VẪN đòi `ok` thật — số cũ dùng để
 * hiển thị được, nhưng không được đóng dấu là chính sách của kỳ này.
 */
const USABLE_OUTCOMES = Object.freeze(['ok', 'ok_stale_rates']);
const isUsableOutcome = (outcome) => USABLE_OUTCOMES.includes(String(outcome || ''));

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

// ── KHOÁ SỔ KỲ: HẾT NGÀY 8 THÁNG SAU (CEO chốt 2026-07-30) ───────────────────
// CEO: "từ ngày 05 tháng sau đổ về trước thì dùng từ DỰ KIẾN vì còn cập nhật lại
// doanh thu... đẹp nhất là trước ngày 08 cho rộng rãi để chốt" → chốt ngày 08.
//
// ‼ Trước đây code coi kỳ là ĐÃ CHỐT ngay khi sang tháng mới (`kỳ < tháng hiện
// tại`), tức 00:00 ngày 01 đã dán nhãn "ĐÃ CHỐT KỲ" trong khi doanh thu còn về
// tới ngày 8. Mọi chỗ hỏi "kỳ này chốt chưa" phải dùng ĐÚNG hàm dưới đây.
//
// Ngày tính theo GIỜ VIỆT NAM (Asia/Bangkok, UTC+7 không có DST) — server chạy
// UTC nên nếu lấy giờ máy thì quanh nửa đêm sẽ lệch một ngày.
const PERIOD_CLOSE_DAY = 8;

function vnToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now instanceof Date ? now : new Date(now));
}

// Ngày khoá sổ của kỳ = ngày 08 của THÁNG SAU. Trả 'YYYY-MM-DD'.
function periodCloseDate(period, closeDay = PERIOD_CLOSE_DAY) {
  const month = normalizeMonth(period);
  if (!month) return '';
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const nextYear = index === 12 ? year + 1 : year;
  const nextMonth = index === 12 ? 1 : index + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(closeDay).padStart(2, '0')}`;
}

// Đã chốt = đã QUA hết ngày khoá sổ. 23:59 ngày 08 vẫn CHƯA chốt; 00:00 ngày 09
// mới chốt. Truyền `today` để test không phụ thuộc đồng hồ thật.
function isPeriodClosed(period, today = vnToday(), closeDay = PERIOD_CLOSE_DAY) {
  const close = periodCloseDate(period, closeDay);
  if (!close) return false;
  return String(today) > close;
}

// Câu mô tả trạng thái khoá sổ, KHÔNG kèm tiền tố "DỰ KIẾN"/"ĐÃ CHỐT KỲ" — để nơi
// gọi tự ghép tiền tố theo ngữ cảnh, tránh lặp "DỰ KIẾN — DỰ KIẾN —".
function periodCloseNote(period, today = vnToday(), closeDay = PERIOD_CLOSE_DAY) {
  const close = periodCloseDate(period, closeDay);
  if (!close) return '';
  const dmy = close.split('-').reverse().join('/');
  return isPeriodClosed(period, today, closeDay)
    ? `đã khoá sổ hết ngày ${dmy}`
    : `doanh thu còn cập nhật đến hết ngày ${dmy}`;
}

// Nhãn đầy đủ cho chỗ hiển thị độc lập (không nằm sau tiền tố nào).
function periodCloseLabel(period, today = vnToday(), closeDay = PERIOD_CLOSE_DAY) {
  const note = periodCloseNote(period, today, closeDay);
  if (!note) return '';
  return isPeriodClosed(period, today, closeDay)
    ? `ĐÃ CHỐT KỲ — số chính thức, ${note}`
    : `DỰ KIẾN — ${note}`;
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

function catalogUnitCodeOf(row = {}) {
  const raw = normCode(row.DONVI ?? row.donvi ?? '');
  // Legacy uploads can carry both unit_code="171" (the short cost-join key)
  // and DONVI="171.PKĐK NAM VIỆT" (the exact C7 catalog key). Vault must get
  // the latter, so prefer a valid full raw DONVI over every short alias.
  if (raw.includes('.') && !raw.startsWith('.') && !raw.endsWith('.')) return raw;
  const direct = normCode(row.unit_code ?? row.c7 ?? row.UNIT_CODE ?? row.C7);
  // Preserve the direct value for existing employee-cost display/filter paths.
  // If it is only a prefix, employeeCostGaps rejects it before worklist sync.
  return direct;
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

function authoritativeProvinceByUnit(revenueRows = []) {
  const candidates = new Map();
  const add = (row) => {
    const unit = unitCodeOf(row);
    const province = safeText(displayValue(row, ['province', 'PROVINCE', 'tinh', 'TINH']), 120);
    const source = String(row?.province_source || '').trim().toLowerCase();
    if (!unit || !province || ['inferred', 'guessed_from_name', 'catalog'].includes(source)) return;
    const values = candidates.get(unit) || new Map();
    values.set(normName(province), province);
    candidates.set(unit, values);
  };
  for (const row of Array.isArray(revenueRows) ? revenueRows : []) add(row);
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
    // C7 canonical used for catalog/worklist joins. Keep it separate from c7:
    // c7 is the human-facing company/unit name and must never be reused as a
    // join key when App Report sends a repair worklist to CEO Vault.
    unitCode: catalogUnitCodeOf(revenueRow) || unit,
    // Hai field chỉ làm metadata lọc backend, không tham gia công thức chi phí.
    // Province chỉ tồn tại khi dòng doanh thu/config chính thức của cùng mã đơn vị
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
    // CEO 2026-07-27: hiện nhóm ưu tiên C10 ngay cạnh mã QLNB trong bảng chi phí —
    // đây là căn cứ chia thưởng P2, phải nhìn thấy tại chỗ. Lấy từ catalog (SSOT);
    // thiếu thì ĐỂ TRỐNG, không suy đoán — chỗ trống chính là dấu hiệu cần bổ sung.
    c10: safeText(displayValue(catalogRow, ['c10', 'C10'])
      ?? displayValue(revenueRow, ['c10', 'C10']), 20),
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

function revenueImmutableLineIdOf(row = {}) {
  return String(displayValue(row, ['source_line_id', 'line_id', 'SOURCE_LINE_ID', 'LINE_ID']) || '').trim();
}

function revenueLineIdOf(row = {}, index = 0) {
  return revenueImmutableLineIdOf(row) || `line-${index + 1}`;
}

function revenueQuantityOf(row = {}) {
  const raw = row.quantity ?? row.so_luong ?? row.QUANTITY ?? row.SO_LUONG;
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function contractorCodeOf(row = {}) {
  return reconciliationShadow.normalizeContractorCode(
    displayValue(row, ['contractor_code', 'contractorCode', 'contractor', 'CONTRACTOR_CODE']),
  );
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
  const provinceByUnit = authoritativeProvinceByUnit(options.revenueRows);
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
      // Additive display-only metadata. These shadow fields never participate
      // in cost formulas, summaries, KPI, exports, or notifications.
      shadowReconciledQuantity: line.source?.shadowReconciledQuantity ?? null,
      shadowQuantityDelta: line.source?.shadowQuantityDelta ?? null,
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
  // Tổng theo cột tính trên các dòng ĐÃ khớp %. `columnTotals` giữ nguyên hành vi
  // fail-closed cũ (null khi coverage < ngưỡng) để export/nơi khác không đổi.
  // `provisional*` LUÔN được tính để UI hiển thị "tạm tính" kèm nhãn rõ coverage,
  // thay vì bỏ trống làm CEO tưởng hỏng. Đây là số của phần đã khớp, chưa gồm
  // phần thiếu % — nhãn ở UI phải nói rõ điều đó.
  const provisionalColumnTotals = Object.fromEntries(columns.map((column) => [
    column.key,
    rows.reduce((sum, row) => sum + (Number.isFinite(row.amounts[column.key]) ? row.amounts[column.key] : 0), 0),
  ]));
  const columnTotals = !hasGroundedRows || low ? null : provisionalColumnTotals;
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
      provisionalMonthlyTotal: monthlyMatchedTotal,
      provisionalAnnualTotal: annualMatchedTotal,
      provisionalColumnTotals,
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


async function applyReconciliationShadow(payload, empCode, options = {}) {
  const shadowOptions = options.reconciliationShadow || {};
  const allocationOptions = options.reconciliationAllocationV4 || {};
  const auditEvent = String(options.auditEvent || 'view');
  // Synthetic variance is a display-only explanation row. Keep it out of every
  // calculation/send/export path; warm_all builds the same base cache used by
  // the interactive all-employee view, so it intentionally retains the row.
  const includeAllocationSynthetic = auditEvent === 'view' || auditEvent === 'view_all'
    || auditEvent.startsWith('warm_all:');
  const periods = Array.isArray(payload?.periods) ? payload.periods : (payload?.rows ? [payload] : []);
  const scopes = [];
  const plans = new Map();
  for (const periodPayload of periods) {
    const period = normalizeMonth(periodPayload.period || options.period);
    const revenueRows = options.revenueRowsByPeriod?.[period]
      ?? (normalizeMonth(options.period) === period ? options.revenueRows : []);
    const sourceContractors = new Map();
    for (const line of buildRevenueLines(revenueRows, empCode, period)) {
      // The display path synthesizes a line id when the source lacks one. Never
      // use that convenience fallback as immutable reconciliation identity.
      const identity = reconciliationShadow.exactIdentity({
        sourceLineId: revenueImmutableLineIdOf(line.source), orderCode: line.orderCode, employeeCode: empCode,
      });
      const contractorCode = contractorCodeOf(line.source);
      if (!identity || !contractorCode) continue;
      const candidates = sourceContractors.get(identity) || new Set();
      candidates.add(contractorCode);
      sourceContractors.set(identity, candidates);
    }
    const rowPlans = (periodPayload.rows || []).map((row) => {
      const identity = reconciliationShadow.exactIdentity(row, empCode);
      const candidates = sourceContractors.get(identity);
      const contractorCode = candidates?.size === 1 ? [...candidates][0] : '';
      if (contractorCode) scopes.push({ period, contractorCode });
      return contractorCode;
    });
    plans.set(periodPayload, rowPlans);
  }
  const snapshots = await reconciliationShadow.loadScopes(scopes, shadowOptions);
  // V4 may only consume the exact VP018-confirmed v3 version/checksum already
  // accepted for this scope. This avoids a second unpinned "latest" read and
  // lets the existing App Sale URL/key configuration remain unchanged.
  const allocationScopes = [];
  for (const [scopeKey, snapshot] of snapshots) {
    const confirmedAt = typeof snapshot?.confirmed_at === 'string' ? snapshot.confirmed_at : '';
    if (snapshot?.confirmed_by !== 'VP018'
      || !Number.isSafeInteger(snapshot?.reconciliation_version)
      || !/^[a-f0-9]{64}$/.test(String(snapshot?.reconciliation_rows_checksum_v2 || ''))
      || !Number.isFinite(Date.parse(confirmedAt))
      || new Date(confirmedAt).toISOString() !== confirmedAt) continue;
    const [period, contractorCode] = scopeKey.split('\u001f');
    allocationScopes.push({
      period,
      contractorCode,
      reconciliationVersion: snapshot.reconciliation_version,
      reconciliationRowsChecksumV2: snapshot.reconciliation_rows_checksum_v2,
      reconciliationConfirmedAt: confirmedAt,
    });
  }
  const allocationSnapshots = await reconciliationAllocationV4.loadScopes(allocationScopes, allocationOptions);
  for (const periodPayload of periods) {
    const period = normalizeMonth(periodPayload.period || options.period);
    const rowPlans = plans.get(periodPayload) || [];
    // A cost-policy payload with no revenue identities is not a reconciliation
    // target; leave its existing shape byte-for-byte unchanged.
    if (!rowPlans.some(Boolean)) continue;
    const grouped = new Map();
    (periodPayload.rows || []).forEach((row, index) => {
      const contractorCode = rowPlans[index];
      if (!contractorCode) return;
      const group = grouped.get(contractorCode) || [];
      group.push({ row, index });
      grouped.set(contractorCode, group);
    });
    const projected = (periodPayload.rows || []).map((row) => ({
      ...row, shadowReconciledQuantity: null, shadowQuantityDelta: null,
    }));
    const syntheticRows = [];
    const allocationTotals = [];
    for (const [contractorCode, group] of grouped) {
      const scopeKey = `${period}\u001f${contractorCode}`;
      const snapshot = snapshots.get(scopeKey);
      // Preserve the v3 fail-closed baseline: without an accepted v3 snapshot,
      // leave the pre-initialized shadow fields null and never let V4 restore
      // stale/input values for this group.
      if (!snapshot) continue;
      const rows = reconciliationShadow.projectEmployeeCostRows(group.map((item) => item.row), snapshot, { employeeCode: empCode });
      const allocationSnapshot = allocationSnapshots.get(scopeKey);
      const result = reconciliationAllocationV4.projectEmployeeCostRows(rows, allocationSnapshot, {
        employeeCode: empCode,
        expected: snapshot ? {
          period,
          contractorCode,
          reconciliationVersion: snapshot.reconciliation_version,
          reconciliationRowsChecksumV2: snapshot.reconciliation_rows_checksum_v2,
          reconciliationConfirmedAt: snapshot.confirmed_at,
        } : {},
        includeSynthetic: includeAllocationSynthetic,
      });
      result.rows.slice(0, group.length).forEach((row, offset) => { projected[group[offset].index] = row; });
      syntheticRows.push(...result.rows.slice(group.length));
      if (result.totals) allocationTotals.push(result.totals);
    }
    periodPayload.rows = [...projected, ...syntheticRows];
    if (allocationTotals.length) periodPayload.shadowReconciliationTotals = {
      orderedQuantity: allocationTotals.reduce((sum, item) => sum + item.orderedQuantity, 0),
      reconciledQuantity: allocationTotals.reduce((sum, item) => sum + item.reconciledQuantity, 0),
      quantityDelta: allocationTotals.reduce((sum, item) => sum + item.quantityDelta, 0),
      employeeVarianceRows: allocationTotals.reduce((sum, item) => sum + item.employeeVarianceRows, 0),
      // Count only; no mixed-employee identity is projected into an employee row.
      mixedEmployeeVarianceCount: allocationTotals.reduce((sum, item) => sum + item.mixedEmployeeVarianceCount, 0),
    };
  }
  return payload;
}

function isTransient(error) {
  return error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || error?.code === 'ETIMEDOUT'
    || error?.status === 502;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Metadata kỳ chỉ dùng làm provenance cho chính sách tỷ lệ. Không suy kỳ từ
// nội dung dòng: DataHub phải trả đủ `from/to`, đúng dạng và không đảo chiều.
function sourcePeriodRangeOf(raw) {
  const from = normalizeMonth(raw?.from);
  const to = normalizeMonth(raw?.to);
  return from && to && from <= to ? { from, to } : null;
}

// Gọi mạng thuần — KHÔNG kèm kế thừa tỷ lệ. Chỉ `applyEffectiveRates` được dùng
// hàm này (nếu không sẽ đệ quy vô hạn). Mọi nơi khác phải dùng `fetchEmployeeCost`.
async function fetchRawEmployeeCost(empCode, options = {}) {
  const baseUrl = resolveDataHubBaseUrl(options.baseUrl);
  const assignmentKey = String(options.assignmentKey ?? process.env.DATA_HUB_ASSIGNMENT_KEY ?? '').trim();
  const employeeCostKeys = parseEmployeeCostKeys(options.employeeCostKeys ?? process.env.APP_REPORT_EMPLOYEE_COST_KEYS);
  const employeeCostKey = employeeCostKeys.get(normEmp(empCode)) || '';
  const fetchImpl = options.fetchImpl || global.fetch;
  const configuredTimeoutMs = Math.max(100, Number(options.timeoutMs ?? process.env.APP_REPORT_COST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const deadlineAt = Number(options.deadlineAt || 0);
  const backoffMs = options.backoffMs || DEFAULT_BACKOFF_MS;
  const sleepImpl = options.sleepImpl || sleep;
  const range = options.from != null || options.to != null ? parseMonthRange(options) : null;
  const unavailable = (attempts = 0) => ({
    payload: range ? emptyRangePayload(empCode, range) : emptyPayload(empCode, DEFAULT_NOTE),
    outcome: 'upstream_unavailable', attempts,
  });
  if (deadlineAt > 0 && deadlineAt <= Date.now()) return unavailable(0);

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
    const remainingMs = deadlineAt > 0 ? deadlineAt - Date.now() : configuredTimeoutMs;
    if (deadlineAt > 0 && remainingMs <= 0) return unavailable(attempts);
    const attemptTimeoutMs = Math.max(1, Math.min(configuredTimeoutMs, remainingMs));
    attempts += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
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
      const sourceRange = sourcePeriodRangeOf(raw);
      if (range) {
        const adapted = adaptPeriodPayload(raw, empCode, range);
        const hasPolicyRows = adapted?.periods?.some((period) => Array.isArray(period.rows) && period.rows.length > 0);
        const provenanceMatchesRequest = sourceRange?.from === range.from && sourceRange?.to === range.to;
        // Có tỷ lệ nhưng provenance không đúng CHÍNH XÁC range đã hỏi thì không
        // được coi là snapshot exact. Xóa toàn bộ payload và chuyển qua lookup
        // policy mới nhất; nhờ vậy T07 không thể bị gắn ngầm thành exact T08.
        if (!adapted || (hasPolicyRows && !provenanceMatchesRequest)) {
          return { payload: emptyRangePayload(empCode, range), outcome: 'invalid_period_payload', attempts, sourceRange };
        }
        return { payload: adapted, outcome: 'ok', attempts, sourceRange };
      }
      return { payload: sanitizePayload(raw, empCode), outcome: 'ok', attempts, sourceRange };
    } catch (error) {
      const retryIndex = attempts - 1;
      if (isTransient(error) && retryIndex < backoffMs.length) {
        const delayMs = Math.max(0, Number(backoffMs[retryIndex]) || 0);
        // A common deadline includes retry sleep as well as fetch time. Never start
        // a retry that cannot fit its backoff inside the remaining cycle budget.
        if (deadlineAt > 0 && Date.now() + delayMs >= deadlineAt) return unavailable(attempts);
        await sleepImpl(delayMs);
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
  for (const key of ['province', 'unitGroup', 'route', 'date', 'q', 'sortKey', 'sortDir']) {
    const item = safeText(value?.[key], key === 'q' ? 200 : 120);
    if (item) output[key] = item;
  }
  return output;
}

function writeAudit({ actor, role, empCode, outcome, attempts, match, filters, range, ratePolicy, event = 'view' }) {
  const rows = persist.load(AUDIT_FILE, []);
  const safeFilters = auditFilters(filters);
  const rangeFrom = normalizeMonth(range?.from);
  const rangeTo = normalizeMonth(range?.to);
  const effectiveFrom = normalizeMonth(ratePolicy?.effectiveFrom);
  rows.push({
    at: new Date().toISOString(),
    event: String(event || 'view'),
    actor: normEmp(actor) || 'UNKNOWN',
    role: String(role || '').toLowerCase() || 'unknown',
    empCode: normEmp(empCode),
    outcome: String(outcome || 'unknown'),
    attempts: Number(attempts || 0),
    ...(rangeFrom && rangeTo ? { range: { from: rangeFrom, to: rangeTo } } : {}),
    ...(ratePolicy ? {
      ratePolicy: {
        state: String(ratePolicy.state || 'unknown'),
        lookupOutcome: String(ratePolicy.lookupOutcome || 'unknown'),
        ...(effectiveFrom ? { effectiveFrom } : {}),
      },
    } : {}),
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

// ‼ CEO chốt 03/08/2026: tỷ lệ % là chính sách có hiệu lực liên tục. Khi tháng
// đang hỏi chưa có bản riêng, App Report lấy đúng bản công bố mới nhất từ endpoint
// không truyền kỳ và chỉ áp về PHÍA SAU. Không có giới hạn ba tháng tùy ý; chính
// sách tiếp tục hiệu lực cho tới khi DataHub công bố bản mới.
async function applyEffectiveRates(payload, empCode, options = {}, fetchLatest = fetchRawEmployeeCost) {
  const periods = Array.isArray(payload?.periods) ? payload.periods : null;
  if (!periods || !periods.some((period) => !period.rows?.length)) return payload;

  const { from, to, revenueRowsByPeriod, catalogRowsByPeriod, fetchOneImpl, ...lookupOptions } = options;
  const latest = await fetchLatest(empCode, lookupOptions);
  const sourceFrom = normalizeMonth(latest?.sourceRange?.from);
  const sourceTo = normalizeMonth(latest?.sourceRange?.to);
  const source = latest?.payload;
  const sourceRows = Array.isArray(source?.rows) ? source.rows : [];
  const provenanceValid = !!sourceFrom && sourceFrom === sourceTo;

  if (latest?.outcome !== 'ok') {
    payload.ratePolicy = { state: 'unavailable', lookupOutcome: String(latest?.outcome || 'unknown') };
    return payload;
  }
  if (!sourceRows.length) {
    payload.ratePolicy = { state: 'missing', lookupOutcome: 'ok' };
    return payload;
  }
  if (!provenanceValid) {
    payload.ratePolicy = { state: 'ambiguous', lookupOutcome: 'invalid_source_period' };
    return payload;
  }

  let applied = 0;
  for (const period of periods) {
    if (period.rows?.length || !normalizeMonth(period.period) || period.period < sourceFrom) continue;
    period.columns = source.columns;
    period.rows = source.rows;
    period.note = source.note;
    period.rateEffectiveFrom = sourceFrom;
    period.rateSource = 'carry_forward';
    applied += 1;
  }
  const unresolved = periods.filter((period) => !period.rows?.length).length;
  payload.ratePolicy = {
    state: applied ? (unresolved ? 'partial' : 'available') : 'not_applicable',
    lookupOutcome: 'ok',
    effectiveFrom: sourceFrom,
    appliedPeriods: applied,
    unresolvedPeriods: unresolved,
  };
  if (applied) payload.rateEffectiveFrom = sourceFrom;
  return payload;
}

// ‼ 04/08/2026 — MỘT ĐƯỜNG DUY NHẤT LẤY TỶ LỆ.
// Trước đó `applyEffectiveRates` chỉ chạy trong `getForSession`, còn
// `employeeCostGaps.js` gọi thẳng hàm mạng ⇒ ô KPI áp policy kế thừa T07 (khớp
// 20/20) trong khi badge "thiếu %" chỉ đọc đúng T08 (báo thiếu 20/20). Hai màn ra
// hai con số, UI phải fail-closed và CEO không xem được gì.
// Từ nay MỌI nơi lấy chi phí đều qua hàm này; không ai còn đường vòng.
/* ═══════════════════════════════════════════════════════════════════════════════
   ‼ KỲ ĐÃ CHỐT SỔ = ĐÓNG BĂNG — KHÔNG HỎI DATAHUB NỮA (CEO yêu cầu lần 2, 09/08/2026)

   CEO: *"T07.2026 đã chốt sổ rồi mà số liệu nó vẫn chạy tùm lum… cứ chạy quanh với
   đống dữ liệu nhảy lambada mệt lắm rồi."*

   GỐC của "lambada": kỳ ĐÃ CHỐT nhưng mỗi lần mở màn App Report vẫn đi hỏi DataHub
   TRỰC TIẾP. Nguồn chập chờn ⇒ lượt này 21/21 NV có số, lượt sau 3/21 ⇒ danh sách
   "chưa lấy được" đổi liên tục, target/tổng co giãn theo. Lưới stale chỉ đỡ được khi
   có bản lưu; nó vẫn là "đỡ đòn", không phải "hết đòn".

   LUẬT MỚI: kỳ nằm TRỌN sau ngày khoá sổ (hết ngày 5 tháng sau — SPEC_REVENUE_
   DELIVERY_PERIOD) VÀ kho cục bộ (CEO bấm "Đồng bộ % chi phí", all-or-nothing) có
   bản kỳ đó cho NV này ⇒ phục vụ THẲNG từ kho, KHÔNG gọi mạng. Số kỳ chốt vì thế
   BẤT BIẾN: hôm nay, mai, tháng sau mở ra đều y hệt — DataHub sống hay chết kệ nó.

   Ba chốt để không thành con dao khác:
   · Kỳ ĐANG CHẠY không bao giờ bị ghim — vẫn hỏi nguồn tươi như cũ.
   · Kho THIẾU kỳ/NV nào ⇒ rơi về đường cũ (hỏi nguồn + lưới stale), không chặn.
   · Bản ghim mang nhãn `rateSource: 'local_pinned'` + mốc đồng bộ — nói rõ số từ
     đâu ra, không giả làm số vừa kéo.
   ═══════════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════════
   ‼ ƯU TIÊN KHO % ĐÃ ĐỒNG BỘ, KHÔNG HỎI DATAHUB NỮA (CEO ra lệnh 2 lần, 10/08/2026)

   CEO: *"Tao đã yêu cầu lấy bên này không lấy bên DataHub về % chi phí nữa để không
   bị lỗi. Yêu cầu mày xử lý cả số liệu nạp trở lại đủ cho tao T07.2026."*

   Vì sao lệnh này đúng — bằng chứng từ chính màn của CEO: 23:05 hiện **359/359 dòng**,
   00:20 hiện **1.332/1.332 dòng**, cùng kỳ T07. Doanh thu "nhảy" vì màn ALL chỉ dựng
   được dòng của những NV **lấy được % từ DataHub**; DataHub trả chậm/đứt vài NV là
   doanh thu tụt theo — dù doanh thu là dữ liệu CỦA App Report, luôn đủ.

   Bản cũ chỉ dùng kho khi kỳ **đã khoá sổ** (`isPeriodClosed`). Kỳ đang chạy vẫn ra
   mạng mỗi lượt xem ⇒ vẫn nhảy. Nay: **kho có kỳ nào thì dùng kỳ đó**, đóng hay mở
   sổ đều vậy. Kho do CHÍNH CEO bấm "Đồng bộ % chi phí" nạp vào (all-or-nothing 21/21),
   có mốc giờ + tên người bấm, nên đây là bản số ỔN ĐỊNH và TRUY ĐƯỢC — khác hẳn việc
   mỗi lượt xem lại rút một bản khác nhau về.

   Muốn số mới ⇒ bấm "Đồng bộ % chi phí" lần nữa. Tắt hẳn cơ chế này bằng
   `APP_REPORT_COST_LOCAL_FIRST=0` (chỉ dùng khi cần đối chiếu với nguồn).
   ═══════════════════════════════════════════════════════════════════════════════ */
const COST_LOCAL_FIRST = String(process.env.APP_REPORT_COST_LOCAL_FIRST ?? '1') !== '0';

function pinnedClosedPayload(empCode, options = {}) {
  let range;
  try { range = parseMonthRange(options); } catch { return null; }
  if (!range || !Array.isArray(range.months) || !range.months.length) return null;
  const today = vnToday();
  const snapshotOptions = options.rateSnapshotStore ? { store: options.rateSnapshotStore } : {};
  const periods = [];
  let fetchedAt = '';
  let allClosed = true;
  for (const month of range.months) {
    const closed = isPeriodClosed(month, today);
    // Kỳ CHƯA khoá sổ vẫn được dùng kho — nhưng chỉ khi bật local-first. Tắt cờ thì
    // hành vi trở lại y như cũ (chỉ kỳ đã chốt mới đọc kho).
    if (!closed && !COST_LOCAL_FIRST) return null;
    if (!closed) allClosed = false;
    const local = rateSnapshot.readLocalSync(empCode, month, snapshotOptions);
    if (!local) return null;
    periods.push({ ...emptyPayload(empCode, DEFAULT_NOTE), period: month, columns: local.payload.columns, rows: local.payload.rows });
    if (!fetchedAt || String(local.fetchedAt) > fetchedAt) fetchedAt = String(local.fetchedAt || '');
  }
  return {
    empCode: normEmp(empCode),
    from: range.from,
    to: range.to,
    periods,
    note: DEFAULT_NOTE,
    // Phân biệt hai nghĩa: 'local_pinned' = kỳ đã chốt, số đóng băng vĩnh viễn;
    // 'local_sync' = kỳ đang chạy, số lấy từ lần CEO bấm đồng bộ gần nhất.
    rateSource: allClosed ? 'local_pinned' : 'local_sync',
    ratePinnedAt: fetchedAt || null,
  };
}

async function fetchEmployeeCost(empCode, options = {}) {
  const hasRange = options.from != null || options.to != null;
  const snapshotOptions = options.rateSnapshotStore ? { store: options.rateSnapshotStore } : {};

  // Kỳ đã chốt + kho có bản ⇒ trả thẳng, khỏi ra mạng. Đặt TRƯỚC mọi đường khác.
  if (hasRange) {
    const pinned = pinnedClosedPayload(empCode, options);
    if (pinned) {
      const result = { payload: pinned, outcome: 'ok', attempts: 0, pinned: true };
      result.payload = await applyEffectiveRates(result.payload, empCode, options, options.fetchOneImpl || fetchRawEmployeeCost);
      return result;
    }
  }

  // Đã có bản lưu cho mọi kỳ đang hỏi ⇒ KHÔNG tiêu ngân sách chờ 25 giây nữa.
  let fastPath = false;
  if (hasRange && options.timeoutMs == null) {
    try {
      const months = parseMonthRange(options).months;
      fastPath = rateSnapshot.covers(empCode, months, snapshotOptions);
    } catch { fastPath = false; }
  }
  const attemptOptions = fastPath ? { ...options, timeoutMs: FAST_TIMEOUT_MS, backoffMs: [] } : options;

  const result = await fetchRawEmployeeCost(empCode, attemptOptions);

  // Đường nhanh mà nguồn không kịp trả ⇒ dùng số cũ ngay, đồng thời làm tươi NGẦM
  // bằng ngân sách đầy đủ để lần sau có số mới. Lỗi nền không được nổi lên màn.
  if (fastPath && result.outcome !== 'ok' && options.backgroundRefresh !== false) {
    let refreshKey = normEmp(empCode);
    try {
      const range = parseMonthRange(options);
      refreshKey = `${refreshKey}:${range.from}:${range.to}`;
    } catch { /* un-ranged calls retain employee-only identity */ }
    let background = backgroundRefreshInFlight.get(refreshKey);
    if (!background) {
      background = fetchRawEmployeeCost(empCode, options)
        .then((fresh) => {
          if (fresh.outcome === 'ok') rateSnapshot.remember(empCode, fresh.payload, snapshotOptions);
          return fresh;
        })
        .catch(() => null)
        .finally(() => { if (backgroundRefreshInFlight.get(refreshKey) === background) backgroundRefreshInFlight.delete(refreshKey); });
      backgroundRefreshInFlight.set(refreshKey, background);
    }
    if (options.awaitBackgroundRefresh === true) await background;
  }
  // ‼ Nguồn DataHub kẹt (khoá mồ côi `vault-audit.lock`) từng làm 21 NV hiện 0đ.
  // Khoá tự lành phải sửa ở DataHub; phía App Report thì KHÔNG được mất số:
  // lấy được thì nhớ lại, kẹt thì dùng bản gần nhất và NÓI RA là số cũ.
  if (hasRange && result.outcome === 'ok') {
    try { rateSnapshot.remember(empCode, result.payload, snapshotOptions); } catch { /* kho hỏng không làm hỏng màn */ }
  } else if (hasRange) {
    // SPEC_COST_RATES_LOCAL_SYNC (CEO 08/08): kẹt KIỂU GÌ cũng rơi về bản đã lưu
    // trước khi fail-closed — kể cả `not_configured`. Bản đầu loại trừ nhánh đó,
    // nghĩa là một lần deploy hỏng cấu hình làm màn trắng NGAY dù kho còn số tốt.
    // Restore luôn gắn nhãn `rateStale` + mốc giờ nên không giấu gì: cấu hình hỏng
    // vẫn lộ qua cảnh báo nguồn, chỉ là NV không mất số oan trong lúc chờ sửa.
    try {
      if (rateSnapshot.restore(empCode, result.payload, snapshotOptions) > 0) result.outcome = 'ok_stale_rates';
    } catch { /* kho hỏng thì giữ nguyên fail-closed như cũ */ }
  }
  if (!hasRange || (result.outcome !== 'ok' && result.outcome !== 'invalid_period_payload')) return result;
  result.payload = await applyEffectiveRates(result.payload, empCode, options, options.fetchOneImpl || fetchRawEmployeeCost);
  // Payload range mơ hồ chỉ được phục hồi thành nguồn `ok` khi policy mới nhất đã
  // lấp ĐỦ mọi kỳ; còn kỳ trước ngày hiệu lực thì tiếp tục fail closed.
  if (result.outcome === 'invalid_period_payload'
    && result.payload.ratePolicy?.state === 'available'
    && Number(result.payload.ratePolicy?.unresolvedPeriods || 0) === 0) {
    result.outcome = 'ok';
  }
  return result;
}

// Probe evidence is deliberately local to one warm cycle. It binds the exact
// employee/range, source provenance and a short-lived verification timestamp; a raw
// `ok` result or an old/global object is never sufficient for promotion.
function verifiedPrefetchEvidence(result, empCode, options = {}) {
  let range;
  try { range = parseMonthRange(options); } catch { return null; }
  const verifiedAt = Number(options.verifiedAt ?? Date.now());
  if (!Number.isFinite(verifiedAt) || verifiedAt <= 0) return null;
  const evidence = { empCode: normEmp(empCode), from: range.from, to: range.to, verifiedAt, result };
  return exactPrefetchedResult(evidence, empCode, { ...options, now: verifiedAt }) ? evidence : null;
}

function exactPrefetchedResult(evidence, empCode, options = {}) {
  if (!evidence || typeof evidence !== 'object') return null;
  let range;
  try { range = parseMonthRange(options); } catch { return null; }
  const now = Number(options.now ?? Date.now());
  const maxAgeMs = Math.max(1, Number(options.maxAgeMs ?? VERIFIED_PREFETCH_MAX_AGE_MS) || VERIFIED_PREFETCH_MAX_AGE_MS);
  const verifiedAt = Number(evidence.verifiedAt);
  if (!Number.isFinite(now) || !Number.isFinite(verifiedAt)
    || verifiedAt > now + 1000 || now - verifiedAt > maxAgeMs) return null;
  if (normEmp(evidence.empCode) !== normEmp(empCode)
    || evidence.from !== range.from || evidence.to !== range.to) return null;
  const result = evidence.result;
  if (!result || result.outcome !== 'ok') return null;
  const payload = result.payload;
  if (normEmp(payload?.empCode) !== normEmp(empCode)
    || normalizeMonth(payload?.from) !== range.from || normalizeMonth(payload?.to) !== range.to) return null;
  if (normalizeMonth(result.sourceRange?.from) !== range.from
    || normalizeMonth(result.sourceRange?.to) !== range.to) return null;
  const periods = Array.isArray(payload?.periods) ? payload.periods : [];
  const byMonth = new Map(periods.map((period) => [normalizeMonth(period?.period), period]));
  if (!range.months.every((month) => {
    const period = byMonth.get(month);
    return period && Array.isArray(period.columns) && period.columns.length > 0
      && Array.isArray(period.rows) && period.rows.length > 0;
  })) return null;
  return { ...result, payload: { ...payload, periods: periods.map((period) => ({ ...period })) } };
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
    audit({ actor: session?.emp_code, role: session?.role, empCode, event: options.auditEvent || 'view', outcome: result.outcome, attempts: result.attempts, range, filters: options.auditFilters });
    return result.payload;
  }
  const result = exactPrefetchedResult(options.prefetchedResult, empCode, options)
    || await fetchEmployeeCost(empCode, options);
  // Revenue belongs to App Report and must stay useful even while the DataHub
  // cost timeline is unavailable/not configured. In that state enrichment
  // preserves every order-line and leaves percentages/amounts as null (—).
  if (range && options.revenueRowsByPeriod && options.catalogRowsByPeriod) {
    result.payload = enrichRangePayload(result.payload, options);
  } else if (Array.isArray(options.revenueRows) && Array.isArray(options.catalogRows)) {
    result.payload = enrichWithRevenue(result.payload, options);
  }
  // This connector runs only after all current financial outputs are final.
  // Every failure mode leaves exactly two additive display fields null.
  result.payload = await applyReconciliationShadow(result.payload, empCode, options);
  audit({
    actor: session?.emp_code,
    role: session?.role,
    empCode,
    event: options.auditEvent || 'view',
    outcome: result.outcome,
    attempts: result.attempts,
    match: result.payload.match,
    range,
    ratePolicy: result.payload.ratePolicy,
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
  // Gắn trạng thái nguồn vào payload. Khi nguồn tỷ lệ của NV này KHÔNG lấy được,
  // mọi dòng của họ hiện ra như "chưa khớp" — nếu gộp thẳng vào coverage sẽ bị
  // hiểu nhầm thành "catalog thiếu %", trong khi thực chất là lỗi nguồn tạm thời.
  // Tầng gộp (mergeEmployeeReports) dùng cờ này để tách bạch 2 nguyên nhân.
  result.payload.sourceOutcome = String(result.outcome || 'unknown');
  return result.payload;
}

module.exports = {
  pinnedClosedPayload,
  USABLE_OUTCOMES,
  isUsableOutcome,
  CONTRACT_PATH,
  DIMENSION_KEYS,
  DEFAULT_NOTE,
  DEFAULT_ANNUAL_COLUMN_KEYS,
  DEFAULT_MATCH_WARNING_PERCENT,
  NOTE_KEY,
  VAT_DIVISOR,
  currentMonth,
  PERIOD_CLOSE_DAY, vnToday, periodCloseDate, isPeriodClosed, periodCloseNote, periodCloseLabel,
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
  sourcePeriodRangeOf,
  applyEffectiveRates,
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
  applyReconciliationShadow,
  fetchEmployeeCost,
  exactPrefetchedResult,
  verifiedPrefetchEvidence,
  VERIFIED_PREFETCH_MAX_AGE_MS,
  backgroundRefreshInFlight,
  fetchRawEmployeeCost,
  rateSnapshot,
  FAST_TIMEOUT_MS,
  resolveDataHubBaseUrl,
  getForSession,
};
