'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const client = require('../src/appSaleReconciliation');
const KEY = 'test-recon-key-never-leak-20260808';
const RANGE = { from: '2026-08-01', to: '2026-08-08' };
const originalFetch = global.fetch;
const ENV_KEYS = [
  'APP_SALE_RECON_ENABLED', 'APP_SALE_RECON_BASE_URL', 'APP_SALE_RECON_KEY',
  'APP_SALE_RECON_TIMEOUT_MS', 'APP_SALE_RECON_RETRIES',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

test.afterEach(() => {
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  client.resetForTests();
});

function configure(overrides = {}) {
  process.env.APP_SALE_RECON_ENABLED = '1';
  process.env.APP_SALE_RECON_BASE_URL = 'http://127.0.0.1:3980';
  process.env.APP_SALE_RECON_KEY = KEY;
  process.env.APP_SALE_RECON_TIMEOUT_MS = '100';
  process.env.APP_SALE_RECON_RETRIES = '0';
  Object.assign(process.env, overrides);
}

function validPayload(overrides = {}) {
  return {
    contract: client.CONTRACT,
    range: { ...RANGE, timezone: 'Asia/Ho_Chi_Minh', filterSemantics: 'APP_SALE_UI_DAY_FILTER' },
    snapshot: { id: 'recon-20260808-0001', generatedAt: '2026-08-08T16:40:00.000Z' },
    summary: { revenueVnd: '3000', rowCount: 3, orderCount: 2 },
    sources: [
      { source: 'MISA', revenueVnd: '1000', rowCount: 1, orderCount: 1 },
      { source: 'APP_WEB_PARTNER', revenueVnd: '2000', rowCount: 2, orderCount: 1 },
    ],
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('success uses fixed GET path/query, server-side bearer key and exact validated response', async () => {
  configure();
  let seen;
  global.fetch = async (url, options) => {
    seen = { url: String(url), options };
    return jsonResponse(validPayload());
  };
  const result = await client.fetchReconciliation(RANGE);
  assert.deepEqual(result, validPayload());
  const url = new URL(seen.url);
  assert.equal(url.origin, 'http://127.0.0.1:3980');
  assert.equal(url.pathname, client.CONTRACT_PATH);
  assert.deepEqual(Object.fromEntries(url.searchParams), RANGE);
  assert.equal(seen.options.method, 'GET');
  assert.equal(seen.options.redirect, 'manual');
  assert.equal(seen.options.headers.authorization, `Bearer ${KEY}`);
  assert.equal(client.diagnostics().status, 'ready');
});

test('401/403 fail closed without retrying or leaking the key/upstream body', async () => {
  for (const status of [401, 403]) {
    configure({ APP_SALE_RECON_RETRIES: '2' });
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return jsonResponse({ error: `rejected ${KEY}` }, status);
    };
    await assert.rejects(
      client.fetchReconciliation(RANGE),
      (error) => error.code === 'APP_SALE_RECON_AUTH_FAILED'
        && error.status === 502
        && !JSON.stringify(error).includes(KEY)
        && !error.message.includes(KEY),
    );
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(client.diagnostics()).includes(KEY), false);
    client.resetForTests();
  }
});

test('timeout is bounded and one configured retry is the maximum', async () => {
  configure({ APP_SALE_RECON_TIMEOUT_MS: '50', APP_SALE_RECON_RETRIES: '1' });
  let calls = 0;
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    calls += 1;
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error(`abort ${KEY}`), { name: 'AbortError' })), { once: true });
  });
  const started = Date.now();
  await assert.rejects(
    client.fetchReconciliation(RANGE),
    (error) => error.code === 'APP_SALE_RECON_TIMEOUT' && !error.message.includes(KEY),
  );
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 800, 'timeout + retry must remain bounded');
});

