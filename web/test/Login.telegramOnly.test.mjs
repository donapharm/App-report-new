import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login = fs.readFileSync(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');

test('màn đăng nhập chỉ hiện Telegram và hướng dẫn đủ ba bước', () => {
  assert.match(login, /const SHOW_ZALO_OTP_UI = false;/);
  assert.match(login, /const showOtpFlow = SHOW_ZALO_OTP_UI && mode && mode\.live;/);
  assert.match(login, /Mở Report Bot[^\n]*Gửi mã đăng nhập[^\n]*Bấm ✅ xác nhận/);
  assert.match(login, /Đăng nhập bằng Telegram/);
});

test('OTP Zalo chỉ bị ẩn ở UI, mã dự phòng vẫn còn để bật lại', () => {
  assert.match(login, /async function sendOtp\(\)/);
  assert.match(login, /api\.otpRequest\(p\)/);
  assert.match(login, /async function verifyOtp\(\)/);
  assert.match(login, /api\.otpVerify\(phone\.trim\(\), code\.trim\(\)\)/);
  assert.match(login, /ĐĂNG NHẬP SĐT \/ OTP ZALO — DỰ PHÒNG/);
});
