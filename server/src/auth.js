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

const SESSION_IDLE_DAYS = Math.max(1, Number(process.env.SESSION_IDLE_DAYS || 7) || 7);
const SESSION_IDLE_MS = SESSION_IDLE_DAYS * 24 * 60 * 60 * 1000; // rolling idle TTL
const MAX_DEVICES = 3;                        // tối đa 3 thiết bị tin cậy / tài khoản
const TG_CODE_TTL_MS = 120 * 1000;            // mã Telegram 120s
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();

/* ===================== SESSION (lưu bền) ===================== */
// Bản ghi: { th:<hash token>, emp_code, role, name, phone, deviceId, method, issued_at, expires_at }
let sessions = persist.load('sessions', []);
const saveSessions = () => persist.save('sessions', sessions);
function pruneSessions() {
  const t = now();
  const before = sessions.length;
  sessions = sessions.filter((s) => s.expires_at > t);
  if (sessions.length !== before) saveSessions();
}
pruneSessions();

/* ===================== THIẾT BỊ TIN CẬY (lưu bền) ===================== */
// Bản ghi: { id:<deviceId>, emp_code, first_seen, last_seen, ua }
let devices = persist.load('devices', []);
const saveDevices = () => persist.save('devices', devices);

/* ===================== AUDIT (lưu bền) ===================== */
let audit = persist.load('audit_auth', []);
function logAudit(event, data) {
  audit.push({ at: new Date().toISOString(), event, ...data });
  if (audit.length > 2000) audit = audit.slice(-2000);
  persist.save('audit_auth', audit);
}

