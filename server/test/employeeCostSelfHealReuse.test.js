'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-selfheal-reuse-auth-'));
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-selfheal-reuse-no-lkg.json');
process.env.EMPLOYEE_COST_ALL_WARM_DISABLED = '1';

const employeeCost = require('../src/employeeCost');
const employeeCostTable = require('../src/employeeCostTable');
const router = require('../src/routes');
const storeModule = require('../src/store');

const columns = ['c36', 'c41', 'c43', 'c44', 'c45'].map((key) => ({ key, label: key.toUpperCase() }));
const rateRows = [{ c5: 'QL1', c7: '001', c16: 'P1', c25: 'Viên', c36: 5, c41: 0, c43: 0, c44: 0, c45: 0 }];
const memoryStore = () => ({ data: {}, load(name, fallback) { return this.data[name] ?? fallback; }, save(name, value) { this.data[name] = value; } });
const fresh = (empCode = 'DN006', from = '2026-08', to = from) => ({
  outcome: 'ok', attempts: 1, sourceRange: { from, to },
  payload: { empCode, from, to, periods: employeeCost.monthsBetween(from, to).map((period) => ({
    empCode, period, columns: columns.map((column) => ({ ...column })), rows: rateRows.map((row) => ({ ...row })),
  })) },
});
const evidence = (empCode = 'DN006', from = '2026-08', to = from, verifiedAt = Date.now()) => (
  employeeCost.verifiedPrefetchEvidence(fresh(empCode, from, to), empCode, { from, to, verifiedAt })
);
const unavailablePayload = (employees) => ({
  from: '2026-08', to: '2026-08', employees: employees.map((empCode) => ({ empCode })),
  periods: [{ period: '2026-08', match: { unavailableEmployees: employees, unavailablePairs: employees.length } }],
});
async function reportFromEvidence(empCode, item, from = '2026-08', to = from) {
  return employeeCost.getForSession({ session: { emp_code: 'CEO', role: 'ceo' }, scope: {}, requestedEmp: empCode }, {
    from, to, prefetchedResult: item, revenueRowsByPeriod: { [from]: [] }, catalogRowsByPeriod: { [from]: [] }, auditImpl: () => {},
  });
}

const roster21 = ['DN001', 'DN002', 'DN003', 'DN004', 'DN005', 'DN006', 'DN007', 'DN008', 'DN009', 'DN010', 'DN011', 'DN012', 'DN016', 'DN017', 'DN018', 'DN019', 'DN021', 'DN022', 'DN023', 'DN024', 'VP004'];

