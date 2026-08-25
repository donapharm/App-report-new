'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEmployeeCostSnapshotStore } = require('../src/employeeCostSnapshotStore');
const { createEmployeeCostSnapshotSync } = require('../src/employeeCostSnapshotSync');

function sealedModel(period = '2026-07', roster = ['DN001', 'DN002']) {
  return {
    allEmployees: true, from: period, to: period,
    employees: roster.map((empCode) => ({ empCode, employeeName: empCode })),
    remoteProvenance: [`${period}:CT01:rv=3:rc=${'a'.repeat(64)}:ca=2026-08-01T00:00:00.000Z`
      + `:sc=${'b'.repeat(64)}:iv=3:ic=${'b'.repeat(64)}:av=4:ac=${'c'.repeat(64)}`],
    revenueRecon: { total: 3, shown: 3, gap: 0, balanced: true },
    periods: [{
      period, columns: [], rows: [],
      match: { totalRows: 0, unavailableEmployeeCount: 0, unavailableEmployees: [], staleEmployeeCount: 0, staleEmployees: [] },
    }],
  };
}

function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emp-cost-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createEmployeeCostSnapshotStore({ root });
  let roster = options.roster || ['DN001', 'DN002'];
  let fetches = 0; let builds = 0;
  const sync = createEmployeeCostSnapshotSync({
    store, concurrency: options.concurrency || 2, requestMinIntervalMs: 0,
    rosterProvider: options.rosterProvider || (async () => roster),
    fetchEmployee: options.fetchEmployee || (async (empCode) => { fetches += 1; return { report: { empCode, amount: empCode === 'DN001' ? 1 : 2 }, fetchedAt: `2026-08-13T01:00:0${fetches}.000Z` }; }),
    buildModel: options.buildModel || (async ({ employees, unavailableReasons }) => { builds += 1; return { allEmployees: true, amounts: [...employees.values()].map((entry) => entry.report.amount), unavailableReasons }; }),
    dependencyIdentity: options.dependencyIdentity || (async () => ({ formula: 'v1', data: 'd1' })),
    isLocked: options.isLocked || (() => false),
    lockedSnapshotProvider: options.lockedSnapshotProvider,
    now: (() => { let second = 0; return () => new Date(`2026-08-13T02:00:${String(second++).padStart(2, '0')}.000Z`); })(),
  });
  return { store, sync, setRoster(value) { roster = value; }, counts: () => ({ fetches, builds }) };
}

test('sync uses bounded concurrency and publishes roster/dependency identity', async (t) => {
  let active = 0; let peak = 0;
  const ctx = setup(t, {
    roster: ['DN001', 'DN002', 'DN003', 'DN004'], concurrency: 2,
    fetchEmployee: async (empCode) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1; return { report: { empCode }, fetchedAt: '2026-08-13T01:00:00.000Z' }; },
  });
  const result = await ctx.sync.dongBoKy('2026-07');
  assert.equal(peak, 2);
  assert.equal(result.complete, true);
  assert.equal(result.manifest.roster.length, 4);
  assert.equal(result.manifest.dependencies.formula, 'v1');
  assert.match(result.manifest.dependencyIdentity, /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.source, 'network');
});

