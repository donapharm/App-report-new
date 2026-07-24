'use strict';

const persist = require('./persist');

const CONTRACT_PATH = '/api/khoan/dashboard';
const SOURCE = 'App VAT';
const DEFAULT_NOTE = 'chưa lấy được xu kỳ này';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BACKOFF_MS = Object.freeze([250, 750]);
const AUDIT_FILE = 'employee_vat_khoan_audit';
const AUDIT_LIMIT = 5000;

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function safeText(value, maxLength = 500) {
  if (value == null) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveVatBase(value) {
  const raw = String(value ?? process.env.VAT_BASE ?? '').trim().replace(/\/$/, '');
  try {
    const parsed = new URL(raw);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password ? parsed.toString().replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

function parsePeriod({ from, to, month, year } = {}, now = new Date()) {
  const explicitTo = String(to || '').trim();
  const explicitFrom = String(from || '').trim();
  if (explicitTo || explicitFrom) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(explicitTo) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(explicitFrom) || explicitFrom > explicitTo) {
      const error = new Error('Kỳ điểm/xu không hợp lệ');
      error.status = 400;
      error.code = 'EMPLOYEE_VAT_KHOAN_PERIOD_INVALID';
      throw error;
    }
    return { month: Number(explicitTo.slice(5, 7)), year: Number(explicitTo.slice(0, 4)), period: explicitTo };
  }
  const parsedMonth = month == null || month === '' ? now.getMonth() + 1 : Number(month);
  const parsedYear = year == null || year === '' ? now.getFullYear() : Number(year);
  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12 || !Number.isInteger(parsedYear) || parsedYear < 2024 || parsedYear > 2100) {
    const error = new Error('Kỳ điểm/xu không hợp lệ');
    error.status = 400;
    error.code = 'EMPLOYEE_VAT_KHOAN_PERIOD_INVALID';
    throw error;
  }
  return { month: parsedMonth, year: parsedYear, period: `${parsedYear}-${String(parsedMonth).padStart(2, '0')}` };
}

function emptyPayload(empCode, period = {}, note = DEFAULT_NOTE) {
  return {
    available: false,
    source: SOURCE,
    note,
    emp_code: normEmp(empCode),
    selected: {
      month: Number(period.month || 0) || null,
      year: Number(period.year || 0) || null,
      quarter: null,
    },
    rule_version: '',
  };
}

function projectDashboard(raw, expectedEmp, expectedPeriod) {
  const empCode = normEmp(expectedEmp);
  const selectedMonth = finite(raw?.selected?.month);
  const selectedYear = finite(raw?.selected?.year);
  const selectedQuarter = finite(raw?.selected?.quarter);
  const ruleVersion = safeText(raw?.rule_version, 120);
  const xuRuleVersion = safeText(raw?.xu_rule_version || raw?.rules?.xu || ruleVersion, 120);
  const fields = {
    xu_thang: finite(raw?.xu?.thang?.xu),
    xu_quy: finite(raw?.xu?.quy?.xu),
    xu_quy_tong: finite(raw?.xu?.quy?.xu_tong),
    carry: finite(raw?.xu?.du_quy_truoc),
  };
  const valid = raw?.ok === true
    && normEmp(raw?.emp_code) === empCode
    && raw?.viewAll === false
    && selectedMonth === expectedPeriod.month
    && selectedYear === expectedPeriod.year
    && Number.isInteger(selectedQuarter) && selectedQuarter >= 1 && selectedQuarter <= 4
    && !!ruleVersion
    && Object.values(fields).every((value) => value != null)
    && fields.xu_thang >= 0 && fields.xu_quy >= 0 && fields.xu_quy_tong >= 0 && fields.carry >= 0;
  if (!valid) return null;
  return {
    available: true,
    aggregate: false,
    source: SOURCE,
    note: '',
    emp_code: empCode,
    emp_name: safeText(raw.emp_name, 160) || empCode,
    selected: { month: selectedMonth, year: selectedYear, quarter: selectedQuarter },
    quarter_label: safeText(raw?.quy?.label, 120) || `Q${selectedQuarter}/${selectedYear}`,
    ...fields,
    rule_version: ruleVersion,
    xu_rule_version: xuRuleVersion,
    upstream_warning: safeText(raw?.warning?.message, 500),
  };
}

