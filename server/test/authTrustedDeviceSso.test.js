const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODULES = ['../src/auth', '../src/trustedDeviceSso', '../src/persist'];
const ASSERTION = `v1.${'a'.repeat(110)}.${'b'.repeat(64)}`;

function clearModules() {
  for (const name of MODULES) delete require.cache[require.resolve(name)];
}

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function memoryPersist() {
  const files = new Map();
  return {
    load: (name, fallback) => structuredClone(files.has(name) ? files.get(name) : fallback),
    save: (name, data) => files.set(name, structuredClone(data)),
    read: (name) => structuredClone(files.get(name)),
  };
}

const users = [{ emp_code: 'DN016', phone: '0867409960', name: 'Ánh', role: 'sale' }];
const userStore = {
  listUsers: () => users.map((user) => ({ ...user })),
  findUserByCode: (code) => users.find((user) => user.emp_code === code) || null,
};

function bridgeWith({ fetchImpl, now, env, store = userStore } = {}) {
  const { createTrustedDeviceSsoBridge } = require('../src/trustedDeviceSso');
  return createTrustedDeviceSsoBridge({
    fetchImpl,
    now,
    env: env || { TRUSTED_DEVICE_REPORT_S2S_TOKEN: 't'.repeat(48), TRUSTED_DEVICE_REPORT_TIMEOUT_MS: '1000' },
    userStore: store,
    persistStore: memoryPersist(),
  });
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

test('trusted success consumes server-to-server and creates a normal scoped session without OTP', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-report-trusted-sso-'));
  const old = {
    authDir: process.env.AUTH_DATA_DIR,
    token: process.env.TRUSTED_DEVICE_REPORT_S2S_TOKEN,
    fetch: global.fetch,
  };
  process.env.AUTH_DATA_DIR = dir;
  process.env.TRUSTED_DEVICE_REPORT_S2S_TOKEN = 'report-only-token-'.padEnd(48, 'x');
  for (const name of ['sessions', 'devices', 'audit_auth', 'trusted_device_sso_pending']) {
    fs.writeFileSync(path.join(dir, `${name}.json`), '[]');
  }
  let consumeRequest;
  global.fetch = async (url, options) => {
    consumeRequest = { url, options, body: JSON.parse(options.body) };
    return jsonResponse(200, {
      valid: true,
      employeeCode: 'DN016',
      subjectType: 'employee',
      audience: 'app-report',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
  };
  clearModules();
  try {
    // Exercise the real S2S contract with an isolated account store.
    const bridge = bridgeWith({ fetchImpl: global.fetch });
    const pending = bridge.start('0867409960');
    assert.equal(Object.hasOwn(pending, 'expectedEmployeeCode'), false);
    const bridgedUser = await bridge.consume(pending.attemptId, ASSERTION);
    assert.equal(bridgedUser.emp_code, 'DN016');
    assert.equal(consumeRequest.url, 'https://sale.donapharm.asia/api/internal/trusted-device/consume');
    assert.equal(consumeRequest.body.expectedEmployeeCode, 'DN016');
    assert.equal(consumeRequest.body.nonce, pending.nonce);
    assert.equal(consumeRequest.body.reportDeviceId, pending.reportDeviceId);
    assert.match(consumeRequest.options.headers.authorization, /^Bearer /);

    // Exercise auth's session issuance independently of repository seed data.
    const trustedModule = require('../src/trustedDeviceSso');
    trustedModule.consume = async () => ({ ...users[0] });
    delete require.cache[require.resolve('../src/auth')];
    const auth = require('../src/auth');
    const result = await auth.consumeTrustedDeviceSso('attempt', ASSERTION, {
      deviceId: 'report-browser-device', ua: 'Chrome on Windows',
    });
    const session = auth.getSession(result.token, { deviceId: 'report-browser-device', ua: 'Chrome on Windows' });
    assert.equal(result.user.emp_code, 'DN016');
    assert.equal(session.emp_code, 'DN016');
    assert.equal(session.method, 'trusted-device-sso');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8'), /report-only-token|v1\./);
  } finally {
    global.fetch = old.fetch;
    if (old.authDir === undefined) delete process.env.AUTH_DATA_DIR; else process.env.AUTH_DATA_DIR = old.authDir;
    if (old.token === undefined) delete process.env.TRUSTED_DEVICE_REPORT_S2S_TOKEN; else process.env.TRUSTED_DEVICE_REPORT_S2S_TOKEN = old.token;
    fs.rmSync(dir, { recursive: true, force: true });
    clearModules();
  }
});

test('consume timeout, 500 and malformed/invalid responses all fail closed', async (t) => {
  await t.test('network timeout/error', async () => {
    const bridge = bridgeWith({ fetchImpl: async () => { throw new Error('timeout'); } });
    const pending = bridge.start('0867409960');
    await rejectsCode(bridge.consume(pending.attemptId, ASSERTION), 'TRUSTED_DEVICE_CONSUME_UNAVAILABLE');
  });
  await t.test('upstream 500', async () => {
    const bridge = bridgeWith({ fetchImpl: async () => jsonResponse(500, { error: 'internal' }) });
    const pending = bridge.start('0867409960');
    await rejectsCode(bridge.consume(pending.attemptId, ASSERTION), 'TRUSTED_DEVICE_CONSUME_REJECTED');
  });
  await t.test('malformed JSON', async () => {
    const bridge = bridgeWith({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) });
    const pending = bridge.start('0867409960');
    await rejectsCode(bridge.consume(pending.attemptId, ASSERTION), 'TRUSTED_DEVICE_CONSUME_REJECTED');
  });
  await t.test('valid is not exactly true', async () => {
    const bridge = bridgeWith({ fetchImpl: async () => jsonResponse(200, { valid: 'true', employeeCode: 'DN016' }) });
    const pending = bridge.start('0867409960');
    await rejectsCode(bridge.consume(pending.attemptId, ASSERTION), 'TRUSTED_DEVICE_CONSUME_REJECTED');
  });
});

test('pending nonce expires at 120 seconds and cannot be reused', async () => {
  let clock = 1_000_000;
  const valid = () => jsonResponse(200, {
    valid: true, employeeCode: 'DN016', audience: 'app-report', expiresAt: new Date(clock + 30_000).toISOString(),
  });
  const bridge = bridgeWith({ fetchImpl: async () => valid(), now: () => clock });
  const expired = bridge.start('0867409960');
  assert.match(expired.nonce, /^[A-Za-z0-9_-]{22,128}$/);
  assert.ok(expired.reportDeviceId.length >= 16 && expired.reportDeviceId.length <= 200);
  clock += 120_001;
  await rejectsCode(bridge.consume(expired.attemptId, ASSERTION), 'TRUSTED_DEVICE_PENDING_EXPIRED');

  const fresh = bridge.start('0867409960');
  await bridge.consume(fresh.attemptId, ASSERTION);
  await rejectsCode(bridge.consume(fresh.attemptId, ASSERTION), 'TRUSTED_DEVICE_PENDING_REUSED');
});

test('concurrent assertion replay can issue at most one local claim', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const bridge = bridgeWith({ fetchImpl: async () => {
    await gate;
    return jsonResponse(200, {
      valid: true, employeeCode: 'DN016', audience: 'app-report', expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
  } });
  const pending = bridge.start('0867409960');
  const first = bridge.consume(pending.attemptId, ASSERTION);
  const replay = bridge.consume(pending.attemptId, ASSERTION);
  release();
  const settled = await Promise.allSettled([first, replay]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) => item.status === 'rejected' && item.reason?.code === 'TRUSTED_DEVICE_PENDING_REUSED').length, 1);
});

