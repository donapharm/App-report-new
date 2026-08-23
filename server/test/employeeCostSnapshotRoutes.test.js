'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const routesSource = () => fs.readFileSync(require.resolve('../src/routes'), 'utf8');

test('snapshot serving flag is off by default and ALL GET fails closed without live fallback', () => {
  const source = routesSource();
  assert.match(source, /employeeCostSnapshotEnabled = \(\) => String\(process\.env\.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT \|\| ''\) === '1'/);
  assert.match(source, /if \(employeeCostSnapshotEnabled\(\) && !snapshotBuild && paginate\) return readEmployeeCostSnapshotModel\(req, range\)/);
  const readStart = source.indexOf('function readEmployeeCostSnapshotModel');
  const readEnd = source.indexOf('\n}', readStart);
  const reader = source.slice(readStart, readEnd);
  assert.match(reader, /tryReadCurrent/);
  assert.match(reader, /status: 503/);
  assert.doesNotMatch(reader, /employeeCostPayload|fetchEmployeeCost|employeeCostAllPayload/);
});

test('snapshot mode bypasses memo, seal, and warm paths while flag-off legacy remains present', () => {
  const source = routesSource();
  assert.match(source, /if \(!snapshotBuild && sealKey && paginate\)/);
  assert.match(source, /snapshotBuild \? await buildMerged\(\) : await buildMergedSealed\(\)/);
  assert.match(source, /async function warmEmployeeCostAllCache[\s\S]*?if \(employeeCostSnapshotEnabled\(\)\) return false/);
  assert.match(source, /function scheduleEmployeeCostAllWarm[\s\S]*?if \(employeeCostSnapshotEnabled\(\)\) return/);
  assert.match(source, /employeeCostSnapshotSyncEnabled = \(\) => String\(process\.env\.EMPLOYEE_COST_LOCAL_SNAPSHOT_SYNC_ENABLED \|\| ''\) === '1'/);
  assert.match(source, /function startEmployeeCostSnapshotSyncLoop[\s\S]*?onlyIfMissing: true[\s\S]*?EMPLOYEE_COST_SNAPSHOT_SYNC_INTERVAL_MS/);
  assert.match(source, /const payload = wantsAll[\s\S]*?await employeeCostAllPayload\(req\)[\s\S]*?employeeCostPayload\(req\)/);
});