test('corrupt current generation fails closed instead of rebuilding over it', async (t) => {
  const ctx = setup(t);
  const period = '2026-07';
  await ctx.sync.dongBoKy(period);
  const currentFile = ctx.store._test.currentFile(period);
  const current = JSON.parse(fs.readFileSync(currentFile, 'utf8')).payload;
  const manifestFile = path.join(ctx.store._test.periodDir(period), 'generations', current.generationId, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.checksum = '0'.repeat(64);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  await assert.rejects(ctx.sync.dongBoKy(period), /checksum|snapshot/i);
  assert.equal(ctx.store.tryReadCurrent(period).ok, false);
});

test('source outage preserves every previous good employee and canonical model byte-for-byte', async (t) => {
  let outage = false;
  const ctx = setup(t, { fetchEmployee: async (empCode) => {
    if (outage) throw Object.assign(new Error('down'), { code: 'UPSTREAM_TIMEOUT' });
    return { report: { empCode, amount: empCode === 'DN001' ? 11 : 22 }, fetchedAt: '2026-08-13T01:00:00.000Z' };
  } });
  const first = await ctx.sync.dongBoKy('2026-07');
  outage = true;
  const second = await ctx.sync.dongBoKy('2026-07');
  assert.deepEqual(second.model, first.model);
  assert.equal(second.employees.get('DN001').report.amount, 11);
  assert.equal(second.employees.get('DN002').report.amount, 22);
  assert.equal(second.complete, true);
  assert.deepEqual(second.manifest.refreshUnavailableReasons, { DN001: 'deadline', DN002: 'deadline' });
});

test('4xx upstream rejection is allowlisted distinctly while 5xx/network stay unavailable', () => {
  const { sourceFailureReason, usableResult } = require('../src/employeeCostSnapshotSync');
  for (const outcome of ['upstream_rejected', 'upstream_400', 'upstream_401', 'upstream_409', 'upstream_499']) {
    assert.equal(sourceFailureReason(null, { sourceOutcome: outcome }), 'upstream_rejected');
    assert.equal(usableResult({ sourceOutcome: outcome }), false);
  }
  assert.equal(sourceFailureReason(null, { sourceOutcome: 'upstream_busy' }), 'upstream_busy');
  for (const outcome of ['upstream_500', 'upstream_502', 'upstream_503', 'upstream_unavailable']) {
    assert.equal(sourceFailureReason(null, { sourceOutcome: outcome }), 'upstream_unavailable');
    assert.equal(usableResult({ sourceOutcome: outcome }), false);
  }
  assert.equal(sourceFailureReason(Object.assign(new Error('secret payload'), { code: 'ECONNRESET' })), 'upstream_unavailable');
});

test('a failed employee never overwrites its LKG while a successful peer advances', async (t) => {
  let round = 0;
  const ctx = setup(t, { fetchEmployee: async (empCode) => {
    if (round && empCode === 'DN001') return { ok: false, sourceOutcome: 'deadline' };
    return { report: { empCode, amount: round ? 20 : empCode === 'DN001' ? 1 : 2 }, fetchedAt: round ? '2026-08-13T02:00:00.000Z' : '2026-08-13T01:00:00.000Z' };
  } });
  await ctx.sync.dongBoKy('2026-07'); round = 1;
  const result = await ctx.sync.dongBoKy('2026-07');
  assert.equal(result.employees.get('DN001').report.amount, 1);
  assert.equal(result.employees.get('DN002').report.amount, 20);
  assert.equal(result.complete, true);
});

test('concurrent cron/button calls are async single-flight', async (t) => {
  let calls = 0; let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const ctx = setup(t, { fetchEmployee: async (empCode) => { calls += 1; await blocker; return { report: { empCode }, fetchedAt: '2026-08-13T01:00:00.000Z' }; } });
  const one = ctx.sync.dongBoKy('2026-07', { reason: 'cron' });
  const two = ctx.sync.dongBoKy('2026-07', { reason: 'button' });
  assert.equal(one, two);
  release(); await Promise.all([one, two]);
  assert.equal(calls, 2);
});

test('roster change reuses old employees and fetches new roster member', async (t) => {
  const ctx = setup(t);
  await ctx.sync.dongBoKy('2026-07');
  ctx.setRoster(['DN001', 'DN002', 'DN003']);
  const before = ctx.store.readCurrent('2026-07', { roster: ['DN001', 'DN002', 'DN003'] });
  assert.equal(before.complete, false);
  assert.equal(before.unavailableReasons.DN003, 'roster_added');
  const result = await ctx.sync.dongBoKy('2026-07', { onlyCodes: ['DN003'] });
  assert.equal(result.complete, true);
  assert.equal(result.employees.size, 3);
});

test('locked period publishes directly from a valid seal with source=seal and zero network/build calls', async (t) => {
  let networkCalls = 0; let buildCalls = 0; let providerCalls = 0; let rosterCalls = 0;
  const expectedModel = sealedModel('2026-07');
  const ctx = setup(t, {
    isLocked: () => true,
    rosterProvider: async () => { rosterCalls += 1; throw new Error('locked path must not load roster'); },
    fetchEmployee: async () => { networkCalls += 1; throw new Error('locked path must not fetch DataHub'); },
    buildModel: async () => { buildCalls += 1; throw new Error('locked path must not rebuild model'); },
    lockedSnapshotProvider: async (period) => {
      providerCalls += 1;
      return {
        model: expectedModel, roster: ['DN001', 'DN002'],
        dependencies: { sealKey: 'v2|2026-07|safe' },
        sealIdentity: 'a'.repeat(64), fetchedAt: '2026-08-13T01:00:00.000Z',
      };
    },
  });
  const result = await ctx.sync.dongBoKy('2026-07');
  assert.equal(result.complete, true);
  assert.equal(result.manifest.locked, true);
  assert.equal(result.manifest.source, 'seal');
  assert.equal(result.manifest.sealIdentity, 'a'.repeat(64));
  assert.equal(result.employees.size, 0, 'seal generation is model-only; it must not forge employee blobs');
  assert.deepEqual(result.model, expectedModel);
  assert.deepEqual({ networkCalls, buildCalls, providerCalls, rosterCalls }, { networkCalls: 0, buildCalls: 0, providerCalls: 1, rosterCalls: 0 });
});

test('locked period with no seal fails closed as locked and makes zero network calls', async (t) => {
  let networkCalls = 0;
  const ctx = setup(t, {
    isLocked: () => true,
    fetchEmployee: async () => { networkCalls += 1; throw new Error('must not call network'); },
    lockedSnapshotProvider: async () => null,
  });
  await assert.rejects(ctx.sync.dongBoKy('2026-07'), { code: 'EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_MISSING' });
  assert.equal(networkCalls, 0);
  assert.equal(ctx.store.tryReadCurrent('2026-07').ok, false);
  const status = ctx.store.readStatus('2026-07');
  assert.equal(status.state, 'locked');
  assert.equal(status.locked, true);
  assert.equal(status.complete, false);
  assert.deepEqual(status.unavailableReasons, { SNAPSHOT: 'locked' });
  assert.equal(status.errorCode, 'EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_MISSING');
});

test('locked period with invalid provenance fails closed and never falls back to network', async (t) => {
  let networkCalls = 0;
  const invalid = Object.assign(new Error('private upstream detail'), { code: 'EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_INVALID', snapshotReason: 'locked' });
  const ctx = setup(t, {
    isLocked: () => true,
    fetchEmployee: async () => { networkCalls += 1; throw new Error('must not call network'); },
    lockedSnapshotProvider: async () => { throw invalid; },
  });
  await assert.rejects(ctx.sync.dongBoKy('2026-07'), { code: 'EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_INVALID' });
  assert.equal(networkCalls, 0);
  assert.equal(ctx.store.readStatus('2026-07').state, 'locked');
  assert.equal(ctx.store.readStatus('2026-07').unavailableReasons.SNAPSHOT, 'locked');
  assert.doesNotMatch(JSON.stringify(ctx.store.readStatus('2026-07')), /private|upstream detail/);
});

test('period becoming locked after fan-out never builds/publishes network data', async (t) => {
  let lockChecks = 0; let networkCalls = 0; let buildCalls = 0;
  const ctx = setup(t, {
    isLocked: () => { lockChecks += 1; return lockChecks >= 4; },
    fetchEmployee: async (empCode) => { networkCalls += 1; return { report: { empCode } }; },
    buildModel: async () => { buildCalls += 1; throw new Error('must not build after close'); },
  });
  await assert.rejects(ctx.sync.dongBoKy('2026-07'), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_STATE_DRIFT' });
  assert.equal(networkCalls, 2);
  assert.equal(buildCalls, 0);
  assert.equal(ctx.store.tryReadCurrent('2026-07').ok, false);
  assert.equal(ctx.store.readStatus('2026-07').state, 'locked');
});

test('period becoming locked while roster awaits switches to seal before employee fan-out', async (t) => {
  let locked = false; let networkCalls = 0; let providerCalls = 0;
  const ctx = setup(t, {
    isLocked: () => locked,
    rosterProvider: async () => { locked = true; return ['DN001', 'DN002']; },
    fetchEmployee: async () => { networkCalls += 1; throw new Error('must not call network'); },
    lockedSnapshotProvider: async (period) => {
      providerCalls += 1;
      return { model: sealedModel(period), roster: ['DN001', 'DN002'], dependencies: {}, sealIdentity: 'b'.repeat(64) };
    },
  });
  const result = await ctx.sync.dongBoKy('2026-07');
  assert.equal(result.manifest.source, 'seal');
  assert.deepEqual({ networkCalls, providerCalls }, { networkCalls: 0, providerCalls: 1 });
});

test('locked complete generation rejects sync before any source fetch', async (t) => {
  let calls = 0; let providerCalls = 0;
  const ctx = setup(t, {
    isLocked: () => true,
    fetchEmployee: async () => { calls += 1; throw new Error('must not call network'); },
    lockedSnapshotProvider: async (period) => {
      providerCalls += 1;
      return { model: sealedModel(period), roster: ['DN001', 'DN002'], dependencies: {}, sealIdentity: 'c'.repeat(64) };
    },
  });
  await ctx.sync.dongBoKy('2026-07');
  await assert.rejects(ctx.sync.dongBoKy('2026-07'), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
  assert.equal(calls, 0);
  assert.equal(providerCalls, 1);
});


test('sync never replaces employee LKG with an older source tuple', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emp-cost-sync-monotonic-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const store = createEmployeeCostSnapshotStore({ root, now: () => new Date('2026-08-13T01:00:00.000Z') });
  let fetchedAt = '2026-08-13T02:00:00.000Z';
  const sync = createEmployeeCostSnapshotSync({ store, rosterProvider: () => [{ emp_code: 'DN001' }],
    fetchEmployee: async () => ({ report: { amount: fetchedAt.includes('02:') ? 20 : 10 }, fetchedAt, sourceRevision: 'same' }),
    dependencyIdentity: async () => ({ revision: 'stable' }), buildModel: async ({ employees }) => ({ amount: employees.get('DN001').report.amount }) });
  await sync.dongBoKy('2026-07');
  fetchedAt = '2026-08-13T01:00:00.000Z';
  await sync.dongBoKy('2026-07');
  const snapshot = store.readCurrent('2026-07');
  assert.equal(snapshot.employees.get('DN001').report.amount, 20);
  assert.equal(snapshot.model.amount, 20);
});

test('requestSync returns 202-friendly state immediately and status contains no report/money/key payload', async (t) => {
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const ctx = setup(t, { fetchEmployee: async (empCode) => { await blocker; return { report: { empCode, secretKey: 'must-not-leak', amount: 999 } }; } });
  const accepted = ctx.sync.requestSync('2026-07', { reason: 'manual' });
  assert.equal(accepted.accepted, true);
  const statusText = JSON.stringify(ctx.sync.trangThaiDongBo('2026-07', ['DN001', 'DN002']));
  assert.doesNotMatch(statusText, /secretKey|999|amount/);
  release(); await ctx.sync.inFlight.get('2026-07');
});

test('ok_stale_rates is not a usable snapshot source', () => {
  const { usableResult, sourceFailureReason } = require('../src/employeeCostSnapshotSync');
  assert.equal(usableResult({ sourceOutcome: 'ok_stale_rates', report: {} }), false);
  assert.equal(sourceFailureReason(null, { sourceOutcome: 'ok_stale_rates' }), 'stale_rates');
});

test('requireComplete rejects stale/partial before any generation is published', async (t) => {
  const ctx = setup(t, {
    fetchEmployee: async (empCode) => empCode === 'DN002'
      ? { ok: false, sourceOutcome: 'ok_stale_rates' }
      : { report: { empCode }, sourceOutcome: 'ok', fetchedAt: '2026-08-14T00:00:00.000Z' },
  });
  await assert.rejects(ctx.sync.dongBoKy('2026-07', { requireComplete: true, concurrency: 1 }), {
    code: 'EMPLOYEE_COST_SNAPSHOT_INCOMPLETE',
  });
  assert.equal(ctx.store.tryReadCurrent('2026-07').ok, false);
  assert.equal(ctx.store.readStatus('2026-07').state, 'failed');
});

test('expected dependency generation is checked before fan-out', async (t) => {
  let fetches = 0;
  const ctx = setup(t, {
    fetchEmployee: async () => { fetches += 1; return { report: {} }; },
    dependencyIdentity: async () => ({ revision: 'actual' }),
  });
  await assert.rejects(ctx.sync.dongBoKy('2026-07', {
    requireComplete: true,
    expectedDependencies: { revision: 'probe' },
  }), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
  assert.equal(fetches, 0);
  assert.equal(ctx.store.tryReadCurrent('2026-07').ok, false);
});

test('requireComplete rejects stale 5/21 before model/pointer publication and preserves exact reasons', async (t) => {
  const stale = new Set(['DN021', 'DN022', 'DN023', 'DN024', 'VP004']);
  const roster21 = [...Array.from({ length: 16 }, (_, index) => `DN${String(index + 1).padStart(3, '0')}`), ...stale];
  let builds = 0;
  const ctx = setup(t, {
    roster: roster21,
    fetchEmployee: async (empCode) => stale.has(empCode)
      ? { ok: true, sourceOutcome: 'ok_stale_rates', fetchedAt: '2026-08-14T01:06:53.654Z' }
      : { ok: true, sourceOutcome: 'ok', report: { empCode }, fetchedAt: '2026-08-14T01:06:53.654Z' },
    buildModel: async () => { builds += 1; return {}; },
  });
  await assert.rejects(ctx.sync.dongBoKy('2026-08', { requireComplete: true, concurrency: 1 }), (error) => {
    assert.equal(error.code, 'EMPLOYEE_COST_SNAPSHOT_INCOMPLETE');
    assert.deepEqual(error.unavailableEmployees, [...stale]);
    assert.deepEqual(error.unavailableReasons, Object.fromEntries([...stale].map((code) => [code, 'stale_rates'])));
    return true;
  });
  assert.equal(builds, 0); assert.equal(ctx.store.tryReadCurrent('2026-08').ok, false);
});

test('expected dependency generation drift refuses before employee fetch', async (t) => {
  let fetches = 0;
  const ctx = setup(t, { fetchEmployee: async () => { fetches += 1; return {}; } });
  await assert.rejects(ctx.sync.dongBoKy('2026-08', { requireComplete: true, expectedDependencies: { formula: 'other' } }), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
  assert.equal(fetches, 0); assert.equal(ctx.store.tryReadCurrent('2026-08').ok, false);
});

function closedRepairSetup(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emp-cost-closed-repair-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createEmployeeCostSnapshotStore({ root });
  const roster = ['DN001', 'DN002'];
  const partial = store.publishGeneration('2026-07', {
    roster, employees: new Map([['DN001', { report: { empCode: 'DN001', amount: 1 } }]]),
    model: { incomplete: true }, dependencies: { revision: 'v1' }, periodLocked: false, locked: false,
  });
  let dependencyCalls = 0;
  const sync = createEmployeeCostSnapshotSync({
    store, concurrency: 1, rosterProvider: async () => roster, isLocked: () => true,
    fetchEmployee: overrides.fetchEmployee || (async (empCode) => ({ sourceOutcome: 'ok', report: { empCode, amount: 10 } })),
    dependencyIdentity: overrides.dependencyIdentity || (async () => { dependencyCalls += 1; return { revision: 'v1' }; }),
    buildModel: overrides.buildModel || (async () => sealedModel('2026-07', roster)),
    validateClosedRepair: overrides.validateClosedRepair || (async ({ model }) => assert.equal(model.revenueRecon.balanced, true)),
    auditClosedRepair: overrides.auditClosedRepair || (() => {}),
  });
  return { store, sync, roster, partial, dependencyCalls: () => dependencyCalls };
}

test('closed repair missing one employee rejects and preserves exact current pointer', async (t) => {
  const audits = [];
  const ctx = closedRepairSetup(t, {
    fetchEmployee: async (empCode) => empCode === 'DN002' ? { ok: false, sourceOutcome: 'deadline' } : { sourceOutcome: 'ok', report: { empCode } },
    auditClosedRepair: (entry) => audits.push(entry),
  });
  const before = ctx.store.readCurrent('2026-07').pointer;
  await assert.rejects(ctx.sync.rebuildIncompleteClosedGeneration('2026-07', { actor: 'CEO' }), { code: 'EMPLOYEE_COST_SNAPSHOT_INCOMPLETE' });
  assert.deepEqual(ctx.store.readCurrent('2026-07').pointer, before);
  assert.deepEqual(audits[0].missing, ['DN002']);
});

test('closed repair dependency drift rejects and preserves old generation', async (t) => {
  let revision = 0;
  const ctx = closedRepairSetup(t, { dependencyIdentity: async () => ({ revision: ++revision }) });
  const before = ctx.store.readCurrent('2026-07').pointer;
  await assert.rejects(ctx.sync.rebuildIncompleteClosedGeneration('2026-07'), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
  assert.deepEqual(ctx.store.readCurrent('2026-07').pointer, before);
});

test('two simultaneous closed repair clicks publish exactly one complete generation', async (t) => {
  const audits = [];
  const ctx = closedRepairSetup(t, { auditClosedRepair: (entry) => audits.push(entry) });
  const results = await Promise.allSettled([
    ctx.sync.rebuildIncompleteClosedGeneration('2026-07', { actor: 'CEO' }),
    ctx.sync.rebuildIncompleteClosedGeneration('2026-07', { actor: 'CEO' }),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(ctx.store.readCurrent('2026-07').complete, true);
  assert.equal(audits.filter((item) => item.outcome === 'published').length, 1);
});

test('closed repair hard-denies T06 before any fetch', async (t) => {
  let fetches = 0;
  const ctx = closedRepairSetup(t, { fetchEmployee: async () => { fetches += 1; return {}; } });
  await assert.rejects(ctx.sync.rebuildIncompleteClosedGeneration('2026-06'), { code: 'EMPLOYEE_COST_SNAPSHOT_REPAIR_PERIOD_DENIED' });
  assert.equal(fetches, 0);
});

function closedInitialSetup(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emp-cost-closed-initial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createEmployeeCostSnapshotStore({ root });
  const roster = overrides.roster || ['DN001', 'DN002'];
  const sync = createEmployeeCostSnapshotSync({
    store, concurrency: 1, rosterProvider: async () => roster,
    isLocked: overrides.isLocked || (() => true),
    fetchEmployee: overrides.fetchEmployee || (async (empCode) => ({ sourceOutcome: 'ok', report: { empCode, amount: 10 } })),
    dependencyIdentity: overrides.dependencyIdentity || (async () => ({ revision: 'v1' })),
    buildModel: overrides.buildModel || (async () => sealedModel('2026-07', roster)),
    validateClosedRepair: overrides.validateClosedRepair || (async ({ model }) => assert.equal(model.revenueRecon.balanced, true)),
    auditClosedRepair: overrides.auditClosedRepair || (() => {}),
  });
  return { root, store, sync, roster };
}

test('closed T07 without current creates exactly one complete initial generation', async (t) => {
  const audits = [];
  const ctx = closedInitialSetup(t, { auditClosedRepair: (entry) => audits.push(entry) });
  const created = await ctx.sync.createInitialClosedGeneration('2026-07', { actor: 'CEO' });
  assert.equal(created.complete, true);
  assert.equal(created.employees.size, 2);
  assert.equal(created.manifest.locked, true);
  assert.equal(created.manifest.source, 'network');
  assert.equal(created.manifest.sealIdentity, '');
  assert.equal(audits.at(-1).outcome, 'initial_published');
  assert.equal(audits.at(-1).source, 'network');
  assert.match(audits.at(-1).checksum, /^[a-f0-9]{64}$/);
});

test('background initial validation failure preserves 21/21 evidence and privacy-safe cause', async (t) => {
  const audits = [];
  const roster = Array.from({ length: 21 }, (_, index) => `DN${String(index + 1).padStart(3, '0')}`);
  const ctx = closedInitialSetup(t, {
    roster,
    auditClosedRepair: (entry) => audits.push(entry),
    buildModel: async () => sealedModel('2026-07', roster),
    validateClosedRepair: async () => {
      throw Object.assign(new Error('private payload must not persist'), {
        code: 'EMPLOYEE_COST_SNAPSHOT_MODEL_STALE_INVALID',
        statusEvidence: { rosterCount: 21, availableCount: 21 },
        validation: {
          identityValid: true, coverageValid: true, freshnessValid: false,
          reconciliationValid: true, provenancePresent: true, provenanceComplete: true,
          provenanceFailures: [{ scope: '2026-07:03.TUE.N', reason: 'upstream_not_found' }],
          unavailableEmployees: [], staleEmployees: ['DN021'], privatePayload: 'must-not-leak',
        },
      });
    },
  });
  ctx.sync.requestInitialClosedGeneration('2026-07', { actor: 'CEO' });
  await assert.rejects(ctx.sync.inFlight.get('2026-07'), { code: 'EMPLOYEE_COST_SNAPSHOT_MODEL_STALE_INVALID' });
  const status = ctx.store.readStatus('2026-07');
  assert.equal(status.state, 'failed');
  assert.equal(status.rosterCount, 21);
  assert.equal(status.availableCount, 21);
  assert.equal(status.errorCode, 'EMPLOYEE_COST_SNAPSHOT_MODEL_STALE_INVALID');
  assert.deepEqual(status.unavailableReasons, { DN021: 'stale_rates' });
  assert.equal(audits.at(-1).outcome, 'initial_rejected_validation');
  assert.equal(audits.at(-1).validation.freshnessValid, false);
  assert.deepEqual(audits.at(-1).provenanceFailures, [
    { scope: '2026-07:03.TUE.N', reason: 'upstream_not_found' },
  ]);
  assert.doesNotMatch(JSON.stringify(audits.at(-1)), /private payload|must-not-leak|privatePayload/);
});

test('closed initial rejects when current already exists', async (t) => {
  const ctx = closedInitialSetup(t);
  await ctx.sync.createInitialClosedGeneration('2026-07');
  await assert.rejects(ctx.sync.createInitialClosedGeneration('2026-07'), { code: 'EMPLOYEE_COST_SNAPSHOT_INITIAL_ALREADY_EXISTS' });
});

test('two simultaneous initial-generation attempts publish exactly one current generation', async (t) => {
  const ctx = closedInitialSetup(t);
  const results = await Promise.allSettled([
    ctx.sync.createInitialClosedGeneration('2026-07', { actor: 'CEO' }),
    ctx.sync.createInitialClosedGeneration('2026-07', { actor: 'CEO' }),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(ctx.store.readCurrent('2026-07').complete, true);
});

test('closed initial with 20-of-21 rejects without current or generation files', async (t) => {
  const roster = Array.from({ length: 21 }, (_, index) => `DN${String(index + 1).padStart(3, '0')}`);
  const ctx = closedInitialSetup(t, {
    roster,
    fetchEmployee: async (empCode) => empCode === 'DN002' ? { ok: false, sourceOutcome: 'deadline' } : { sourceOutcome: 'ok', report: { empCode } },
  });
  await assert.rejects(ctx.sync.createInitialClosedGeneration('2026-07'), (error) => {
    assert.equal(error.code, 'EMPLOYEE_COST_SNAPSHOT_INCOMPLETE');
    assert.deepEqual(error.unavailableEmployees, ['DN002']);
    return true;
  });
  assert.equal(ctx.store.tryReadCurrent('2026-07').ok, false);
  const generations = path.join(ctx.root, '2026-07', 'generations');
  assert.equal(fs.existsSync(generations), false);
});

test('closed initial rejects an open period', async (t) => {
  const ctx = closedInitialSetup(t, { isLocked: () => false });
  await assert.rejects(ctx.sync.createInitialClosedGeneration('2026-07'), { code: 'EMPLOYEE_COST_SNAPSHOT_INITIAL_PERIOD_OPEN' });
  assert.equal(ctx.store.tryReadCurrent('2026-07').ok, false);
});

test('closed initial hard-denies T06 before fetch', async (t) => {
  let fetches = 0;
  const ctx = closedInitialSetup(t, { fetchEmployee: async () => { fetches += 1; return {}; } });
  await assert.rejects(ctx.sync.createInitialClosedGeneration('2026-06'), { code: 'EMPLOYEE_COST_SNAPSHOT_INITIAL_PERIOD_DENIED' });
  assert.equal(fetches, 0);
  assert.equal(ctx.store.tryReadCurrent('2026-06').ok, false);
});
