import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login = fs.readFileSync(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');

test('màn đăng nhập chỉ hiện Telegram và hướng dẫn đủ ba bước', () => {
  assert.match(login, /const SHOW_ZALO_OTP_UI = false;/);
  assert.match(login, /const showOtpFlow = SHOW_ZALO_OTP_UI && mode && mode\.live;/);
  // CEO xin thêm kênh 09/08: hướng dẫn nói "một trong các bot" thay vì đích danh
  // một bot, vì nay có thể có hai đường (bot đăng nhập + bot Report).
  assert.match(login, /Mở <b>một trong các bot<\/b>[^\n]*Gửi mã đăng nhập[^\n]*Bấm ✅ xác nhận/);
  assert.match(login, /Đăng nhập bằng Telegram/);
});

test('OTP Zalo chỉ bị ẩn ở UI, mã dự phòng vẫn còn để bật lại', () => {
  assert.match(login, /async function sendOtp\(\)/);
  assert.match(login, /api\.otpRequest\(p\)/);
  assert.match(login, /async function verifyOtp\(\)/);
  assert.match(login, /api\.otpVerify\(phone\.trim\(\), code\.trim\(\)\)/);
  assert.match(login, /ĐĂNG NHẬP SĐT \/ OTP ZALO — DỰ PHÒNG/);
});

/* ── Thêm kênh xác nhận đăng nhập (CEO 09/08/2026) ───────────────────────────── */

test('mỗi bot đang bật là MỘT nút — danh sách do backend cấp, không viết cứng', () => {
  assert.match(login, /tg\.bots && tg\.bots\.length \? tg\.bots :/);
  assert.match(login, /Mở \{bot\.label\} ›/);
  // Bản web cũ chỉ có bot_link ⇒ vẫn còn đường lui, không ai bị kẹt màn login.
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
