/**
 * auth.js — ĐĂNG NHẬP + PHÂN QUYỀN (quyết định ở BACKEND).
 *
 * V2 (SPEC_LOGIN_V2): Telegram login (chính) + Zalo OTP (dự phòng)
 *   - Phiên rolling LƯU BỀN (persist.js, restart PM2 không văng phiên).
 *   - Tối đa 3 thiết bị tin cậy / tài khoản (thiết bị thứ 4 đá cũ nhất + audit).
 *   - Chống device-code phishing: bot hỏi ✅, mã TTL 120s dùng 1 lần, poll bằng poll_secret, rate-limit.
 *   - Tự hủy phiên + thiết bị khi đổi SĐT / mã NV / quyền / xoá khỏi danh bạ.
 * Nguyên tắc không đổi: mọi phiên qua issueToken + scopeOf (NV chỉ thấy phần mình).
 */
const crypto = require('crypto');
const store = require('./store');
const persist = require('./persist');
const accessPolicy = require('./accessPolicy');
const { deviceIdHash, deviceFingerprint } = require('./trustedDevice');
const trustedDeviceSso = require('./trustedDeviceSso');
const passkeyAuth = require('./passkeyAuth');

const SESSION_IDLE_DAYS = Math.max(1, Number(process.env.SESSION_IDLE_DAYS || 7) || 7);
const SESSION_IDLE_MS = SESSION_IDLE_DAYS * 24 * 60 * 60 * 1000; // rolling idle TTL
const MAX_DEVICES = 3;                        // tối đa 3 thiết bị tin cậy / tài khoản
const TRUSTED_LOGIN_THRESHOLD = Math.max(1, Number(process.env.SESSION_TRUSTED_LOGIN_THRESHOLD || 3) || 3);
const TRUSTED_DEVICE_REVERIFY_DAYS = Math.max(1, Number(process.env.SESSION_TRUSTED_DEVICE_REVERIFY_DAYS || 30) || 30);
const TRUSTED_DEVICE_REVERIFY_MS = TRUSTED_DEVICE_REVERIFY_DAYS * 24 * 60 * 60 * 1000;
const TG_CODE_TTL_MS = 120 * 1000;            // mã Telegram 120s
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();
const isQaMethod = (method) => /^qa(?:-|$)/i.test(String(method || '').trim());

// Service token riêng cho machine-to-machine (DataHub → App Report).
// Ưu tiên lưu hash trong env để App Report không cần giữ plaintext; token thật chỉ nằm ở bên gọi (DataHub secret/env).
// Chỉ dùng cho route allowlist riêng, KHÔNG thay thế phiên đăng nhập người dùng toàn app.
const SERVICE_TOKEN_SHA256 = String(process.env.APP_REPORT_SERVICE_TOKEN_SHA256 || '').trim().toLowerCase();
const SERVICE_TOKEN_PLAINTEXT = String(process.env.APP_REPORT_SERVICE_TOKEN || '').trim();
const SERVICE_TOKEN_HASH = SERVICE_TOKEN_SHA256 || (SERVICE_TOKEN_PLAINTEXT ? sha(SERVICE_TOKEN_PLAINTEXT) : '');

// Credential riêng cho Home DONAPHARM hỏi quyết định có hiện ô App Report hay
// không. Tuyệt đối không tái dùng token DataHub ở trên: mỗi bên gọi chỉ được vào
// đúng allowlist endpoint của mình. App Report chỉ giữ SHA-256, không giữ token
// plaintext trong env/source.
const HOME_SERVICE_TOKEN_HASH = String(process.env.APP_REPORT_HOME_SERVICE_TOKEN_SHA256 || '').trim().toLowerCase();

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
  catch { return false; }
}

function serviceSessionFromRequest(req) {
  if (!SERVICE_TOKEN_HASH) return null;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || String(req.headers['x-app-report-service-token'] || '').trim();
  if (!token) return null;
  if (!safeEqualHex(sha(token), SERVICE_TOKEN_HASH)) return null;
  return {
    emp_code: 'CEO',
    role: 'ceo',
    name: 'DataHub Service',
    phone: null,
    deviceId: sha('service:datahub'),
    method: 'service-token',
    issued_at: now(),
    expires_at: now() + SESSION_IDLE_MS,
    service: 'datahub',
  };
}

function homeServiceSessionFromRequest(req) {
  if (!/^[a-f0-9]{64}$/.test(HOME_SERVICE_TOKEN_HASH)) return null;
  // Cấu hình nhầm cùng token DataHub cũng phải fail-closed, không âm thầm dùng chung.
  if (HOME_SERVICE_TOKEN_HASH === SERVICE_TOKEN_HASH) return null;
  const bearer = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization || '').trim());
  if (!bearer || !safeEqualHex(sha(bearer[1]), HOME_SERVICE_TOKEN_HASH)) return null;
  return {
    emp_code: 'HOME_SERVICE',
    role: 'service',
    name: 'Home DONAPHARM Service',
    phone: null,
    deviceId: sha('service:home'),
    method: 'service-token',
    issued_at: now(),
    expires_at: now() + SESSION_IDLE_MS,
    service: 'home',
  };
}

/* ===================== SESSION (lưu bền) ===================== */
// Bản ghi: { th:<hash token>, emp_code, role, name, phone, deviceId, method, issued_at, expires_at }
let sessions = persist.load('sessions', []);
const revokedSessionsAtStartup = sessions.filter((s) => accessPolicy.isLoginBlocked(s.emp_code)).length;
if (revokedSessionsAtStartup) {
  sessions = sessions.filter((s) => !accessPolicy.isLoginBlocked(s.emp_code));
}
const saveSessions = () => persist.save('sessions', sessions);
if (revokedSessionsAtStartup) {
  saveSessions();
  console.warn(`[auth] revoked ${revokedSessionsAtStartup} blocked App Report session(s) at startup`);
}
function pruneSessions() {
  const t = now();
  const before = sessions.length;
  sessions = sessions.filter((s) => s.expires_at > t);
  if (sessions.length !== before) saveSessions();
}
pruneSessions();

