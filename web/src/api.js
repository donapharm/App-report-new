// api.js — gọi backend, tự đính token. Frontend KHÔNG tự quyết quyền.
import { RequestCoordinator, requestScopeKey } from './requestCoordinator.js';
import { syncExceptionsRequestPath } from './syncExceptionsRequest.js';
import { clearSwrActor } from './swrCache.js';
const TOKEN_KEY = 'rpt_token';
const AUTH_ACTOR_KEY = 'rpt_auth_actor';
const OTP_AUTH_TIMEOUT_MS = 12000;
const ME_TIMEOUT_MS = 8000;
// Chi phí/nhân viên gọi DataHub (nối tiếp, timeout 6.5s/kỳ ở backend) + tính bảng.
// Không có timeout ở client -> spinner quay vô tận khi DataHub chậm. Chặn trần để
// hết "quay mãi": quá hạn thì báo lỗi có nút thử lại thay vì treo im lặng.
const EMPLOYEE_COST_TIMEOUT_MS = 45000;
const EMPLOYEE_COST_TIMEOUT_MESSAGE = 'DataHub đang phản hồi chậm. Vui lòng thử lại.';
const TRUSTED_DEVICE_VERIFY_TIMEOUT_MS = 5000;
const APP_SALE_TRUSTED_DEVICE_VERIFY_URL = 'https://sale.donapharm.asia/api/internal/trusted-device/verify';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
const requestCoordinator = new RequestCoordinator({ maxEntries: 12 });
let backendDataSignature = 'boot';
let observedToken;
let authScopeGeneration = 0;
let authenticatedActor = null;

function availableStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function actorCode(actor) {
  return String(actor?.emp_code || actor?.empCode || actor?.id || '').trim().toUpperCase();
}

export function setAuthActor(actor, storage) {
  authenticatedActor = actorCode(actor) ? actor : null;
  const target = availableStorage(storage);
  if (!target) return;
  try {
    if (authenticatedActor) target.setItem(AUTH_ACTOR_KEY, actorCode(authenticatedActor));
    else target.removeItem(AUTH_ACTOR_KEY);
  } catch { /* restricted storage */ }
}

// Clear the actor-scoped stale snapshot before invalidating the token/UI actor.
// The persisted actor code covers an expired token found during cold bootstrap,
// when React has not restored `me` yet. Never enumerate/delete another actor.
export function clearExpiredAuth(storage) {
  const target = availableStorage(storage);
  let actor = authenticatedActor;
  try { if (!actor && target) actor = { emp_code: target.getItem(AUTH_ACTOR_KEY) || '' }; } catch { /* restricted storage */ }
  if (target) clearSwrActor(target, actor);
  requestCoordinator.clear();
  backendDataSignature = 'boot';
  observedToken = '';
  authScopeGeneration += 1;
  try {
    target?.removeItem(TOKEN_KEY);
    target?.removeItem(AUTH_ACTOR_KEY);
  } catch { /* restricted storage */ }
  authenticatedActor = null;
  try { globalThis.window?.dispatchEvent(new CustomEvent('app:auth-expired')); } catch { /* non-browser/test */ }
}

async function authenticatedFetch(...args) {
  const response = await fetch(...args);
  if (response.status === 401) clearExpiredAuth();
  return response;
}

// `req()` already invalidates a 401 before throwing. A /me 403 is different:
// invalidate it here, then (and only then) let App attempt trusted-device recovery.
export async function recoverAfterMeRejection(error, restoreTrustedDevice, storage) {
  const status = Number(error?.status || 0);
  if (status !== 401 && status !== 403) return false;
  if (status === 403) clearExpiredAuth(storage);
  await restoreTrustedDevice();
  return true;
}
function authScopeFor(token) {
  if (token !== observedToken) {
    observedToken = token;
    authScopeGeneration += 1;
    requestCoordinator.clear();
  }
  return `${token ? 'AUTH' : 'ANON'}:${authScopeGeneration}`;
}
export const setToken = (t) => {
  requestCoordinator.clear();
  backendDataSignature = 'boot';
  observedToken = String(t || '');
  authScopeGeneration += 1;
  return t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
};

// deviceId bền cho "thiết bị tin cậy": đồng bộ localStorage + cookie 1 năm.
// Ưu tiên cookie giống App Sale để hai bản sao không luân phiên nhau.
const DEVICE_KEY = 'rpt_device';
const LAST_PHONE_KEY = 'rpt_last_phone';

function readCookie(name) {
  try {
    const prefix = `${name}=`;
    const found = document.cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith(prefix));
    return found ? decodeURIComponent(found.slice(prefix.length)) : '';
  } catch { return ''; }
}

function writeDeviceCookie(value) {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${DEVICE_KEY}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
  } catch { /* ignore */ }
}

