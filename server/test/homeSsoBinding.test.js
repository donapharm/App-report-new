const test = require('node:test');
const assert = require('node:assert/strict');
const { exchange, selectedCookieHeader } = require('../src/homeSsoExchange');

test('forwards only Home session and binding cookies', () => {
  assert.equal(selectedCookieHeader('noise=x; sso_token=abc; sso_device_binding=def; auth=secret'), 'sso_token=abc; sso_device_binding=def');
});

test('requires both cookies before any upstream request', async () => {
  let called = false;
  await assert.rejects(exchange('sso_token=abc', { fetchImpl: async () => { called = true; } }), (error) => error.code === 'SSO_BINDING_REQUIRED' && error.status === 401);
  assert.equal(called, false);
});

test('exchanges binding server-to-server and normalizes identity', async () => {
  let request;
  const identity = await exchange('sso_token=abc; sso_device_binding=def; other=no', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ ok: true, phone: '84947858486', emp_code: 'dn007', emp_name: 'Linh' }) };
    },
  });
  assert.equal(request.options.headers.Cookie, 'sso_token=abc; sso_device_binding=def');
  assert.deepEqual(identity, { phone: '0947858486', empCode: 'DN007', name: 'Linh' });
});

test('binding mismatch is explicit and fail-closed', async () => {
  await assert.rejects(exchange('sso_token=abc; sso_device_binding=wrong', {
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ ok: false, code: 'SSO_BINDING_INVALID' }) }),
  }), (error) => error.code === 'SSO_BINDING_INVALID' && error.status === 401);
});

test('browser never reads or forwards an SSO token value', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const login = fs.readFileSync(path.join(__dirname, '../../web/src/pages/Login.jsx'), 'utf8');
  assert.match(login, /params\.has\('sso_token'\)/);
  assert.doesNotMatch(login, /params\.get\('sso_token'\)/);
  assert.match(login, /await api\.sso\(\)/);
  assert.doesNotMatch(login, /api\.sso\(ssoToken\)/);
});
