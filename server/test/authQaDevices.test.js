const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('phiên QA không bind hoặc chiếm suất thiết bị tin cậy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reportnew-auth-qa-'));
  const oldDir = process.env.AUTH_DATA_DIR;
  process.env.AUTH_DATA_DIR = dir;
  try {
    for (const name of ['sessions', 'devices', 'audit_auth']) fs.writeFileSync(path.join(dir, `${name}.json`), '[]');
    for (const mod of ['../src/auth', '../src/persist']) delete require.cache[require.resolve(mod)];
    const auth = require('../src/auth');
    const user = { emp_code: 'CEO', name: 'CEO QA', role: 'admin' };

    const token = auth.issueToken(user, { method: 'qa-catalog-proof', deviceId: 'headless-at-issue', ua: 'HeadlessChrome' });
    const session = auth.getSession(token, { deviceId: 'headless-on-request', ua: 'HeadlessChrome' });
    assert.equal(session.deviceId, 'headless-at-issue');
    assert.deepEqual(auth.listDevices('CEO'), []);

    auth.issueToken(user, { method: 'telegram', deviceId: 'real-browser', ua: 'Chrome' });
    assert.equal(auth.listDevices('CEO').length, 1);
    assert.equal(auth.listDevices('CEO')[0].id, 'real-browser');
  } finally {
    if (oldDir === undefined) delete process.env.AUTH_DATA_DIR;
    else process.env.AUTH_DATA_DIR = oldDir;
    fs.rmSync(dir, { recursive: true, force: true });
    for (const mod of ['../src/auth', '../src/persist']) delete require.cache[require.resolve(mod)];
  }
});
