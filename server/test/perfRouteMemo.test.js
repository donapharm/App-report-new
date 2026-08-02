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
const employeeCostAllGuard = require('../src/employeeCostAllGuard');
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

test('employee-cost ALL shares one admin base across actors/pages/filters and invalidates on signature', async () => {
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;
  let signature = 'cost-slot-a';
  let builds = 0;
  let catalogBuilds = 0;
  store.activeDataSignature = () => signature;
  store.employeeCostDataSignature = () => signature;
  store.targetRoster = () => [
    { emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true },
    { emp_code: 'DN003', name: 'NV 3', role: 'sale', has_target: true },
  ];
  catalogManagement.getSnapshot = async () => {
    catalogBuilds += 1;
    return { rows: [], catalog: [] };
  };
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
    assert.equal(catalogBuilds, 3, 'concurrent requests must coalesce the three month/quarter catalog snapshots');

    const second = await invoke('/employee-cost', query, admin);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body);
    assert.equal(builds, firstBuilds, 'identical ALL request must be memoized');

    const otherAdmin = await invoke('/employee-cost', query, admin2);
    assert.deepEqual(otherAdmin.body, first.body);
    assert.equal(builds, firstBuilds, 'ALL is admin-only and must share the exact company payload across admins');

    await invoke('/employee-cost', { ...query, page: '2' }, admin);
    assert.equal(builds, firstBuilds, 'another page must transform the shared heavy base without rebuilding employees');
    await invoke('/employee-cost', { ...query, q: 'khong-co-ket-qua' }, admin2);
    assert.equal(builds, firstBuilds, 'another filter must transform the shared heavy base without rebuilding employees');
    const afterPageBuilds = builds;

    signature = 'cost-slot-b';
    await invoke('/employee-cost', query, admin);
    assert.ok(builds > afterPageBuilds, 'slot change must invalidate ALL cache');

    const forbidden = await invoke('/employee-cost', query, sale);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 'EMPLOYEE_COST_ALL_FORBIDDEN');
    const forcedOther = await invoke('/employee-cost', { ...query, emp: 'DN002' }, sale);
    assert.equal(forcedOther.status, 403);
    assert.equal(forcedOther.body.code, 'EMPLOYEE_COST_EMP_FORBIDDEN');
  } finally {
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});

// ‼ ĐỔI HỢP ĐỒNG 04/08/2026: một NV lỗi nguồn KHÔNG còn kéo sập cả bảng đội.
// Trước đây trả 500 ⇒ CEO mở màn hình thấy TRẮNG, 20 NV còn lại cũng mất theo.
// Nay NV lỗi bị đánh dấu `source_error` và hiện đích danh trên băng đỏ; số của
// những người khác vẫn ra. Không ai bị trả 0đ oan, không ai biến mất lặng lẽ.
// Phần "không giữ Promise lỗi" vẫn phải đúng: bản gộp có NV lỗi chỉ được cache
// 2 phút (employeeCostAllDegraded) nên lần sau vẫn dựng lại bằng số thật.
test('employee-cost ALL: một NV lỗi không kéo sập bảng, và không giữ kết quả lỗi', async () => {
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
    const degraded = await invoke('/employee-cost', query, admin);
    assert.equal(degraded.status, 200, 'màn hình vẫn phải mở được, không trả 500 trắng màn');
    const periods = Array.isArray(degraded.body?.periods) ? degraded.body.periods : [degraded.body];
    const named = periods.flatMap((period) => period?.match?.unavailableEmployees || []);
    assert.ok(named.includes('DN001'), 'NV lỗi nguồn phải hiện ĐÍCH DANH, không im lặng');
    assert.equal(attempts, 1);
  } finally {
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});

