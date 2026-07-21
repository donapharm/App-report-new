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
  for (const row of Array.isArray(catalogRows) ? catalogRows : []) {
    const code = productCodeOf(row);
    const name = productNameOf(row);
    if (!code || !name) continue;
    addCandidate(byName, name, code);
    const unit = unitCodeOf(row);
    if (unit) addCandidate(byUnitName, `${unit}\u001f${name}`, code);
  }
  return { byName, byUnitName };
}

function resolveProductCode(costRow, catalogIndex) {
  const name = productNameOf(costRow);
  if (!name) return '';
  const unit = unitCodeOf(costRow);
  const candidates = catalogIndex.byUnitName.get(`${unit}\u001f${name}`) || catalogIndex.byName.get(name);
  if (!candidates?.size) return '';

  // C5 is a useful disambiguator only after C16 has been resolved through the
  // catalog; it is never trusted as a direct bypass around the catalog.
  const c5 = normCode(costRow?.c5);
  if (c5 && candidates.has(c5)) return c5;
  return candidates.size === 1 ? [...candidates][0] : '';
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

function calculateAmount(revenue, percent) {
  if (percent == null || percent === '') return null;
  const rate = Number(percent);
  if (!Number.isFinite(revenue) || !Number.isFinite(rate)) return null;
  return Math.round(revenue * rate / 100);
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
  const revenueIndex = buildRevenueIndex(options.revenueRows, payload.empCode);
  let matchedRows = 0;
  let monthlyMatchedTotal = 0;
  let annualMatchedTotal = 0;

  const rows = (payload.rows || []).map((source) => {
    const productCode = resolveProductCode(source, catalogIndex);
    const revenueKey = `${unitCodeOf(source)}\u001f${productCode}`;
    const matched = !!productCode && revenueIndex.has(revenueKey);
    const revenue = matched ? revenueIndex.get(revenueKey) : null;
    if (matched) matchedRows += 1;
    const amounts = {};
    for (const column of columns) {
      const amount = matched ? calculateAmount(revenue, source[column.key]) : null;
      amounts[column.key] = amount;
      if (amount == null) continue;
      if (column.annual) annualMatchedTotal += amount;
      else monthlyMatchedTotal += amount;
    }
    return { ...source, amounts, revenueMatched: matched };
  });

  const totalRows = rows.length;
  const hasGroundedRows = totalRows > 0 && columns.length > 0;
  const rate = totalRows ? +(matchedRows / totalRows * 100).toFixed(1) : null;
  const low = rate != null && rate < threshold;
  const annualLabels = columns.filter((column) => column.annual).map((column) => column.label);
  return {
    ...payload,
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
  const baseUrl = String(options.baseUrl ?? process.env.DATAHUB_BASE ?? '').trim().replace(/\/$/, '');
  const token = String(options.token ?? process.env.APP_REPORT_COST_TOKEN ?? '').trim();
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Math.max(100, Number(options.timeoutMs ?? process.env.APP_REPORT_COST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const backoffMs = options.backoffMs || DEFAULT_BACKOFF_MS;
  const sleepImpl = options.sleepImpl || sleep;

  if (!baseUrl || !token || typeof fetchImpl !== 'function') {
    return { payload: emptyPayload(empCode, DEFAULT_NOTE), outcome: 'not_configured', attempts: 0 };
  }

  const url = `${baseUrl}${CONTRACT_PATH}?emp=${encodeURIComponent(normEmp(empCode))}`;
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
        return { payload: emptyPayload(empCode, DEFAULT_NOTE), outcome: 'scope_mismatch', attempts };
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
        payload: emptyPayload(empCode, DEFAULT_NOTE),
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
  if (!empCode) {
    const result = { payload: emptyPayload('', DEFAULT_NOTE), outcome: 'missing_emp', attempts: 0 };
    audit({ actor: session?.emp_code, role: session?.role, empCode, outcome: result.outcome, attempts: result.attempts });
    return result.payload;
  }
  const result = await fetchEmployeeCost(empCode, options);
  if (result.outcome === 'ok' && Array.isArray(options.revenueRows) && Array.isArray(options.catalogRows)) {
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
  resolveScopedEmployee,
  isAllowedDynamicKey,
  sanitizePayload,
  emptyPayload,
  configuredAnnualColumnKeys,
  configuredMatchWarningPercent,
  buildProductCatalogIndex,
  resolveProductCode,
  buildRevenueIndex,
  calculateAmount,
  enrichWithRevenue,
  fetchEmployeeCost,
  getForSession,
};
