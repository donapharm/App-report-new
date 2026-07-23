const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const AUTH_MODULES = ['../src/auth', '../src/persist'];
function clearAuthModules() {
  for (const mod of AUTH_MODULES) delete require.cache[require.resolve(mod)];
}

function withAuthDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-report-trusted-device-'));
  const oldDir = process.env.AUTH_DATA_DIR;
  process.env.AUTH_DATA_DIR = dir;
  for (const name of ['sessions', 'devices', 'audit_auth']) {
    fs.writeFileSync(path.join(dir, `${name}.json`), '[]');
  }
  clearAuthModules();
  try { return run(dir, require('../src/auth')); }
  finally {
    if (oldDir === undefined) delete process.env.AUTH_DATA_DIR;
    else process.env.AUTH_DATA_DIR = oldDir;
    fs.rmSync(dir, { recursive: true, force: true });
    clearAuthModules();
  }
}

const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const CHROME_WINDOWS_NEW_VERSION = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1';

test('trusted device requires 3 OTP logins and preserves the 30-day OTP anchor', () => withAuthDir((dir, auth) => {
  const user = require('../src/store').findUserByCode('DN016');
  const ctx = { method: 'otp', phone: user.phone, deviceId: 'device-dn016', ua: CHROME_WINDOWS };

  auth.issueToken(user, ctx);
  auth.issueToken(user, ctx);
  assert.equal(auth.loginByTrustedDevice(user.phone, ctx), null, '2 OTP chưa được tin cậy');

  auth.issueToken(user, ctx);
  const before = auth.listDevices(user.emp_code)[0];
  assert.equal(before.trusted_login_count, 3);
  assert.equal(before.is_trusted, true);
  assert.ok(before.last_otp_at);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'devices.json'), 'utf8'), /device-dn016/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8'), /device-dn016/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'audit_auth.json'), 'utf8'), /device-dn016/);

  const login = auth.loginByTrustedDevice(user.phone, { deviceId: ctx.deviceId, ua: CHROME_WINDOWS_NEW_VERSION });
  assert.ok(login?.token, 'đổi version Chrome vẫn cùng fingerprint OS + browser family');
  assert.equal(login.user.emp_code, user.emp_code);
  const after = auth.listDevices(user.emp_code)[0];
  assert.equal(after.trusted_login_count, 3, 'device-login không cộng lần OTP');
  assert.equal(after.last_otp_at, before.last_otp_at, 'device-login không gia hạn mốc OTP 30 ngày');

  assert.equal(
    auth.loginByTrustedDevice(user.phone, { deviceId: ctx.deviceId, ua: SAFARI_IOS }),
    null,
    'fingerprint OS + browser khác phải fail closed',
  );

  const devicesPath = path.join(dir, 'devices.json');
  const persisted = JSON.parse(fs.readFileSync(devicesPath, 'utf8'));
  persisted[0].last_otp_at = Date.now() - 31 * 24 * 60 * 60 * 1000;
  fs.writeFileSync(devicesPath, JSON.stringify(persisted));
  clearAuthModules();
  const reloaded = require('../src/auth');
  assert.equal(
    reloaded.loginByTrustedDevice(user.phone, { deviceId: ctx.deviceId, ua: CHROME_WINDOWS }),
    null,
    'quá 30 ngày phải yêu cầu OTP lại',
  );
}));

test('Telegram and SSO sessions never increase OTP trust count', () => withAuthDir((_dir, auth) => {
  const user = require('../src/store').findUserByCode('DN016');
  for (const method of ['telegram', 'sso', 'device']) {
    auth.issueToken(user, { method, phone: user.phone, deviceId: 'device-other-auth', ua: CHROME_WINDOWS });
  }
  const device = auth.listDevices(user.emp_code)[0];
  assert.equal(device.trusted_login_count, 0);
  assert.equal(device.is_trusted, false);
  assert.equal(auth.loginByTrustedDevice(user.phone, { deviceId: 'device-other-auth', ua: CHROME_WINDOWS }), null);
}));

test('revoking a device removes its trusted login and active sessions', () => withAuthDir((_dir, auth) => {
  const user = require('../src/store').findUserByCode('DN016');
  const ctx = { method: 'otp', phone: user.phone, deviceId: 'device-to-revoke', ua: CHROME_WINDOWS };
  auth.issueToken(user, ctx);
  auth.issueToken(user, ctx);
  auth.issueToken(user, ctx);
  const login = auth.loginByTrustedDevice(user.phone, ctx);
  assert.ok(login?.token);
  assert.ok(auth.getSession(login.token, ctx));

  assert.equal(auth.removeDevice(auth.listDevices(user.emp_code)[0].id), true);
  assert.equal(auth.loginByTrustedDevice(user.phone, ctx), null);
  assert.equal(auth.getSession(login.token, ctx), null);
  assert.equal(auth.listDevices(user.emp_code).length, 0);
}));

test('legacy raw device records migrate to hashes without dropping rolling sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-report-device-migration-'));
  const oldDir = process.env.AUTH_DATA_DIR;
  const token = 'legacy-session-token';
  const rawDevice = 'legacy-raw-device';
  process.env.AUTH_DATA_DIR = dir;
  fs.writeFileSync(path.join(dir, 'devices.json'), JSON.stringify([{
    id: rawDevice, emp_code: 'DN016', first_seen: Date.now() - 1000, last_seen: Date.now() - 1000, ua: CHROME_WINDOWS,
  }]));
  fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify([{
    th: crypto.createHash('sha256').update(token).digest('hex'), emp_code: 'DN016', role: 'sale', name: 'Chị Ánh',
    phone: '0867409960', deviceId: rawDevice, method: 'telegram', issued_at: Date.now() - 1000, expires_at: Date.now() + 60_000,
  }]));
  fs.writeFileSync(path.join(dir, 'audit_auth.json'), JSON.stringify([{ ts: Date.now(), event: 'login', device: rawDevice }]));
  clearAuthModules();
  try {
    const auth = require('../src/auth');
    assert.ok(auth.getSession(token, { deviceId: rawDevice, ua: CHROME_WINDOWS }), 'phiên rolling cũ vẫn hợp lệ');
    for (const file of ['devices.json', 'sessions.json', 'audit_auth.json']) {
      assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /legacy-raw-device/);
    }
  } finally {
    if (oldDir === undefined) delete process.env.AUTH_DATA_DIR;
    else process.env.AUTH_DATA_DIR = oldDir;
    fs.rmSync(dir, { recursive: true, force: true });
    clearAuthModules();
  }
});