/* ===================== MAPPING TELEGRAM (lưu bền) ===================== */
// Bản ghi: { telegram_id, emp_code, name, added_at, added_by }
// NGUỒN SỰ THẬT = FILE telegram_map.json. LÝ DO: backend (reportnew) và worker Telegram
// (reportnew-tgbot) là 2 TIẾN TRÌNH riêng. Nếu giữ bản in-memory `let tgMap` thì khi admin
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
  const t = now();
  let d = devices.find((x) => x.emp_code === code && x.id === deviceId);
  if (d) { d.last_seen = t; if (ua) d.ua = ua; }
  else {
    devices.push({ id: deviceId, emp_code: code, first_seen: t, last_seen: t, ua: ua || '' });
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

function issueToken(user, opts = {}) {
  pruneSessions();
  const token = crypto.randomBytes(24).toString('hex');
  const t = now();
  const rec = {
    th: sha(token),
    emp_code: user.emp_code,
    role: user.role,
    name: user.name,
    phone: user.phone || opts.phone || store.findUserByCode(user.emp_code)?.phone || null,
    deviceId: opts.deviceId || null,
    method: opts.method || 'otp',
    issued_at: t,
    expires_at: t + SESSION_IDLE_MS,
  };
  sessions.push(rec);
  saveSessions();
  touchDevice(user.emp_code, opts.deviceId, opts.ua);
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
  const reqDeviceId = opts.deviceId ? String(opts.deviceId).trim() : '';
  // Phiên cũ trước Login V2 có thể chưa gắn deviceId: bind 1 lần theo header ổn định.
  // Nếu phiên đã có deviceId thì không đổi sang device khác, tránh máy lạ dùng token bị tính là thiết bị tin cậy.
  if (!s.deviceId && reqDeviceId) { s.deviceId = reqDeviceId; changed = true; }
  if (s.deviceId && reqDeviceId && s.deviceId === reqDeviceId) touchDevice(s.emp_code, reqDeviceId, opts.ua);
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
const demoAllowed = () => process.env.ALLOW_DEMO_LOGIN !== '0';
function mockLogin(empCode, opts = {}) {
  if (!demoAllowed()) return null;
  const user = store.findUserByCode(empCode);
  if (!user) return null;
  return { token: issueToken(user, { ...opts, method: 'demo' }), user };
}

const OTP_URL = process.env.OTP_BACKEND_URL || '';
const SSO_URL = process.env.SSO_VERIFY_URL || '';
const liveAuthEnabled = () => !!OTP_URL;
function normPhone(v) {
  let s = String(v || '').replace(/[^\d]/g, '');
  if (s.startsWith('84')) s = '0' + s.slice(2);
  if (s && !s.startsWith('0')) s = '0' + s;
  return s;
}
async function requestOtp(phone) {
  if (!OTP_URL) throw new Error('Chưa cấu hình OTP_BACKEND_URL');
  const r = await fetch(`${OTP_URL}/api/otp/request`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  return r.ok;
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
  const r = await fetch(`${OTP_URL}/api/otp/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  });
  let data = {};
  try { data = await r.json(); } catch { /* ignore */ }
  if (!r.ok || !data.ok) return null;

  const accounts = (Array.isArray(data.accounts) ? data.accounts : []).map(mapAcc).filter((a) => a.emp_code);
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

async function verifySso(ssoToken, opts = {}) {
  if (!SSO_URL) throw new Error('Chưa cấu hình SSO_VERIFY_URL');
  const r = await fetch(SSO_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: ssoToken }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const user = store.findUserByCode((data.emp_code || '').toUpperCase());
  return user ? { token: issueToken(user, { ...opts, method: 'sso' }), user } : null;
}

/* ===================== ĐĂNG NHẬP TELEGRAM (chính) ===================== */
const TG_SECRET = process.env.TELEGRAM_BOT_SECRET || '';
const TG_BOT = process.env.TELEGRAM_BOT_USERNAME || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
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
  const bot_link = TG_BOT ? `https://t.me/${TG_BOT}?start=${code}` : null;
  return { login_code: code, poll_secret, expires_in: Math.floor(TG_CODE_TTL_MS / 1000), bot_link };
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

// CHỈ bot Telegram nội bộ gọi (dùng secret_bot = TELEGRAM_BOT_SECRET).
function telegramConfirm({ login_code, telegram_id, secret_bot }) {
  pruneCodes();
  if (!TG_SECRET || secret_bot !== TG_SECRET) {
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
  entry.status = 'confirmed';
  entry.telegram_id = String(telegram_id);
  entry.user = { emp_code: user.emp_code, name: user.name, role: normRole(user.role), phone: user.phone };
  logAudit('telegram_confirm', { emp_code: user.emp_code, telegram_id: String(telegram_id) });
  return { ok: true, emp_code: user.emp_code, name: user.name };
}

/* ===================== MIDDLEWARE + SCOPE ===================== */
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const sess = getSession(token, {
    deviceId: (req.headers['x-device-id'] || '').toString().trim() || null,
    ua: (req.headers['user-agent'] || '').toString().slice(0, 200),
  });
  if (!sess) return res.status(401).json({ error: 'Chưa đăng nhập' });
  // Tự hủy phiên khi NV đổi mã NV/quyền/SĐT hoặc bị xoá khỏi danh bạ.
  const u = store.findUserByCode(sess.emp_code);
  const roleChanged = u && normRole(u.role) !== sess.role;
  const phoneChanged = u && sess.phone && u.phone && u.phone !== sess.phone;
  if (!u || roleChanged || phoneChanged) {
    purgeUser(sess.emp_code, !u ? 'removed_from_directory' : roleChanged ? 'role_changed' : 'phone_changed');
    return res.status(401).json({ error: 'Phiên đã hết hiệu lực do thay đổi tài khoản. Vui lòng đăng nhập lại.' });
  }
  req.session = sess;
  next();
}
const isAdmin = (role) => role === 'ceo' || role === 'admin';
function scopeOf(session) {
  return { empCode: isAdmin(session.role) ? null : session.emp_code };
}
function sessionForUser(user) {
  if (!user) return null;
  return { emp_code: user.emp_code, name: user.name, role: normRole(user.role), phone: user.phone || null };
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req.session.role)) return res.status(403).json({ error: 'Không đủ quyền' });
  next();
}

module.exports = {
  mockLogin, requireAuth, requireAdmin, isAdmin, scopeOf, sessionForUser, getSession,
  issueToken, liveAuthEnabled, requestOtp, verifyOtp, selectAccount, verifySso, demoAllowed,
  // Telegram
  telegramStart, telegramStatus, telegramConfirm, telegramConfigured: () => !!(TG_SECRET && TG_BOT && TG_TOKEN),
  // Mapping + thiết bị + hủy phiên
  listTelegramMap, addTelegramMap, removeTelegramMap, resolveTelegram,
  listDevices, removeDevice, purgeUser, invalidateUserSessions, invalidateUserDevices,
};