/* ===================== THIẾT BỊ TIN CẬY (lưu bền) ===================== */
// Bản ghi tương thích App Sale:
// { id, device_id_hash, emp_code, phone, first_seen, last_seen, ua,
//   trusted_fingerprint, trusted_login_count, is_trusted, trusted_at, last_otp_at }
let devices = persist.load('devices', []);
const revokedDevicesAtStartup = devices.filter((d) => accessPolicy.isLoginBlocked(d.emp_code)).length;
if (revokedDevicesAtStartup) {
  devices = devices.filter((d) => !accessPolicy.isLoginBlocked(d.emp_code));
}
const saveDevices = () => persist.save('devices', devices);
if (revokedDevicesAtStartup) {
  saveDevices();
  console.warn(`[auth] revoked ${revokedDevicesAtStartup} blocked App Report device(s) at startup`);
}

const isStoredDeviceId = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''));
const migrateDeviceId = (value) => isStoredDeviceId(value) ? String(value) : deviceIdHash(value);

// Migrate bản ghi Login V2 cũ: backend chỉ giữ device ID đã băm. Client vẫn gửi
// device ID bền dạng thô qua header; mỗi request được băm trước khi so khớp.
// Việc đổi đồng thời devices + sessions giữ nguyên các phiên rolling hiện hữu.
{
  const oldToHash = new Map();
  let devicesChanged = false;
  for (const d of devices) {
    const oldId = String(d.id || '').trim();
    const hash = String(d.device_id_hash || '').trim() || migrateDeviceId(oldId);
    if (oldId) oldToHash.set(oldId, hash);
    if (d.id !== hash || d.device_id_hash !== hash) devicesChanged = true;
    d.id = hash;
    d.device_id_hash = hash;
  }
  let sessionsChanged = false;
  for (const s of sessions) {
    if (!s.deviceId) continue;
    const hash = oldToHash.get(String(s.deviceId)) || migrateDeviceId(s.deviceId);
    if (s.deviceId !== hash) { s.deviceId = hash; sessionsChanged = true; }
  }
  if (devicesChanged) saveDevices();
  if (sessionsChanged) saveSessions();
}

function timeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ===================== AUDIT (lưu bền) ===================== */
let audit = persist.load('audit_auth', []);
{
  let changed = false;
  for (const item of audit) {
    if (!item?.device || isStoredDeviceId(item.device)) continue;
    item.device = deviceIdHash(item.device);
    changed = true;
  }
  if (changed) persist.save('audit_auth', audit);
}
function logAudit(event, data) {
  audit.push({ at: new Date().toISOString(), event, ...data });
  if (audit.length > 2000) audit = audit.slice(-2000);
  persist.save('audit_auth', audit);
}

/* ===================== MAPPING TELEGRAM (lưu bền) ===================== */
// Bản ghi: { telegram_id, emp_code, name, added_at, added_by }
// NGUỒN SỰ THẬT = FILE telegram_map.json. LÝ DO: backend App Report và worker Telegram
// là 2 TIẾN TRÌNH riêng. Nếu giữ bản in-memory `let tgMap` thì khi admin
// thêm map ở tiến trình này, tiến trình kia KHÔNG thấy (worker cứ đòi mã RP, không trả lời;
// digest cũng sót) và các tiến trình có thể GHI ĐÈ map của nhau bằng bản RAM cũ.
// => Luôn đọc/ghi THẲNG file (quy mô nhỏ, rất rẻ) + read-modify-write để không xoá nhầm.
const loadTgMap = () => { const v = persist.load('telegram_map', []); return Array.isArray(v) ? v : []; };
const resolveTelegram = (tid) => loadTgMap().find((m) => String(m.telegram_id) === String(tid)) || null;
function listTelegramMap() { return loadTgMap().map((m) => ({ ...m })); }
function addTelegramMap(telegram_id, emp_code, addedBy) {
  const tid = String(telegram_id).trim();
  const code = String(emp_code).trim().toUpperCase();
  if (!tid || !code) throw new Error('Thiếu telegram_id hoặc emp_code');
  const user = store.findUserByCode(code);
  if (!user) throw new Error('Mã NV không có trong danh bạ');
  const list = loadTgMap().filter((m) => String(m.telegram_id) !== tid); // đọc mới nhất từ disk; 1 tid ↔ 1 NV
  list.push({ telegram_id: tid, emp_code: code, name: user.name, added_at: new Date().toISOString(), added_by: addedBy || 'admin' });
  persist.save('telegram_map', list);
  logAudit('telegram_map_add', { telegram_id: tid, emp_code: code, by: addedBy });
  return { telegram_id: tid, emp_code: code, name: user.name };
}
function removeTelegramMap(telegram_id) {
  const tid = String(telegram_id).trim();
  const list = loadTgMap();
  const next = list.filter((m) => String(m.telegram_id) !== tid);
  if (next.length !== list.length) { persist.save('telegram_map', next); logAudit('telegram_map_remove', { telegram_id: tid }); }
  return next.length !== list.length;
}

/* ===================== HỦY PHIÊN / THIẾT BỊ ===================== */
function invalidateUserSessions(empCode, reason) {
  const code = String(empCode).toUpperCase();
  const before = sessions.length;
  sessions = sessions.filter((s) => s.emp_code !== code);
  if (sessions.length !== before) { saveSessions(); logAudit('sessions_invalidated', { emp_code: code, reason, removed: before - sessions.length }); }
}
function invalidateUserDevices(empCode, reason) {
  const code = String(empCode).toUpperCase();
  const before = devices.length;
  devices = devices.filter((d) => d.emp_code !== code);
  if (devices.length !== before) { saveDevices(); logAudit('devices_cleared', { emp_code: code, reason }); }
}
// Gọi khi đổi SĐT / mã NV / quyền / xoá khỏi danh bạ.
function purgeUser(empCode, reason) {
  invalidateUserSessions(empCode, reason);
  invalidateUserDevices(empCode, reason);
}

