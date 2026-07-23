const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test('OTP proxy forwards the same stable device context on request and verify', async () => {
  const received = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ url: req.url, deviceId: req.headers['x-device-id'], body: JSON.parse(body || '{}') });
      res.writeHead(req.url.endsWith('/request') ? 200 : 401, { 'content-type': 'application/json' });
      res.end(req.url.endsWith('/request') ? JSON.stringify({ ok: true }) : JSON.stringify({ ok: false }));
    });
  });
  const port = await listen(upstream);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-report-otp-device-'));
  const old = {
    url: process.env.OTP_BACKEND_URL,
    timeout: process.env.OTP_BACKEND_TIMEOUT_MS,
    authDir: process.env.AUTH_DATA_DIR,
  };
  process.env.OTP_BACKEND_URL = `http://127.0.0.1:${port}`;
  process.env.OTP_BACKEND_TIMEOUT_MS = '1000';
  process.env.AUTH_DATA_DIR = dir;
  for (const name of ['sessions', 'devices', 'audit_auth']) fs.writeFileSync(path.join(dir, `${name}.json`), '[]');
  for (const mod of ['../src/auth', '../src/persist']) delete require.cache[require.resolve(mod)];
  try {
    const auth = require('../src/auth');
    const opts = { deviceId: 'stable-device-context', ua: 'Chrome on Windows' };
    assert.equal(await auth.requestOtp('0867409960', opts), true);
    assert.equal(await auth.verifyOtp('0867409960', '123456', opts), null);
    assert.equal(received.length, 2);
    for (const call of received) {
      assert.equal(call.deviceId, opts.deviceId);
      assert.equal(call.body.deviceId, opts.deviceId);
      assert.equal(call.body.page, 'Report');
    }
  } finally {
    await close(upstream);
    if (old.url === undefined) delete process.env.OTP_BACKEND_URL; else process.env.OTP_BACKEND_URL = old.url;
    if (old.timeout === undefined) delete process.env.OTP_BACKEND_TIMEOUT_MS; else process.env.OTP_BACKEND_TIMEOUT_MS = old.timeout;
    if (old.authDir === undefined) delete process.env.AUTH_DATA_DIR; else process.env.AUTH_DATA_DIR = old.authDir;
    fs.rmSync(dir, { recursive: true, force: true });
    for (const mod of ['../src/auth', '../src/persist']) delete require.cache[require.resolve(mod)];
  }
});
