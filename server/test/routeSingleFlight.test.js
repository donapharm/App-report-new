'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const router = require('../src/routes');
const A = require('../src/analytics');
const store = require('../src/store');

function routeHandler(routePath) {
  const layer = router.stack.find((candidate) => candidate.route?.path === routePath && candidate.route?.methods?.get);
  assert.ok(layer, `missing GET ${routePath}`);
  return layer.route.stack.at(-1).handle;
}

function invoke(handler, { query = {}, session = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      query: { ...query },
      session: { ...session },
      headers: {},
      body: {},
      params: {},
      ip: '127.0.0.1',
      aborted: false,
      once() {},
      removeListener() {},
    };
    const res = {
      statusCode: 200,
      headersSent: false,
      headers: {},
      set(key, value) { this.headers[key.toLowerCase()] = value; return this; },
      setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.headersSent = true; resolve({ status: this.statusCode, body, headers: this.headers }); return this; },
      send(body) { this.headersSent = true; resolve({ status: this.statusCode, body, headers: this.headers }); return this; },
      end() { this.headersSent = true; resolve({ status: this.statusCode, body: null, headers: this.headers }); return this; },
    };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
}

const admin = { emp_code: 'CEO', role: 'admin', name: 'CEO QA' };
const admin2 = { emp_code: 'ADMIN02', role: 'admin', name: 'Admin QA' };
const sale = { emp_code: 'DN001', role: 'sale', name: 'Sale QA' };

