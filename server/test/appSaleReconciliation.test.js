'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const client = require('../src/appSaleReconciliation');
const SENTINEL_KEY = 'unit-test-recon-secret-sentinel-20260809';
const originalFetch = global.fetch;
const ENV_KEYS = [
  'APP_SALE_RECON_BASE_URL', 'APP_SALE_RECON_KEY', 'APP_SALE_RECON_TIMEOUT_MS',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

test.afterEach(() => {
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function configure(overrides = {}) {
  process.env.APP_SALE_RECON_BASE_URL = 'http://127.0.0.1:3980';
  process.env.APP_SALE_RECON_KEY = SENTINEL_KEY;
  process.env.APP_SALE_RECON_TIMEOUT_MS = '100';
  Object.assign(process.env, overrides);
}

function sampleRows() {
  return [{
    ma_don_vi: 'DV001',
    ma_qlnb: 'QL001',
    ten_hang: 'Thuốc A',
    dvt: 'Hộp',
    so_luong: 2,
    don_gia: 1000,
    thanh_tien: 2000,
  }];
}

function validPayload(overrides = {}) {
  const rows = sampleRows();
  return {
    ky: '2026-08',
    ma_nha_thau: 'NCC_01',
    ten_nha_thau: 'Nhà thầu 01',
    trang_thai: 'committed',
    phien_ban: 7,
    rows_checksum: client.rowsChecksum(rows),
    rows,
    offset: 5,
    con_nua: false,
    tong_dong: 6,
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function input(overrides = {}) {
  return { ky: '2026-08', maNhaThau: 'NCC_01', phienBan: 7, offset: 5, ...overrides };
}

test('uses exact live URL, x-datahub-key header, query, one GET and validates success schema', async () => {
  configure();
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse(validPayload());
  };

  const result = await client.fetchReconciliation(input());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:3980/api/reconciliation/2026-08/NCC_01?phien_ban=7&offset=5');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers[client.AUTH_HEADER], SENTINEL_KEY);
  assert.equal(Object.hasOwn(calls[0].options.headers, 'authorization'), false);
  assert.deepEqual(result, validPayload());
});

test('latest effective version omits phien_ban, preserves contractor case and always sends bounded offset', async () => {
  configure();
  let seenUrl;
  const payload = validPayload({ ma_nha_thau: 'Ncc.01', phien_ban: 9, offset: 0, tong_dong: 1 });
  global.fetch = async (url) => { seenUrl = String(url); return jsonResponse(payload); };
  const result = await client.fetchReconciliation(input({ maNhaThau: 'Ncc.01', phienBan: undefined, offset: 0 }));
  assert.equal(seenUrl, 'http://127.0.0.1:3980/api/reconciliation/2026-08/Ncc.01?offset=0');
  assert.equal(result.phien_ban, 9);
});

test('401 fails closed without retry or upstream body/key leakage', async () => {
  configure();
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return jsonResponse({ error: `credential ${SENTINEL_KEY} rejected`, details: 'private upstream detail' }, 401);
  };
  await assert.rejects(client.fetchReconciliation(input()), (error) => {
    const serialized = JSON.stringify({ message: error.message, code: error.code, status: error.status });
    return error.code === 'APP_SALE_RECON_AUTH_FAILED' && error.status === 502
      && !serialized.includes(SENTINEL_KEY) && !serialized.includes('private upstream detail');
  });
  assert.equal(calls, 1);
});

test('404 is sanitized, preserves not-found semantics and never retries', async () => {
  configure();
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return jsonResponse({ error: `missing contractor; debug=${SENTINEL_KEY}` }, 404);
  };
  await assert.rejects(client.fetchReconciliation(input()), (error) => (
    error.code === 'APP_SALE_RECON_NOT_FOUND'
      && error.status === 404
      && !error.message.includes(SENTINEL_KEY)
      && !error.message.includes('debug')
  ));
  assert.equal(calls, 1);
});

test('timeout is bounded across headers/body and performs no retry', async () => {
  configure({ APP_SALE_RECON_TIMEOUT_MS: '250' });
  let calls = 0;
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    calls += 1;
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error(`abort ${SENTINEL_KEY}`), { name: 'AbortError' })), { once: true });
  });
  const started = Date.now();
  await assert.rejects(client.fetchReconciliation(input()), (error) => (
    error.code === 'APP_SALE_RECON_TIMEOUT' && error.status === 504 && !error.message.includes(SENTINEL_KEY)
  ));
  assert.equal(calls, 1);
  assert.ok(Date.now() - started >= 200 && Date.now() - started < 1000);

  calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    return new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener('abort', () => controller.error(Object.assign(new Error(SENTINEL_KEY), { name: 'AbortError' })), { once: true });
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(client.fetchReconciliation(input()), (error) => error.code === 'APP_SALE_RECON_TIMEOUT');
  assert.equal(calls, 1);
});