test('exact regression uses the live 21-person roster: 2s stale -> 15s ok -> <=2s evidence rebuild, 21/21 healthy', async () => {
  assert.deepEqual(require('../data/target_roster.json').allowed_codes, roster21, 'regression roster must track live canonical roster');
  const stages = [];
  const snapshotStore = memoryStore();
  employeeCost.rateSnapshot.remember('DN006', fresh().payload, { store: snapshotStore });
  const fastStarted = Date.now();
  const stale = await employeeCost.fetchEmployeeCost('DN006', {
    baseUrl: 'https://example.invalid/ords', assignmentKey: 'assignment-key-0001',
    employeeCostKeys: 'DN006=employee-cost-key-DN006', from: '2026-08', to: '2026-08',
    rateSnapshotStore: snapshotStore, backgroundRefresh: false,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })))),
  });
  const fastElapsedMs = Date.now() - fastStarted;
  assert.equal(stale.outcome, 'ok_stale_rates');
  assert.ok(fastElapsedMs >= employeeCost.FAST_TIMEOUT_MS - 150 && fastElapsedMs < employeeCost.FAST_TIMEOUT_MS + 1000,
    `user fast path elapsed ${fastElapsedMs}ms`);
  stages.push({ stage: 'fast', timeoutMs: employeeCost.FAST_TIMEOUT_MS, outcome: stale.outcome, elapsedMs: fastElapsedMs });
  const initial = unavailablePayload(roster21);
  const healed = await router.selfHealUnavailableCostSources({
    payload: initial, probeConcurrency: 6,
    probe: async (empCode) => {
      const payload = { empCode, from: '2026-08', to: '2026-08', columns, rows: [{ ...rateRows[0], EMP_CODE: empCode }] };
      const result = await employeeCost.fetchEmployeeCost(empCode, {
        baseUrl: 'https://example.invalid/ords', assignmentKey: 'assignment-key-0001',
        employeeCostKeys: `${empCode}=employee-cost-key-${empCode}`, from: '2026-08', to: '2026-08',
        rateSnapshotStore: snapshotStore, timeoutMs: 15000, backgroundRefresh: false,
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }),
      });
      stages.push({ stage: 'probe', empCode, timeoutMs: 15000, outcome: result.outcome });
      return employeeCost.verifiedPrefetchEvidence(result, empCode, { from: '2026-08', to: '2026-08', verifiedAt: Date.now() });
    },
    acceptProbeResult: (item, empCode) => !!employeeCost.exactPrefetchedResult(item, empCode, { from: '2026-08', to: '2026-08' }),
    invalidate: () => assert.fail('prepared rebuild must not invalidate before commit'),
    rebuild: async (verified) => {
      const began = Date.now();
      const reports = await Promise.all(roster21.map((empCode) => reportFromEvidence(empCode, verified.get(empCode))));
      stages.push({ stage: 'reports', healthy: reports.filter((report) => report.sourceOutcome === 'ok').length });
      const payload = employeeCostTable.mergeEmployeeReports(reports, roster21.map((emp_code) => ({ emp_code, name: emp_code })));
      return { payload, commit() { stages.push({ stage: 'rebuild', elapsedMs: Date.now() - began }); } };
    },
  });
  assert.equal(stages[0].timeoutMs, employeeCost.FAST_TIMEOUT_MS);
  assert.equal(stages.filter((x) => x.stage === 'probe' && x.timeoutMs === 15000).length, roster21.length);
  const rebuildStage = stages.find((x) => x.stage === 'rebuild');
  assert.ok(rebuildStage, JSON.stringify(stages));
  assert.ok(rebuildStage.elapsedMs <= employeeCost.FAST_TIMEOUT_MS,
    `evidence-only rebuild exceeded ${employeeCost.FAST_TIMEOUT_MS}ms`);
  assert.deepEqual(healed.recovered, roster21, JSON.stringify(stages));
  assert.deepEqual(healed.payload.periods[0].match.unavailableEmployees, []);
  assert.equal(healed.payload.periods[0].match.unavailableEmployeeCount, 0);
  assert.equal(healed.payload.employees.length, roster21.length);
  assert.equal(stages.find((x) => x.stage === 'reports').healthy, roster21.length);
  for (const code of ['DN006', 'DN018', 'DN022']) assert.ok(healed.payload.employees.some((x) => x.empCode === code));
});

test('evidence rejects invalid identity, period/range, timestamp, provenance, outcome and empty rows', () => {
  const options = { from: '2026-08', to: '2026-08', now: 10_000, maxAgeMs: 1_000 };
  const valid = { empCode: 'DN006', from: '2026-08', to: '2026-08', verifiedAt: 9_500, result: fresh() };
  assert.ok(employeeCost.exactPrefetchedResult(valid, 'DN006', options));
  for (const bad of [
    { ...valid, empCode: 'DN018' },
    { ...valid, from: '2026-07', to: '2026-07' },
    { ...valid, verifiedAt: 8_999 },
    { ...valid, verifiedAt: 12_000 },
    { ...valid, result: { ...fresh(), sourceRange: { from: '2026-07', to: '2026-07' } } },
    { ...valid, result: { ...fresh(), outcome: 'ok_stale_rates' } },
  ]) assert.equal(employeeCost.exactPrefetchedResult(bad, 'DN006', options), null);
  const wrongPayloadRange = fresh(); wrongPayloadRange.payload.from = '2026-07';
  assert.equal(employeeCost.exactPrefetchedResult({ ...valid, result: wrongPayloadRange }, 'DN006', options), null);
  const empty = fresh(); empty.payload.periods[0].rows = [];
  assert.equal(employeeCost.exactPrefetchedResult({ ...valid, result: empty }, 'DN006', options), null);
});

