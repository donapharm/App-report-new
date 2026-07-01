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

// Cho phép đăng nhập DEMO (bấm chọn tài khoản, không mật khẩu)?
// Mặc định BẬT. Khi có OTP/SSO thật -> đặt ALLOW_DEMO_LOGIN=0 để KHOÁ demo (bảo mật).
const demoAllowed = () => process.env.ALLOW_DEMO_LOGIN !== '0';

// Demo login: nhận mã NV mẫu, trả token. (Không mật khẩu — chỉ để xem app.)
function mockLogin(empCode) {
  if (!demoAllowed()) return null;
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
// Chuẩn hoá SĐT VN để khớp khi tra cứu (bỏ ký tự thừa, +84/84 -> 0)
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

// Chuẩn hoá vai trò backend -> ceo/admin/sale.
// LƯU Ý: OTP backend nội bộ trả 'full' cho tài khoản toàn quyền (CEO/admin).
function normRole(v) {
  const r = String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();
  if (/(ceo|giam doc|tong giam|chu tich|bod)/.test(r)) return 'ceo';
  if (/(full|admin|quan tri|manager|all)/.test(r)) return 'admin';
  return 'sale';
}
// 1 phần tử tài khoản (từ backend) -> user chuẩn của app
function mapAcc(o) {
  return { emp_code: String(o.code || o.emp_code || '').trim().toUpperCase(), name: o.name || '', role: normRole(o.role) };
}
const pub = (u) => ({ emp_code: u.emp_code, name: u.name, role: u.role });

// Lưu tạm SĐT đã xác thực OTP (để chọn tài khoản khi 1 SĐT có nhiều mã NV)
const verifiedPhones = new Map(); // normPhone -> { accounts, at }

/**
 * Xác thực OTP với backend nội bộ. Backend trả: { ok, token, code, name, role, accounts, requireAccountChoice }.
 * - Sai mã / hết hạn -> null.
 * - 1 tài khoản -> tạo SESSION của app (không dùng token backend).
 * - Nhiều tài khoản -> trả accounts để frontend chọn (rồi gọi selectAccount).
 */
async function verifyOtp(phone, code) {
  if (!OTP_URL) throw new Error('Chưa cấu hình OTP_BACKEND_URL');
  const r = await fetch(`${OTP_URL}/api/otp/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  });
  let data = {};
  try { data = await r.json(); } catch { /* ignore */ }
  if (!r.ok || !data.ok) return null; // BẮT BUỘC kiểm data.ok (mã sai vẫn HTTP 200)

  const accounts = (Array.isArray(data.accounts) ? data.accounts : []).map(mapAcc).filter((a) => a.emp_code);
  if (data.requireAccountChoice && accounts.length > 1) {
    verifiedPhones.set(normPhone(phone), { accounts, at: Date.now() });
    return { accounts };
  }
  const acc = accounts[0] || mapAcc(data); // 1 tài khoản: ưu tiên accounts[0], fallback field top-level
  if (!acc.emp_code) return null;
  // Bổ sung tên từ danh bạ nếu backend không trả tên
  if (!acc.name) acc.name = store.findUserByCode(acc.emp_code)?.name || acc.emp_code;
  return { token: issueToken(acc), user: pub(acc) };
}

// Chọn 1 tài khoản sau khi OTP đã xác thực (SĐT có nhiều mã NV)
function selectAccount(phone, empCode) {
  const v = verifiedPhones.get(normPhone(phone));
  if (!v || Date.now() - v.at > 5 * 60000) throw new Error('Phiên chọn tài khoản đã hết hạn, đăng nhập lại.');
  const acc = v.accounts.find((a) => a.emp_code === String(empCode).trim().toUpperCase());
  if (!acc) throw new Error('Tài khoản không hợp lệ.');
  verifiedPhones.delete(normPhone(phone));
  if (!acc.name) acc.name = store.findUserByCode(acc.emp_code)?.name || acc.emp_code;
  return { token: issueToken(acc), user: pub(acc) };
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
  issueToken, liveAuthEnabled, requestOtp, verifyOtp, selectAccount, verifySso, demoAllowed,
};
