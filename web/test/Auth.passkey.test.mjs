import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const login = fs.readFileSync(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('Passkey uses WebAuthn browser ceremonies and backend verification', () => {
  assert.match(api, /startAuthentication/);
  assert.match(api, /startRegistration/);
  assert.match(api, /\/auth\/passkey\/login\/options/);
  assert.match(api, /\/auth\/passkey\/login\/verify/);
  assert.match(api, /\/auth\/passkey\/register\/options/);
  assert.match(api, /\/auth\/passkey\/register\/verify/);
});

test('Passkey login is shown only when backend reports an enrolled credential and OTP remains', () => {
  assert.match(login, /mode\.passkey/);
  assert.match(login, /Đăng nhập bằng Face ID \/ Passkey/);
  assert.match(login, /await api\.otpRequest\(p\)/);
  assert.match(login, /OTP và Telegram vẫn là cách dự phòng/);
});

test('Only backend-confirmed CEO sees enrollment controls on desktop and mobile', () => {
  assert.equal((app.match(/me\.is_ceo && <button[^>]+onClick=\{enrollPasskey\}/g) || []).length, 2);
  assert.doesNotMatch(app, /me\.role\s*===\s*['"]ceo['"]/);
});