test('employee-cost ALL retries a degraded source snapshot after short TTL but keeps a recovered snapshot hot', async () => {
  const realNow = Date.now;
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;
  let now = realNow();
  let builds = 0;
  let outcome = 'upstream_unavailable';
  Date.now = () => now;
  store.activeDataSignature = () => 'cost-outcome-aware-ttl';
  store.employeeCostDataSignature = () => 'cost-outcome-aware-ttl';
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    builds += 1;
    return {
      ...employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to })),
      sourceOutcome: outcome,
    };
  };
  const query = { emp: 'ALL', from: '2026-05', to: '2026-05', page: '1', pageSize: '20' };
  try {
    const degraded = await invoke('/employee-cost', query, admin);
    assert.equal(degraded.body.periods[0].match.unavailableEmployeeCount, 1);
    assert.equal(builds, 1);

    now += employeeCostAllGuard.DEFAULT_ERROR_TTL_MS - 1;
    await invoke('/employee-cost', query, admin);
    assert.equal(builds, 1, 'degraded base stays coalesced only inside its short TTL');

    outcome = 'ok';
    now += 2;
    const recovered = await invoke('/employee-cost', query, admin);
    assert.equal(builds, 2, 'degraded base must retry without waiting six hours');
    assert.equal(recovered.body.periods[0].match.unavailableEmployeeCount, 0);

    now += 60 * 60 * 1000;
    await invoke('/employee-cost', query, admin);
    assert.equal(builds, 2, 'healthy recovered base keeps the established long TTL');
  } finally {
    Date.now = realNow;
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});

test('employee-cost ALL bounds both catalog and employee fan-out at reviewed concurrency two', async () => {
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;
  let activeCatalog = 0;
  let maxCatalog = 0;
  let catalogCalls = 0;
  let activeEmployees = 0;
  let maxEmployees = 0;
  let employeeCalls = 0;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
  store.activeDataSignature = () => 'cost-bounded-fanout-2031';
  store.employeeCostDataSignature = () => 'cost-bounded-fanout-2031';
  store.targetRoster = () => Array.from({ length: 5 }, (_, index) => ({
    emp_code: `DN${String(index + 1).padStart(3, '0')}`,
    name: `NV ${index + 1}`,
    role: 'sale',
    has_target: true,
  }));
  catalogManagement.getSnapshot = async () => {
    catalogCalls += 1;
    activeCatalog += 1;
    maxCatalog = Math.max(maxCatalog, activeCatalog);
    await pause();
    activeCatalog -= 1;
    return { rows: [], catalog: [] };
  };
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    employeeCalls += 1;
    activeEmployees += 1;
    maxEmployees = Math.max(maxEmployees, activeEmployees);
    await pause();
    activeEmployees -= 1;
    return { ...employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to })), sourceOutcome: 'ok' };
  };
  try {
    const response = await invoke('/employee-cost', {
      emp: 'ALL', from: '2031-01', to: '2031-06', page: '1', pageSize: '20',
    }, admin);
    assert.equal(response.status, 200);
    assert.equal(catalogCalls, 6, 'six unique requested/quarter periods must each be read once');
    assert.equal(maxCatalog, 2, 'catalog DataHub fan-out must be bounded to two');
    assert.equal(employeeCalls, 5);
    assert.equal(maxEmployees, 2, 'employee DataHub fan-out must be bounded to two');
  } finally {
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});

test('catalog failure marks the hidden base degraded and retries after the short TTL', async () => {
  const realNow = Date.now;
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;
  let now = realNow();
  let builds = 0;
  let catalogFails = true;
  Date.now = () => now;
  store.activeDataSignature = () => 'cost-catalog-degraded-2032';
  store.employeeCostDataSignature = () => 'cost-catalog-degraded-2032';
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => {
    if (catalogFails) throw new Error('catalog unavailable in test');
    return { rows: [], catalog: [] };
  };
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    builds += 1;
    return { ...employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to })), sourceOutcome: 'ok' };
  };
  const query = { emp: 'ALL', from: '2032-05', to: '2032-05', page: '1', pageSize: '20' };
  try {
    const degraded = await invoke('/employee-cost', query, admin);
    assert.equal(degraded.status, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(degraded.body, 'sourceHealth'), false, 'internal health metadata must not change public JSON');
    assert.equal(degraded.body.periods[0].match.unavailableEmployeeCount, 0, 'employee source itself remains healthy in this regression');
    assert.equal(builds, 1);

    now += employeeCostAllGuard.DEFAULT_ERROR_TTL_MS - 1;
    await invoke('/employee-cost', query, admin);
    assert.equal(builds, 1, 'catalog-degraded base remains hot only inside error TTL');

    catalogFails = false;
    now += 2;
    await invoke('/employee-cost', query, admin);
    assert.equal(builds, 2, 'catalog-degraded base must rebuild after two minutes');

    now += 60 * 60 * 1000;
    await invoke('/employee-cost', query, admin);
    assert.equal(builds, 2, 'recovered catalog base keeps healthy TTL');
  } finally {
    Date.now = realNow;
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});

