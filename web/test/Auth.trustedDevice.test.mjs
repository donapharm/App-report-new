import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const login = fs.readFileSync(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../server/src/auth.js', import.meta.url), 'utf8');
const trustedDevice = fs.readFileSync(new URL('../../server/src/trustedDevice.js', import.meta.url), 'utf8');

test('device id is durable in localStorage and cookie and sent on every auth request', () => {
  assert.match(api, /localStorage\.getItem\(DEVICE_KEY\)/);
  assert.match(api, /document\.cookie\s*=/);
  assert.match(api, /Max-Age=31536000/);
  assert.match(api, /'X-Device-Id': getDeviceId\(\)/);
  assert.match(api, /otpRequest:[\s\S]*?'\/auth\/otp\/request'/);
  assert.match(api, /otpVerify:[\s\S]*?'\/auth\/otp\/verify'/);
  assert.match(api, /trustedDeviceLogin/);
  assert.match(api, /'\/auth\/trusted-device\/start'/);
  assert.match(api, /'\/auth\/trusted-device\/consume'/);
});

test('bootstrap tries trusted device before showing OTP and remembers phone only after OTP session', () => {
  assert.match(api, /rememberLastPhone\(phone\)/);
  assert.match(app, /if \(!getToken\(\)\)[\s\S]*?restoreTrustedDevice\(\)/);
  assert.match(app, /api\.trustedDeviceLogin\(phone\)/);
  assert.match(app, /current\?\.method === 'otp' && current\?\.phone/);
  assert.match(app, /rememberLastPhone\(current\.phone\)/);
  assert.match(app, /error\?\.status === 401 \|\| error\?\.status === 403/);
  assert.match(app, /forgetLastPhone\(\)/);
  assert.match(login, /useState\(\(\) => getLastPhone\(\)\)/);
});

test('backend delegates OTP bypass exclusively to App Sale trusted-device consume', () => {
  assert.match(routes, /router\.post\('\/auth\/trusted-device\/start'/);
  assert.match(routes, /router\.post\('\/auth\/trusted-device\/consume'/);
  assert.match(routes, /router\.post\('\/auth\/device-login'[\s\S]*?DEVICE_NOT_TRUSTED/);
  assert.match(routes, /auth\.requestOtp\([\s\S]*?loginCtx\(req\)\)/);
  assert.match(auth, /SESSION_TRUSTED_LOGIN_THRESHOLD \|\| 3/);
  assert.match(auth, /SESSION_TRUSTED_DEVICE_REVERIFY_DAYS \|\| 30/);
  assert.match(auth, /deviceIdHash, deviceFingerprint/);
  assert.match(trustedDevice, /function deviceFingerprint/);
  assert.match(auth, /rec\.method === 'otp'/);
  assert.match(auth, /method: 'device'/);
  assert.match(auth, /last_otp_at/);
});