export function getDeviceId() {
  let local = '';
  try { local = localStorage.getItem(DEVICE_KEY) || ''; } catch { /* ignore */ }
  const cookie = readCookie(DEVICE_KEY);
  const d = cookie || local
    || (crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  try { if (local !== d) localStorage.setItem(DEVICE_KEY, d); } catch { /* ignore */ }
  if (cookie !== d) writeDeviceCookie(d);
  return d;
}

export function rememberLastPhone(phone) {
  try { if (String(phone || '').trim()) localStorage.setItem(LAST_PHONE_KEY, String(phone).trim()); } catch { /* ignore */ }
}
export function getLastPhone() {
  try { return localStorage.getItem(LAST_PHONE_KEY) || ''; } catch { return ''; }
}
export function forgetLastPhone() {
  try { localStorage.removeItem(LAST_PHONE_KEY); } catch { /* ignore */ }
}

function requestError(message, res, data) {
  const error = new Error(message);
  error.status = res?.status || 0;
  error.code = data?.code || '';
  return error;
}

let activeRequestCount = 0;

function emitRequestState(phase, meta = {}) {
  if (typeof window === 'undefined') return;
  activeRequestCount = phase === 'start'
    ? activeRequestCount + 1
    : Math.max(0, activeRequestCount - 1);
  try {
    window.dispatchEvent(new CustomEvent('app:request-state', {
      detail: { phase, active: activeRequestCount, ...meta },
    }));
  } catch {
    /* ignore */
  }
}

function combineAbortSignals(signals) {
  const active = signals.filter(Boolean);
  if (active.length < 2) return active[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active);
  const controller = new AbortController();
  const abort = (event) => controller.abort(event?.target?.reason);
  for (const candidate of active) {
    if (candidate.aborted) { controller.abort(candidate.reason); break; }
    candidate.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

async function req(method, path, body, { timeoutMs = 0, timeoutMessage = '', signal, cacheMs } = {}) {
  const token = getToken() || '';
  const authScope = authScopeFor(token);
  const deviceId = getDeviceId();
  const bodyKey = body ? JSON.stringify(body) : '';
  const key = requestScopeKey({ method, path, authScope, deviceId, dataSignature: backendDataSignature, body: bodyKey });
  const perform = async (coordinatorSignal) => {
    const timeoutController = timeoutMs > 0 ? new AbortController() : null;
    const timer = timeoutController ? setTimeout(() => timeoutController.abort(), timeoutMs) : null;
    const fetchSignal = combineAbortSignals([coordinatorSignal, timeoutController?.signal]);
    emitRequestState('start', { method, path });
    try {
    const res = await fetch('/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': deviceId,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      ...(fetchSignal ? { signal: fetchSignal } : {}),
    });
    const data = await res.json().catch(() => ({}));
    const responseSignature = String(res.headers?.get?.('x-app-data-signature') || '');
    if (responseSignature && responseSignature !== backendDataSignature) {
      backendDataSignature = responseSignature;
      requestCoordinator.invalidateCache();
    }
    if (res.status === 401) {
      // OTP sai/hết hạn không phải là phiên đăng nhập hết hạn.
      if (path === '/auth/otp/verify') {
        throw requestError(data.error || 'Mã OTP không đúng hoặc đã hết hạn', res, data);
      }
      clearExpiredAuth();
      throw requestError(data.error || 'Phiên đăng nhập hết hạn', res, data);
    }
    // Kèm mã HTTP khi backend không gửi lời giải thích — "Lỗi máy chủ" trần khiến
    // người ta không phân biệt nổi 404 (thiếu route/bản cũ) với 502/504 (nghẽn/proxy).
    // Đúng vụ 09/08: bảng "đơn vị → nhóm" báo "Lỗi máy chủ" mà không ai biết lỗi gì.
    if (!res.ok) throw requestError(data.error || `Lỗi máy chủ (HTTP ${res.status})`, res, data);
    // Any successful mutation may alter settings/permissions that are not part
    // of the file-backed data signature. Never reuse a pre-mutation response.
    if (method !== 'GET') requestCoordinator.invalidateCache();
    return data;
  } catch (e) {
    if (timeoutController?.signal.aborted) {
      throw new Error(timeoutMessage || 'Hệ thống phản hồi quá lâu. Vui lòng thử lại.');
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    emitRequestState('end', { method, path });
  }
  };
  // A short private cache makes a quick menu round-trip instant. Scope keys
  // include auth, device, full query and backend generation; mutations clear it.
  if (method === 'GET') return requestCoordinator.run(key, perform, { cacheMs: cacheMs ?? 12 * 1000, signal });
  return perform(signal);
}

export async function trustedDeviceLogin(phone) {
  const pending = await req('POST', '/auth/trusted-device/start', { phone }, {
    timeoutMs: TRUSTED_DEVICE_VERIFY_TIMEOUT_MS,
    timeoutMessage: 'Không thể bắt đầu xác nhận thiết bị tin cậy.',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRUSTED_DEVICE_VERIFY_TIMEOUT_MS);
  let verified;
  try {
    const response = await fetch(APP_SALE_TRUSTED_DEVICE_VERIFY_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phone,
        reportDeviceId: pending.reportDeviceId,
        nonce: pending.nonce,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('trusted-device verify rejected');
    verified = await response.json();
  } catch {
    throw new Error('Thiết bị chưa được xác nhận; vui lòng dùng OTP.');
  } finally {
    clearTimeout(timer);
  }
  if (verified?.trusted !== true || typeof verified.assertion !== 'string') {
    throw new Error('Thiết bị chưa được xác nhận; vui lòng dùng OTP.');
  }
  return req('POST', '/auth/trusted-device/consume', {
    attemptId: pending.attemptId,
    assertion: verified.assertion,
  }, {
    timeoutMs: TRUSTED_DEVICE_VERIFY_TIMEOUT_MS + 1000,
    timeoutMessage: 'Không xác nhận được thiết bị tin cậy; vui lòng dùng OTP.',
  });
}

export async function passkeyLogin() {
  const pending = await req('POST', '/auth/passkey/login/options', {});
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const response = await startAuthentication({ optionsJSON: pending.options });
  return req('POST', '/auth/passkey/login/verify', { attemptId: pending.attemptId, response });
}

export async function registerPasskey() {
  const options = await req('POST', '/auth/passkey/register/options', {});
  const { startRegistration } = await import('@simplewebauthn/browser');
  const response = await startRegistration({ optionsJSON: options });
  return req('POST', '/auth/passkey/register/verify', { response });
}

export const api = {
  passkeyLogin,
  registerPasskey,
  // Màn "Chưa đồng bộ" — chỉ đọc, danh mục dòng bị loại + lý do.
  syncExceptions: (ky, { freshKey = null } = {}) => req(
    'GET',
    syncExceptionsRequestPath(ky, freshKey),
    undefined,
    freshKey == null ? {} : { cacheMs: 0 },
  ),
  // Sổ "Thanh toán CP của tôi" — GHI NHẬN. Backend chỉ cho CEO; frontend chỉ ẩn nút
  // cho gọn mắt, KHÔNG được coi việc ẩn nút là bảo vệ.
  paymentSetSecond: (payload) => req('POST', '/employee-cost/payment/second', payload),
  paymentRecord: (payload) => req('POST', '/employee-cost/payment/record', payload),
  paymentUndo: (payload) => req('POST', '/employee-cost/payment/undo', payload),
  login: (emp_code) => req('POST', '/auth/login', { emp_code }),
  demoUsers: () => req('GET', '/auth/demo-users'),
  mode: () => req('GET', '/auth/mode'),
  otpRequest: (phone) => req('POST', '/auth/otp/request', { phone }, {
    timeoutMs: OTP_AUTH_TIMEOUT_MS,
    timeoutMessage: 'Hệ thống OTP phản hồi quá lâu. Vui lòng thử lại.',
  }),
  otpVerify: (phone, code) => req('POST', '/auth/otp/verify', { phone, code }, {
    timeoutMs: OTP_AUTH_TIMEOUT_MS,
    timeoutMessage: 'Hệ thống OTP phản hồi quá lâu. Vui lòng thử lại.',
  }).then((r) => { if (r.token) rememberLastPhone(phone); return r; }),
  otpSelect: (phone, emp_code) => req('POST', '/auth/otp/select', { phone, emp_code }, {
    timeoutMs: OTP_AUTH_TIMEOUT_MS,
    timeoutMessage: 'Hệ thống OTP phản hồi quá lâu. Vui lòng thử lại.',
  }).then((r) => { if (r.token) rememberLastPhone(phone); return r; }),
  trustedDeviceLogin,
  sso: (sso_token) => req('POST', '/auth/sso', { sso_token }),
  // Telegram login (chính)
  telegramStart: () => req('POST', '/auth/telegram/start', {}),
  telegramStatus: (poll_secret) => req('POST', '/auth/telegram/status', { poll_secret }),
  // Admin: mapping Telegram + thiết bị tin cậy
  adminTelegramMap: () => req('GET', '/admin/telegram-map'),
  adminTelegramMapAdd: (telegram_id, emp_code) => req('POST', '/admin/telegram-map', { telegram_id, emp_code }),
  adminTelegramMapDel: (telegram_id) => req('DELETE', '/admin/telegram-map', { telegram_id }),
  adminDevices: (emp) => req('GET', '/admin/devices' + (emp ? `?emp=${encodeURIComponent(emp)}` : '')),
  adminDeviceDel: (id) => req('DELETE', '/admin/devices/' + encodeURIComponent(id)),
  me: () => req('GET', '/me', undefined, {
    timeoutMs: ME_TIMEOUT_MS,
    timeoutMessage: 'Không tải được thông tin đăng nhập. Vui lòng tải lại trang.',
  }),
  employeeCost: (emp, range = {}, requestOptions = {}) => {
    const params = new URLSearchParams();
    if (emp) params.set('emp', emp);
    for (const key of ['from', 'to', 'q', 'sortKey', 'sortDir', 'page', 'pageSize', 'province', 'unitGroup', 'route', 'date']) {
      if (range[key] != null && range[key] !== '') params.set(key, range[key]);
    }
    const query = params.toString();
    return req('GET', '/employee-cost' + (query ? `?${query}` : ''), undefined, {
      timeoutMs: EMPLOYEE_COST_TIMEOUT_MS, timeoutMessage: EMPLOYEE_COST_TIMEOUT_MESSAGE,
      cacheMs: 20 * 1000, ...requestOptions,
    });
  },
  employeeCostSnapshotStatus: (period, requestOptions = {}) => req('GET', '/employee-cost/snapshot/status?' + new URLSearchParams({ period }).toString(), undefined, { cacheMs: 0, ...requestOptions }),
  employeeCostSnapshotResync: (period) => req('POST', '/employee-cost/snapshot/resync', { period }, {
    timeoutMs: 8000,
    timeoutMessage: 'Chưa gửi được yêu cầu đồng bộ. Vui lòng thử lại.',
  }),
  employeeCostSalaryAdvance: (emp, period, requestOptions = {}) => {
    const params = new URLSearchParams();
    if (emp) params.set('emp', emp);
    if (period) params.set('period', period);
    const query = params.toString();
    return req('GET', '/employee-cost/salary-advance' + (query ? `?${query}` : ''), undefined, {
      timeoutMs: 8000,
      timeoutMessage: 'App Salary đang phản hồi chậm. Các chỉ số chi phí khác vẫn dùng bình thường.',
      cacheMs: 20 * 1000,
      ...requestOptions,
    });
  },
  employeeCostDiemXu: (emp, range = {}, requestOptions = {}) => {
    const params = new URLSearchParams();
    if (emp) params.set('emp', emp);
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    const query = params.toString();
    return req('GET', '/employee-cost/diem-xu' + (query ? `?${query}` : ''), undefined, {
      timeoutMs: EMPLOYEE_COST_TIMEOUT_MS, timeoutMessage: EMPLOYEE_COST_TIMEOUT_MESSAGE,
      cacheMs: 30 * 1000, ...requestOptions,
    });
  },
  employeeCostGaps: (emp, range = {}) => {
    const params = new URLSearchParams();
    if (emp) params.set('emp', emp);
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    const query = params.toString();
    return req('GET', '/employee-cost/gaps' + (query ? `?${query}` : ''), undefined, {
      timeoutMs: EMPLOYEE_COST_TIMEOUT_MS, timeoutMessage: EMPLOYEE_COST_TIMEOUT_MESSAGE,
    });
  },
  // Đếm nhẹ cho badge trên tab (không kèm danh sách).
  employeeCostGapsSummary: (range = {}) => {
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    const query = params.toString();
    return req('GET', '/employee-cost/gaps/summary' + (query ? `?${query}` : ''), undefined, {
      timeoutMs: EMPLOYEE_COST_TIMEOUT_MS, timeoutMessage: EMPLOYEE_COST_TIMEOUT_MESSAGE,
    });
  },
  employeeCostGapSyncDataHub: (params = {}, body = { confirm: true }) => {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null)),
    ).toString();
    return req('POST', '/employee-cost/gaps/sync-datahub' + (query ? `?${query}` : ''), body, {
      timeoutMs: EMPLOYEE_COST_TIMEOUT_MS, timeoutMessage: EMPLOYEE_COST_TIMEOUT_MESSAGE,
    });
  },
  employeeCostDataQuality: (params = {}) => req('GET', '/employee-cost/data-quality?' + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null)),
  ).toString(), undefined, {
    timeoutMs: EMPLOYEE_COST_TIMEOUT_MS, timeoutMessage: EMPLOYEE_COST_TIMEOUT_MESSAGE,
  }),
  // Badge phải đếm ĐÚNG KỲ đang xem — trước đây không truyền from/to nên đếm kỳ mặc định.
  employeeCostDataQualitySummary: (range = {}) => {
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    const query = params.toString();
    return req('GET', `/employee-cost/data-quality/summary${query ? `?${query}` : ''}`, undefined, {
      timeoutMs: EMPLOYEE_COST_TIMEOUT_MS, timeoutMessage: EMPLOYEE_COST_TIMEOUT_MESSAGE,
    });
  },
  paymentRange: ({ emp, from, to } = {}, requestOptions = {}) => {
    const params = new URLSearchParams();
    if (emp && emp !== 'ALL') params.set('emp', emp);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return req('GET', `/employee-cost/payment/range?${params.toString()}`, undefined, requestOptions);
  },
  // Preview xin nhận sớm là READ-ONLY nhưng dùng POST để luôn lấy trạng thái quota
  // mới nhất; frontend chỉ gửi kỳ + lần, tuyệt đối không gửi/tự tính số tiền.
  paymentEarlyPreview: ({ emp, period, key } = {}) => req('POST', '/employee-cost/payment/request-unlock-preview', {
    ...(emp ? { emp_code: emp } : {}), period, key,
  }),
  // Quy trình đề nghị nhận Lần 2/Lần 3. NV KHÔNG gửi số tiền — chỉ gửi kỳ + lần.
  paymentFlow: (action, { emp, period, key, note, requestId } = {}) => req('POST', `/employee-cost/payment/${action}`, {
    ...(emp ? { emp_code: emp } : {}), period, key, ...(note ? { note } : {}), ...(requestId ? { request_id: requestId } : {}),
  }),
  paymentRequestReasons: (requestOptions = {}) => req('GET', '/employee-cost/payment/request-reasons', undefined, requestOptions),
  paymentNotifications: () => req('GET', '/employee-cost/payment/notifications'),
  paymentNotificationsRead: (payload = {}) => req('POST', '/employee-cost/payment/notifications/read', payload),
  employeeCostEmployees: () => req('GET', '/employee-cost/employees'),
  employeeCostVisibility: () => req('GET', '/employee-cost/visibility'),
  employeeCostVisibilitySave: (payload) => req('POST', '/employee-cost/visibility', payload),
  periods: () => req('GET', '/periods'),
  revenueRefreshStatus: () => req('GET', '/admin/revenue-refresh/status'),
  revenueRefreshRun: (ky) => req('POST', '/admin/revenue-refresh/run', ky ? { ky } : {}),
  adminReconcile: (ky) => req('GET', '/admin/reconcile' + (ky ? `?ky=${encodeURIComponent(ky)}` : '')),
  adminTargets: (ky) => req('GET', '/admin/targets' + (ky ? `?ky=${encodeURIComponent(ky)}` : '')),
  adminBonusPolicies: (params = {}) => req('GET', '/admin/bonus-policies?' + new URLSearchParams(params).toString()),
  adminBonusPolicyPreview: (payload) => req('POST', '/admin/bonus-policies/preview', payload),
  adminBonusPolicySave: (payload) => req('POST', '/admin/bonus-policies', payload),
  adminPenaltyPolicies: (params = {}) => req('GET', '/admin/penalty-policies?' + new URLSearchParams(params).toString()),
  adminPenaltyPolicyPreview: (payload) => req('POST', '/admin/penalty-policies/preview', payload),
  adminPenaltyPolicySave: (payload) => req('POST', '/admin/penalty-policies', payload),
  adminTargetManual: (payload) => req('POST', '/admin/targets/manual', payload),
  adminTargetBulk: (payload) => req('POST', '/admin/targets/bulk', payload),
  adminTargetQuarter: (payload) => req('POST', '/admin/targets/quarter', payload),
  adminTargetAiPropose: () => req('POST', '/admin/targets/ai/propose', {}),
  adminTargetAiApply: (payload) => req('POST', '/admin/targets/ai/apply', payload),
  adminTargetUploadCommit: (previewId) => req('POST', '/admin/targets/upload/commit', { previewId }),
  adminTargetCarryover: (payload) => req('POST', '/admin/targets/carryover', payload),
  adminTargetManualClear: (payload) => req('POST', '/admin/targets/manual/clear', payload),
  adminTargetUploadRollback: (batchId) => req('POST', '/admin/targets/upload/rollback', { batchId }),
  adminTargetHistory: () => req('GET', '/admin/targets/history'),
  targetAdjustments: (params = {}) => req('GET', '/target-adjustments?' + new URLSearchParams(params).toString()),
  targetAdjustmentCreate: (payload) => req('POST', '/target-adjustments', payload),
  adminTargetAdjustmentApprove: (id) => req('POST', '/admin/target-adjustments/' + encodeURIComponent(id) + '/approve', {}),
  adminTargetAdjustmentReject: (id) => req('POST', '/admin/target-adjustments/' + encodeURIComponent(id) + '/reject', {}),
  adminTargetAdjustmentSuggestions: (params = {}) => req('GET', '/admin/target-adjustments/suggestions?' + new URLSearchParams(params).toString()),
  filters: (params) => req('GET', '/filters' + (params ? `?${new URLSearchParams(typeof params === 'string' ? { ky: params } : params)}` : '')),
  overview: (params) => req('GET', '/overview' + (params ? `?${new URLSearchParams(typeof params === 'string' ? { ky: params } : params)}` : '')),
  trend: (params = {}) => req('GET', '/trend?' + new URLSearchParams(params).toString()),
  alerts: (params) => req('GET', '/alerts' + (params ? `?${new URLSearchParams(params)}` : '')),
  dormantGate: (params = {}) => req('GET', '/dormant/gate?' + new URLSearchParams(params).toString()),
  dormantActions: (payload) => req('POST', '/dormant/actions', payload),
  dormantItemDetail: (key) => req('GET', '/dormant/items/' + encodeURIComponent(key) + '/detail'),
  dormantReportCurrent: (params = {}) => req('GET', '/dormant/reports/current?' + new URLSearchParams(params).toString()),
  dormantReportSnapshotCreate: (payload) => req('POST', '/dormant/reports/snapshots', payload),
  dormantReportSnapshots: () => req('GET', '/dormant/reports/snapshots'),
  dormantReportSnapshot: (id) => req('GET', '/dormant/reports/snapshots/' + encodeURIComponent(id)),
  dormantSummary: (params = {}) => req('GET', '/dormant/summary?' + new URLSearchParams(params).toString()),
  dormantAdminPlans: (params = {}) => req('GET', '/dormant/admin/plans?' + new URLSearchParams(params).toString()),
  dormantNotifications: () => req('GET', '/dormant/notifications'),
  dormantNotificationsRead: (payload = {}) => req('POST', '/dormant/notifications/read', payload),
  dormantEmployeeNotifications: () => req('GET', '/dormant/employee/notifications'),
  dormantEmployeeNotificationsRead: (payload = {}) => req('POST', '/dormant/employee/notifications/read', payload),
  dormantFeedbackCreate: (payload) => req('POST', '/dormant/feedback', payload),
  dormantFeedbackTelegramPreview: (id) => req('GET', '/dormant/feedback/' + encodeURIComponent(id) + '/telegram-preview'),
  dormantFeedbackAck: (id, payload) => req('POST', '/dormant/feedback/' + encodeURIComponent(id) + '/ack', payload),
  revenue: (dimension, ky, extra = {}) => {
    const p = new URLSearchParams({ dimension, ...(ky ? { ky } : {}), ...extra });
    return req('GET', '/revenue?' + p.toString());
  },
  revenueFull: (params = {}) => req('GET', '/revenue/full?' + new URLSearchParams(params).toString()),
  revenueSendRecipients: () => req('GET', '/report/revenue-send/recipients'),
  revenueSendPreview: (payload) => req('POST', '/report/revenue-send/preview', payload),
  revenueSendNow: (payload) => req('POST', '/report/revenue-send/send', payload),
  products: (params = {}) => req('GET', '/products?' + new URLSearchParams(params).toString()),
  analysis: (params = {}) => req('GET', '/analysis?' + new URLSearchParams(params).toString()),
  dailySalesOrders: (params = {}) => req('GET', '/daily-sales/orders?' + new URLSearchParams(params).toString()),
  cst: (params = {}) => req('GET', '/cst?' + new URLSearchParams(params).toString()),
  salesCatalog: (params = {}) => req('GET', '/catalog/sales?' + new URLSearchParams(params).toString()),
  myAssignments: (params = {}) => req('GET', '/assignments/mine?' + new URLSearchParams(params).toString()),
  catalogManagement: (period) => req('GET', '/catalog-management?' + new URLSearchParams(period ? { period } : {}).toString()),
  // Nút "Đồng bộ lại": vứt bản nhớ tạm 2 phút rồi hỏi lại Data Hub ngay (admin/CEO).
  catalogManagementRefresh: (period) => req('POST', '/catalog-management/refresh', period ? { period } : {}),
  costBreakdown: (params = {}) => req('GET', '/catalog-management/cost-breakdown?' + new URLSearchParams(params).toString()),
  // Phân quyền cột % (SPEC_CATALOG_COST_COLUMNS.md) — backend chặn CHỈ CEO được ghi.
  catalogCostGrants: () => req('GET', '/catalog-management/cost-columns/grants'),
  catalogCostGrantSave: (empCode, payload) => req('PUT', `/catalog-management/cost-columns/grants/${encodeURIComponent(empCode)}`, payload),
  catalogCostMyGrant: () => req('GET', '/catalog-management/cost-columns/my-grant'),
  catalogCostRates: (params = {}) => req('GET', '/catalog-management/cost-rates?' + new URLSearchParams(params).toString()),
  catalogCostRatesSync: (period) => req('POST', '/catalog-management/cost-rates/sync', { period }),
  catalogCostRatesLocalStatus: (params = {}) => req('GET', '/catalog-management/cost-rates/local-status?' + new URLSearchParams(params).toString()),
  catalogCostRatesTable: (params = {}) => req('GET', '/catalog-management/cost-rates/table?' + new URLSearchParams(params).toString()),
  // Bảng tra "mã đơn vị → nhóm" cho menu phân quyền v2 — backend phân giải, CEO-only.
  catalogCostUnitGroups: (units) => req('POST', '/catalog-management/cost-columns/unit-groups', { units }),
  // Menu riêng "Thành tiền C32/C47" — backend tự chặn (mặc định chỉ CEO; NV cần công tắc).
  costAmounts: (params = {}) => req('GET', '/catalog-management/cost-amounts?' + new URLSearchParams(params).toString()),
  costAmountsVisibility: () => req('GET', '/catalog-management/cost-amounts/visibility'),
  costAmountsVisibilitySave: (patch) => req('PUT', '/catalog-management/cost-amounts/visibility', patch),
  adminCatalogManagementHistory: (period) => req('GET', '/admin/catalog-management/history?' + new URLSearchParams(period ? { period } : {}).toString()),
  adminCatalogManagementDiagnostics: () => req('GET', '/admin/catalog-management/diagnostics'),
  adminCatalogManagementReportPreview: (payload) => req('POST', '/admin/catalog-management/report/preview', payload),
  adminCatalogManagementDeliveryPreview: (payload) => req('POST', '/admin/catalog-management/report/delivery/preview', payload),
  adminCatalogManagementDeliveryStatus: (previewId) => req('GET', '/admin/catalog-management/report/delivery/' + encodeURIComponent(previewId)),
  adminCatalogManagementTransfer: (payload) => req('POST', '/admin/catalog-management/transfers', payload),
  specialCandidates: () => req('GET', '/specials'),
  adminAssignments: (params = {}) => req('GET', '/admin/assignments?' + new URLSearchParams(params).toString()),
  adminAssignmentSave: (payload) => req('POST', '/admin/assignments', payload),
  adminAssignmentDelete: (id) => req('DELETE', '/admin/assignments/' + encodeURIComponent(id)),
  adminAssignmentSeed: (replaceAuto = false) => req('POST', '/admin/assignments/seed', { replaceAuto }),
  adminAssignmentHistory: () => req('GET', '/admin/assignments/history'),
  adminAssignmentUpload: (file) => {
    const fd = new FormData(); fd.append('file', file);
    return authenticatedFetch('/api/admin/assignments/upload', { method: 'POST', headers: { 'X-Device-Id': getDeviceId(), ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) }, body: fd }).then(async (res) => { const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'Lỗi upload phân công'); return data; });
  },
  targets: (params) => req('GET', '/targets' + (params ? `?${new URLSearchParams(typeof params === 'string' ? { ky: params } : params)}` : '')),
  targetKpi: (ky) => req('GET', '/targets/kpi' + (ky ? `?ky=${encodeURIComponent(ky)}` : '')),
  employeeDetail: (emp, ky) => req('GET', '/employee/detail?' + new URLSearchParams({ ...(emp ? { emp } : {}), ...(ky ? { ky } : {}) }).toString()),
  notificationsPreview: (ky) => req('GET', '/admin/notifications/preview' + (ky ? `?ky=${encodeURIComponent(ky)}` : '')),
  notificationsSend: (payload) => req('POST', '/admin/notifications/send', payload || {}),
  notificationsSendOne: (emp_code, ky) => req('POST', '/admin/notifications/send-one', { emp_code, ...(ky ? { ky } : {}) }),
  forecast: () => req('GET', '/targets/forecast'),
  ask: (text, context = null) => req('POST', '/ai/ask', { text, ...(context ? { context } : {}) }),
  lookup: (q, ky) => req('GET', '/lookup?' + new URLSearchParams({ q, ...(ky ? { ky } : {}) }).toString()),
  // Upload
  uploadPreview: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return authenticatedFetch('/api/upload/preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() },
      body: fd,
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || 'Lỗi upload'), { errors: d.errors, headerDetected: d.headerDetected });
      return d;
    });
  },
  targetUploadPreview: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return authenticatedFetch('/api/admin/targets/upload/preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() },
      body: fd,
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || 'Lỗi upload target'), { errors: d.errors });
      return d;
    });
  },
  uploadCommit: (payload) => req('POST', '/upload/commit', payload),
  uploadSlots: () => req('GET', '/upload/slots'),
  uploadActivate: (id) => req('POST', '/upload/activate', { id }),
};