test('RAM gate rejection makes zero catalog/employee calls and is evicted for a safe retry', async () => {
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;
  const originalAssertMemoryBudget = employeeCostAllGuard.assertMemoryBudget;
  let catalogCalls = 0;
  let employeeCalls = 0;
  store.activeDataSignature = () => 'cost-ram-gate-eviction';
  store.employeeCostDataSignature = () => 'cost-ram-gate-eviction';
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => {
    catalogCalls += 1;
    return { rows: [], catalog: [] };
  };
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    employeeCalls += 1;
    return employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to }));
  };
  const query = { emp: 'ALL', from: '2033-04', to: '2033-04', page: '1', pageSize: '20' };
  try {
    employeeCostAllGuard.assertMemoryBudget = () => { throw employeeCostAllGuard.memoryPressureError(); };
    const blocked = await invoke('/employee-cost', query, admin);
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.code, 'EMPLOYEE_COST_ALL_MEMORY_PRESSURE');
    assert.equal(catalogCalls, 0, 'admission gate must run before the first catalog fetch');
    assert.equal(employeeCalls, 0, 'admission gate must run before the first employee fetch');

    employeeCostAllGuard.assertMemoryBudget = originalAssertMemoryBudget;
    const retried = await invoke('/employee-cost', query, admin);
    assert.equal(retried.status, 200);
    assert.ok(catalogCalls > 0);
    assert.equal(employeeCalls, 1, 'rejected request must not poison the retry');
  } finally {
    employeeCostAllGuard.assertMemoryBudget = originalAssertMemoryBudget;
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});

