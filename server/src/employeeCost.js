'use strict';

const persist = require('./persist');

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

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function normCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normName(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim();
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
  const supplied = [value.period, value.ky, value.month].filter((item) => item != null && String(item).trim() !== '');
  if (!supplied.length) return '';
  const normalized = supplied.map(normalizeMonth);
  if (normalized.some((period) => !period) || new Set(normalized).size !== 1) return '';
  return normalized[0];
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
  } else if (Array.isArray(raw?.rows) && raw.rows.some((row) => row && (row.period != null || row.ky != null || row.month != null))) {
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
  return normCode(row.iit_code ?? row.qlnb_code ?? row.product_code ?? row.c5 ?? row.code);
}

function productNameOf(row = {}) {
  return normName(row.product_name ?? row.c16 ?? row.name);
}

function unitCodeOf(row = {}) {
  return normCode(row.unit_code ?? row.c7);
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
      const key = `${unit}\u001f${code}`;
      const unitRows = byUnitCode.get(key) || [];
      unitRows.push(row);
      byUnitCode.set(key, unitRows);
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

  // C5 is accepted only after the canonical catalog confirms that exact
  // unit+code (or a globally unique code when the source has no unit). When
  // C16 is present it must agree with one canonical name for the code.
  const directRows = c5
    ? (catalogIndex.byUnitCode.get(`${unit}\u001f${c5}`) || (!unit ? catalogIndex.byCode.get(c5) : null))
    : null;
  if (directRows?.length) {
    const canonicalNames = new Set(directRows.map(productNameOf).filter(Boolean));
    if (!name || canonicalNames.has(name)) return c5;
    return '';
  }
  if (!name) return '';
  const unitCandidates = unit ? catalogIndex.byUnitName.get(`${unit}\u001f${name}`) : null;
  const globalCandidates = catalogIndex.byName.get(name);
  // Never infer a code for a unit from a globally unique raw name alone. A
  // global catalog fallback is accepted only when C5 itself confirms the code;
  // the final lookup key still includes the exact C7 unit.
  const candidates = unitCandidates || (!unit ? globalCandidates : null);
  if (candidates?.size) {
    if (c5 && candidates.has(c5)) return c5;
    return candidates.size === 1 ? [...candidates][0] : '';
  }
  return c5 && globalCandidates?.has(c5) ? c5 : '';
}

function displayValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value != null && String(value).trim() !== '') return value;
  }
  return null;
}

function canonicalDimensions(revenueRow, unit, product, catalogIndex) {
  const exactRows = catalogIndex.byUnitCode.get(`${unit}\u001f${product}`) || [];
  const codeRows = catalogIndex.byCode.get(product) || [];
  const catalogRow = exactRows[0] || (codeRows.length === 1 ? codeRows[0] : null);
  return {
    c5: product,
    c7: unit,
    c16: displayValue(catalogRow, ['product_name', 'c16', 'name'])
      ?? displayValue(revenueRow, ['product_name', 'c16', 'name']),
    c25: displayValue(catalogRow, ['uom', 'c25'])
      ?? displayValue(revenueRow, ['uom', 'c25']),
  };
}

function buildRevenueIndex(revenueRows = [], expectedEmp = '') {
  const index = new Map();
  const scopedEmp = normEmp(expectedEmp);
  for (const row of Array.isArray(revenueRows) ? revenueRows : []) {
    const rowEmp = normEmp(row.emp_code ?? row.empCode);
    if (scopedEmp && rowEmp && rowEmp !== scopedEmp) continue;
    const unit = unitCodeOf(row);
    const product = productCodeOf(row);
    if (!unit || !product) continue;
    const revenue = Number(row.revenue ?? row.tong_tien);
    if (!Number.isFinite(revenue)) continue;
    const key = `${unit}\u001f${product}`;
    index.set(key, (index.get(key) || 0) + revenue);
  }
  return index;
}