/* ===================== ĐĂNG KÝ THIẾT BỊ + PHÁT TOKEN ===================== */
function touchDevice(empCode, deviceId, ua) {
  if (!deviceId) return;
  const code = String(empCode).toUpperCase();
  const storedId = deviceIdHash(deviceId);
  const t = now();
  let d = devices.find((x) => x.emp_code === code && x.id === storedId);
  if (d) {
    d.last_seen = t;
    d.device_id_hash = storedId;
    if (ua) d.ua = ua;
  }
  else {
    devices.push({
      id: storedId,
      device_id_hash: storedId,
      emp_code: code,
      first_seen: t,
      last_seen: t,
      ua: ua || '',
      trusted_login_count: 0,
      is_trusted: false,
      trusted_at: null,
      last_otp_at: null,
    });
    // Vượt quá 3 thiết bị -> đá thiết bị CŨ NHẤT (first_seen cũ nhất) + audit + hủy phiên của nó.
    const mine = devices.filter((x) => x.emp_code === code).sort((a, b) => a.first_seen - b.first_seen);
    while (mine.length > MAX_DEVICES) {
      const victim = mine.shift();
      devices = devices.filter((x) => !(x.emp_code === code && x.id === victim.id));
      const sb = sessions.length;
      sessions = sessions.filter((s) => !(s.emp_code === code && s.deviceId === victim.id));
      if (sessions.length !== sb) saveSessions();
      logAudit('device_evicted', { emp_code: code, device: victim.id, reason: 'over_max_devices' });
    }
  }
  saveDevices();
}

// Chỉ OTP thành công mới cộng đếm. Telegram/SSO/device-login không được làm mới
// ngưỡng tin cậy hoặc cửa sổ 30 ngày.
function markOtpTrustedDevice(user, opts = {}) {
  const deviceId = String(opts.deviceId || '').trim();
  if (!deviceId) return;
  const code = String(user.emp_code || '').trim().toUpperCase();
  touchDevice(code, deviceId, opts.ua);
  const storedId = deviceIdHash(deviceId);
  const d = devices.find((x) => x.emp_code === code && x.id === storedId);
  if (!d) return;
  const t = now();
  const count = Math.min(TRUSTED_LOGIN_THRESHOLD, Math.max(0, Number(d.trusted_login_count || 0)) + 1);
  d.phone = normPhone(opts.phone || user.phone || store.findUserByCode(code)?.phone || '');
  d.device_id_hash = storedId;
  d.trusted_login_count = count;
  d.is_trusted = count >= TRUSTED_LOGIN_THRESHOLD;
  if (d.is_trusted && !d.trusted_at) d.trusted_at = t;
  d.last_otp_at = t;
  d.trusted_fingerprint = deviceFingerprint(opts.ua);
  saveDevices();
  logAudit('device_otp_verified', { emp_code: code, device: storedId, count, trusted: d.is_trusted });
}

function issueToken(user, opts = {}) {
  if (accessPolicy.isLoginBlocked(user?.emp_code)) {
    const e = new Error('Tài khoản không được cấp quyền truy cập App Report.');
    e.status = 403;
    e.code = 'APP_REPORT_ACCESS_REVOKED';
    throw e;
  }
  pruneSessions();
  const token = crypto.randomBytes(24).toString('hex');
  const t = now();
  const rec = {
    th: sha(token),
    emp_code: user.emp_code,
    role: user.role,
    name: user.name,
    phone: user.phone || opts.phone || store.findUserByCode(user.emp_code)?.phone || null,
    deviceId: opts.deviceId ? deviceIdHash(opts.deviceId) : null,
    method: opts.method || 'otp',
    issued_at: t,
    expires_at: t + SESSION_IDLE_MS,
  };
  sessions.push(rec);
  saveSessions();
  // Phiên nghiệm thu tự động tuyệt đối không được chiếm suất thiết bị tin cậy.
  // Nếu không chặn ở cả lúc phát token và lúc request bind device, Headless QA
  // có thể làm thiết bị thật của CEO bị loại khi vượt MAX_DEVICES.
  if (!isQaMethod(rec.method)) touchDevice(user.emp_code, opts.deviceId, opts.ua);
  if (rec.method === 'otp') markOtpTrustedDevice(user, { ...opts, phone: rec.phone });
  logAudit('login', { emp_code: user.emp_code, method: rec.method, device: rec.deviceId });
  return token;
}

function getSession(token, opts = {}) {
  if (!token) return null;
  const th = sha(token);
  const s = sessions.find((x) => x.th === th);
  if (!s) return null;
  if (s.expires_at <= now()) { pruneSessions(); return null; }
  const t = now();
  let changed = false;
  const rawDeviceId = opts.deviceId ? String(opts.deviceId).trim() : '';
  const reqDeviceId = rawDeviceId ? deviceIdHash(rawDeviceId) : '';
  const trackTrustedDevice = !isQaMethod(s.method);
  // Phiên cũ trước Login V2 có thể chưa gắn deviceId: bind 1 lần theo header ổn định.
  // Nếu phiên đã có deviceId thì không đổi sang device khác, tránh máy lạ dùng token bị tính là thiết bị tin cậy.
  if (trackTrustedDevice && !s.deviceId && reqDeviceId) { s.deviceId = reqDeviceId; changed = true; }
  if (trackTrustedDevice && s.deviceId && reqDeviceId && s.deviceId === reqDeviceId) touchDevice(s.emp_code, rawDeviceId, opts.ua);
  // Rolling session: mọi request token hợp lệ gia hạn theo idle TTL.
  s.expires_at = t + SESSION_IDLE_MS;
  changed = true;
  if (changed) saveSessions();
  return s;
}

function listDevices(empCode) {
  const code = empCode ? String(empCode).toUpperCase() : null;
  return devices
    .filter((d) => !code || d.emp_code === code)
    .map((d) => ({ id: d.id, emp_code: d.emp_code, first_seen: d.first_seen, last_seen: d.last_seen, ua: d.ua,
      trusted_login_count: Number(d.trusted_login_count || 0), is_trusted: d.is_trusted === true,
      trusted_at: d.trusted_at || null, last_otp_at: d.last_otp_at || null,
      active_sessions: sessions.filter((s) => s.emp_code === d.emp_code && s.deviceId === d.id && s.expires_at > now()).length }))
    .sort((a, b) => b.last_seen - a.last_seen);
}
function removeDevice(id) {
  const d = devices.find((x) => x.id === id);
  if (!d) return false;
  devices = devices.filter((x) => x.id !== id);
  saveDevices();
  const sb = sessions.length;
  sessions = sessions.filter((s) => s.deviceId !== id);
  if (sessions.length !== sb) saveSessions();
  logAudit('device_removed_by_admin', { emp_code: d.emp_code, device: id });
  return true;
}

