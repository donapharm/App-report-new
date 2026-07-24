const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-perf-memo-auth-'));
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-perf-memo-no-lkg.json');

const store = require('../src/store');
const smart = require('../src/smart');
const employeeCost = require('../src/employeeCost');
const catalogManagement = require('../src/catalogManagement');
const router = require('../src/routes');

function routeHandlers(routePath) {
  const layer = router.stack.find((candidate) => candidate.route?.path === routePath && candidate.route?.methods?.get);
  assert.ok(layer, `missing GET ${routePath}`);
  return layer.route.stack.slice(1).map((item) => item.handle);
}

function invoke(routePath, query, session) {
  const handlers = routeHandlers(routePath);
  return new Promise((resolve, reject) => {
    let index = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const res = {
      statusCode: 200,
      headersSent: false,
      headers: {},
      set(key, value) { this.headers[key] = value; return this; },
      setHeader(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { finish(resolve, { status: this.statusCode, body }); },
      send(body) { finish(resolve, { status: this.statusCode, body }); },
      end() { finish(resolve, { status: this.statusCode, body: null }); },
    };
    const req = { query: { ...query }, session: { ...session }, headers: {}, body: {}, params: {}, ip: '127.0.0.1' };
    const dispatch = (error) => {
      if (error) return finish(reject, error);
      const handler = handlers[index++];
      if (!handler) return finish(reject, new Error(`route ended without response: ${routePath}`));
      try { Promise.resolve(handler(req, res, dispatch)).catch(dispatch); }
      catch (cause) { dispatch(cause); }
    };
    dispatch();
  });
}

const admin = { emp_code: 'CEO', role: 'admin', name: 'CEO QA' };
const admin2 = { emp_code: 'ADMIN02', role: 'admin', name: 'Admin QA' };
const sale = { emp_code: 'DN001', role: 'sale', name: 'Sale QA' };

test('heavy read memo key separates query, actor, role and employee scope and invalidates on slot signature', async () => {
  const originalSignature = store.activeDataSignature;
  const originalDashboardSignature = store.dashboardDataSignature;
  const originalAlerts = smart.buildAlerts;
  let signature = 'slot-a';
  let builds = 0;
  store.activeDataSignature = () => signature;
  store.dashboardDataSignature = () => signature;
  smart.buildAlerts = ({ scope, filters }) => ({ build: ++builds, scope: scope.empCode || 'ADMIN', q: filters.q || null });
  try {
    const query = { ky: '07.2026', q: 'memo-scope-check' };
    const first = await invoke('/alerts', query, admin);
    const second = await invoke('/alerts', query, admin);
    assert.equal(first.status, 200);
    assert.deepEqual(second.body, first.body);
    assert.equal(builds, 1, 'same actor/scope/query must hit memo');

    await invoke('/alerts', query, admin2);
    assert.equal(builds, 2, 'different admin actor must not share cache');
    await invoke('/alerts', query, sale);
    assert.equal(builds, 3, 'employee scope must not share admin cache');
    await invoke('/alerts', { ...query, q: 'memo-other-filter' }, admin);
    assert.equal(builds, 4, 'different filters must not collide');

    signature = 'slot-b';
    const afterUpload = await invoke('/alerts', query, admin);
    assert.equal(builds, 5, 'slot signature change must rebuild');
    assert.equal(afterUpload.body.build, 5);
  } finally {
    store.activeDataSignature = originalSignature;
    store.dashboardDataSignature = originalDashboardSignature;
    smart.buildAlerts = originalAlerts;
  }
});

test('employee-cost ALL memo reuses exact payload and splits page/signature while non-admin stays forbidden', async () => {
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;
  let signature = 'cost-slot-a';
  let builds = 0;
  store.activeDataSignature = () => signature;
  store.employeeCostDataSignature = () => signature;
  store.targetRoster = () => [
    { emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true },
    { emp_code: 'DN003', name: 'NV 3', role: 'sale', has_target: true },
  ];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    builds += 1;
    const range = employeeCost.parseMonthRange({ from: options.from, to: options.to });
    return employeeCost.emptyRangePayload(requestedEmp, range);
  };
  try {
    const query = { emp: 'ALL', from: '2026-07', to: '2026-07', page: '1', pageSize: '20', sortDir: 'asc' };
    const [first, concurrent] = await Promise.all([
      invoke('/employee-cost', query, admin),
      invoke('/employee-cost', query, admin),
    ]);
    const firstBuilds = builds;
    assert.equal(first.status, 200);
    assert.deepEqual(concurrent.body, first.body);
    assert.ok(firstBuilds > 1, 'first ALL request must build roster payloads');
    assert.equal(firstBuilds, 2, 'concurrent identical request must share one in-flight build');

    const second = await invoke('/employee-cost', query, admin);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body);
    assert.equal(builds, firstBuilds, 'identical ALL request must be memoized');

    await invoke('/employee-cost', { ...query, page: '2' }, admin);
    assert.ok(builds > firstBuilds, 'page belongs to the ALL cache key');
    const afterPageBuilds = builds;

    signature = 'cost-slot-b';
    await invoke('/employee-cost', query, admin);
    assert.ok(builds > afterPageBuilds, 'slot change must invalidate ALL cache');

    const forbidden = await invoke('/employee-cost', query, sale);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 'EMPLOYEE_COST_ALL_FORBIDDEN');
  } finally {
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});

test('employee-cost ALL does not retain a rejected Promise', async () => {
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;
  let attempts = 0;
  store.activeDataSignature = () => 'cost-rejection-eviction';
  store.employeeCostDataSignature = () => 'cost-rejection-eviction';
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    attempts += 1;
    if (attempts === 1) throw new Error('upstream transient');
    return employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to }));
  };
  try {
    const query = { emp: 'ALL', from: '2026-06', to: '2026-06', page: '1', pageSize: '20' };
    const failed = await invoke('/employee-cost', query, admin);
    assert.equal(failed.status, 500);
    const retried = await invoke('/employee-cost', query, admin);
    assert.equal(retried.status, 200);
    assert.equal(attempts, 2, 'second request must rebuild after rejection');
  } finally {
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});

test('all requested P0 routes are memoized after auth and cache keeps private/no-store employee-cost semantics', () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  for (const [routePath, name] of [
    ['/filters', 'filters'], ['/alerts', 'alerts'], ['/revenue', 'revenue'], ['/analysis', 'analysis'], ['/cst', 'cst'],
  ]) {
    const escaped = routePath.replace('/', '\\/');
    assert.match(source, new RegExp(`router\\.get\\('${escaped}', auth\\.requireAuth, memoJson\\('${name}'`));
  }
  assert.match(source, /employeeCostAllPayload[\s\S]*?readCacheKey\(req, 'employee-cost-all'/);
  assert.match(source, /router\.get\('\/employee-cost'[\s\S]*?Cache-Control', 'private, no-store'/);
  assert.match(source, /function memoJson[\s\S]*?Cache-Control', 'private, no-store'/);
  assert.match(source, /function currentMemoDataSignature\(\)[\s\S]*?store\.activeDataSignature\(\)[\s\S]*?memo\.clear\(\)/);
  assert.match(source, /v\.catch\(\(\) => \{ if \(memo\.get\(key\) === entry\) memo\.delete\(key\); \}\)/);
  const analyticsSource = fs.readFileSync(require.resolve('../src/analytics'), 'utf8');
  assert.match(analyticsSource, /cacheKey = JSON\.stringify\(\{ data: store\.dashboardDataSignature\(\), list,/);
});
