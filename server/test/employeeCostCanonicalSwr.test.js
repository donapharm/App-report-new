const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-swr-auth-'));
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-swr-no-lkg.json');

const store = require('../src/store');
const employeeCost = require('../src/employeeCost');
const catalogManagement = require('../src/catalogManagement');
const router = require('../src/routes');

function routeHandlers(routePath) {
  const layer = router.stack.find((c) => c.route?.path === routePath && c.route?.methods?.get);
  assert.ok(layer, `missing GET ${routePath}`);
  return layer.route.stack.slice(1).map((item) => item.handle);
}
function invoke(routePath, query, session) {
  const handlers = routeHandlers(routePath);
  return new Promise((resolve, reject) => {
    let index = 0;
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const res = {
      statusCode: 200, headers: {},
      set(k, v) { this.headers[k] = v; return this; },
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { finish(resolve, { status: this.statusCode, body: b }); },
      send(b) { finish(resolve, { status: this.statusCode, body: b }); },
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
const flush = () => new Promise((r) => setImmediate(r));
const admin = { emp_code: 'CEO', role: 'admin', name: 'CEO QA' };

test('canonical snapshot: stale-while-revalidate serves cached instantly and refreshes once in background', async () => {
  const realNow = Date.now;
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;

  let clock = realNow();
  const calls = {};
  Date.now = () => clock;
  store.activeDataSignature = () => 'swr-sig';
  store.employeeCostDataSignature = () => 'swr-sig';
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async (key) => {
    calls[key] = (calls[key] || 0) + 1;
    return { rows: [], catalog: [{ key, n: calls[key] }] };
  };
  employeeCost.getForSession = async ({ requestedEmp }, options) => (
    employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to }))
  );
  const total = () => Object.values(calls).reduce((a, b) => a + b, 0);
  try {
    const query = { emp: 'ALL', from: '2026-03', to: '2026-03', page: '1', pageSize: '20' };

    // Cold: mỗi kỳ (tháng + các kỳ quý) lấy DataHub đúng 1 lần.
    const cold = await invoke('/employee-cost', query, admin);
    assert.equal(cold.status, 200);
    await flush();
    const coldCalls = total();
    assert.ok(coldCalls > 0, 'cold request must fetch at least one period');

    // Còn hạn: không gọi lại DataHub.
    const warm = await invoke('/employee-cost', query, admin);
    assert.equal(warm.status, 200);
    await flush();
    assert.equal(total(), coldCalls, 'within TTL must not refetch DataHub');

    // Quá hạn 16 phút: phải trả NGAY (không treo) và làm mới ở nền đúng 1 lần/kỳ.
    clock += 16 * 60 * 1000;
    const stale = await invoke('/employee-cost', query, admin);
    assert.equal(stale.status, 200, 'stale request must resolve immediately, not hang on DataHub');
    await flush();
    await flush();
    assert.equal(total(), coldCalls * 2, 'stale-while-revalidate must trigger exactly one background refresh per period');

    // Sau khi nền làm mới xong: lại còn hạn, không refetch nữa.
    const afterRefresh = await invoke('/employee-cost', query, admin);
    assert.equal(afterRefresh.status, 200);
    await flush();
    assert.equal(total(), coldCalls * 2, 'refreshed entry is fresh again; no extra DataHub calls');
  } finally {
    Date.now = realNow;
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});