test('same-cycle failed report is reusable only as explicitly unavailable, never promoted to ok', () => {
  const range = { from: '2026-08', to: '2026-08', months: ['2026-08'] };
  const failed = employeeCost.emptyRangePayload('DN018', range, 'upstream unavailable');
  failed.sourceOutcome = 'upstream_unavailable';
  assert.equal(router.sameCycleEmployeeCostReport(failed, 'DN018', range), true);
  assert.equal(router.reusableEmployeeCostReport(failed, 'DN018', range), false);
  assert.equal(router.sameCycleEmployeeCostReport({ ...failed, empCode: 'DN006' }, 'DN018', range), false);
});

test('probe error and partial memo-hit stay fail-closed/all-or-nothing', async () => {
  let rebuilt = 0;
  const result = await router.selfHealUnavailableCostSources({
    payload: unavailablePayload(['DN006']), probeEmployees: ['DN006', 'DN018', 'DN022'], requireAllProbesForRebuild: true,
    probeConcurrency: 3,
    probe: async (emp) => { if (emp === 'DN018') throw new Error('upstream'); return evidence(emp); },
    acceptProbeResult: (item, emp) => !!employeeCost.exactPrefetchedResult(item, emp, { from: '2026-08', to: '2026-08' }),
    invalidate: () => assert.fail('must preserve prior memo'), rebuild: async () => { rebuilt += 1; },
  });
  assert.equal(rebuilt, 0);
  assert.deepEqual(result.recovered, []);
  assert.deepEqual(result.payload, unavailablePayload(['DN006']));
});

test('generation drift before/after build and immediately before commit preserves old payload', async () => {
  let generation = 'g1'; let commits = 0; const old = unavailablePayload(['DN006']);
  const before = await router.selfHealUnavailableCostSources({ payload: old, probe: async () => evidence(), canRebuild: () => generation === 'g1', invalidate: () => {}, rebuild: async () => { generation = 'g2'; return { payload: { periods: [] }, commit: () => { commits += 1; } }; } });
  assert.equal(commits, 0); assert.equal(before.payload, old);
  generation = 'g2';
  const blocked = await router.selfHealUnavailableCostSources({ payload: old, probe: async () => evidence(), canRebuild: () => false, invalidate: () => {}, rebuild: async () => assert.fail('no build') });
  assert.equal(blocked.payload, old);
  generation = 'g1';
  const atCommit = await router.selfHealUnavailableCostSources({
    payload: old, probe: async () => evidence(), canRebuild: () => generation === 'g1',
    rebuild: async () => ({ payload: { periods: [] }, commit: () => { generation = 'g2'; throw new Error('generation drift immediately before commit'); } }),
  });
  assert.equal(atCommit.payload, old); assert.deepEqual(atCommit.recovered, []);
});

test('build exception preserves prior payload/cache and never invalidates', async () => {
  const old = unavailablePayload(['DN006']); let invalidated = 0;
  const result = await router.selfHealUnavailableCostSources({
    payload: old, probe: async () => evidence(), invalidate: () => { invalidated += 1; },
    rebuild: async () => { throw new Error('build failed'); },
  });
  assert.equal(result.payload, old); assert.deepEqual(result.recovered, []); assert.equal(invalidated, 0);
});

test('bounded probe concurrency, single-flight cleanup and common expired deadline', async () => {
  let active = 0; let hwm = 0;
  await router.mapBounded(roster21, 4, async () => { active += 1; hwm = Math.max(hwm, active); await new Promise((r) => setTimeout(r, 4)); active -= 1; });
  assert.equal(hwm, 4);
  const flights = new Map(); let calls = 0;
  const [a, b] = await Promise.all([router.singleFlight(flights, '08.2026', async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); return 7; }), router.singleFlight(flights, '08.2026', async () => 8)]);
  assert.deepEqual([a, b], [7, 7]); assert.equal(calls, 1); assert.equal(flights.size, 0);
  let network = 0;
  const expired = await employeeCost.fetchRawEmployeeCost('DN006', { from: '2026-08', to: '2026-08', baseUrl: 'http://hub', assignmentKey: 'assignment-key-1234', employeeCostKeys: 'DN006=employee-cost-key-1234', deadlineAt: Date.now() - 1, fetchImpl: async () => { network += 1; } });
  assert.equal(expired.outcome, 'upstream_unavailable'); assert.equal(network, 0);
  let sleeps = 0;
  const noRetryPastDeadline = await employeeCost.fetchRawEmployeeCost('DN006', {
    from: '2026-08', to: '2026-08', baseUrl: 'http://hub', assignmentKey: 'assignment-key-1234',
    employeeCostKeys: 'DN006=employee-cost-key-1234', deadlineAt: Date.now() + 50, backoffMs: [100],
    fetchImpl: async () => { network += 1; return { ok: false, status: 502, json: async () => ({}) }; },
    sleepImpl: async () => { sleeps += 1; },
  });
  assert.notEqual(noRetryPastDeadline.outcome, 'ok'); assert.equal(noRetryPastDeadline.attempts, 1);
  assert.equal(network, 1); assert.equal(sleeps, 0);
});

