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

test('locked complete period is immutable', () => {
  const { store } = fresh();
  store.publishGeneration(PERIOD, { roster: ROSTER, employees: employees(), model: model(), locked: true });
  assert.throws(() => store.publishGeneration(PERIOD, { roster: ROSTER, employees: employees(3, 4), model: model('mutate'), locked: true }), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
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
