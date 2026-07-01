/**
 * auth.js — ĐĂNG NHẬP + PHÂN QUYỀN (quyết định ở BACKEND).
 *
 * Bản demo: đăng nhập bằng mã NV mẫu (mockLogin), session lưu RAM.
 * TODO(LIVE): thay mockLogin bằng:
 *   1) /api/otp/request + /api/otp/verify  (backend nội bộ 3848)
 *   2) /api/sso/verify                      (SSO nội bộ 3862)
 * rồi map ra { emp_code, role } như bên dưới.
 */
const crypto = require('crypto');
const store = require('./store');

const sessions = new Map(); // token -> { emp_code, role, name, ts }

function issueToken(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    emp_code: user.emp_code,
    role: user.role,
    name: user.name,
    ts: Date.now(),
  });
  return token;
}

// Demo login: nhận mã NV mẫu, trả token. (Không mật khẩu — chỉ để xem app.)
function mockLogin(empCode) {
  const user = store.findUserByCode(empCode);
  if (!user) return null;
  return { token: issueToken(user), user };
}

/* ===================== ĐĂNG NHẬP THẬT (OTP + SSO) =====================
 * MẶC ĐỊNH TẮT. Bật bằng env:
 *   OTP_BACKEND_URL=http://localhost:3848
 *   SSO_VERIFY_URL=http://localhost:3862/api/sso/verify
 * KHÔNG test được từ máy ngoài mạng công ty — code sẵn để bật + kiểm trên server.
 * TODO(LIVE): khớp đúng path/response thật của backend OTP/SSO nội bộ.
 */
const OTP_URL = process.env.OTP_BACKEND_URL || '';
const SSO_URL = process.env.SSO_VERIFY_URL || '';
const liveAuthEnabled = () => !!OTP_URL;

async function requestOtp(phone) {
  if (!OTP_URL) throw new Error('Chưa cấu hình OTP_BACKEND_URL');
  const r = await fetch(`${OTP_URL}/api/otp/request`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  return r.ok;
}

// Xác thực OTP -> trả danh sách tài khoản gắn với SĐT (1 SĐT có thể nhiều mã NV).
async function verifyOtp(phone, code) {
  if (!OTP_URL) throw new Error('Chưa cấu hình OTP_BACKEND_URL');
  const r = await fetch(`${OTP_URL}/api/otp/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  });
  if (!r.ok) return null;
  // Danh tính do master data quyết định (đưa về backend, không hardcode ở frontend)
  const accounts = store.listUsers().filter((u) => u.phone === phone);
  if (accounts.length === 1) return { token: issueToken(accounts[0]), user: accounts[0] };
  return { accounts: accounts.map((u) => ({ emp_code: u.emp_code, name: u.name, role: u.role })) };
}

// Xác thực SSO token từ portal chung -> tạo session.
async function verifySso(ssoToken) {
  if (!SSO_URL) throw new Error('Chưa cấu hình SSO_VERIFY_URL');
  const r = await fetch(SSO_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: ssoToken }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const user = store.findUserByCode((data.emp_code || '').toUpperCase());
  return user ? { token: issueToken(user), user } : null;
}

function getSession(token) {
  return token ? sessions.get(token) || null : null;
}

// Middleware: bắt buộc đăng nhập
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const sess = getSession(token);
  if (!sess) return res.status(401).json({ error: 'Chưa đăng nhập' });
  req.session = sess;
  next();
}

// Vai trò xem toàn công ty
const isAdmin = (role) => role === 'ceo' || role === 'admin';

/**
 * Phạm vi dữ liệu theo quyền:
 *  - admin/ceo: { empCode: null }  => xem tất cả
 *  - sale:      { empCode: <mã của họ> } => chỉ dữ liệu của họ
 * DÙNG CHO MỌI truy vấn — frontend KHÔNG tự quyết phạm vi.
 */
function scopeOf(session) {
  return { empCode: isAdmin(session.role) ? null : session.emp_code };
}

// Middleware: chỉ admin/ceo
function requireAdmin(req, res, next) {
  if (!isAdmin(req.session.role)) return res.status(403).json({ error: 'Không đủ quyền' });
  next();
}

module.exports = {
  mockLogin, requireAuth, requireAdmin, isAdmin, scopeOf, getSession,
  issueToken, liveAuthEnabled, requestOtp, verifyOtp, verifySso,
};