test('timeout also bounds a stalled response body', async () => {
  configure({ APP_SALE_RECON_TIMEOUT_MS: '50', APP_SALE_RECON_RETRIES: '0' });
  global.fetch = async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      options.signal.addEventListener('abort', () => controller.error(Object.assign(new Error('body aborted'), { name: 'AbortError' })), { once: true });
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(client.fetchReconciliation(RANGE), (error) => error.code === 'APP_SALE_RECON_TIMEOUT');
});

test('malformed JSON and semantic contract mismatch fail closed without retry', async () => {
  configure({ APP_SALE_RECON_RETRIES: '2' });
  const responses = [
    () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
    () => jsonResponse(validPayload({ contract: 'wrong-contract' })),
    () => jsonResponse(validPayload({ summary: { revenueVnd: '9999', rowCount: 3, orderCount: 2 } })),
  ];
  for (const response of responses) {
    let calls = 0;
    global.fetch = async () => { calls += 1; return response(); };
    await assert.rejects(client.fetchReconciliation(RANGE), (error) => error.code === 'APP_SALE_RECON_CONTRACT_INVALID');
    assert.equal(calls, 1);
    client.resetForTests();
  }
});

test('disabled and missing env fail closed before any request; health stays truthful', async () => {
  delete process.env.APP_SALE_RECON_ENABLED;
  delete process.env.APP_SALE_RECON_BASE_URL;
  delete process.env.APP_SALE_RECON_KEY;
  global.fetch = async () => { throw new Error('must not fetch'); };
  await assert.rejects(client.fetchReconciliation(RANGE), (error) => error.code === 'APP_SALE_RECON_DISABLED' && error.status === 503);
  assert.deepEqual(client.diagnostics(), { enabled: false, status: 'disabled', lastProbe: null });

  process.env.APP_SALE_RECON_ENABLED = '1';
  await assert.rejects(client.fetchReconciliation(RANGE), (error) => error.code === 'APP_SALE_RECON_CONFIG_MISSING' && error.status === 503);
  assert.equal(client.diagnostics().enabled, true);
  assert.equal(client.diagnostics().status, 'unavailable');
});

test('range, payload size, redirects and unsafe cleartext origins are rejected', async () => {
  configure();
  global.fetch = async () => new Response('', { status: 302, headers: { location: 'https://login.example/' } });
  await assert.rejects(client.fetchReconciliation(RANGE), (error) => error.code === 'APP_SALE_RECON_REDIRECT');
  await assert.rejects(client.fetchReconciliation({ from: '2026-08-09', to: '2026-08-08' }), /1-366 days/);

  client.resetForTests();
  configure({ APP_SALE_RECON_BASE_URL: 'http://sale.example' });
  await assert.rejects(client.fetchReconciliation(RANGE), (error) => error.code === 'APP_SALE_RECON_CONFIG_INVALID');

  client.resetForTests();
  configure();
  global.fetch = async () => new Response(JSON.stringify(validPayload()), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': String(client.MAX_RESPONSE_BYTES + 1) },
  });
  await assert.rejects(client.fetchReconciliation(RANGE), (error) => error.code === 'APP_SALE_RECON_RESPONSE_TOO_LARGE');
});

test('route is GET-only, authenticated and CEO-only; key cannot enter browser source', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  const webRoot = path.join(__dirname, '..', '..', 'web');
  const webFiles = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else webFiles.push(file);
    }
  };
  walk(webRoot);
  assert.match(routes, /router\.get\('\/admin\/app-sale-reconciliation', auth\.requireAuth, auth\.requireCeo/);
  assert.doesNotMatch(routes, /router\.(?:post|put|patch|delete)\('\/admin\/app-sale-reconciliation'/);
  assert.match(index, /optional:\s*\{ appSaleReconciliation: appSaleReconciliation\.diagnostics\(\) \}/);
  for (const file of webFiles) {
    const source = fs.readFileSync(file);
    assert.equal(source.includes(Buffer.from('APP_SALE_RECON_KEY')), false, `${file} references server key`);
    assert.equal(source.includes(Buffer.from(KEY)), false, `${file} contains test key`);
  }
});
