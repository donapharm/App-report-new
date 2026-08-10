import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login = fs.readFileSync(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../server/src/auth.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/* ── CÔNG TẮC KÊNH ĐĂNG NHẬP KHÔNG ĐƯỢC VIẾT CỨNG TRONG WEB (CEO 10/08/2026) ──
 * CEO: *"Ở đây nó bỏ qua bước nhập số điện thoại là sao — vậy nó mặc định nhảy vào
 * bot devreport làm tao phát điên."* Nguyên nhân: hằng `SHOW_ZALO_OTP_UI = false`
 * viết cứng trong bundle, giấu luôn ô nhập SĐT; bật lại phải sửa code + deploy.  */

test('‼ CẤM viết cứng công tắc ẩn đường SĐT/OTP trong web', () => {
  // Soi phần CODE, không soi phần ghi chú — lịch sử vì sao bỏ hằng này phải giữ lại.
  const code = login.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /SHOW_ZALO_OTP_UI/, 'công tắc kênh phải nằm ở backend, không nằm trong bundle');
  assert.match(login, /const otpAvailable = \(mode\) =>/);
  assert.match(login, /mode\.otp === undefined \? !!mode\.live : !!mode\.otp/, 'backend bản cũ chưa có cờ vẫn phải chạy');
});

test('backend là nơi quyết kênh SĐT/OTP bật hay tắt', () => {
  assert.match(auth, /const otpLoginEnabled = \(\) => !!OTP_URL && String\(process\.env\.LOGIN_OTP_ENABLED \?\? '1'\) !== '0'/);
  assert.match(auth, /otpLoginEnabled,/, 'phải export ra ngoài');
  assert.match(routes, /otp: auth\.otpLoginEnabled\(\)/, '/auth/mode phải nói kênh OTP đang bật hay tắt');
});

test('có hai cửa ⇒ hiện hàng chọn, và MẶC ĐỊNH là số điện thoại', () => {
  assert.match(login, /const bothChannels = showTelegram && showOtpFlow/);
  assert.match(login, /className="login-channels"/);
  assert.match(login, /📱 Số điện thoại/);
  assert.match(login, /✈️ Telegram/);
  // Ưu tiên SĐT: đây là đường DUY NHẤT chọn được tài khoản nào đăng nhập.
  assert.match(login, /setChannel\(otpAvailable\(m\) \? 'phone' : \(m\.telegram \? 'telegram' : ''\)\)/);
  for (const cls of ['login-channels', 'login-channel']) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `thiếu CSS cho .${cls}`);
  }
});

test('cửa SĐT có Ô NHẬP SĐT thật, nói rõ nhập số của tài khoản cần vào', () => {
  assert.match(login, /showOtpFlow && channel === 'phone'/);
  assert.match(login, /placeholder="Số điện thoại của tài khoản cần vào"/);
  assert.match(login, /Gửi mã OTP/);
  assert.match(login, /api\.otpRequest\(p\)/);
  assert.match(login, /api\.otpVerify\(phone\.trim\(\), code\.trim\(\)\)/);
});

test('‼ NÓI TRƯỚC ranh giới an ninh: OTP về máy của chính số đó, không sang máy khác', () => {
  // Nếu gửi được sang máy khác thì ai biết SĐT cũng vào được — cấm tuyệt đối.
  assert.match(login, /Mã OTP luôn gửi về <b>đúng máy của số này<\/b>/);
  assert.match(login, /nhờ họ đọc mã/);
});

test('cửa Telegram phải giải thích vì sao KHÔNG có ô nhập SĐT', () => {
  assert.match(login, /không có ô nhập số điện thoại<\/b>/);
  assert.match(login, /Muốn vào <b>tài khoản khác<\/b> thì chọn <b>📱 Số điện thoại<\/b>/);
});

test('chỉ còn Telegram ⇒ nói rõ vì sao mất ô SĐT, không im lặng bỏ trống', () => {
  assert.match(login, /showTelegram && !showOtpFlow/);
  assert.match(login, /LOGIN_OTP_ENABLED/);
});

test('OTP lỗi ⇒ đưa ngay đường thoát sang Telegram', () => {
  assert.match(login, /!!err && showTelegram/);
  assert.match(login, /Thử cách khác: ✈️ Telegram/);
});

test('đổi cách đăng nhập phải dọn sạch dấu vết cách cũ', () => {
  // Bỏ sót: mã Telegram vẫn đếm ngược và vẫn poll phía sau ô nhập SĐT ⇒ đăng nhập
  // nhầm tài khoản khi mã cũ được xác nhận muộn.
  assert.match(login, /const pickChannel = \(next\) => \{[\s\S]*stopTelegram\(\); setTg\(null\)/);
});

/* ── Giữ nguyên các bảo đảm cũ ───────────────────────────────────────────────── */

test('hướng dẫn Telegram vẫn đủ ba bước và nói "một trong các bot"', () => {
  assert.match(login, /Mở <b>một trong các bot<\/b>[^\n]*Gửi mã đăng nhập[^\n]*Bấm ✅ xác nhận/);
  assert.match(login, /Đăng nhập bằng Telegram/);
});

test('mỗi bot đang bật là MỘT nút — danh sách do backend cấp, không viết cứng', () => {
  assert.match(login, /tg\.bots && tg\.bots\.length \? tg\.bots :/);
  assert.match(login, /Mở \{bot\.label\} ›/);
  assert.match(login, /tg\.bot_link \? \[\{ key: 'login', label: 'Report Bot', link: tg\.bot_link \}\] : \[\]/);
});

test('có từ hai bot thì NÓI RÕ gửi bot nào cũng được — kênh dự phòng phải thấy được', () => {
  assert.match(login, /tg\.bots && tg\.bots\.length > 1/);
  assert.match(login, /bot này kẹt thì dùng bot kia/);
});

test('cảnh báo chống lừa đảo GIỮ NGUYÊN dù thêm kênh', () => {
  assert.match(login, /Không gửi mã này theo yêu cầu của người khác/);
  assert.match(login, /Chỉ bấm ✅ khi chính bạn đang đăng nhập/);
});