test('malformed JSON and malformed success schema fail closed without retry', async () => {
  configure();
  const cases = [
    () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
    () => jsonResponse(validPayload({ ky: '2026-07' })),
    () => jsonResponse(validPayload({ rows_checksum: SENTINEL_KEY })),
    () => jsonResponse(validPayload({ rows: [{ ...sampleRows()[0], unexpected: 1 }] })),
    () => jsonResponse(validPayload({ con_nua: undefined })),
  ];
  for (const response of cases) {
    let calls = 0;
    global.fetch = async () => { calls += 1; return response(); };
    await assert.rejects(client.fetchReconciliation(input()), (error) => (
      error.code === 'APP_SALE_RECON_CONTRACT_INVALID' && !error.message.includes(SENTINEL_KEY)
    ));
    assert.equal(calls, 1);
  }
});

test('missing URL/key disables before fetch; invalid inputs and unsafe origins fail closed', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error('must not fetch'); };
  delete process.env.APP_SALE_RECON_BASE_URL;
  delete process.env.APP_SALE_RECON_KEY;
  await assert.rejects(client.fetchReconciliation(input()), (error) => error.code === 'APP_SALE_RECON_DISABLED' && error.status === 503);

  process.env.APP_SALE_RECON_KEY = SENTINEL_KEY;
  await assert.rejects(client.fetchReconciliation(input()), (error) => error.code === 'APP_SALE_RECON_DISABLED');

  configure({ APP_SALE_RECON_BASE_URL: 'http://sale.example' });
  await assert.rejects(client.fetchReconciliation(input()), (error) => error.code === 'APP_SALE_RECON_CONFIG_INVALID');
  configure();
  for (const bad of [
    { ky: '08-2026' }, { maNhaThau: '../admin' }, { phienBan: '' }, { phienBan: 0 }, { offset: -1 }, { offset: client.MAX_OFFSET + 1 },
  ]) {
    await assert.rejects(client.fetchReconciliation(input(bad)), (error) => error.code === 'APP_SALE_RECON_INPUT_INVALID');
  }
  assert.equal(calls, 0);
});

test('500 and oversized responses are sanitized and never retried', async () => {
  configure();
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return jsonResponse({ error: `${SENTINEL_KEY} database stack` }, 500);
  };
  await assert.rejects(client.fetchReconciliation(input()), (error) => (
    error.code === 'APP_SALE_RECON_UPSTREAM' && !error.message.includes(SENTINEL_KEY)
  ));
  assert.equal(calls, 1);

  calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(client.MAX_RESPONSE_BYTES + 1) },
    });
  };
  await assert.rejects(client.fetchReconciliation(input()), (error) => error.code === 'APP_SALE_RECON_RESPONSE_TOO_LARGE');
  assert.equal(calls, 1);
});

test('route remains inside existing authenticated admin reconciliation area and browser has no secret/env access', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  assert.match(routes, /router\.get\('\/admin\/reconcile\/app-sale\/:ky\/:maNhaThau', auth\.requireAuth, auth\.requireAdmin/);
  assert.doesNotMatch(routes, /router\.(?:post|put|patch|delete)\('\/admin\/reconcile\/app-sale/);
  assert.match(routes, /Cache-Control', 'private, no-store'/);

  const webRoot = path.join(__dirname, '..', '..', 'web');
  const stack = [webRoot];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else {
        const source = fs.readFileSync(target);
        assert.equal(source.includes(Buffer.from('APP_SALE_RECON_KEY')), false, `${target} exposes key env name`);
        assert.equal(source.includes(Buffer.from(SENTINEL_KEY)), false, `${target} contains key bytes`);
      }
    }
  }
});

test('shared App Sale contract matches the exact live transport and success schema', { skip: !process.env.APP_SALE_CONTRACT_PATH }, () => {
  const contractPath = path.resolve(process.env.APP_SALE_CONTRACT_PATH);
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const serialized = JSON.stringify(contract);
  assert.match(serialized, /GET/);
  assert.match(serialized, /\/api\/reconciliation\/\{ky\}\/\{ma_nha_thau\}/);
  assert.match(serialized, /x-datahub-key/);
  assert.doesNotMatch(serialized, /x-app-sale-recon-key|Bearer <server-side APP_SALE_RECON_KEY>/);
  for (const field of ['ky', 'ma_nha_thau', 'ten_nha_thau', 'trang_thai', 'phien_ban', 'rows_checksum', 'rows']) {
    assert.match(serialized, new RegExp(`\\"${field}\\"`), `shared contract must define ${field}`);
  }
  for (const field of client.ROW_KEYS) {
    assert.match(serialized, new RegExp(`\\"${field}\\"`), `shared contract must define row.${field}`);
  }
});
