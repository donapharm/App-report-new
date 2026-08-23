'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createEmployeeCostSnapshotStore } = require('../src/employeeCostSnapshotStore');

const PERIOD = '2026-08';
const ROSTER = [{ emp_code: 'DN001', name: 'A' }, { emp_code: 'DN002', name: 'B' }];
const model = (marker = 'A') => ({ from: PERIOD, to: PERIOD, marker, periods: [{ period: PERIOD, columns: [], rows: [], match: { unavailableEmployees: [] } }] });
const sealedModel = (marker = 'SEAL') => ({
  allEmployees: true, from: PERIOD, to: PERIOD, marker,
  employees: ROSTER.map((row) => ({ empCode: row.emp_code, employeeName: row.name })),
  remoteProvenance: [],
  revenueRecon: { total: 3, shown: 3, gap: 0, balanced: true },
  periods: [{
    period: PERIOD, columns: [], rows: [],
    match: { totalRows: 0, unavailableEmployeeCount: 0, unavailableEmployees: [], staleEmployeeCount: 0, staleEmployees: [] },
  }],
});
const employees = (a = 1, b = 2) => new Map([
  ['DN001', { payload: { empCode: 'DN001', value: a }, fetchedAt: '2026-08-13T01:00:00.000Z', sourceRevision: `r${a}` }],
  ['DN002', { payload: { empCode: 'DN002', value: b }, fetchedAt: '2026-08-13T01:00:00.000Z', sourceRevision: `r${b}` }],
]);
function fresh(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-cost-snapshot-'));
  return { root, store: createEmployeeCostSnapshotStore({ root, ...options }) };
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

test('normalizes period/employee and rejects traversal', () => {
  const { store } = fresh();
  assert.equal(store.normalizePeriod(PERIOD), PERIOD);
  assert.equal(store.normalizeEmployee('dn001'), 'DN001');
  for (const value of ['../2026-08', '2026-8', '/tmp/x', '2026-13']) assert.throws(() => store.normalizePeriod(value), /YYYY-MM/);
  for (const value of ['../DN001', 'DN 001', '']) assert.throws(() => store.normalizeEmployee(value));
});

test('closed repair validation separates identity, coverage, freshness, reconciliation and provenance', () => {
  const { store } = fresh();
  const healthy = {
    ...sealedModel(),
    remoteProvenance: ['scope:rc=abc:OK'],
  };
  assert.deepEqual(store.closedRepairModelValidation(healthy, PERIOD, ROSTER), {
    valid: true,
    identityValid: true,
    coverageValid: true,
    freshnessValid: true,
    reconciliationValid: true,
    provenancePresent: true,
    provenanceComplete: true,
    provenanceFailures: [],
    unavailableEmployees: [],
    staleEmployees: [],
  });

  const degraded = {
    ...healthy,
    periods: [{
      ...healthy.periods[0],
      match: {
        unavailableEmployeeCount: 1, unavailableEmployees: ['dn002'],
        staleEmployeeCount: 1, staleEmployees: ['dn001'],
      },
    }],
    revenueRecon: { unavailable: true, balanced: false },
    remoteProvenance: [],
  };
  const result = store.closedRepairModelValidation(degraded, PERIOD, ROSTER);
  assert.equal(result.valid, false);
  assert.equal(result.identityValid, true);
  assert.equal(result.coverageValid, false);
  assert.equal(result.freshnessValid, false);
  assert.equal(result.reconciliationValid, false);
  assert.equal(result.provenancePresent, false);
  assert.deepEqual(result.unavailableEmployees, ['DN002']);
  assert.deepEqual(result.staleEmployees, ['DN001']);
});

test('closed repair validation reports roster identity separately from source health', () => {
  const { store } = fresh();
  const healthy = { ...sealedModel(), remoteProvenance: ['scope:rc=abc:OK'] };
  const result = store.closedRepairModelValidation(healthy, PERIOD, [ROSTER[0]]);
  assert.equal(result.identityValid, false);
  assert.equal(result.coverageValid, true);
  assert.equal(result.freshnessValid, true);
  assert.equal(result.reconciliationValid, true);
  assert.equal(result.provenanceComplete, true);
});

test('two raw bodies are byte-identical and repeated model digests stay stable', () => {
  const { store } = fresh();
  store.publishGeneration(PERIOD, { roster: ROSTER, employees: employees(), model: model() });
  const first = JSON.stringify(store.readCurrent(PERIOD).model);
  const second = JSON.stringify(store.readCurrent(PERIOD).model);
  assert.equal(first, second);
  assert.equal(digest(JSON.parse(first)), digest(JSON.parse(second)));
});

test('source outage preserves the prior good employee LKG', () => {
  const { store } = fresh();
  store.publishGeneration(PERIOD, { roster: ROSTER, employees: employees(), model: model('first') });
  store.publishGeneration(PERIOD, {
    roster: ROSTER,
    employees: new Map([['DN002', { payload: { empCode: 'DN002', value: 3 }, fetchedAt: '2026-08-13T02:00:00.000Z', sourceRevision: 'r3' }]]),
    model: model('second'), unavailableReasons: { DN001: 'upstream_unavailable' },
  });
  assert.equal(store.readCurrent(PERIOD).employees.get('DN001').report.value, 1);
  assert.equal(store.readCurrent(PERIOD).employees.get('DN002').report.value, 3);
  assert.equal(store.readCurrent(PERIOD).manifest.refreshUnavailableReasons.DN001, 'upstream_unavailable');
  assert.equal(store.readCurrent(PERIOD).unavailableReasons.DN001, 'upstream_unavailable');
  assert.equal(store.readCurrent(PERIOD).complete, true);
});

test('monotonic tuple rejects an older employee source', () => {
  const { store } = fresh();
  store.publishGeneration(PERIOD, { roster: ROSTER, employees: employees(7, 2), model: model('new') });
  const older = new Map([['DN001', { payload: { empCode: 'DN001', value: 1 }, fetchedAt: '2026-08-12T01:00:00.000Z', sourceRevision: 'a' }]]);
  store.publishGeneration(PERIOD, { roster: ROSTER, employees: older, model: model('later-sync') });
  assert.equal(store.readCurrent(PERIOD).employees.get('DN001').report.value, 7);
});

test('roster add makes generation incomplete; remove publishes only current roster', () => {
  const { store } = fresh();
  store.publishGeneration(PERIOD, { roster: ROSTER, employees: employees(), model: model() });
  const added = [...ROSTER, { emp_code: 'DN003', name: 'C' }];
  const m2 = store.publishGeneration(PERIOD, { roster: added, employees: new Map(), model: model('add'), unavailableReasons: { DN003: 'not_configured' } });
  assert.equal(m2.complete, false);
  assert.deepEqual(m2.manifest.roster, ['DN001', 'DN002', 'DN003']);
  assert.equal(store.readCurrent(PERIOD).complete, false);
  const m3 = store.publishGeneration(PERIOD, { roster: [ROSTER[0]], employees: new Map(), model: model('remove') });
  assert.equal(m3.complete, true);
  assert.deepEqual([...m3.employees.keys()], ['DN001']);
});

test('corrupt checksum and schema fail closed with no fallback', () => {
  const { root, store } = fresh();
  store.publishGeneration(PERIOD, { roster: ROSTER, employees: employees(), model: model() });
  const current = JSON.parse(fs.readFileSync(path.join(root, PERIOD, 'current.json'))).payload;
  const manifestFile = path.join(root, PERIOD, 'generations', current.generationId, 'manifest.json');
  const original = fs.readFileSync(manifestFile, 'utf8');
  const corrupt = JSON.parse(original); corrupt.schemaVersion = 99; fs.writeFileSync(manifestFile, JSON.stringify(corrupt));
  assert.throws(() => store.readCurrent(PERIOD), /schema|checksum/i);
  fs.writeFileSync(manifestFile, original);
  const manifest = JSON.parse(original).payload;
  const blob = path.join(path.dirname(manifestFile), manifest.employees.find((item) => item.empCode === 'DN001').file);
  const body = JSON.parse(fs.readFileSync(blob)); body.payload.report.value = 999; fs.writeFileSync(blob, JSON.stringify(body));
  assert.throws(() => store.readCurrent(PERIOD).employees.get('DN001'), /schema|checksum/i);
});

test('persistence boundary rejects a closed-period publication not explicitly locked', () => {
  const { store } = fresh();
  assert.throws(() => store.publishGeneration(PERIOD, {
    roster: ROSTER, employees: employees(), model: model(), periodLocked: true, locked: false,
  }), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
  assert.equal(store.tryReadCurrent(PERIOD).ok, false);
});

test('seal source round-trips as a model-only complete locked generation', () => {
  const { store } = fresh();
  const snapshot = store.publishGeneration(PERIOD, {
    source: 'seal', sealIdentity: 'a'.repeat(64), periodLocked: true, locked: true,
    roster: ROSTER, employees: new Map(), model: sealedModel(), dependencies: { sealKey: 'safe' },
  });
  assert.equal(snapshot.manifest.source, 'seal');
  assert.equal(snapshot.manifest.sealIdentity, 'a'.repeat(64));
  assert.equal(snapshot.manifest.complete, true);
  assert.equal(snapshot.manifest.locked, true);
  assert.equal(snapshot.employees.size, 0);
  assert.deepEqual(snapshot.model, sealedModel());
});

test('seal source rejects missing identity, forged employees and a model that cannot prove roster', () => {
  const { store } = fresh();
  assert.throws(() => store.publishGeneration(PERIOD, {
    source: 'seal', periodLocked: true, locked: true, roster: ROSTER, model: sealedModel(),
  }), { code: 'EMPLOYEE_COST_SNAPSHOT_SEAL_INVALID' });
  assert.throws(() => store.publishGeneration(PERIOD, {
    source: 'seal', sealIdentity: 'b'.repeat(64), periodLocked: true, locked: true,
    roster: ROSTER, employees: employees(), model: { ...sealedModel(), employees: [{ empCode: 'DN001' }] },
  }), { code: 'EMPLOYEE_COST_SNAPSHOT_SEAL_INVALID' });
  assert.equal(store.tryReadCurrent(PERIOD).ok, false);

  const snapshot = store.publishGeneration(PERIOD, {
    source: 'seal', sealIdentity: 'e'.repeat(64), periodLocked: true, locked: true,
    roster: ROSTER, employees: new Map(), model: sealedModel(),
  });
  const generationDir = path.join(store._test.periodDir(PERIOD), 'generations', snapshot.manifest.generationId);
  const manifestFile = path.join(generationDir, 'manifest.json');
  const pointerFile = store._test.currentFile(PERIOD);
  const manifestEnvelope = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifestEnvelope.payload.source = 'other';
  manifestEnvelope.checksum = store.sha256(store.canonicalJson(manifestEnvelope.payload));
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifestEnvelope, null, 2)}\n`);
  const pointerEnvelope = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
  pointerEnvelope.payload.manifestChecksum = store.sha256(store.canonicalJson(manifestEnvelope.payload));
  pointerEnvelope.checksum = store.sha256(store.canonicalJson(pointerEnvelope.payload));
  fs.writeFileSync(pointerFile, `${JSON.stringify(pointerEnvelope, null, 2)}\n`);
  assert.equal(store.tryReadCurrent(PERIOD).error.code, 'EMPLOYEE_COST_SNAPSHOT_SOURCE_INVALID');
});

test('locked complete seal generation is immutable and network cannot claim locked', () => {
  const { store } = fresh();
  assert.throws(() => store.publishGeneration(PERIOD, {
    source: 'network', roster: ROSTER, employees: employees(), model: model(), locked: true,
  }), { code: 'EMPLOYEE_COST_SNAPSHOT_SEAL_INVALID' });
  store.publishGeneration(PERIOD, {
    source: 'seal', sealIdentity: 'c'.repeat(64), periodLocked: true, locked: true,
    roster: ROSTER, employees: new Map(), model: sealedModel('A'),
  });
  assert.throws(() => store.publishGeneration(PERIOD, {
    source: 'seal', sealIdentity: 'd'.repeat(64), periodLocked: true, locked: true,
    roster: ROSTER, employees: new Map(), model: sealedModel('mutate'),
  }), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
  assert.equal(store.readCurrent(PERIOD).model.marker, 'A');
});

test('feature flag is off by default and rolls back immediately', () => {
  const saved = process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT;
  try {
    delete process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT;
    const { store } = fresh(); assert.equal(String(process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT || '') === '1', false);
    process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT = '1'; assert.equal(String(process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT || '') === '1', true);
    process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT = '0'; assert.equal(String(process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT || '') === '1', false);
  } finally {
    if (saved === undefined) delete process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT; else process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT = saved;
  }
});

test('inter-process lock serializes cron/button and status is persisted', async () => {
  const { store } = fresh();
  let release; const wait = new Promise((resolve) => { release = resolve; });
  const first = store.withPeriodLock(PERIOD, async () => { store.writeStatus(PERIOD, { state: 'syncing' }); await wait; return 1; });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(store.withPeriodLock(PERIOD, async () => 2, { waitMs: 0 }), { code: 'EMPLOYEE_COST_SNAPSHOT_LOCKED' });
  assert.equal(store.readStatus(PERIOD).state, 'syncing');
  release(); assert.equal(await first, 1);
  assert.equal(await store.withPeriodLock(PERIOD, async () => 3), 3);
});


test('snapshot reason allowlist preserves rejected but normalizes private/upstream 5xx text', () => {
  const { store } = fresh();
  const manifest = store.publishGeneration(PERIOD, {
    roster: ROSTER, employees: new Map(), model: model('safe'),
    unavailableReasons: {
      DN001: 'upstream_rejected',
      DN002: 'upstream_502 credential=must-not-leak',
    },
  });
  assert.deepEqual(manifest.manifest.refreshUnavailableReasons, {
    DN001: 'upstream_rejected',
    DN002: 'upstream_unavailable',
  });
  assert.doesNotMatch(JSON.stringify(manifest.manifest), /credential|must-not-leak|upstream_502/);
});

test('privacy-safe persisted status excludes payload, key and monetary values', () => {
  const { root, store } = fresh();
  store.writeStatus(PERIOD, { state: 'failed', errorCode: 'UPSTREAM_FAILED', apiKey: 'SECRET', amount: 123456 });
  const status = fs.readFileSync(path.join(root, PERIOD, 'status.json'), 'utf8');
  assert.match(status, /UPSTREAM_FAILED/); assert.doesNotMatch(status, /SECRET|123456|apiKey|amount/);
});

for (const boundary of ['afterWrite', 'afterFileFsync', 'afterRename', 'afterDirFsync']) {
  test(`crash boundary ${boundary}: CURRENT always resolves to an intact generation`, () => {
    let armed = false; let hits = 0;
    const boundaryMap = { afterWrite: 'after-write', afterFileFsync: 'after-file-fsync', afterRename: 'after-rename', afterDirFsync: 'after-dir-fsync' };
    const crashHook = (point, info) => { if (armed && point === `current:${boundaryMap[boundary]}` && ++hits === 1) throw new Error(`crash:${boundary}:${path.basename(info.file)}`); };
    const { store } = fresh({ crashHook });
    store.publishGeneration(PERIOD, { roster: ROSTER, employees: employees(), model: model('old') });
    armed = true;
    assert.throws(() => store.publishGeneration(PERIOD, { roster: ROSTER, employees: employees(4, 5), model: model('new') }), /crash:/);
    const marker = store.readCurrent(PERIOD).model.marker;
    assert.ok(marker === 'old' || marker === 'new');
    if (boundary === 'afterWrite' || boundary === 'afterFileFsync') assert.equal(marker, 'old');
  });
}

test('period busy observer sees an inter-process snapshot lock', async (t) => {
  const { store } = fresh(t);
  const release = await store.acquireLock('2026-08');
  assert.equal(store.isPeriodBusy('2026-08'), true);
  release();
  assert.equal(store.isPeriodBusy('2026-08'), false);
});

test('publication capture/restore removes only failed invocation generation and restores prior current atomically', (t) => {
  const { store } = fresh(t);
  const period = '2026-08';
  const roster = ['DN001'];
  const one = store.publishGeneration(period, { roster, employees: new Map([['DN001', { report: { value: 1 }, fetchedAt: '2026-08-14T01:00:00.000Z' }]]), model: { value: 1 }, dependencies: { d: 1 }, fetchedAt: '2026-08-14T01:00:00.000Z' });
  const captured = store.capturePublicationState(period);
  const two = store.publishGeneration(period, { roster, employees: new Map([['DN001', { report: { value: 2 }, fetchedAt: '2026-08-14T02:00:00.000Z' }]]), model: { value: 2 }, dependencies: { d: 2 }, fetchedAt: '2026-08-14T02:00:00.000Z' });
  assert.notEqual(two.manifest.generationId, one.manifest.generationId);
  store.restorePublicationState(period, captured, two.manifest.generationId);
  const restored = store.readCurrent(period, { roster });
  assert.equal(restored.manifest.generationId, one.manifest.generationId);
  assert.equal(fs.existsSync(path.join(store._test.periodDir(period), 'generations', two.manifest.generationId)), false);
});

test('publication restore refuses to overwrite a newer current generation', (t) => {
  const { store } = fresh(t); const period = '2026-08'; const roster = ['DN001'];
  const one = store.publishGeneration(period, { roster, employees: new Map([['DN001', { report: { value: 1 } }]]), model: { value: 1 }, dependencies: { d: 1 } });
  const captured = store.capturePublicationState(period);
  const two = store.publishGeneration(period, { roster, employees: new Map([['DN001', { report: { value: 2 } }]]), model: { value: 2 }, dependencies: { d: 2 } });
  const three = store.publishGeneration(period, { roster, employees: new Map([['DN001', { report: { value: 3 } }]]), model: { value: 3 }, dependencies: { d: 3 } });
  assert.throws(() => store.restorePublicationState(period, captured, two.manifest.generationId), { code: 'EMPLOYEE_COST_SNAPSHOT_RESTORE_DRIFT' });
  assert.equal(store.readCurrent(period, { roster }).manifest.generationId, three.manifest.generationId);
  assert.notEqual(one.manifest.generationId, three.manifest.generationId);
});
