const test = require('node:test');
const assert = require('node:assert/strict');
const client = require('../src/appSaleProductCrosswalk');

const ENV_KEYS = [
  'APP_SALE_PRODUCT_CROSSWALK_URL',
  'APP_SALE_PRODUCT_CROSSWALK_TOKEN',
  'APP_SALE_PRODUCT_CROSSWALK_TIMEOUT_MS',
  'APP_SALE_PRODUCT_CROSSWALK_TTL_MS',
  'APP_SALE_PRODUCT_CROSSWALK_LKG_TTL_MS',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;

function row(overrides = {}) {
  return {
    sub_code: 'G3.ĐY.QĐ141.214.N3.107',
    master_code: 'G3.ĐY.QĐ141.213.N3.107',
    sub_uom: 'Gói',
    master_uom: 'Gam',
    relation: 'phu_convert',
    convert_factor: 5,
    ...overrides,
  };
}

function masterRow(overrides = {}) {
  return {
    sub_code: 'G3.ĐY.QĐ141.213.N3.107',
    master_code: 'G3.ĐY.QĐ141.213.N3.107',
    sub_uom: 'Gam',
    master_uom: 'Gam',
    relation: 'goc',
    convert_factor: 1,
    ...overrides,
  };
}

function payload(rows = [row(), masterRow()], overrides = {}) {
  return {
    version_no: 12,
    snapshot_sha256: client.snapshotSha256ForRows(rows),
    total: rows.length,
    snapshot_at: '2026-07-25T00:00:00Z',
    rows,
    ...overrides,
  };
}

function configure() {
  process.env.APP_SALE_PRODUCT_CROSSWALK_URL = `https://sale.example${client.CONTRACT_PATH}`;
  process.env.APP_SALE_PRODUCT_CROSSWALK_TOKEN = 'dedicated-secret';
  process.env.APP_SALE_PRODUCT_CROSSWALK_TTL_MS = '60000';
}

test.afterEach(() => {
  client.resetForTests();
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] == null) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('uses dedicated bearer token, manual redirects, RAM TTL and in-flight coalescing', async () => {
  configure();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  global.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, `https://sale.example${client.CONTRACT_PATH}`);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.authorization, 'Bearer dedicated-secret');
    await gate;
    return new Response(JSON.stringify(payload()), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const first = client.getSnapshot();
  const second = client.getSnapshot();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.status, 'ready');
  assert.equal(a.rowCount, 2);
  assert.equal((await client.getSnapshot()).rowCount, 2);
  assert.equal(calls, 1);
});

test('uses only a bounded verified RAM snapshot as last-known-good during a short outage', async () => {
  configure();
  process.env.APP_SALE_PRODUCT_CROSSWALK_LKG_TTL_MS = '60000';
  global.fetch = async () => new Response(JSON.stringify(payload()), { status: 200 });
  assert.equal((await client.getSnapshot()).status, 'ready');
  global.fetch = async () => { throw new Error('temporary outage'); };
  const lkg = await client.getSnapshot({ force: true });
  assert.equal(lkg.status, 'ready');
  assert.equal(lkg.cache, 'lkg');
  assert.match(lkg.message, /snapshot.*gần nhất/i);
  assert.equal(client.publicSource(lkg).cache, 'lkg');
});

test('strictly validates snapshot identity, uniqueness and rows without treating non-positive factors as conversions', () => {
  assert.throws(() => client.validateSnapshot(payload([row({ relation: undefined })])), /thiếu trường/i);
  assert.throws(() => client.validateSnapshot(payload([row({ convert_factor: null })])), /convert_factor/i);
  assert.throws(() => client.validateSnapshot(payload([row({ convert_factor: 'NaN' })])), /convert_factor/i);
  assert.throws(() => client.validateSnapshot(payload([], { version_no: 12 })), /rỗng/i);
  assert.throws(() => client.validateSnapshot(payload([row()], { version_no: undefined })), /version_no/i);
  assert.throws(() => client.validateSnapshot(payload([row()], { snapshot_sha256: undefined })), /snapshot_sha256/i);
  assert.throws(() => client.validateSnapshot(payload([row()], { snapshot_sha256: 'not-a-sha' })), /snapshot_sha256/i);
  assert.throws(() => client.validateSnapshot(payload(undefined, { snapshot_sha256: 'a'.repeat(64) })), /canonical rows/i);
  assert.throws(() => client.validateSnapshot(payload([row()], { total: 2 })), /total/i);
  assert.throws(() => client.validateSnapshot(payload([row(), row({ master_code: 'OTHER.MASTER' })])), /sub_code trùng/i);
  assert.throws(() => client.validateSnapshot(payload([row()])), /thiếu mã gốc/i);
  assert.throws(() => client.validateSnapshot(payload([row(), masterRow({ sub_uom: 'Viên', master_uom: 'Viên' })])), /ĐVT gốc/i);
  assert.equal(client.validateSnapshot(payload([row({ convert_factor: 0 }), masterRow()])).rows[0].convert_factor, 0);
  assert.equal(client.validateSnapshot(payload([row({ convert_factor: -5 }), masterRow()])).rows[0].convert_factor, -5);
  assert.equal(client.validateSnapshot(payload()).version, '12');
  assert.equal(client.validateSnapshot(payload()).signature, client.snapshotSha256ForRows([row(), masterRow()]));
});

test('invalid, unavailable and redirecting providers fail closed as source_unavailable', async () => {
  configure();
  process.env.APP_SALE_PRODUCT_CROSSWALK_URL = `https://sale.example${client.CONTRACT_PATH}?unexpected=1`;
  global.fetch = async () => { throw new Error('must not fetch invalid URL'); };
  assert.equal((await client.getSnapshot()).status, 'source_unavailable');
  configure();
  const responses = [
    () => new Response(JSON.stringify(payload([row({ convert_factor: null })])), { status: 200 }),
    () => new Response('', { status: 302, headers: { location: 'https://login.example/' } }),
  ];
  for (const response of responses) {
    client.resetForTests();
    global.fetch = async () => response();
    const snapshot = await client.getSnapshot();
    assert.equal(snapshot.status, 'source_unavailable');
    assert.deepEqual(snapshot.rows, []);
  }
  client.resetForTests();
  global.fetch = async () => { throw new Error('provider down'); };
  const unavailable = await client.getSnapshot();
  assert.equal(unavailable.status, 'source_unavailable');
  assert.match(unavailable.message, /provider down/);
  assert.equal(JSON.stringify(unavailable).includes('dedicated-secret'), false);
  global.fetch = async () => new Response(JSON.stringify(payload()), { status: 200 });
  assert.equal((await client.getSnapshot()).status, 'ready');
});