function buildRevenueDetail(revenueRows = [], expectedEmp = '', period = '') {
  const monthly = new Map();
  const daily = new Map();
  const dimensions = new Map();
  const invalidDailyKeys = new Set();
  const scopedEmp = normEmp(expectedEmp);
  const expectedPeriod = normalizeMonth(period);
  for (const row of Array.isArray(revenueRows) ? revenueRows : []) {
    const rowEmp = normEmp(row.emp_code ?? row.empCode);
    if (scopedEmp && rowEmp && rowEmp !== scopedEmp) continue;
    const unit = unitCodeOf(row);
    const product = productCodeOf(row);
    const revenue = Number(row.revenue ?? row.tong_tien);
    if (!unit || !product || !Number.isFinite(revenue)) continue;
    const key = `${unit}\u001f${product}`;
    monthly.set(key, (monthly.get(key) || 0) + revenue);
    if (!dimensions.has(key)) dimensions.set(key, row);

    const date = String(row.date || '').slice(0, 10);
    const datePeriod = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : '';
    const explicitlyPeriodOnly = String(row.date_granularity || '').toLowerCase() === 'period';
    if (!datePeriod || explicitlyPeriodOnly || (expectedPeriod && datePeriod !== expectedPeriod)) {
      invalidDailyKeys.add(key);
      continue;
    }
    const byDate = daily.get(key) || new Map();
    byDate.set(date, (byDate.get(date) || 0) + revenue);
    daily.set(key, byDate);
  }
  for (const key of invalidDailyKeys) daily.delete(key);
  return { monthly, daily, dimensions, invalidDailyKeys };
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
  // VND is displayed as an integer. Independent day rounding can differ from
  // the rounded month by a few đồng, so put the deterministic residual on the
  // last day to guarantee the acceptance rule Σ day = month.
  const sum = [...amounts.values()].reduce((total, amount) => total + amount, 0);
  const lastDate = entries.at(-1)[0];
  amounts.set(lastDate, amounts.get(lastDate) + monthlyAmount - sum);
  return amounts;
}