test('duplicate user-path background refresh is single-flight and stale remains explicitly stale', async () => {
  const memory = {};
  const store = { load: (name, fallback) => memory[name] ?? fallback, save: (name, value) => { memory[name] = value; } };
  const creds = { from: '2026-08', to: '2026-08', baseUrl: 'http://hub', assignmentKey: 'assignment-key-1234', employeeCostKeys: 'DN006=employee-cost-key-1234', rateSnapshotStore: store };
  await employeeCost.fetchEmployeeCost('DN006', { ...creds, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ empCode: 'DN006', from: '2026-08', to: '2026-08', columns, rows: rateRows }) }) });
  let calls = 0; let release;
  const pending = new Promise((r) => { release = r; });
  const fetchImpl = async (_url, { signal }) => { calls += 1; if (calls <= 2) return { ok: false, status: 503, json: async () => ({}) }; await Promise.race([pending, new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' }))))]); return { ok: false, status: 503, json: async () => ({}) }; };
  const [one, two] = await Promise.all([employeeCost.fetchEmployeeCost('DN006', { ...creds, fetchImpl }), employeeCost.fetchEmployeeCost('DN006', { ...creds, fetchImpl })]);
  assert.equal(one.outcome, 'ok_stale_rates'); assert.equal(two.outcome, 'ok_stale_rates');
  assert.equal(employeeCost.backgroundRefreshInFlight.size, 1, 'one shared background refresh only');
  release(); await Promise.all([...employeeCost.backgroundRefreshInFlight.values()]);
  assert.equal(employeeCost.backgroundRefreshInFlight.size, 0);
});

test('full generation stays stable across probe snapshot writes; stale SWR owner cannot overwrite atomic replacement', () => {
  const signatureBefore = storeModule.employeeCostDataSignature();
  const snapshotStore = memoryStore();
  employeeCost.rateSnapshot.remember('DN006', fresh().payload, { store: snapshotStore });
  assert.equal(storeModule.employeeCostDataSignature(), signatureBefore,
    'probe-local rate snapshot is deliberately outside report source generation');

  const key = 'employee-cost-all:view:test:ADMIN_ALL:{"from":"2026-08","to":"2026-08"}';
  router.memoReplaceResolved([{ key, value: 'stale', ttlMs: 1 }]);
  const staleOwner = router.memoPeek(key);
  router.memoReplaceResolved([{ key, value: 'healthy', ttlMs: 1000 }]);
  assert.equal(router.memoPublishIfOwner(key, staleOwner, { t: Date.now(), v: 'late-swr', ttl: 1 }), false);
  assert.equal(router.memoPeek(key).v, 'healthy');

  const routes = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
  assert.match(routes, /buildDataSignature\s*=\s*store\.employeeCostDataSignature\(\)/);
  assert.match(routes, /sourceDataSignature\s*=\s*sourceGeneration\.value/);
  assert.doesNotMatch(routes.slice(routes.indexOf('async function warmEmployeeCostAllCache'), routes.indexOf('function scheduleEmployeeCostAllWarm')), /sourceDataSignature\s*=\s*store\.activeDataSignature/);
  assert.match(routes, /remove: \(key\) => employeeCostAllKeyMatchesRange\(key, range\)/);
  assert.match(routes, /đổi generation trước publish/);
});