/* ===================== DEMO / OTP / SSO (giữ luồng cũ) ===================== */
// Default DENY: demo chỉ bật khi chủ động đặt đúng ALLOW_DEMO_LOGIN=1.
// Tránh tình huống mất/không nạp env khiến production tự mở đăng nhập bằng mã NV.
const demoAllowed = () => process.env.ALLOW_DEMO_LOGIN === '1';
if (process.env.NODE_ENV === 'production' && demoAllowed()) {
  throw new Error('[SECURITY] Không được bật ALLOW_DEMO_LOGIN=1 trong production');
}
function mockLogin(empCode, opts = {}) {
  if (!demoAllowed()) return null;
  if (accessPolicy.isLoginBlocked(empCode)) return null;
  const user = store.findUserByCode(empCode);
  if (!user) return null;
  return { token: issueToken(user, { ...opts, method: 'demo' }), user };
}

const OTP_URL = process.env.OTP_BACKEND_URL || '';
const SSO_URL = process.env.SSO_VERIFY_URL || '';
const otpBackendTimeoutEnv = Number(process.env.OTP_BACKEND_TIMEOUT_MS || 10000);
const OTP_BACKEND_TIMEOUT_MS = Number.isFinite(otpBackendTimeoutEnv)
  ? Math.min(60000, Math.max(250, otpBackendTimeoutEnv))
  : 10000;
const liveAuthEnabled = () => !!(OTP_URL || SSO_URL);
/**
 * ‼ CÔNG TẮC KÊNH "SĐT + OTP" NẰM Ở BACKEND, KHÔNG VIẾT CỨNG TRONG WEB
 * (CEO bực 10/08/2026: *"nó bỏ qua bước nhập số điện thoại là sao, vậy nó mặc định
 * nhảy vào bot devreport làm tao phát điên."*)
 *
 * Trước đây web có hằng `SHOW_ZALO_OTP_UI = false` viết cứng để tạm giấu đường OTP
 * lúc dịch vụ Zalo lỗi. Hệ quả: ô nhập SĐT **biến mất khỏi màn login**, và muốn bật
 * lại phải SỬA CODE + BUILD + DEPLOY. Công tắc vận hành mà nằm trong bundle thì
 * không ai bật/tắt được lúc cần — đó là lỗi thiết kế, không phải lỗi tạm.
 *
 * Nay: bật/tắt bằng `LOGIN_OTP_ENABLED` (mặc định BẬT khi đã cấu hình OTP_BACKEND_URL).
 * Đặt `LOGIN_OTP_ENABLED=0` là tắt ngay, không cần build lại.
 */
