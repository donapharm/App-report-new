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

module.exports = { mockLogin, requireAuth, requireAdmin, isAdmin, scopeOf, getSession };