test('rising RSS during employee fan-out stops before remaining employees and before merge', async () => {
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;
  const originalAssertMemoryBudget = employeeCostAllGuard.assertMemoryBudget;
  const hardLimit = employeeCostAllGuard.maxRssBytes();
  let hardChecks = 0;
  let employeeCalls = 0;
  store.activeDataSignature = () => 'cost-rising-ram-2034';
  store.employeeCostDataSignature = () => 'cost-rising-ram-2034';
  store.targetRoster = () => Array.from({ length: 4 }, (_, index) => ({
    emp_code: `DN${String(index + 1).padStart(3, '0')}`,
    name: `NV ${index + 1}`,
    role: 'sale',
    has_target: true,
  }));
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    employeeCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to }));
  };
  employeeCostAllGuard.assertMemoryBudget = ({ limitBytes } = {}) => {
    if (limitBytes === hardLimit) {
      hardChecks += 1;
      // 3 catalog checks, then permit exactly the first 2 employee requests.
      if (hardChecks >= 6) throw employeeCostAllGuard.memoryPressureError();
    }
    return { rss: 1, limitBytes };
  };
  try {
    const blocked = await invoke('/employee-cost', {
      emp: 'ALL', from: '2034-08', to: '2034-08', page: '1', pageSize: '20',
    }, admin);
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.code, 'EMPLOYEE_COST_ALL_MEMORY_PRESSURE');
    assert.equal(employeeCalls, 2, 'no employee beyond the first admitted pair may start');
  } finally {
    employeeCostAllGuard.assertMemoryBudget = originalAssertMemoryBudget;
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
  assert.match(source, /function employeeCostAllCacheKey[\s\S]*?'ADMIN_ALL'/);
  assert.match(source, /employeeCostAllCacheKey\(req, 'base'\)[\s\S]*?EMPLOYEE_COST_ALL_BASE_TTL_MS/);
  assert.match(source, /employeeCostAllCacheKey\(req, 'view'\)[\s\S]*?EMPLOYEE_COST_ALL_VIEW_TTL_MS/);
  assert.match(source, /revenueRefresh\.onMaterialized\([\s\S]*?warmEmployeeCostAllCache/);
  assert.match(source, /scheduleEmployeeCostAllWarm\(slot\.ky, 'upload_commit'\)/);
  assert.match(source, /scheduleEmployeeCostAllWarm\(slot\.ky, 'upload_activate'\)/);
  assert.match(source, /router\.get\('\/employee-cost'[\s\S]*?Cache-Control', 'private, no-store'/);
  assert.match(source, /function memoJson[\s\S]*?Cache-Control', 'private, no-store'/);
  assert.match(source, /function currentMemoDataSignature\(\)[\s\S]*?store\.activeDataSignature\(\)[\s\S]*?memo\.clear\(\)/);
  assert.match(source, /v\.then\([\s\S]*?memo\.get\(key\) === entry[\s\S]*?memo\.delete\(key\)/);
  assert.match(source, /ttlForValue:[\s\S]*?EMPLOYEE_COST_ALL_ERROR_TTL_MS/);
  const analyticsSource = fs.readFileSync(require.resolve('../src/analytics'), 'utf8');
  assert.match(analyticsSource, /cacheKey = JSON\.stringify\(\{ data: store\.dashboardDataSignature\(\), list,/);
  const storeSource = fs.readFileSync(require.resolve('../src/store'), 'utf8');
  assert.match(storeSource, /function employeeCostDataSignature[\s\S]*?EMPLOYEE_BONUS_POLICY_FILE[\s\S]*?catalog_management_lkg\.json/);
  const refreshSource = fs.readFileSync(require.resolve('../src/revenueRefresh'), 'utf8');
  assert.match(refreshSource, /notifyMaterialized\(run\)/);
  assert.match(refreshSource, /setImmediate\(\(\) => Promise\.resolve\(listener\(run\)\)/);
});

/* ── CEO duyệt 04/08: trả số cũ ngay, dựng lại ngầm ────────────────────────── */

test('‼ hết hạn thì TRẢ NGAY bản cũ và dựng lại NGẦM, không bắt người dùng chờ', async () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  const memoGet = new Function('memo', `${source.slice(
    source.indexOf('function memoGet(key, ttlMs'),
    source.indexOf('function stableCacheValue'),
  )}; return memoGet;`)(new Map());

  let builds = 0;
  const build = async () => { builds += 1; return `bản ${builds}`; };
  const key = 'k';
  assert.equal(await memoGet(key, 10, build, null, { staleMs: 60_000 }), 'bản 1');
  await new Promise((resolve) => setTimeout(resolve, 30));   // quá hạn 10ms
  // Lần gọi này phải trả NGAY bản cũ, không chờ dựng lại.
  assert.equal(await memoGet(key, 10, build, null, { staleMs: 60_000 }), 'bản 1', 'phải trả bản cũ tức thì');
  await new Promise((resolve) => setTimeout(resolve, 30));   // để bản ngầm chạy xong
  assert.equal(builds, 2, 'bản mới phải được dựng ở nền');
  assert.equal(await memoGet(key, 10_000, build, null, { staleMs: 60_000 }), 'bản 2', 'lần sau đã là số mới');
});

test('‼ quá hạn dùng tạm thì KHÔNG được trả bản cũ nữa — phải dựng lại thật', async () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  const memoGet = new Function('memo', `${source.slice(
    source.indexOf('function memoGet(key, ttlMs'),
    source.indexOf('function stableCacheValue'),
  )}; return memoGet;`)(new Map());
  let builds = 0;
  const build = async () => { builds += 1; return `bản ${builds}`; };
  assert.equal(await memoGet('k2', 5, build, null, { staleMs: 5 }), 'bản 1');
  await new Promise((resolve) => setTimeout(resolve, 40));   // quá cả TTL lẫn hạn dùng tạm
  assert.equal(await memoGet('k2', 5, build, null, { staleMs: 5 }), 'bản 2', 'quá hạn dùng tạm thì phải chờ số mới');
});

test('bảng "Tất cả NV" phải bật chế độ trả-cũ-dựng-ngầm', () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(source, /staleMs: EMPLOYEE_COST_ALL_STALE_MS/);
  assert.match(source, /const EMPLOYEE_COST_ALL_STALE_MS = 10 \* 60 \* 1000/);
});
