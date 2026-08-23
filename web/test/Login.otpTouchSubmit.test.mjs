import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login = fs.readFileSync(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');

test('OTP confirm submits on touch pointerup while preserving mouse click and keyboard Enter', () => {
  assert.match(login, /function verifyOtpOnPointerUp\(e\)/);
  assert.match(login, /if \(e\.pointerType === 'mouse'\) return;/);
  assert.match(login, /e\.preventDefault\(\);\s*verifyOtp\(\);/);
  assert.match(login, /onPointerUp=\{verifyOtpOnPointerUp\} onClick=\{verifyOtp\}/);
  assert.match(login, /onKeyDown=\{\(e\) => e\.key === 'Enter' && !busy && verifyOtp\(\)\}/);
});

test('OTP confirm has an in-flight ref lock so pointerup and synthetic click cannot double submit', () => {
  assert.match(login, /const otpVerifyInFlightRef = useRef\(false\);/);
  assert.match(login, /if \(otpVerifyInFlightRef\.current\) return;/);
  assert.match(login, /otpVerifyInFlightRef\.current = true;/);
  assert.match(login, /finally \{ otpVerifyInFlightRef\.current = false; setBusy\(false\); \}/);
});
