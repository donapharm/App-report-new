const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

test('OTP proxy has a finite timeout and never reports upstream failure as success', async (t) => {
  let mode = 'hang';
  const upstream = http.createServer((req, res) => {
    if (mode === 'hang') return; // Cố ý không gửi response.
    res.setHeader('content-type', 'application/json');
    if (mode === 'false-success') {
      res.end(JSON.stringify({ ok: false, error: 'OTP upstream từ chối' }));
      return;
    }
    if (mode === 'http-500') {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'upstream unavailable' }));
      return;
    }
    res.end(JSON.stringify({ ok: false }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });

  const address = upstream.address();
  process.env.OTP_BACKEND_URL = `http://127.0.0.1:${address.port}`;
  process.env.OTP_BACKEND_TIMEOUT_MS = '250';
  const auth = require('../src/auth');

  const started = Date.now();
  await assert.rejects(
    auth.requestOtp('0968145073'),
    (error) => error?.status === 504
      && error?.code === 'OTP_BACKEND_TIMEOUT'
      && /phản hồi quá lâu/.test(error.message),
  );
  assert.ok(Date.now() - started < 2000, 'timeout phải kết thúc nhanh trong test');

  mode = 'hang';
  await assert.rejects(
    auth.verifyOtp('0968145073', '000000'),
    (error) => error?.status === 504 && error?.code === 'OTP_BACKEND_TIMEOUT',
  );

  mode = 'false-success';
  await assert.rejects(
    auth.requestOtp('0968145073'),
    (error) => error?.status === 502
      && error?.code === 'OTP_BACKEND_UNAVAILABLE'
      && /từ chối/.test(error.message),
  );

  mode = 'http-500';
  await assert.rejects(
    auth.requestOtp('0968145073'),
    (error) => error?.status === 502 && error?.code === 'OTP_BACKEND_UNAVAILABLE',
  );
});
