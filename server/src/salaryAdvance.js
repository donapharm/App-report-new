'use strict';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMP_CODE_RE = /^[A-Z0-9_-]{2,20}$/;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const PROJECTION_KEYS = ['amount', 'applicable', 'available', 'currency', 'emp_code', 'locked', 'ok', 'period', 'reason', 'status'];
const BUSINESS_REASONS = new Set(['period_not_found', 'employee_not_found', 'duplicate_employee']);

function normalizeEmpCode(value) { return String(value || '').trim().toUpperCase(); }
function typedError(message, code, status = 502) { return Object.assign(new Error(message), { code, status }); }

function unavailableProjection(periodValue, empCodeValue, reason = 'upstream_unavailable') {
  return Object.freeze({
    available: false,
    applicable: null,
    period: String(periodValue || '').trim(),
    emp_code: normalizeEmpCode(empCodeValue),
    amount: null,
    currency: 'VND',
    locked: null,
    status: 'unavailable',
    reason,
  });
}

function validateProjection(payload, expected = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw typedError('App Salary trả payload không hợp lệ.', 'SALARY_ADVANCE_INVALID_PAYLOAD');
  const keys = Object.keys(payload).sort();
  if (keys.length !== PROJECTION_KEYS.length || keys.some((key, index) => key !== PROJECTION_KEYS[index])) {
    throw typedError('App Salary trả projection ngoài allowlist.', 'SALARY_ADVANCE_INVALID_PAYLOAD');
  }
  const period = String(expected.period || '');
  const empCode = normalizeEmpCode(expected.empCode);
  if (payload.ok !== true || payload.period !== period || payload.emp_code !== empCode || payload.currency !== 'VND') {
    throw typedError('App Salary trả sai phạm vi kỳ/mã/tiền tệ.', 'SALARY_ADVANCE_INVALID_PAYLOAD');
  }
  if (![true, false].includes(payload.available) || ![true, false, null].includes(payload.applicable)
      || ![true, false, null].includes(payload.locked) || !['draft', 'locked', 'unavailable'].includes(payload.status)) {
    throw typedError('App Salary trả trạng thái không hợp lệ.', 'SALARY_ADVANCE_INVALID_PAYLOAD');
  }
  if (payload.available && payload.applicable === true) {
    if (!Number.isSafeInteger(payload.amount) || payload.amount < 0 || payload.reason !== null
        || !['draft', 'locked'].includes(payload.status) || payload.locked !== (payload.status === 'locked')) {
      throw typedError('App Salary trả số ứng không hợp lệ.', 'SALARY_ADVANCE_INVALID_PAYLOAD');
    }
  } else if (payload.available && payload.applicable === false) {
    if (payload.amount !== null || payload.reason !== 'not_eligible') throw typedError('App Salary trả trạng thái không áp dụng không hợp lệ.', 'SALARY_ADVANCE_INVALID_PAYLOAD');
  } else if (payload.available === false) {
    if (payload.amount !== null || payload.applicable !== null || !BUSINESS_REASONS.has(payload.reason)) {
      throw typedError('App Salary trả lý do thiếu dữ liệu không hợp lệ.', 'SALARY_ADVANCE_INVALID_PAYLOAD');
    }
  }
  return Object.freeze({ ...payload });
}

function createClient({
  baseUrl = process.env.SALARY_SERVICE_BASE || 'http://127.0.0.1:3925',
  token = process.env.SALARY_SERVICE_TOKEN || '',
  fetchImpl = global.fetch,
  timeoutMs = 5000,
  retryDelayMs = 100,
  cacheTtlMs = 25_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
} = {}) {
  const cache = new Map();
  const flights = new Map();

  async function request(period, empCode) {
    if (!PERIOD_RE.test(period) || !EMP_CODE_RE.test(empCode)) throw typedError('Kỳ hoặc mã nhân viên không hợp lệ.', 'SALARY_ADVANCE_INVALID_QUERY', 400);
    if (!token || !baseUrl || typeof fetchImpl !== 'function') throw typedError('App Report chưa cấu hình kết nối App Salary.', 'SALARY_ADVANCE_NOT_CONFIGURED', 503);
    const url = `${String(baseUrl).replace(/\/+$/, '')}/api/integrations/app-report/first-advance?period=${encodeURIComponent(period)}&emp_code=${encodeURIComponent(empCode)}`;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = typedError(`App Salary phản hồi HTTP ${response.status}.`, 'SALARY_ADVANCE_UPSTREAM_ERROR', 502);
          error.upstreamStatus = response.status;
          if (attempt === 0 && RETRYABLE_STATUS.has(response.status)) { lastError = error; await sleep(retryDelayMs); continue; }
          throw error;
        }
        return validateProjection(await response.json(), { period, empCode });
      } catch (error) {
        const timeout = error?.name === 'AbortError';
        const safe = timeout ? typedError('App Salary quá thời gian phản hồi.', 'SALARY_ADVANCE_TIMEOUT', 504) : error;
        if (attempt === 0 && (timeout || RETRYABLE_STATUS.has(error?.upstreamStatus))) { lastError = safe; await sleep(retryDelayMs); continue; }
        throw safe;
      } finally { clearTimeout(timer); }
    }
    throw lastError || typedError('Không gọi được App Salary.', 'SALARY_ADVANCE_UPSTREAM_ERROR');
  }

  async function get(periodValue, empCodeValue) {
    const period = String(periodValue || '').trim();
    const empCode = normalizeEmpCode(empCodeValue);
    const key = `${period}|${empCode}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheTtlMs) return hit.payload;
    if (flights.has(key)) return flights.get(key);
    const flight = request(period, empCode)
      .then((payload) => { cache.set(key, { at: now(), payload }); return payload; })
      .catch((error) => {
        logger.warn?.('[salary-advance] upstream unavailable', { period, empCode, code: error?.code || 'SALARY_ADVANCE_UPSTREAM_ERROR', status: error?.upstreamStatus || error?.status || 0 });
        throw error;
      })
      .finally(() => flights.delete(key));
    flights.set(key, flight);
    return flight;
  }

  return { get, validateProjection, cache, flights };
}

const client = createClient();

async function safeGetFirstAdvance(period, empCode, get = (...args) => client.get(...args)) {
  try { return await get(period, empCode); }
  catch { return unavailableProjection(period, empCode); }
}

// App Report chỉ cảnh báo, không tự sửa/kẹp số App Salary. Guard dùng đúng tổng
// chi phí tháng sau phạt cùng kỳ; phép trừ KPI nằm riêng ở remainingAfterAdvance.
function withAfterPenaltyGuard(projection, afterPenaltyTotal) {
  if (!projection || typeof projection !== 'object') return projection;
  if (!(projection.available === true && projection.applicable === true && Number.isSafeInteger(projection.amount))) {
    return Object.freeze({ ...projection, suspect: false, suspect_reason: null });
  }
  if (!Number.isSafeInteger(afterPenaltyTotal) || afterPenaltyTotal < 0) {
    return Object.freeze({ ...projection, suspect: null, suspect_reason: 'after_penalty_total_unavailable' });
  }
  const suspect = projection.amount > afterPenaltyTotal;
  return Object.freeze({
    ...projection,
    suspect,
    suspect_reason: suspect ? 'amount_exceeds_after_penalty_total' : null,
  });
}

module.exports = {
  PERIOD_RE,
  EMP_CODE_RE,
  normalizeEmpCode,
  unavailableProjection,
  validateProjection,
  createClient,
  getFirstAdvance: (...args) => client.get(...args),
  safeGetFirstAdvance,
  withAfterPenaltyGuard,
};
