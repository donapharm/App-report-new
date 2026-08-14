'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSnapshotWatcher, createCeoOutbox, evaluateProbe, digest, CEO_TELEGRAM_ID } = require('../src/employeeCostSnapshotWatcher');

const roster = Array.from({ length: 21 }, (_, index) => `DN${String(index + 1).padStart(3, '0')}`);
const deps = { period: '2026-08', data: 'd1', rates: 'r1', formula: 'f1' };
function good(code, generation = 'source-1') { return { empCode: code, ok: true, sourceOutcome: 'ok', sourceRange: { from: '2026-08', to: '2026-08' }, sourceGeneration: generation, fetchedAt: '2026-08-14T01:00:00.000Z' }; }
function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function watcher(t, overrides = {}) {
  const root = temp(t); let syncs = 0; let cleanups = 0; let synced = false;
  const watcherSuccessKey = digest({ period: '2026-08', sourceGeneration: 'source-1', dependencyDigest: digest(deps) });
  const manifest = { generationId: 'a'.repeat(64), roster, dependencyIdentity: digest(deps), watcherSuccessKey, sourceGeneration: 'source-1', model: { checksum: 'b'.repeat(64) } };
  const value = createSnapshotWatcher({
    period: '2026-08', statusFile: path.join(root, 'status.json'), stateFile: path.join(root, 'state.json'),
    rosterProvider: async () => roster, probeEmployee: async (code) => good(code), dependencyIdentity: async () => deps,
    readActiveJobs: async () => [], mode: 'probe',
    syncOnce: async () => { syncs += 1; synced = true; return { manifest }; },
    readCurrent: async () => { if (!synced) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { complete: true, manifest }; },
    capturePublicationState: async () => ({ prior: true }), cleanupFailedTarget: async () => { cleanups += 1; },
    ...overrides,
  });
  return { value, root, counts: () => ({ syncs, cleanups }) };
}

test('probe evaluation rejects 20/21, stale, mixed generation, and records exact sanitized observations', () => {
  const partial = evaluateProbe({ period: '2026-08', roster, results: roster.slice(0, 20).map((code) => good(code)), dependencyStart: deps, dependencyEnd: deps });
  assert.equal(partial.ready, false); assert.deepEqual(partial.unavailableEmployees, ['DN021']);
  const staleRows = roster.map(good); staleRows[20] = { ...staleRows[20], sourceOutcome: 'ok_stale_rates', sourceRange: { from: '2026-07', to: '2026-07' }, fetchedAt: '2026-08-14T01:06:53.654Z' };
  const stale = evaluateProbe({ period: '2026-08', roster, results: staleRows, dependencyStart: deps, dependencyEnd: deps });
  assert.equal(stale.ready, false); assert.equal(stale.unavailableReasons.DN021, 'stale_rates');
  assert.deepEqual(stale.observations.DN021, { reason: 'stale_rates', effectiveFrom: '2026-07', effectiveTo: '2026-07', sourceEffectiveAt: '2026-08-14T01:06:53.654Z' });
  const mixed = roster.map((code, index) => good(code, index === 20 ? 'source-2' : 'source-1'));
  const mixedProbe = evaluateProbe({ period: '2026-08', roster, results: mixed, dependencyStart: deps, dependencyEnd: deps });
  assert.equal(mixedProbe.ready, false);
  assert.deepEqual(mixedProbe.generationMismatches, { DN021: 'source-2' });
  assert.equal(mixedProbe.unavailableReasons.DN021, 'source_generation_mismatch');
  const missingGeneration = roster.map(good); delete missingGeneration[20].sourceGeneration;
  const missingProbe = evaluateProbe({ period: '2026-08', roster, results: missingGeneration, dependencyStart: deps, dependencyEnd: deps });
  assert.equal(missingProbe.ready, false);
  assert.equal(missingProbe.unavailableReasons.DN021, 'source_generation_missing');
  const blankGeneration = roster.map(good); blankGeneration[20].sourceGeneration = '   ';
  assert.equal(evaluateProbe({ period: '2026-08', roster, results: blankGeneration, dependencyStart: deps, dependencyEnd: deps }).unavailableReasons.DN021, 'source_generation_missing');
});