test('overview/trend route keys stay protected by actor, scope and query', () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(source, /routeName === 'alerts' \|\| routeName === 'analysis' \|\| routeName === 'overview'/);
  assert.match(source, /if \(routeName === 'trend'\) return store\.targetDataSignature\(\);/);
  assert.match(source, /String\(req\.session\.emp_code \|\| ''\)/);
  assert.match(source, /scope\.empCode \|\| 'ADMIN'/);
  assert.match(source, /JSON\.stringify\(stableCacheValue\(req\.query \|\| \{\}\)\)/);
  assert.match(source, /protectedRouteBuild\(req, 'overview'/);
  assert.match(source, /const cacheKey = readCacheKey\(req, 'trend'\);/);
  assert.match(source, /protectedRouteBuild\(req, 'trend'/);
});

test('overview route single-flights identical burst, separates actor/query/scope, and evicts failed build', async () => {
  const handler = routeHandler('/overview');
  const originalOverviewKpis = A.overviewKpis;
  let builds = 0;
  let fail = false;
  A.overviewKpis = ({ scope, filters }) => {
    builds += 1;
    if (fail) throw Object.assign(new Error('overview exploded'), { code: 'OVERVIEW_EXPLODED' });
    return {
      revenue: builds,
      kys: ['07.2026'],
      build: builds,
      scope: scope.empCode || 'ADMIN',
      province: filters.province || null,
    };
  };
  try {
    const sameQuery = { ky: '07.2026', province: 'HCM', nonce: 'overview-burst-a' };
    const differentQuery = { ky: '07.2026', province: 'HN', nonce: 'overview-burst-b' };
    const burst = await Promise.all([
      ...Array.from({ length: 10 }, () => invoke(handler, { query: sameQuery, session: admin })),
      invoke(handler, { query: sameQuery, session: admin2 }),
      invoke(handler, { query: sameQuery, session: sale }),
      invoke(handler, { query: differentQuery, session: admin }),
    ]);

    assert.equal(builds, 4, 'same actor/scope/query should share one build; actor, scope, query must split');
    const identical = burst.slice(0, 10);
    assert.deepEqual(new Set(identical.map((item) => item.body.build)).size, 1);
    identical.forEach((item) => assert.equal(item.status, 200));
    assert.equal(burst[10].body.scope, 'ADMIN', 'different admin actor gets its own protected build');
    assert.equal(burst[11].body.scope, 'DN001', 'employee scope must not share admin payload');
    assert.equal(burst[12].body.province, 'HN', 'different query must build independently');

    fail = true;
    const failed = await Promise.all(Array.from({ length: 10 }, () => invoke(handler, {
      query: { ky: '07.2026', province: 'FAIL', nonce: 'overview-fail' },
      session: admin,
    })));
    assert.equal(builds, 5, 'failed burst still runs only once');
    failed.forEach((item) => {
      assert.equal(item.status, 500);
      assert.equal(item.body.code, 'OVERVIEW_EXPLODED');
    });

    fail = false;
    const retry = await invoke(handler, {
      query: { ky: '07.2026', province: 'FAIL', nonce: 'overview-fail' },
      session: admin,
    });
    assert.equal(retry.status, 200);
    assert.equal(builds, 6, 'failed build must evict so the next request can rebuild');
  } finally {
    A.overviewKpis = originalOverviewKpis;
  }
});

test('trend route single-flights identical burst, protects actor/query cache boundaries, and evicts failed memo build', async () => {
  const handler = routeHandler('/trend');
  const originalTargetSignature = store.targetDataSignature;
  const originalListPeriods = store.listPeriods;
  const originalGetRows = store.getRows;
  const originalGetTargets = store.getTargets;
  const originalApplyFilters = A.applyFilters;
  const originalSum = A.sum;
  const originalSelectedEmployeeCodes = A.selectedEmployeeCodes;
  const originalTargetFiltersComparable = A.targetFiltersComparable;

  let signature = 'trend-sig-a';
  let builds = 0;
  let fail = false;

  store.targetDataSignature = () => signature;
  store.listPeriods = () => {
    builds += 1;
    if (fail) throw Object.assign(new Error('trend exploded'), { code: 'TREND_EXPLODED' });
    return [{ ky: '07.2026' }];
  };
  store.getRows = () => [{ revenue: 120 }];
  store.getTargets = () => [{ emp_code: 'DN001', target: 100 }];
  A.applyFilters = (rows) => rows;
  A.sum = (rows, picker) => rows.reduce((sum, row) => sum + Number(picker(row) || 0), 0);
  A.selectedEmployeeCodes = (filters = {}) => (filters.emp ? [String(filters.emp).trim().toUpperCase()] : []);
  A.targetFiltersComparable = () => true;

  try {
    const sameQuery = { ky: '07.2026', emp: 'DN001', nonce: 'trend-burst-a' };
    const differentQuery = { ky: '07.2026', emp: 'DN002', nonce: 'trend-burst-b' };
    const burst = await Promise.all([
      ...Array.from({ length: 10 }, () => invoke(handler, { query: sameQuery, session: admin })),
      invoke(handler, { query: sameQuery, session: admin2 }),
      invoke(handler, { query: differentQuery, session: admin }),
    ]);

    assert.equal(builds, 3, 'same actor/query shares one trend build; actor/query boundaries stay isolated');
    const identical = burst.slice(0, 10);
    assert.deepEqual(new Set(identical.map((item) => JSON.stringify(item.body))).size, 1);
    identical.forEach((item) => assert.equal(item.status, 200));

    const cached = await invoke(handler, { query: sameQuery, session: admin });
    assert.equal(cached.status, 200);
    assert.equal(builds, 3, 'same actor/query should reuse cached trend payload after the burst');

    signature = 'trend-sig-fail';
    fail = true;
    const failed = await Promise.all(Array.from({ length: 10 }, () => invoke(handler, {
      query: { ky: '07.2026', emp: 'DN001', nonce: 'trend-fail' },
      session: admin,
    })));
    assert.equal(builds, 4, 'failed memo build still runs only once');
    failed.forEach((item) => {
      assert.equal(item.status, 500);
      assert.equal(item.body.code, 'TREND_EXPLODED');
    });

    fail = false;
    const retry = await invoke(handler, {
      query: { ky: '07.2026', emp: 'DN001', nonce: 'trend-fail' },
      session: admin,
    });
    assert.equal(retry.status, 200);
    assert.equal(builds, 5, 'rejected memo build must evict so retry can rebuild');
  } finally {
    store.targetDataSignature = originalTargetSignature;
    store.listPeriods = originalListPeriods;
    store.getRows = originalGetRows;
    store.getTargets = originalGetTargets;
    A.applyFilters = originalApplyFilters;
    A.sum = originalSum;
    A.selectedEmployeeCodes = originalSelectedEmployeeCodes;
    A.targetFiltersComparable = originalTargetFiltersComparable;
  }
});
