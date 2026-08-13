'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEmployeeCostSnapshotStore } = require('../src/employeeCostSnapshotStore');
const { createEmployeeCostSnapshotSync } = require('../src/employeeCostSnapshotSync');

function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emp-cost-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createEmployeeCostSnapshotStore({ root });
  let roster = options.roster || ['DN001', 'DN002'];
  let fetches = 0; let builds = 0;
  const sync = createEmployeeCostSnapshotSync({
    store, concurrency: options.concurrency || 2, requestMinIntervalMs: 0,
    rosterProvider: async () => roster,
    fetchEmployee: options.fetchEmployee || (async (empCode) => { fetches += 1; return { report: { empCode, amount: empCode === 'DN001' ? 1 : 2 }, fetchedAt: `2026-08-13T01:00:0${fetches}.000Z` }; }),
    buildModel: options.buildModel || (async ({ employees, unavailableReasons }) => { builds += 1; return { allEmployees: true, amounts: [...employees.values()].map((entry) => entry.report.amount), unavailableReasons }; }),
    dependencyIdentity: options.dependencyIdentity || (async () => ({ formula: 'v1', data: 'd1' })),
    isLocked: options.isLocked || (() => false),
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

test('closed period refuses an incomplete refresh instead of freezing LKG', async (t) => {
  let fail = false;
  const ctx = setup(t, {
    isLocked: () => true,
    fetchEmployee: async (empCode) => fail && empCode === 'DN001'
      ? { ok: false, sourceOutcome: 'deadline' }
      : { report: { empCode }, fetchedAt: '2026-08-13T01:00:00.000Z' },
  });
  await ctx.sync.dongBoKy('2026-07');
  // Use another closed period without a prior publication to exercise the fresh
  // full-roster gate; a partial run must leave CURRENT absent.
  fail = true;
  await assert.rejects(ctx.sync.dongBoKy('2026-06'), { code: 'EMPLOYEE_COST_SNAPSHOT_CLOSED_INCOMPLETE' });
  assert.equal(ctx.store.tryReadCurrent('2026-06').ok, false);
});

test('locked complete generation rejects sync before any source fetch', async (t) => {
  let calls = 0;
  const ctx = setup(t, { isLocked: () => true, fetchEmployee: async (empCode) => { calls += 1; return { report: { empCode } }; } });
  await ctx.sync.dongBoKy('2026-07');
  await assert.rejects(ctx.sync.dongBoKy('2026-07'), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
  assert.equal(calls, 2);
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
