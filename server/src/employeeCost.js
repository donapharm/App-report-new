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

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
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

function writeAudit({ actor, role, empCode, outcome, attempts }) {
  const rows = persist.load(AUDIT_FILE, []);
  rows.push({
    at: new Date().toISOString(),
    actor: normEmp(actor) || 'UNKNOWN',
    role: String(role || '').toLowerCase() || 'unknown',
    empCode: normEmp(empCode),
    outcome: String(outcome || 'unknown'),
    attempts: Number(attempts || 0),
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
  audit({
    actor: session?.emp_code,
    role: session?.role,
    empCode,
    outcome: result.outcome,
    attempts: result.attempts,
  });
  if (result.outcome !== 'ok') {
    // Deliberately generic: never print response bodies, request headers or token.
    console.warn('[employee-cost] upstream unavailable', { actor: normEmp(session?.emp_code), empCode, outcome: result.outcome, attempts: result.attempts });
  }
  return result.payload;
}

module.exports = {
  CONTRACT_PATH,
  DIMENSION_KEYS,
  DEFAULT_NOTE,
  resolveScopedEmployee,
  isAllowedDynamicKey,
  sanitizePayload,
  emptyPayload,
  fetchEmployeeCost,
  getForSession,
};