test('active snapshot/cron/warm context refuses before source probe or sync', async (t) => {
  let probes = 0;
  const ctx = watcher(t, { readActiveJobs: async () => ['snapshot-cron', 'warm'], probeEmployee: async () => { probes += 1; return {}; }, mode: 'sync' });
  const result = await ctx.value.run();
  assert.equal(result.code, 'WATCHER_OVERLAP_REFUSED'); assert.equal(probes, 0); assert.equal(ctx.counts().syncs, 0);
});

test('20/21 and stale source fail closed without publish or serve change', async (t) => {
  const ctx = watcher(t, { mode: 'sync', probeEmployee: async (code) => code === 'DN021' ? { ...good(code), sourceOutcome: 'ok_stale_rates' } : good(code) });
  const result = await ctx.value.run();
  assert.equal(result.state, 'waiting'); assert.equal(result.serveChanged, false); assert.deepEqual(result.probe.unavailableEmployees, ['DN021']); assert.equal(ctx.counts().syncs, 0);
});

test('dependency drift fails same-generation gate without sync', async (t) => {
  let calls = 0;
  const ctx = watcher(t, { mode: 'sync', dependencyIdentity: async () => ({ ...deps, data: calls++ ? 'd2' : 'd1' }) });
  const result = await ctx.value.run(); assert.equal(result.probe.dependencyStable, false); assert.equal(ctx.counts().syncs, 0);
});

test('ready generation syncs exactly once, verifies generation+digest, and repeats idempotently', async (t) => {
  const ctx = watcher(t, { mode: 'sync' });
  const first = await ctx.value.run(); const second = await ctx.value.run();
  assert.equal(first.state, 'ready'); assert.equal(first.idempotent, false); assert.equal(second.idempotent, true); assert.equal(ctx.counts().syncs, 1);
  assert.match(first.generationId, /^[a-f0-9]{64}$/); assert.match(first.manifestDigest, /^[a-f0-9]{64}$/);
});

test('sync error before publication remains no-serve and never restores/deletes another generation', async (t) => {
  let cleanups = 0;
  const ctx = watcher(t, {
    mode: 'sync',
    syncOnce: async () => { throw Object.assign(new Error('partial'), { code: 'EMPLOYEE_COST_SNAPSHOT_INCOMPLETE' }); },
    cleanupFailedTarget: async () => { cleanups += 1; },
  });
  const result = await ctx.value.run();
  assert.equal(result.state, 'waiting'); assert.equal(result.serveChanged, false); assert.equal(cleanups, 0);
});

test('existing complete publication recovers idempotency after crash without a second sync', async (t) => {
  const watcherSuccessKey = digest({ period: '2026-08', sourceGeneration: 'source-1', dependencyDigest: digest(deps) });
  const manifest = { generationId: 'c'.repeat(64), roster, dependencyIdentity: digest(deps), watcherSuccessKey, sourceGeneration: 'source-1', model: { checksum: 'd'.repeat(64) } };
  const ctx = watcher(t, { mode: 'sync', readCurrent: async () => ({ complete: true, manifest }) });
  const result = await ctx.value.run();
  assert.equal(result.idempotent, true); assert.equal(result.recoveredFromPublication, true); assert.equal(ctx.counts().syncs, 0);
});

test('post-publish mismatch restores captured publication state and remains no-serve waiting', async (t) => {
  let restored = null;
  const ctx = watcher(t, { mode: 'sync', readCurrent: async () => ({ complete: false, manifest: {} }), cleanupFailedTarget: async (period, state) => { restored = { period, state }; } });
  const result = await ctx.value.run();
  assert.equal(result.code, 'WATCHER_SYNC_FAILED'); assert.equal(result.serveChanged, false); assert.deepEqual(restored, { period: '2026-08', state: { prior: true } });
});