test('snapshot status/resync routes are admin guarded and mutation is additionally CEO guarded', () => {
  const source = routesSource();
  assert.match(source, /router\.get\('\/employee-cost\/snapshot\/status', auth\.requireAuth, auth\.requireAdmin/);
  assert.match(source, /router\.post\('\/employee-cost\/snapshot\/resync', auth\.requireAuth, auth\.requireAdmin/);
  assert.match(source, /if \(!auth\.isCeoActor\(req\.session\)\) return res\.status\(403\)/);
  assert.match(source, /return res\.status\(202\)\.json/);
  assert.match(source, /EMPLOYEE_COST_SNAPSHOT_SYNC_DISABLED/);
  assert.match(source, /EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE/);
  assert.match(source, /controlEnabled: enabled \|\| trangThaiDongBo\.initialGenerationAllowed === true/);
  assert.match(source, /closedIncomplete[\s\S]*?trustedHumanDeviceForSession[\s\S]*?EMPLOYEE_COST_SNAPSHOT_HUMAN_OTP_REQUIRED/);
  assert.match(source, /requestClosedRepair\(period/);
  assert.match(source, /expectedRateChecksum = '615981e92ef1576fce54de8ae12e14140181d38c44d9839d7e363b68d35e356c'/);
});

test('closed repair UI is visible only for an incomplete locked generation', () => {
  const ui = fs.readFileSync(require.resolve('../../web/src/employeeCostSnapshotControl'), 'utf8');
  assert.match(ui, /status\.locked && status\.complete/);
  assert.match(ui, /Dựng lại bản tiền thiếu/);
});

test('closed T07 without current has a distinct CEO OTP initial-generation path', () => {
  const source = routesSource();
  assert.match(source, /closedInitial[\s\S]*?trustedHumanDeviceForSession[\s\S]*?requestInitialClosedGeneration/);
  assert.match(source, /period === '2026-07'/);
  assert.match(source, /period === '2026-06'[\s\S]*?EMPLOYEE_COST_SNAPSHOT_INITIAL_PERIOD_DENIED/);
  const ui = fs.readFileSync(require.resolve('../../web/src/pages/EmployeeCost.jsx'), 'utf8');
  const control = fs.readFileSync(require.resolve('../../web/src/employeeCostSnapshotControl'), 'utf8');
  assert.match(ui, /EmployeeCostSnapshotControl/);
  assert.doesNotMatch(control, /status\.locked[^\n]{0,160}(đã đóng dấu|có con dấu)/i);
});

test('sync probes exact authoritative evidence once before enrichment', () => {
  const source = routesSource();
  const adapterStart = source.indexOf('async function fetchAuthoritativeEmployeeCost');
  const adapterEnd = source.indexOf('\n}\n\nconst employeeCostSnapshotSync', adapterStart);
  const adapter = source.slice(adapterStart, adapterEnd);
  assert.match(adapter, /employeeCost\.fetchRawEmployeeCost\(empCode/);
  assert.doesNotMatch(adapter, /employeeCost\.fetchEmployeeCost\(empCode/);
  const rawCall = adapter.slice(adapter.indexOf('employeeCost.fetchRawEmployeeCost'), adapter.indexOf(');', adapter.indexOf('employeeCost.fetchRawEmployeeCost')) + 2);
  assert.doesNotMatch(rawCall, /pinnedClosedPayload|rateSnapshot|backgroundRefresh|ok_stale_rates/);
  assert.match(source, /employeeCost\.verifiedPrefetchEvidence\(raw, empCode/);
  assert.match(source, /prefetchedCostResult: evidence/);
  assert.match(adapter, /const sourceOutcome = raw\?\.outcome \|\| 'ok'/);
  assert.match(adapter, /report: \{ \.\.\.report, sourceOutcome \}/);
  assert.match(source, /fetchEmployee: \(empCode, options\) => fetchAuthoritativeEmployeeCost\(empCode, options\)/);
  assert.match(source, /probeEmployee: \(empCode, options\) => fetchAuthoritativeEmployeeCost\(empCode/);
});

test('watcher runtime is external-only; checked-in runner enforces lock/interlocks and CEO outbox', () => {
  const source = routesSource();
  const runner = fs.readFileSync(require.resolve('../scripts/employee-cost-snapshot-watcher'), 'utf8');
  const watcher = fs.readFileSync(require.resolve('../src/employeeCostSnapshotWatcher'), 'utf8');
  assert.match(source, /router\.employeeCostSnapshotWatcherRuntime/);
  assert.doesNotMatch(source, /startEmployeeCostSnapshotWatchLoop|EMPLOYEE_COST_SNAPSHOT_WATCH_ENABLED/);
  assert.match(runner, /runLockedProcess/);
  assert.match(runner, /EMPLOYEE_COST_ALL_WARM_DISABLED/);
  assert.match(runner, /EMPLOYEE_COST_LOCAL_SNAPSHOT_SYNC_ENABLED/);
  assert.match(runner, /EMPLOYEE_COST_CRON_DISABLED/);
  assert.match(runner, /EMPLOYEE_COST_SNAPSHOT_WATCH_PERIOD/);
  assert.match(runner, /currentWatchPeriod\(\)/);
  assert.match(runner, /isPeriodBusy\(watchPeriod\)/);
  assert.match(runner, /EMPLOYEE_COST_SERVE_FROM_SNAPSHOT/);
  assert.match(watcher, /CEO_TELEGRAM_ID = '1748199545'/);
  assert.match(watcher, /concurrency: 1/);
  assert.doesNotMatch(source, /EMPLOYEE_COST_SERVE_FROM_SNAPSHOT\s*=\s*['"]1/);
});

test('manual sync audit/log is privacy-safe and never logs keys or monetary payload', () => {
  const source = routesSource();
  const start = source.indexOf("router.post('/employee-cost/snapshot/resync'");
  const end = source.indexOf('// Independent KPI projection', start);
  const route = source.slice(start, end);
  assert.match(route, /console\.info\('\[employee-cost-snapshot\] manual resync', \{ period, actor:[\s\S]*?accepted:/);
  assert.doesNotMatch(route, /amount|money|report|payload|secret|token|key:/i);
});