test('account binding mismatch and missing configuration never authenticate', async () => {
  const mismatch = bridgeWith({ fetchImpl: async () => jsonResponse(200, {
    valid: true, employeeCode: 'DN001', audience: 'app-report', expiresAt: new Date(Date.now() + 30_000).toISOString(),
  }) });
  const pending = mismatch.start('0867409960');
  await rejectsCode(mismatch.consume(pending.attemptId, ASSERTION), 'TRUSTED_DEVICE_CONSUME_REJECTED');

  const missing = bridgeWith({ env: {}, fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(missing.isConfigured(), false);
  assert.throws(() => missing.start('0867409960'), (error) => error?.code === 'TRUSTED_DEVICE_NOT_CONFIGURED');
});

test('start does not enumerate Report accounts or expose employee codes', async () => {
  const upstreamBodies = [];
  const fetchImpl = async (_url, options) => {
    upstreamBodies.push(JSON.parse(options.body));
    return jsonResponse(403, { error: 'invalid_assertion' });
  };
  const bridge = bridgeWith({ fetchImpl });
  const known = bridge.start('0867409960', { ip: '10.0.0.1' });
  const unknown = bridge.start('0900000000', { ip: '10.0.0.1' });
  const duplicateStore = {
    listUsers: () => [
      ...users,
      { emp_code: 'DN017', phone: '0867409960', name: 'Oanh', role: 'sale' },
    ],
    findUserByCode: userStore.findUserByCode,
  };
  const duplicateBridge = bridgeWith({ fetchImpl, store: duplicateStore });
  const duplicate = duplicateBridge.start('0867409960', { ip: '10.0.0.2' });
  for (const pending of [known, unknown, duplicate]) {
    assert.deepEqual(Object.keys(pending).sort(), ['attemptId', 'expiresAt', 'nonce', 'reportDeviceId']);
    assert.equal(Object.hasOwn(pending, 'expectedEmployeeCode'), false);
  }
  await rejectsCode(bridge.consume(unknown.attemptId, ASSERTION, { ip: '10.0.0.1' }), 'TRUSTED_DEVICE_CONSUME_REJECTED');
  await rejectsCode(duplicateBridge.consume(duplicate.attemptId, ASSERTION, { ip: '10.0.0.2' }), 'TRUSTED_DEVICE_CONSUME_REJECTED');
  assert.equal(upstreamBodies.length, 2, 'unknown and ambiguous accounts must use the same S2S rejection path');
  for (const body of upstreamBodies) {
    assert.match(body.expectedEmployeeCode, /^NO_REPORT_[A-F0-9]{16}$/);
    assert.notEqual(body.expectedEmployeeCode, 'DN016');
  }
});

test('start and consume enforce bounded per-IP rate limits', async () => {
  const env = {
    TRUSTED_DEVICE_REPORT_S2S_TOKEN: 't'.repeat(48),
    TRUSTED_DEVICE_REPORT_START_RATE_LIMIT_PER_MINUTE: '2',
    TRUSTED_DEVICE_REPORT_CONSUME_RATE_LIMIT_PER_MINUTE: '2',
  };
  const bridge = bridgeWith({ env, fetchImpl: async () => jsonResponse(500, {}) });
  bridge.start('0867409960', { ip: '10.0.0.2' });
  bridge.start('0900000000', { ip: '10.0.0.2' });
  assert.throws(
    () => bridge.start('0910000000', { ip: '10.0.0.2' }),
    (error) => error?.status === 429 && error?.code === 'TRUSTED_DEVICE_RATE_LIMITED',
  );

  const pending = bridge.start('0867409960', { ip: '10.0.0.3' });
  await rejectsCode(bridge.consume(pending.attemptId, 'bad', { ip: '10.0.0.3' }), 'TRUSTED_DEVICE_ASSERTION_INVALID');
  await rejectsCode(bridge.consume(pending.attemptId, 'bad', { ip: '10.0.0.3' }), 'TRUSTED_DEVICE_ASSERTION_INVALID');
  await rejectsCode(bridge.consume(pending.attemptId, 'bad', { ip: '10.0.0.3' }), 'TRUSTED_DEVICE_RATE_LIMITED');
});

test('browser contract uses host-only App Sale cookie implicitly and never exposes server token', () => {
  const apiSource = fs.readFileSync(path.join(__dirname, '../../web/src/api.js'), 'utf8');
  const loginSource = fs.readFileSync(path.join(__dirname, '../../web/src/pages/Login.jsx'), 'utf8');
  assert.match(apiSource, /https:\/\/sale\.donapharm\.asia\/api\/internal\/trusted-device\/verify/);
  assert.match(apiSource, /credentials:\s*'include'/);
  assert.doesNotMatch(apiSource, /expectedEmployeeCode:\s*pending\.expectedEmployeeCode/);
  assert.match(apiSource, /reportDeviceId:\s*pending\.reportDeviceId/);
  assert.match(apiSource, /nonce:\s*pending\.nonce/);
  assert.doesNotMatch(apiSource, /appsale_device_id|TRUSTED_DEVICE_REPORT_S2S_TOKEN|Domain=/);
  assert.match(loginSource, /catch \{ \/\* fail closed: keep the normal OTP flow \*\//);
  const routesSource = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
  assert.match(routesSource, /TRUSTED_DEVICE_RATE_LIMITED/);
  assert.match(routesSource, /TRUSTED_DEVICE_REJECTED/);
  assert.doesNotMatch(routesSource.match(/router\.post\('\/auth\/trusted-device\/start'[\s\S]*?router\.post\('\/auth\/sso'/)?.[0] || '', /error:\s*e\.message/);
  assert.match(loginSource, /await api\.otpRequest\(p\)/);
});
