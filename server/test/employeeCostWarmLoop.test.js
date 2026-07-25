const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-warmloop-auth-'));
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-warmloop-no-lkg.json');
delete process.env.EMPLOYEE_COST_ALL_WARM_DISABLED;

const store = require('../src/store');
const employeeCost = require('../src/employeeCost');
const catalogManagement = require('../src/catalogManagement');
const router = require('../src/routes');

const flush = () => new Promise((r) => setImmediate(r));

test('employee-cost ALL warm loop warms current period on startup, is idempotent, and honors disable flag', async () => {
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalLatestKy = store.latestKy;
  const originalCurrentKyByDate = store.currentKyByDate;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;

  let builds = 0;
  let warmedFrom = null;
  store.activeDataSignature = () => 'warmloop-sig';
  store.employeeCostDataSignature = () => 'warmloop-sig';
  store.latestKy = () => '03.2026';
  store.currentKyByDate = () => '03.2026';
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    builds += 1;
    warmedFrom = options.from;
    return employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to }));
  };
  try {
    assert.equal(typeof router.startEmployeeCostAllWarmLoop, 'function', 'warm loop starter must be exported');

    // Bật vòng warm -> phải warm NGAY kỳ hiện tại (03.2026 -> 2026-03).
    const timer = router.startEmployeeCostAllWarmLoop();
    assert.ok(timer, 'starting must return a live timer when not disabled');
    await flush();
    await flush();
    assert.ok(builds > 0, 'startup must warm the ALL cache for the current period');
    assert.equal(warmedFrom, '2026-03', 'must warm the current active month resolved from latestKy');

    // Idempotent: gọi lại trả cùng timer, không tạo vòng thứ hai.
    const again = router.startEmployeeCostAllWarmLoop();
    assert.equal(again, timer, 'starting twice must not create a second loop');

    // Tắt rồi bật với cờ disable -> không chạy (null).
    router.stopEmployeeCostAllWarmLoop();
    process.env.EMPLOYEE_COST_ALL_WARM_DISABLED = '1';
    const disabled = router.startEmployeeCostAllWarmLoop();
    assert.equal(disabled, null, 'disable flag must prevent the warm loop');
  } finally {
    delete process.env.EMPLOYEE_COST_ALL_WARM_DISABLED;
    router.stopEmployeeCostAllWarmLoop();
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.latestKy = originalLatestKy;
    store.currentKyByDate = originalCurrentKyByDate;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});