function filenameFromDisposition(disposition, fallback) {
  const utf8 = String(disposition || '').match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) { try { return decodeURIComponent(utf8[1].replace(/["']/g, '')); } catch { /* use regular filename */ } }
  return String(disposition || '').match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

async function downloadEmployeeCostFile(path, format, params, fallback) {
  const extension = format === 'pdf' ? 'pdf' : 'xlsx';
  const url = `/api/${path}/export.${extension}?` + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null)),
  ).toString();
  const res = await authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không xuất được báo cáo chi phí');
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filenameFromDisposition(res.headers.get('content-disposition'), `${fallback}.${extension}`);
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
}

export async function downloadEmployeeCostReport(format = 'xlsx', params = {}) {
  return downloadEmployeeCostFile('employee-cost', format, params, 'employee-cost');
}

export async function downloadEmployeeCostGaps(format = 'xlsx', params = {}) {
  return downloadEmployeeCostFile('employee-cost/gaps', format, params, 'employee-cost-gaps');
}

export async function downloadEmployeeCostDataQuality(format = 'xlsx', params = {}) {
  return downloadEmployeeCostFile('employee-cost/data-quality', format, params, 'employee-cost-data-quality');
}

export async function downloadEmployeeCostProvinceWorklist(params = {}) {
  return downloadEmployeeCostFile('employee-cost/province-worklist', 'xlsx', params, 'employee-cost-province-worklist');
}

// Bảng % kho cục bộ — export theo ĐÚNG phạm vi quyền của người tải (backend lọc).
export async function downloadCostRatesTable(params = {}) {
  const url = '/api/catalog-management/cost-rates/table.xlsx?' + new URLSearchParams(params).toString();
  const res = await authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không xuất được bảng % chi phí');
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filenameFromDisposition(res.headers.get('content-disposition'), 'ty-le-chi-phi.xlsx');
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
}

// Tổng hợp chi phí C33–C46 — CHỈ CEO (backend requireCeo).
export async function downloadCostBreakdown(params = {}) {
  const url = '/api/catalog-management/cost-breakdown.xlsx?' + new URLSearchParams(params).toString();
  const res = await authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không xuất được bảng tổng hợp chi phí');
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filenameFromDisposition(res.headers.get('content-disposition'), 'tong-hop-chi-phi.xlsx');
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
}

// Thành tiền C32/C47 — export theo ĐÚNG phạm vi quyền của người tải (backend lọc).
export async function downloadCostAmounts(params = {}) {
  const url = '/api/catalog-management/cost-amounts.xlsx?' + new URLSearchParams(params).toString();
  const res = await authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không xuất được bảng thành tiền C32/C47');
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filenameFromDisposition(res.headers.get('content-disposition'), 'thanh-tien-c32-c47.xlsx');
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
}

export async function downloadDormantReport(format, snapshotId) {
  const extension = format === 'pdf' ? 'pdf' : 'xlsx';
  const url = `/api/dormant/reports/export.${extension}?` + new URLSearchParams({ snapshot_id: snapshotId }).toString();
  const res = await authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không xuất được báo cáo QLNB');
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filenameFromDisposition(res.headers.get('content-disposition'), `bao-cao-qlnb-${snapshotId}.${extension}`);
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
}

// Tải file export: fetch có token rồi kích hoạt download (an toàn hơn link trần).
export async function downloadExport(kind, params = {}) {
  const url = `/api/export/${kind}.xlsx?` + new URLSearchParams(params).toString();
  const res = await authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + getToken() } });
  if (!res.ok) throw new Error('Không xuất được file');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `report_${kind}_${params.ky || ''}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// Bộ báo cáo doanh thu quản trị: Excel nhiều sheet / CSV / PDF / PowerPoint.
export async function downloadRevenueReport(format = 'xlsx', params = {}) {
  const fmt = ['xlsx', 'csv', 'pdf', 'pptx'].includes(format) ? format : 'xlsx';
  const url = `/api/export/revenue_report.${fmt}?` + new URLSearchParams(params).toString();
  const res = await authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Không xuất được báo cáo');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] || `bao_cao_doanh_thu_${params.ky || ''}.${fmt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function downloadCatalogReport(url, payload, fallbackName) {
  const res = await authenticatedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() },
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không xuất được báo cáo');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

export async function downloadFilteredEmployeeReport(empCode, payload) {
  return downloadCatalogReport(`/api/admin/catalog-management/report/export/${encodeURIComponent(empCode)}.xlsx`, payload, `bao-cao-ca-nhan-${empCode}.xlsx`);
}

export async function downloadFilteredEmployeeSummary(payload) {
  return downloadCatalogReport('/api/admin/catalog-management/report/export-summary.xlsx', payload, 'tong-hop-bao-cao-nhan-vien.xlsx');
}

export async function downloadAssignmentTemplate(ky) {
  const url = `/api/admin/assignments/template.xlsx?` + new URLSearchParams({ ky: ky || '' }).toString();
  const res = await authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) throw new Error('Không tải được mẫu phân công');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `assignment_template_${ky || ''}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export async function downloadTargetTemplate(ky, basis = 't06') {
  const url = `/api/admin/targets/template.xlsx?` + new URLSearchParams({ ky: ky || '', basis: basis || 't06' }).toString();
  const res = await authenticatedFetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) throw new Error('Không tải được template target');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `target_template_${ky || ''}_${basis || 't06'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