function enrichWithRevenue(payload, options = {}) {
  const annualKeys = configuredAnnualColumnKeys(options.annualColumnKeys);
  const threshold = configuredMatchWarningPercent(options.matchWarningPercent);
  const columns = (payload.columns || []).map((column) => ({
    ...column,
    type: 'percent',
    amountKey: `${column.key}_amount`,
    annual: annualKeys.has(column.key),
  }));
  const catalogIndex = buildProductCatalogIndex(options.catalogRows);
  const revenueDetail = buildRevenueDetail(options.revenueRows, payload.empCode, options.period);
  const revenueIndex = revenueDetail.monthly;
  let matchedRows = 0;
  let monthlyMatchedTotal = 0;
  let annualMatchedTotal = 0;
  let dailyRowsReliable = true;
  const allDates = new Set();

  const costContexts = (payload.rows || []).map((source) => {
    const productCode = resolveProductCode(source, catalogIndex);
    return { source, productCode, revenueKey: `${unitCodeOf(source)}\u001f${productCode}` };
  });
  const costRowsByKey = new Map();
  for (const context of costContexts) {
    if (!context.productCode) continue;
    const matches = costRowsByKey.get(context.revenueKey) || [];
    matches.push(context.source);
    costRowsByKey.set(context.revenueKey, matches);
  }

  // Revenue is the row driver. DataHub rows are a percentage lookup only:
  // extra cost rows cannot create output, while every sold unit+product stays
  // visible even when its percentage lookup is missing or ambiguous.
  const rows = [...revenueIndex.entries()].map(([revenueKey, revenue]) => {
    const separator = revenueKey.indexOf('\u001f');
    const unit = revenueKey.slice(0, separator);
    const productCode = revenueKey.slice(separator + 1);
    const costMatches = costRowsByKey.get(revenueKey) || [];
    const source = costMatches.length === 1 ? costMatches[0] : null;
    const hasAllPercentages = !!source && columns.length > 0 && columns.every((column) => {
      const value = source[column.key];
      return value !== '' && value != null && Number.isFinite(Number(value));
    });
    // Duplicate lookup rows are ambiguous even when their percentages happen
    // to be equal. Choosing one would make future group/config drift invisible.
    const matched = costMatches.length === 1 && hasAllPercentages;
    if (matched) matchedRows += 1;
    const amounts = {};
    const dailyAmounts = {};
    const byDate = matched ? revenueDetail.daily.get(revenueKey) : null;
    let rowDailyReliable = matched && !!byDate?.size;
    for (const column of columns) {
      const amount = matched ? calculateAmount(revenue, source[column.key]) : null;
      amounts[column.key] = amount;
      if (amount == null) continue;
      if (column.annual) annualMatchedTotal += amount;
      else monthlyMatchedTotal += amount;
      if (rowDailyReliable) {
        const allocated = calculateDailyAmounts(byDate, source[column.key], amount);
        if (!allocated) {
          rowDailyReliable = false;
          continue;
        }
        for (const [date, dayAmount] of allocated) {
          if (!dailyAmounts[date]) dailyAmounts[date] = {};
          dailyAmounts[date][column.key] = dayAmount;
          allDates.add(date);
        }
      }
    }
    if (matched && !rowDailyReliable) dailyRowsReliable = false;
    const dimensions = canonicalDimensions(revenueDetail.dimensions.get(revenueKey), unit, productCode, catalogIndex);
    const percentages = {};
    for (const column of columns) percentages[column.key] = matched ? source[column.key] : null;
    return {
      ...dimensions,
      ...percentages,
      amounts,
      revenueMatched: matched,
      dailyAmounts: rowDailyReliable ? dailyAmounts : null,
      dayRevenueMatched: rowDailyReliable,
    };
  });

  const totalRows = rows.length;
  const hasGroundedRows = totalRows > 0 && columns.length > 0;
  const rate = totalRows ? +(matchedRows / totalRows * 100).toFixed(1) : null;
  const low = rate != null && rate < threshold;
  const annualLabels = columns.filter((column) => column.annual).map((column) => column.label);
  const dailyReliable = hasGroundedRows && !low && dailyRowsReliable && matchedRows === totalRows;
  const dates = dailyReliable ? [...allDates].sort() : [];
  const dayTotals = dates.map((date) => {
    let monthlyTotal = 0;
    let annualTotal = 0;
    for (const row of rows) {
      for (const column of columns) {
        const amount = row.dailyAmounts?.[date]?.[column.key];
        if (amount == null) continue;
        if (column.annual) annualTotal += amount;
        else monthlyTotal += amount;
      }
    }
    return { date, monthlyTotal, annualTotal };
  });
  const dayMonthlyTotal = dayTotals.reduce((sum, day) => sum + day.monthlyTotal, 0);
  const dayAnnualTotal = dayTotals.reduce((sum, day) => sum + day.annualTotal, 0);
  const reconciled = dailyReliable && dayMonthlyTotal === monthlyMatchedTotal && dayAnnualTotal === annualMatchedTotal;
  const basePayload = { ...payload };
  if (rows.length) delete basePayload.note;
  return {
    ...basePayload,
    period: String(options.period || ''),
    columns,
    rows,
    match: { matchedRows, totalRows, rate, threshold, low },
    summary: {
      reliable: hasGroundedRows && !low,
      monthlyTotal: !hasGroundedRows || low ? null : monthlyMatchedTotal,
      annualTotal: !hasGroundedRows || low ? null : annualMatchedTotal,
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
  return {
    ...payload,
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
  // App Report's deployed env already uses the shared DataHub names. Keep the
  // legacy employee-cost aliases for compatibility, but never require a
  // second copy of the same S2S endpoint/key just for this route.
  const baseUrl = String(options.baseUrl ?? process.env.DATAHUB_BASE ?? process.env.DATA_HUB_BASE_URL ?? '').trim().replace(/\/$/, '');
  const token = String(options.token ?? process.env.APP_REPORT_COST_TOKEN ?? process.env.DATA_HUB_ASSIGNMENT_KEY ?? '').trim();
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Math.max(100, Number(options.timeoutMs ?? process.env.APP_REPORT_COST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const backoffMs = options.backoffMs || DEFAULT_BACKOFF_MS;
  const sleepImpl = options.sleepImpl || sleep;
  const range = options.from != null || options.to != null ? parseMonthRange(options) : null;

  if (!baseUrl || !token || typeof fetchImpl !== 'function') {
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
          headers: { 'x-assignment-key': token, accept: 'application/json' },
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

function writeAudit({ actor, role, empCode, outcome, attempts, match }) {
  const rows = persist.load(AUDIT_FILE, []);
  rows.push({
    at: new Date().toISOString(),
    actor: normEmp(actor) || 'UNKNOWN',
    role: String(role || '').toLowerCase() || 'unknown',
    empCode: normEmp(empCode),
    outcome: String(outcome || 'unknown'),
    attempts: Number(attempts || 0),
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
    audit({ actor: session?.emp_code, role: session?.role, empCode, outcome: result.outcome, attempts: result.attempts });
    return result.payload;
  }
  const result = await fetchEmployeeCost(empCode, options);
  if (result.outcome === 'ok' && range && options.revenueRowsByPeriod && options.catalogRowsByPeriod) {
    result.payload = enrichRangePayload(result.payload, options);
  } else if (result.outcome === 'ok' && Array.isArray(options.revenueRows) && Array.isArray(options.catalogRows)) {
    result.payload = enrichWithRevenue(result.payload, options);
  }
  audit({
    actor: session?.emp_code,
    role: session?.role,
    empCode,
    outcome: result.outcome,
    attempts: result.attempts,
    match: result.payload.match,
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
  currentMonth,
  normalizeMonth,
  toUiMonth,
  monthsBetween,
  parseMonthRange,
  resolveScopedEmployee,
  isAllowedDynamicKey,
  sanitizePayload,
  emptyPayload,
  emptyRangePayload,
  adaptPeriodPayload,
  configuredAnnualColumnKeys,
  configuredMatchWarningPercent,
  buildProductCatalogIndex,
  resolveProductCode,
  buildRevenueIndex,
  buildRevenueDetail,
  calculateAmount,
  calculateDailyAmounts,
  enrichWithRevenue,
  enrichRangePayload,
  fetchEmployeeCost,
  getForSession,
};