test('published-but-unnotified state is recovered after restart without duplicate outbox event', async (t) => {
  const root = temp(t);
  const stateFile = path.join(root, 'state.json');
  const outboxRoot = path.join(root, 'outbox');
  const outbox = createCeoOutbox({ root: outboxRoot, enabled: true, now: () => new Date('2026-08-14T01:00:00.000Z') });
  const watcherSuccessKey = digest({ period: '2026-08', sourceGeneration: 'source-1', dependencyDigest: digest(deps) });
  const manifest = { generationId: 'e'.repeat(64), roster, dependencyIdentity: digest(deps), watcherSuccessKey, sourceGeneration: 'source-1', model: { checksum: 'f'.repeat(64) } };
  let synced = false;
  const common = {
    period: '2026-08', stateFile, statusFile: path.join(root, 'status.json'), mode: 'sync',
    rosterProvider: async () => roster, probeEmployee: async (code) => good(code), dependencyIdentity: async () => deps,
    readActiveJobs: async () => [], outbox,
    syncOnce: async () => { synced = true; return { manifest }; },
    readCurrent: async () => { if (!synced) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { complete: true, manifest }; },
  };
  const first = await createSnapshotWatcher({ ...common, afterNotificationEnqueue: () => { throw new Error('simulated crash'); } }).run();
  assert.equal(first.notificationState, 'pending');
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).notificationState, 'pending');
  assert.equal(fs.readdirSync(outboxRoot).filter((name) => /^\d.*\.json$/.test(name)).length, 1);
  const second = await createSnapshotWatcher(common).run();
  assert.equal(second.notificationState, 'pending');
  assert.equal(second.idempotent, true);
  assert.equal(fs.readdirSync(outboxRoot).filter((name) => /^\d.*\.json$/.test(name)).length, 1);
  const restarted = createSnapshotWatcher(common);
  assert.equal(restarted.markNotified(watcherSuccessKey).marked, true);
  const third = await restarted.run();
  assert.equal(third.notificationState, 'notified');
  assert.equal(fs.readdirSync(outboxRoot).filter((name) => /^\d.*\.json$/.test(name)).length, 1);
});

test('CEO outbox is restricted, reports stale employee time and deduplicates unchanged status', (t) => {
  const root = temp(t);
  assert.deepEqual(createCeoOutbox({ root, enabled: false }).enqueue({ state: 'ready' }), { queued: false, reason: 'disabled' });
  assert.deepEqual(createCeoOutbox({ root, enabled: true, recipient: '123' }).enqueue({ state: 'ready' }), { queued: false, reason: 'recipient_refused' });
  const outbox = createCeoOutbox({ root, enabled: true, recipient: CEO_TELEGRAM_ID, now: () => new Date('2026-08-14T01:00:00.000Z') });
  const event = {
    type: 'snapshot_waiting', state: 'waiting', period: '2026-08', code: 'WATCHER_SOURCE_NOT_READY',
    probe: {
      unavailableEmployees: ['dn021'], unavailableReasons: { DN021: 'stale_rates' },
      observations: { DN021: { effectiveFrom: '2026-08', effectiveTo: '2026-08', sourceEffectiveAt: '2026-08-13T17:12:33.680Z' } },
    },
  };
  const queued = outbox.enqueue(event);
  assert.equal(queued.queued, true); const payload = JSON.parse(fs.readFileSync(path.join(root, queued.file)));
  assert.equal(payload.recipient, CEO_TELEGRAM_ID); assert.deepEqual(payload.unavailableEmployees, ['DN021']);
  assert.deepEqual(payload.staleSources, [{ empCode: 'DN021', effectiveFrom: '2026-08', effectiveTo: '2026-08', sourceEffectiveAt: '2026-08-13T17:12:33.680Z' }]);
  assert.match(payload.text, /DN021: bản tỷ lệ lưu .*14\/08\/2026/);
  assert.deepEqual(outbox.enqueue(event), { queued: false, reason: 'duplicate' });
  const ready = outbox.enqueue({ type: 'snapshot_ready', state: 'ready', period: '2026-08', generationId: 'a'.repeat(64), manifestDigest: 'b'.repeat(64) });
  assert.equal(ready.queued, true);
  assert.equal(fs.existsSync(path.join(root, 'superseded', queued.file)), true);
  assert.equal(fs.existsSync(path.join(root, queued.file)), false);
  assert.doesNotMatch(JSON.stringify(payload), /token|secret|amount/i);
});