function transient(error) {
  return error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || error?.code === 'ETIMEDOUT'
    || error?.code === 'ECONNRESET'
    || error?.code === 'ECONNREFUSED'
    || [502, 503, 504].includes(error?.status);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchDashboard(empCode, period, options = {}) {
  const expectedEmp = normEmp(empCode);
  const baseUrl = resolveVatBase(options.baseUrl);
  const serviceToken = String(options.serviceToken ?? process.env.VAT_SERVICE_TOKEN ?? '').trim();
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.max(100, Number(options.timeoutMs ?? process.env.VAT_KHOAN_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));
  const backoffMs = Array.isArray(options.backoffMs) ? options.backoffMs : DEFAULT_BACKOFF_MS;
  const sleepImpl = options.sleepImpl || sleep;
  const unavailable = (outcome, attempts = 0) => ({ payload: emptyPayload(expectedEmp, period), outcome, attempts });

  if (!expectedEmp || !/^[A-Z][A-Z0-9._-]{1,31}$/.test(expectedEmp) || !baseUrl || serviceToken.length < 16 || typeof fetchImpl !== 'function') {
    return unavailable('not_configured');
  }
  const params = new URLSearchParams({ month: String(period.month), year: String(period.year), emp_code: expectedEmp });
  const url = `${baseUrl}${CONTRACT_PATH}?${params}`;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${serviceToken}`, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error('App VAT upstream failed');
        error.status = response.status;
        throw error;
      }
      let raw;
      try { raw = await response.json(); }
      catch (error) {
        if (transient(error)) throw error;
        return unavailable('invalid_payload', attempts);
      }
      const payload = projectDashboard(raw, expectedEmp, period);
      return payload ? { payload, outcome: 'ok', attempts } : unavailable('invalid_payload', attempts);
    } catch (error) {
      const retryIndex = attempts - 1;
      if (transient(error) && retryIndex < backoffMs.length) {
        await sleepImpl(backoffMs[retryIndex]);
        continue;
      }
      const outcome = error?.status === 401
        ? 'upstream_unauthorized'
        : error?.status === 400
          ? 'upstream_bad_request'
          : error?.status
            ? `upstream_${error.status}`
            : 'upstream_unavailable';
      return unavailable(outcome, attempts);
    } finally {
      // Keep the deadline active through response.json(); a stalled body must
      // abort and follow the same bounded retry/fail-closed path as fetch().
      clearTimeout(timer);
    }
  }
}

function writeAudit({ actor, role, empCode, period, outcome, attempts, ruleVersion, event = 'view' }) {
  const rows = persist.load(AUDIT_FILE, []);
  rows.push({
    at: new Date().toISOString(),
    event: safeText(event, 80) || 'view',
    actor: normEmp(actor) || 'UNKNOWN',
    role: safeText(role, 40).toLowerCase() || 'unknown',
    empCode: normEmp(empCode),
    month: Number(period?.month || 0) || null,
    year: Number(period?.year || 0) || null,
    outcome: safeText(outcome, 80) || 'unknown',
    attempts: Number(attempts || 0),
    ruleVersion: safeText(ruleVersion, 120),
  });
  persist.save(AUDIT_FILE, rows.slice(-AUDIT_LIMIT));
}

async function getForSession({ session, scope, requestedEmp, period }, options = {}) {
  const own = normEmp(scope?.empCode || session?.emp_code);
  const empCode = scope?.empCode ? own : (normEmp(requestedEmp) || own);
  const audit = (entry) => {
    try {
      (options.auditImpl || writeAudit)(entry);
      return true;
    } catch {
      console.warn('[employee-vat-khoan] audit write failed', { actor: normEmp(session?.emp_code), empCode });
      return false;
    }
  };
  const result = empCode
    ? await fetchDashboard(empCode, period, options)
    : { payload: emptyPayload('', period), outcome: 'missing_emp', attempts: 0 };
  const audited = audit({
    actor: session?.emp_code,
    role: session?.role,
    empCode,
    period,
    event: options.auditEvent || 'view',
    outcome: result.outcome,
    attempts: result.attempts,
    ruleVersion: result.payload.rule_version,
  });
  if (!audited) return emptyPayload(empCode, period);
  if (result.outcome !== 'ok') {
    // Deliberately omit URL, token, headers and upstream response bodies.
    console.warn('[employee-vat-khoan] upstream unavailable', {
      actor: normEmp(session?.emp_code), empCode, month: period.month, year: period.year,
      outcome: result.outcome, attempts: result.attempts,
    });
  }
  return result.payload;
}

function aggregatePayloads(payloads = [], roster = [], period = {}) {
  const rows = payloads.filter(Boolean);
  if (!rows.length || rows.some((payload) => !payload.available)) {
    return { ...emptyPayload('ALL', period), aggregate: true, employeeSubtotals: [] };
  }
  const versions = [...new Set(rows.map((payload) => payload.rule_version))];
  const xuVersions = [...new Set(rows.map((payload) => payload.xu_rule_version || payload.rule_version))];
  if (versions.length !== 1 || xuVersions.length !== 1) return { ...emptyPayload('ALL', period), aggregate: true, employeeSubtotals: [] };
  const names = new Map(roster.map((employee) => [normEmp(employee.emp_code), String(employee.name || employee.emp_code || '')]));
  const sum = (key) => rows.reduce((total, payload) => total + Number(payload[key] || 0), 0);
  return {
    available: true,
    aggregate: true,
    source: SOURCE,
    note: '',
    emp_code: 'ALL',
    emp_name: 'Tất cả nhân viên',
    selected: { ...rows[0].selected },
    quarter_label: rows[0].quarter_label,
    xu_thang: sum('xu_thang'),
    xu_quy: sum('xu_quy'),
    xu_quy_tong: sum('xu_quy_tong'),
    carry: sum('carry'),
    rule_version: versions[0],
    xu_rule_version: xuVersions[0],
    upstream_warning: '',
    employeeSubtotals: rows.map((payload) => ({
      emp_code: payload.emp_code,
      emp_name: names.get(payload.emp_code) || payload.emp_name || payload.emp_code,
      xu_thang: payload.xu_thang,
      xu_quy_tong: payload.xu_quy_tong,
      carry: payload.carry,
    })),
  };
}

module.exports = {
  CONTRACT_PATH,
  SOURCE,
  DEFAULT_NOTE,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_BACKOFF_MS,
  AUDIT_FILE,
  normEmp,
  resolveVatBase,
  parsePeriod,
  emptyPayload,
  projectDashboard,
  fetchDashboard,
  writeAudit,
  getForSession,
  aggregatePayloads,
};
