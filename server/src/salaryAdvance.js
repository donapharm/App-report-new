'use strict';

const snapshot = require('./salaryAdvanceSnapshot');

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
  // Allowlist vẫn là allowlist: App Report CHỈ đọc và CHỈ trả lại 10 khoá đã thoả
  // thuận, mọi khoá lạ bị BỎ chứ không đi tiếp (không log, không hiển thị, không lưu).
  // Nhưng thiếu một khoá bắt buộc thì vẫn chặn cả gói.
  // ‼ Trước 03/08/2026 chỉ cần App Salary THÊM một nhãn mới là cả gói bị vứt, ô KPI
  // trắng — bên kia đổi hợp đồng lúc nào thì App Report gãy lúc đó. Bỏ ràng buộc
  // "đếm đúng số khoá" để hết giòn; các phép kiểm giá trị bên dưới giữ nguyên 100%.
  if (PROJECTION_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(payload, key))) {
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
  // Chỉ 10 khoá hợp đồng đi tiếp — khoá lạ dừng lại đúng ở đây.
  // Vẫn phải KÊU LÊN: mục đích ban đầu của allowlist là để phát hiện App Salary lỡ
  // trả field lương ra ngoài (vd `net`). Ghi TÊN khoá, tuyệt đối không ghi giá trị.
  const extras = Object.keys(payload).filter((key) => !PROJECTION_KEYS.includes(key));
  if (extras.length) console.warn('[salary-advance] App Salary trả field ngoài hợp đồng (đã loại bỏ)', { keys: extras.sort() });
  return Object.freeze(Object.fromEntries(PROJECTION_KEYS.map((key) => [key, payload[key]])));
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

// ‼ 03/08/2026: mọi lỗi từng bị nuốt chung thành `upstream_unavailable`, nên CEO
// nhìn ô KPI không phân biệt được *mạng lỗi* / *sai key* / *App Salary đổi hợp đồng*.
// Giữ nguyên nguyên tắc không lộ nội dung phản hồi, nhưng PHẢI trả đúng MÃ lỗi ra
// để màn hình nói được ai phải sửa.
const SAFE_REASON_BY_CODE = new Map([
  ['SALARY_ADVANCE_INVALID_PAYLOAD', 'contract_mismatch'],
  ['SALARY_ADVANCE_NOT_CONFIGURED', 'not_configured'],
  ['SALARY_ADVANCE_TIMEOUT', 'upstream_timeout'],
  ['SALARY_ADVANCE_INVALID_QUERY', 'invalid_query'],
]);

// ‼ CEO 04/08: "khi có số ứng lần 1 rồi thì lấy số về luôn, chỉ khi thay đổi số
// mới đổi số" — trước đây mỗi lần NV mở màn (quá 25s) là một lượt gọi App Salary.
// Nay đi qua kho: kỳ ĐÃ CHỐT thì không gọi lại lần nào; kỳ đang mở chỉ làm tươi
// khi quá hạn. Xem `salaryAdvanceSnapshot.js` và SPEC_THANH_TOAN_CP_SELFVIEW.md §11.
async function safeGetFirstAdvance(period, empCode, get = (...args) => client.get(...args), options = {}) {
  const store = options.snapshotStore;
  const snapshotOptions = store ? { store } : {};
  let stored = null;
  try { stored = snapshot.read(empCode, period, snapshotOptions); } catch { stored = null; }
  if (!snapshot.needsRefresh(stored, { now: options.now, ttlMs: options.ttlMs, force: options.force === true })) {
    // Kèm mốc lấy số để màn hình ghi rõ "số tại lúc …", không để tưởng số đang sống.
    return Object.freeze({ ...stored.projection, fetchedAt: stored.fetchedAt, fromSnapshot: true });
  }
  try {
    const fresh = await get(period, empCode);
    try { snapshot.write(empCode, period, fresh, snapshotOptions); } catch { /* kho hỏng không được làm hỏng màn */ }
    return fresh;
  } catch (error) {
    // Nguồn lỗi mà kho còn số cũ ⇒ vẫn cho xem số cũ kèm mốc thời gian, hơn là
    // trắng màn. Chưa có gì trong kho thì báo đúng loại lỗi như trước.
    if (stored) return Object.freeze({ ...stored.projection, fetchedAt: stored.fetchedAt, fromSnapshot: true, stale: true });
    const reason = SAFE_REASON_BY_CODE.get(error?.code)
      || (error?.upstreamStatus === 401 || error?.upstreamStatus === 403 ? 'unauthorized' : 'upstream_unavailable');
    return unavailableProjection(period, empCode, reason);
  }
}

// App Report chỉ cảnh báo, không tự sửa/kẹp số App Salary. Guard dùng đúng tổng
// chi phí tháng sau phạt cùng kỳ; phép trừ KPI nằm riêng ở remainingAfterAdvance.
function withAfterPenaltyGuard(projection, afterPenaltyTotal) {
  if (!projection || typeof projection !== 'object') return projection;
  if (!(projection.available === true && projection.applicable === true && Number.isSafeInteger(projection.amount))) {
    return Object.freeze({
      ...projection,
      suspect: false,
      suspect_reason: null,
      suspectReason: null,
      suspectMessage: null,
      comparisonAfterPenaltyTotal: null,
    });
  }
  if (!Number.isSafeInteger(afterPenaltyTotal) || afterPenaltyTotal < 0) {
    return Object.freeze({
      ...projection,
      suspect: null,
      suspect_reason: 'after_penalty_total_unavailable',
      suspectReason: 'after_penalty_total_unavailable',
      suspectMessage: null,
      comparisonAfterPenaltyTotal: null,
    });
  }
  const suspect = projection.amount > afterPenaltyTotal;
  return Object.freeze({
    ...projection,
    suspect,
    suspect_reason: suspect ? 'amount_exceeds_after_penalty_total' : null,
    suspectReason: suspect ? 'amount_exceeds_after_penalty_total' : null,
    suspectMessage: suspect ? 'Số ứng App Salary lớn hơn tổng nhận — nghi sai, đang đối chiếu' : null,
    comparisonAfterPenaltyTotal: afterPenaltyTotal,
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
  snapshot,
  withAfterPenaltyGuard,
};