const otpLoginEnabled = () => !!OTP_URL && String(process.env.LOGIN_OTP_ENABLED ?? '1') !== '0';
function normPhone(v) {
  let s = String(v || '').replace(/[^\d]/g, '');
  if (s.startsWith('84')) s = '0' + s.slice(2);
  if (s && !s.startsWith('0')) s = '0' + s;
  return s;
}
async function otpBackendRequest(path, payload, opts = {}) {
  try {
    const deviceId = String(opts.deviceId || '').trim();
    const response = await fetch(`${OTP_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(deviceId ? { 'x-device-id': deviceId } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(OTP_BACKEND_TIMEOUT_MS),
    });
    let data = {};
    try { data = await response.json(); } catch { /* ignore */ }
    return { response, data };
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      const timeoutError = new Error('Máy chủ OTP phản hồi quá lâu. Vui lòng thử lại.');
      timeoutError.status = 504;
      timeoutError.code = 'OTP_BACKEND_TIMEOUT';
      throw timeoutError;
    }
    const networkError = new Error('Không kết nối được máy chủ OTP. Vui lòng thử lại.');
    networkError.status = 502;
    networkError.code = 'OTP_BACKEND_UNAVAILABLE';
    throw networkError;
  }
}
async function requestOtp(phone, opts = {}) {
  if (!OTP_URL) throw new Error('Chưa cấu hình OTP_BACKEND_URL');
  const deviceId = String(opts.deviceId || '').trim();
  const { response, data } = await otpBackendRequest('/api/otp/request', {
    phone,
    ...(deviceId ? { deviceId } : {}),
    page: 'Report',
  }, opts);
  if (!response.ok || data.ok === false) {
    const upstreamError = new Error(data.error || 'Không thể gửi mã OTP.');
    upstreamError.status = !response.ok && response.status >= 400 && response.status < 500 ? response.status : 502;
    upstreamError.code = response.ok || response.status >= 500 ? 'OTP_BACKEND_UNAVAILABLE' : 'OTP_BACKEND_REJECTED';
    throw upstreamError;
  }
  return true;
}
function normRole(v) {
  const r = String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();
  if (/(ceo|giam doc|tong giam|chu tich|bod)/.test(r)) return 'ceo';
  if (/(full|admin|quan tri|manager|all)/.test(r)) return 'admin';
  return 'sale';
}
function mapAcc(o) {
  return { emp_code: String(o.code || o.emp_code || '').trim().toUpperCase(), name: o.name || '', role: normRole(o.role) };
}
const pub = (u) => ({ emp_code: u.emp_code, name: u.name, role: u.role });
const verifiedPhones = new Map();

async function verifyOtp(phone, code, opts = {}) {
  if (!OTP_URL) throw new Error('Chưa cấu hình OTP_BACKEND_URL');
  const deviceId = String(opts.deviceId || '').trim();
  const { response, data } = await otpBackendRequest('/api/otp/verify', {
    phone,
    code,
    ...(deviceId ? { deviceId } : {}),
    page: 'Report',
  }, opts);
  if (!response.ok || !data.ok) return null;

  const accounts = (Array.isArray(data.accounts) ? data.accounts : []).map(mapAcc)
    .filter((a) => a.emp_code && !accessPolicy.isLoginBlocked(a.emp_code));
  if (data.requireAccountChoice && accounts.length > 1) {
    verifiedPhones.set(normPhone(phone), { accounts, at: now(), opts });
    return { accounts };
  }
  const acc = accounts[0] || mapAcc(data);
  if (!acc.emp_code) return null;
  if (!acc.name) acc.name = store.findUserByCode(acc.emp_code)?.name || acc.emp_code;
  return { token: issueToken(acc, { ...opts, phone: normPhone(phone), method: 'otp' }), user: pub(acc) };
}

function selectAccount(phone, empCode, opts = {}) {
  const v = verifiedPhones.get(normPhone(phone));
  if (!v || now() - v.at > 5 * 60000) throw new Error('Phiên chọn tài khoản đã hết hạn, đăng nhập lại.');
  const acc = v.accounts.find((a) => a.emp_code === String(empCode).trim().toUpperCase());
  if (!acc) throw new Error('Tài khoản không hợp lệ.');
  verifiedPhones.delete(normPhone(phone));
  if (!acc.name) acc.name = store.findUserByCode(acc.emp_code)?.name || acc.emp_code;
  return { token: issueToken(acc, { ...opts, ...(v.opts || {}), phone: normPhone(phone), method: 'otp' }), user: pub(acc) };
}

// Thiết bị đủ 3 lần OTP, fingerprint còn khớp và OTP gần nhất chưa quá 30 ngày
// được cấp phiên mới. Device-login không cộng đếm và không gia hạn last_otp_at.
function loginByTrustedDevice(phone, opts = {}) {
  const normalizedPhone = normPhone(phone);
  const deviceId = String(opts.deviceId || '').trim();
  const fingerprint = deviceFingerprint(opts.ua);
  if (!normalizedPhone || !deviceId || !fingerprint) return null;
  const hash = deviceIdHash(deviceId);
  const cutoff = now() - TRUSTED_DEVICE_REVERIFY_MS;
  const candidates = devices.filter((d) => {
    if (d.device_id_hash !== hash && d.id !== hash) return false;
    if (normPhone(d.phone) !== normalizedPhone) return false;
    if (d.is_trusted !== true || Number(d.trusted_login_count || 0) < TRUSTED_LOGIN_THRESHOLD) return false;
    if (timeValue(d.last_otp_at) <= cutoff) return false;
    return d.trusted_fingerprint === fingerprint;
  });
  // Một SĐT có thể có nhiều mã NV trong App Report. Nếu nhiều tài khoản cùng đủ
  // điều kiện thì fail closed và yêu cầu OTP/chọn tài khoản, không tự đoán.
  const valid = candidates.map((d) => ({ d, user: store.findUserByCode(d.emp_code) }))
    .filter(({ user }) => user && !accessPolicy.isLoginBlocked(user.emp_code) && normPhone(user.phone) === normalizedPhone);
  if (valid.length !== 1) {
    logAudit('device_login_rejected', { phone: normalizedPhone, device: hash, matches: valid.length });
    return null;
  }
  const { d, user } = valid[0];
  const token = issueToken(user, { ...opts, phone: normalizedPhone, method: 'device' });
  logAudit('device_login', { emp_code: user.emp_code, device: d.id });
  return { token, user: pub(user) };
}

function startTrustedDeviceSso(phone, opts = {}) {
  return trustedDeviceSso.start(phone, opts);
}

async function consumeTrustedDeviceSso(attemptId, assertion, opts = {}) {
  const user = await trustedDeviceSso.consume(attemptId, assertion, opts);
  return {
    token: issueToken(user, { ...opts, phone: normPhone(user.phone), method: 'trusted-device-sso' }),
    user: pub(user),
  };
}

async function verifySso(ssoToken, opts = {}) {
  if (!SSO_URL) throw new Error('Chưa cấu hình SSO_VERIFY_URL');
  if (!ssoToken) return null;
  // Home Portal xác thực SSO bằng GET + query token. App Report chỉ đổi token
  // Home thành session riêng của Report; không lưu token Home trong frontend.
  const verifyUrl = new URL(SSO_URL);
  verifyUrl.searchParams.set('sso_token', ssoToken);
  const headers = {};
  if (opts.deviceId) headers['x-device-id'] = opts.deviceId;
  const r = await fetch(verifyUrl, { method: 'GET', headers });
  if (!r.ok) return null;
  const data = await r.json();
  if (!data.ok) return null;
  const empCode = String(data.emp_code || data.user?.code || '').trim().toUpperCase();
  if (accessPolicy.isLoginBlocked(empCode)) return null;
  const user = store.findUserByCode(empCode);
  return user ? { token: issueToken(user, { ...opts, method: 'sso' }), user } : null;
}

async function passkeyRegistrationOptions(session, opts = {}) {
  if (!isCeoActor(session)) throw Object.assign(new Error('Chỉ CEO được đăng ký Passkey.'), { status: 403, code: 'CEO_ONLY' });
  return passkeyAuth.registrationOptions(session, opts);
}

async function passkeyVerifyRegistration(session, response, opts = {}) {
  if (!isCeoActor(session)) throw Object.assign(new Error('Chỉ CEO được đăng ký Passkey.'), { status: 403, code: 'CEO_ONLY' });
  const result = await passkeyAuth.verifyRegistration(session, response, opts);
  logAudit('passkey_registered', { emp_code: 'CEO', device: opts.deviceId ? deviceIdHash(opts.deviceId) : null });
  return result;
}

async function passkeyAuthenticationOptions() {
  return passkeyAuth.authenticationOptions();
}

async function passkeyVerifyAuthentication(attemptId, response, opts = {}) {
  const result = await passkeyAuth.verifyAuthentication(attemptId, response);
  const user = store.findUserByCode(result.emp_code);
  if (!user || !isCeoActor(user) || accessPolicy.isLoginBlocked(user.emp_code)) {
    throw Object.assign(new Error('Tài khoản CEO không khả dụng.'), { status: 403, code: 'CEO_ACCESS_REVOKED' });
  }
  return { token: issueToken(user, { ...opts, method: 'passkey' }), user: pub(user) };
}

/* ===================== ĐĂNG NHẬP TELEGRAM (chính) ===================== */
const TG_SECRET = process.env.TELEGRAM_BOT_SECRET || '';
const TG_BOT = process.env.TELEGRAM_BOT_USERNAME || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

/* ═══════════════════════════════════════════════════════════════════════════════
   KÊNH THỨ HAI ĐỂ XÁC NHẬN ĐĂNG NHẬP (CEO yêu cầu 09/08/2026)

   CEO: *"otp đang trả về cho bot loginreportdonapharm mà không có thêm kênh gửi về
   cho tin nhắn bot report — khắc phục ngay cho tôi thêm cách gửi này."*

   ‼ Vì sao thêm kênh KHÔNG làm yếu đăng nhập: mã đăng nhập không đổi, cách xác thực
   không đổi. Telegram cấp **một user id duy nhất cho mỗi người, dùng chung mọi bot**,
   nên bot nào chuyển mã về thì `resolveTelegram(telegram_id)` vẫn ra ĐÚNG một nhân
   viên đó. Thêm bot = thêm ĐƯỜNG ĐI, không phải thêm danh tính:
     · vẫn phải có mã hiển thị trên trình duyệt (mã 120s, dùng một lần);
     · vẫn phải là telegram_id ĐÃ được map sang mã NV;
     · vẫn chặn tài khoản bị khoá; vẫn ghi audit — thêm cả BOT NÀO đã xác nhận.

   ‼ Bot nào KHÔNG có secret riêng thì KHÔNG được nhận — secret rỗng không bao giờ
   khớp. So sánh theo kiểu hằng-thời-gian để không rò rỉ độ dài/nội dung secret qua
   thời gian phản hồi.

   Cấu hình: bot 1 giữ nguyên biến cũ; bot 2 dùng `TELEGRAM_BOT2_USERNAME` +
   `TELEGRAM_BOT2_SECRET` (+ `TELEGRAM_BOT2_LABEL` để đặt tên nút trên màn login).
   Chưa cấu hình bot 2 ⇒ mọi thứ chạy y như trước, không có nút thứ hai.
   ═══════════════════════════════════════════════════════════════════════════════ */
const TG_BOT2_SECRET = process.env.TELEGRAM_BOT2_SECRET || '';
const TG_BOT2 = process.env.TELEGRAM_BOT2_USERNAME || '';
const TG_BOT2_LABEL = process.env.TELEGRAM_BOT2_LABEL || 'Bot Report (tin nhắn)';

function loginBots() {
  return [
    { key: 'login', label: process.env.TELEGRAM_BOT_LABEL || 'Report Bot (đăng nhập)', username: TG_BOT, secret: TG_SECRET },
    { key: 'report', label: TG_BOT2_LABEL, username: TG_BOT2, secret: TG_BOT2_SECRET },
  ];
}

/** So sánh secret không rò rỉ thời gian. Rỗng/khác độ dài ⇒ sai, không so tiếp. */
function secretMatches(given, expected) {
  const a = Buffer.from(String(given || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
// Bản ghi mã (ephemeral, không cần lưu bền vì TTL 120s): login_code -> {...}
const loginCodes = new Map();
// Rate-limit
const ipStarts = new Map();   // ip -> [timestamps]
const pollLast = new Map();   // poll_secret -> ts

function genLoginCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm (I,O,0,1)
  let s = '';
  const buf = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) s += A[buf[i] % A.length];
  return 'RP-' + s;
}
function pruneCodes() {
  const t = now();
  for (const [k, v] of loginCodes) if (v.expires_at <= t) loginCodes.delete(k);
}

function telegramStart({ deviceId, ip, ua } = {}) {
  pruneCodes();
  // Rate-limit: ≤5 mã/phút/IP
  if (ip) {
    const arr = (ipStarts.get(ip) || []).filter((t) => now() - t < 60000);
    if (arr.length >= 5) { const e = new Error('Bạn tạo mã quá nhanh, vui lòng thử lại sau 1 phút.'); e.status = 429; throw e; }
    arr.push(now()); ipStarts.set(ip, arr);
  }
  let code;
  do { code = genLoginCode(); } while (loginCodes.has(code));
  const poll_secret = crypto.randomBytes(24).toString('hex'); // ≥32 ký tự hex (48)
  loginCodes.set(code, {
    poll_secret, deviceId: deviceId || null, ua: ua || '',
    created_at: now(), expires_at: now() + TG_CODE_TTL_MS,
    status: 'pending', user: null, telegram_id: null,
  });
  // Mỗi bot ĐÃ CẤU HÌNH ĐỦ (có username + secret) là một đường gửi mã. `bot_link`
  // giữ lại cho bản web cũ, luôn trỏ bot thứ nhất.
  const bots = loginBots()
    .filter((bot) => bot.username && bot.secret)
    .map((bot) => ({ key: bot.key, label: bot.label, link: `https://t.me/${bot.username}?start=${code}` }));
  const bot_link = TG_BOT ? `https://t.me/${TG_BOT}?start=${code}` : null;
  return { login_code: code, poll_secret, expires_in: Math.floor(TG_CODE_TTL_MS / 1000), bot_link, bots };
}

// Trình duyệt poll bằng poll_secret (KHÔNG phải mã hiển thị).
function telegramStatus(poll_secret) {
  pruneCodes();
  if (!poll_secret) return { status: 'expired' };
  // Rate-limit poll: ≥2s/lần
  const last = pollLast.get(poll_secret) || 0;
  if (now() - last < 2000) { const e = new Error('Poll quá nhanh'); e.status = 429; throw e; }
  pollLast.set(poll_secret, now());

  let entry = null;
  for (const v of loginCodes.values()) if (v.poll_secret === poll_secret) { entry = v; break; }
  if (!entry) return { status: 'expired' };
  if (entry.expires_at <= now()) return { status: 'expired' };
  if (entry.status !== 'confirmed' || !entry.user) return { status: 'pending' };

  // Confirmed: phát token 1 lần rồi hủy mã (dùng 1 lần).
  const user = entry.user;
  for (const [k, v] of loginCodes) if (v === entry) loginCodes.delete(k);
  pollLast.delete(poll_secret);
  const token = issueToken(user, { deviceId: entry.deviceId, ua: entry.ua, method: 'telegram' });
  return { status: 'confirmed', token, user: pub(user) };
}

// CHỈ bot Telegram nội bộ gọi. Nhận secret của BẤT KỲ bot nào đã cấu hình (bot đăng
// nhập hoặc bot Report) — cùng một luật xác thực, chỉ khác đường đi.
function telegramConfirm({ login_code, telegram_id, secret_bot }) {
  pruneCodes();
  const via = loginBots().find((bot) => secretMatches(secret_bot, bot.secret));
  if (!via) {
    // KHÔNG ghi secret vào audit — chỉ ghi có ai đó gõ sai.
    logAudit('telegram_confirm_bad_secret', { telegram_id, login_code });
    const e = new Error('secret_bot không hợp lệ'); e.status = 403; throw e;
  }
  const code = String(login_code || '').trim().toUpperCase();
  const entry = loginCodes.get(code);
  if (!entry || entry.expires_at <= now()) { const e = new Error('Mã không tồn tại hoặc đã hết hạn'); e.status = 410; throw e; }
  if (entry.status === 'confirmed') { const e = new Error('Mã đã được xác nhận'); e.status = 409; throw e; }
  const m = resolveTelegram(telegram_id);
  if (!m) { const e = new Error('unmapped'); e.status = 404; e.code = 'UNMAPPED'; throw e; }
  const user = store.findUserByCode(m.emp_code);
  if (!user) { const e = new Error('Mã NV không còn trong danh bạ'); e.status = 404; throw e; }
  if (accessPolicy.isLoginBlocked(user.emp_code)) {
    const e = new Error('Tài khoản không được cấp quyền truy cập App Report.');
    e.status = 403;
    e.code = 'APP_REPORT_ACCESS_REVOKED';
    throw e;
  }
  entry.status = 'confirmed';
  entry.telegram_id = String(telegram_id);
  entry.via = via.key;
  entry.user = { emp_code: user.emp_code, name: user.name, role: normRole(user.role), phone: user.phone };
  // Ghi rõ BOT NÀO đã xác nhận — có hai đường thì phải truy được đường nào đã dùng.
  logAudit('telegram_confirm', { emp_code: user.emp_code, telegram_id: String(telegram_id), via: via.key });
  return { ok: true, emp_code: user.emp_code, name: user.name, via: via.key };
}

/* ===================== MIDDLEWARE + SCOPE ===================== */
function revenueOnlyDenied(res) {
  return res.status(403).json({
    error: 'Tài khoản này chỉ được xem Doanh thu, Doanh thu đầy đủ và Cơ số thầu.',
    code: 'REVENUE_ONLY_ACCESS',
    allowed_tabs: ['revenue', 'revenueFull', 'cst'],
  });
}

// Chốt policy ở cấp router, kể cả method/path không khớp một route cụ thể.
// Nhờ đó VP018 luôn nhận 403 cho mọi POST/PUT/PATCH/DELETE và mọi API ngoài
// allowlist (kể cả /employee-cost* chưa/không còn tồn tại), thay vì rơi qua 404.
// Chỉ peek phiên trong RAM, không gia hạn/ghi sessions; requireAuth của route hợp
// lệ vẫn là nơi xác thực đầy đủ và rolling session đúng một lần.
function enforceAccessPolicyBoundary(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return next();
  const sess = sessions.find((item) => item.th === sha(token) && item.expires_at > now());
  if (!sess || accessPolicy.isRequestAllowed(sess, {
    method: req.method,
    path: req.originalUrl || `${req.baseUrl || ''}${req.path || req.url || ''}`,
  })) return next();
  return revenueOnlyDenied(res);
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const sess = getSession(token, {
    deviceId: (req.headers['x-device-id'] || '').toString().trim() || null,
    ua: (req.headers['user-agent'] || '').toString().slice(0, 200),
  });
  if (!sess) return res.status(401).json({ error: 'Chưa đăng nhập' });
  if (accessPolicy.isLoginBlocked(sess.emp_code)) {
    purgeUser(sess.emp_code, 'app_report_access_revoked');
    return res.status(403).json({
      error: 'Tài khoản không được cấp quyền truy cập App Report.',
      code: 'APP_REPORT_ACCESS_REVOKED',
    });
  }
  // Tự hủy phiên khi NV đổi mã NV/quyền/SĐT hoặc bị xoá khỏi danh bạ.
  const u = store.findUserByCode(sess.emp_code);
  const roleChanged = u && normRole(u.role) !== sess.role;
  const phoneChanged = u && sess.phone && u.phone && u.phone !== sess.phone;
  if (!u || roleChanged || phoneChanged) {
    purgeUser(sess.emp_code, !u ? 'removed_from_directory' : roleChanged ? 'role_changed' : 'phone_changed');
    return res.status(401).json({ error: 'Phiên đã hết hiệu lực do thay đổi tài khoản. Vui lòng đăng nhập lại.' });
  }
  const requestPath = req.originalUrl || `${req.baseUrl || ''}${req.path || req.url || ''}`;
  if (!accessPolicy.isRequestAllowed(sess, { method: req.method, path: requestPath })) return revenueOnlyDenied(res);
  req.session = sess;
  next();
}

// Machine-to-machine auth allowlist cho API target DataHub cần đọc.
// Không dùng middleware này đại trà cho các route user/admin khác.
function requireTargetAuth(req, res, next) {
  const svc = serviceSessionFromRequest(req);
  if (svc) { req.session = svc; return next(); }
  return requireAuth(req, res, next);
}

// Endpoint tích hợp DataHub chỉ chấp nhận service token riêng. Không cho phép
// cookie/session người dùng thay thế để tránh biến API machine-to-machine thành
// một đường đọc dữ liệu quản trị ngoài ý muốn.
function requireDataHubService(req, res, next) {
  const svc = serviceSessionFromRequest(req);
  if (!svc || svc.service !== 'datahub') {
    return res.status(401).json({ error: 'DataHub service token không hợp lệ.', code: 'DATAHUB_SERVICE_AUTH_REQUIRED' });
  }
  req.session = svc;
  next();
}

// Home chỉ được hỏi quyết định hiển thị ô App Report. User session, cookie và
// token DataHub không thay thế được credential riêng này.
function requireHomeService(req, res, next) {
  // Kể cả lỗi auth cũng không được cache quyết định/quyền truy cập.
  res.set('Cache-Control', 'no-store');
  const svc = homeServiceSessionFromRequest(req);
  if (!svc || svc.service !== 'home') {
    return res.status(401).json({ error: 'Home service token không hợp lệ.', code: 'HOME_SERVICE_AUTH_REQUIRED' });
  }
  req.session = svc;
  next();
}
const isAdmin = (role) => role === 'ceo' || role === 'admin';
function scopeOf(session) {
  return { empCode: isAdmin(session.role) ? null : session.emp_code };
}
// VP018 là người kiểm tra doanh thu thay CEO: chỉ các route doanh thu gọi helper
// này mới nhận company scope. `scopeOf` chung vẫn self-scope để một allowlist sai
// trong tương lai không tự biến thành quyền đọc toàn công ty ngoài route chuyên biệt.
function revenueScopeOf(session) {
  return { empCode: accessPolicy.canReadAllRevenue(session) ? null : scopeOf(session).empCode };
}
function cstScopeOf(session) {
  return { empCode: accessPolicy.canReadAllCst(session) ? null : scopeOf(session).empCode };
}
function sessionForUser(user) {
  if (!user) return null;
  return { emp_code: user.emp_code, name: user.name, role: normRole(user.role), phone: user.phone || null };
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req.session.role)) return res.status(403).json({ error: 'Không đủ quyền' });
  next();
}

