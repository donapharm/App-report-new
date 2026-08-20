const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function loadIsolated() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-report-passkey-'));
  process.env.AUTH_DATA_DIR = dir;
  for (const name of ['../src/passkeyAuth', '../src/persist']) delete require.cache[require.resolve(name)];
  return { dir, passkey: require('../src/passkeyAuth') };
}

test('Passkey starts unavailable and registration options require user verification without biometric payload', async () => {
  const { dir, passkey } = loadIsolated();
  try {
    assert.deepEqual(passkey.status(), { available: false, credentials: 0 });
    const options = await passkey.registrationOptions({ emp_code: 'CEO', name: 'CEO' }, { deviceId: 'device-one' });
    assert.equal(options.rp.id, 'report.donapharm.asia');
    assert.equal(options.user.name, 'CEO');
    assert.equal(options.authenticatorSelection.userVerification, 'required');
    assert.equal(options.attestation, 'none');
    assert.doesNotMatch(JSON.stringify(options), /face|photo|image|biometric/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Passkey login fails closed when CEO has not enrolled', async () => {
  const { dir, passkey } = loadIsolated();
  try {
    await assert.rejects(() => passkey.authenticationOptions(), (error) => error.code === 'PASSKEY_NOT_ENROLLED' && error.status === 404);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Passkey challenges are single-use and expire fail-closed', async () => {
  const { dir, passkey } = loadIsolated();
  try {
    await passkey.registrationOptions({ emp_code: 'CEO', name: 'CEO' }, { deviceId: 'device-two' });
    await assert.rejects(
      () => passkey.verifyRegistration({ emp_code: 'CEO' }, {}, { deviceId: 'different-device' }),
      (error) => error.code === 'PASSKEY_CHALLENGE_EXPIRED',
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Passkey implementation bounds unauthenticated pending challenges', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/passkeyAuth.js'), 'utf8');
  assert.match(source, /MAX_PENDING_CHALLENGES\s*=\s*256/);
  assert.match(source, /while \(store\.size > MAX_PENDING_CHALLENGES\)/);
});

test('Passkey request context rejects a foreign Host and a foreign Origin', () => {
  const { dir, passkey } = loadIsolated();
  try {
    const allowed = (host, origin) => passkey.requestContextAllowed({
      headers: { host, origin },
      get(name) { return this.headers[String(name).toLowerCase()]; },
    });
    assert.equal(allowed('report.donapharm.asia', 'https://report.donapharm.asia'), true);
    assert.equal(allowed('evil.example', 'https://report.donapharm.asia'), false);
    assert.equal(allowed('report.donapharm.asia', 'https://evil.example'), false);
    assert.equal(allowed('report.donapharm.asia', ''), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Passkey middleware returns 403 before handling a foreign request context', () => {
  const { dir, passkey } = loadIsolated();
  try {
    let nextCalled = false;
    let responseStatus = 0;
    let responseBody;
    const req = {
      headers: { host: 'foreign.example', origin: 'https://foreign.example' },
      get(name) { return this.headers[String(name).toLowerCase()]; },
    };
    const res = {
      status(value) { responseStatus = value; return this; },
      json(value) { responseBody = value; return this; },
    };
    passkey.requireTrustedRequestContext(req, res, () => { nextCalled = true; });
    assert.equal(responseStatus, 403);
    assert.equal(responseBody.code, 'PASSKEY_REQUEST_ORIGIN_REJECTED');
    assert.equal(nextCalled, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Passkey startup log exposes only the configured RP domain', () => {
  const { dir, passkey } = loadIsolated();
  try {
    assert.equal(passkey.startupLogLine(), '[passkey] RP domain: report.donapharm.asia');
    assert.doesNotMatch(passkey.startupLogLine(), /token|secret|password|cookie|otp/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