// ‼ CEO chốt 04/08/2026: ghi nhận thanh toán CP là việc CHỈ CEO được làm —
// admin cũng KHÔNG được. `requireAdmin` cho cả 'ceo' lẫn 'admin' nên không đủ chặt
// cho các cửa động vào tiền chi trả. Dùng đúng hàm này cho những cửa đó.
function isCeo(role) { return String(role || '').toLowerCase() === 'ceo'; }

/**
 * ‼ AI LÀ CEO? HỎI DANH TÍNH, ĐỪNG HỎI CHUỖI ROLE. (sửa 05/08/2026)
 *
 * Tài khoản CEO trên PROD là `emp_code = 'CEO'` nhưng `role = 'admin'` (bot xác nhận
 * 05/08). `isCeo(role)` vì thế trả **false** cho chính CEO ⇒ **6 cửa tiền**
 * (approve · reject · unlock · second · record · undo) trả 403 `CEO_ONLY` cho người
 * duy nhất được phép đi qua. Lỗi này nằm im từ lúc dựng luồng duyệt, không ai kêu vì
 * frontend lại giấu mất nút (`PaymentSchedule.jsx` xét `role === 'ceo'`).
 *
 * ‼ TUYỆT ĐỐI KHÔNG sửa bằng cách cho `isAdmin` đi qua. Ba lý do:
 *   1. Trái lệnh CEO 04/08 *"chỉ duy nhất CEO được phép ghi thôi"* — admin cũng không.
 *   2. Làm đỏ chính `paymentLedgerRoutes.test.js` — bài test ghi lại lệnh đó.
 *   3. Feed thông báo chỉ chiếu `amount` vào vai CEO ⇒ cho admin vào vai CEO là
 *      **lộ tiền của toàn bộ NV**, phạm nguyên tắc trong CLAUDE.md.
 *
 * Nên: nhận diện theo **mã nhân viên**. Admin khác (VD `VP002`) vẫn bị chặn y như cũ.
 *
 * ‼ MỘT BẢN DUY NHẤT. Trước đây repo có tới 4 bản chép của luật này (2 đúng, 2 sai);
 * thêm bản thứ hai ở bất kỳ đâu là tái lập đúng sự cố 05/08.
 */
const CEO_EMP_CODES = new Set(
  String(process.env.CEO_EMP_CODES || 'CEO').split(',').map((code) => code.trim().toUpperCase()).filter(Boolean),
);
function isCeoActor(session) {
  return isCeo(session?.role) || CEO_EMP_CODES.has(String(session?.emp_code || '').trim().toUpperCase());
}
function requireCeo(req, res, next) {
  if (!isCeoActor(req.session)) return res.status(403).json({ error: 'Chỉ CEO được thực hiện', code: 'CEO_ONLY' });
  next();
}

module.exports = {
  mockLogin, enforceAccessPolicyBoundary, requireAuth, requireTargetAuth, requireDataHubService, requireHomeService, requireAdmin, isAdmin, requireCeo, isCeo, isCeoActor, CEO_EMP_CODES, scopeOf, revenueScopeOf, cstScopeOf, sessionForUser, getSession,
  issueToken, liveAuthEnabled, otpLoginEnabled, requestOtp, verifyOtp, selectAccount, loginByTrustedDevice, verifySso, demoAllowed,
  accessProfileFor: accessPolicy.accessProfileFor,
  canReadAllRevenue: accessPolicy.canReadAllRevenue,
  canReadAllCst: accessPolicy.canReadAllCst,
  startTrustedDeviceSso, consumeTrustedDeviceSso, trustedDeviceSsoConfigured: trustedDeviceSso.isConfigured,
  passkeyRegistrationOptions, passkeyVerifyRegistration, passkeyAuthenticationOptions, passkeyVerifyAuthentication,
  passkeyStatus: passkeyAuth.status,
  // Telegram
  telegramStart, telegramStatus, telegramConfirm,
  // Đủ điều kiện khi CÓ ÍT NHẤT MỘT bot cấu hình đủ (username + secret) và app có
  // token để nói chuyện với Telegram.
  telegramConfigured: () => !!TG_TOKEN && loginBots().some((bot) => bot.username && bot.secret),
  telegramLoginBots: () => loginBots().filter((bot) => bot.username && bot.secret).map(({ key, label, username }) => ({ key, label, username })),
  // Mapping + thiết bị + hủy phiên
  listTelegramMap, addTelegramMap, removeTelegramMap, resolveTelegram,
  listDevices, removeDevice, purgeUser, invalidateUserSessions, invalidateUserDevices,
};
