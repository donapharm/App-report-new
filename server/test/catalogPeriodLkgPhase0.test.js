const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const phase0 = require('../src/catalogPeriodLkgPhase0');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-period-lkg-phase0-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function roots() {
  const snapshot = {
    period: '2026-08',
    rows: [{ id: 'r1', emp_code: 'DN001' }],
    catalog: [{ c5: 'QL01', c7: 'DV01', c16: 'Thuốc A' }],
    history: [{ id: 'h1', action: 'sync' }],
    meta: { version: 'V31.5', checksum: 'upstream-checksum' },
  };
  const dqSnapshot = {
    period: '2026-08',
    rows: [{ type: 'unit_qlnb', unit_code: 'DV01', qlnb_code: 'QL01' }],
    catalog: [{ c5: 'QL01', c7: 'DV01', c16: 'Thuốc A' }],
    meta: snapshot.meta,
  };
  return { main: { schemaVersion: 2, snapshots: { '2026-08': snapshot } }, dq: { schemaVersion: 2, snapshots: { '2026-08': dqSnapshot } }, snapshot, dqSnapshot };
}

test('period projection preserves rows, catalog, history, source metadata, and DQ projection exactly', () => {
  const { main, dq, snapshot, dqSnapshot } = roots();
  const envelope = phase0.projectPeriod(main, dq, '2026-08');
  const payload = phase0.validateEnvelope(envelope, '2026-08');
  assert.deepEqual(payload.snapshot, snapshot);
  assert.deepEqual(payload.dqSnapshot, dqSnapshot);
  assert.deepEqual(payload.snapshot.meta, { version: 'V31.5', checksum: 'upstream-checksum' });
});

test('checksum drift and period substitution fail closed', () => {
  const { main, dq } = roots();
  const envelope = phase0.projectPeriod(main, dq, '2026-08');
  envelope.payload.snapshot.catalog[0].c16 = 'Bị sửa';
  assert.throws(() => phase0.validateEnvelope(envelope, '2026-08'), { code: 'CATALOG_PERIOD_CHECKSUM_INVALID' });
  const clean = phase0.projectPeriod(main, dq, '2026-08');
  assert.throws(() => phase0.validateEnvelope(clean, '2026-07'), { code: 'CATALOG_PERIOD_MISMATCH' });
});

test('missing main or DQ period fails closed', () => {
  const { main, dq } = roots();
  assert.throws(() => phase0.projectPeriod(main, dq, '2026-07'), { code: 'CATALOG_PERIOD_MISSING' });
  assert.throws(() => phase0.projectPeriod(main, { snapshots: {} }, '2026-08'), { code: 'CATALOG_DQ_PERIOD_MISSING' });
});

test('atomic write publishes mode 0600 and leaves no temp file', () => {
  const { main, dq } = roots();
  const file = path.join(dir, 'normal', '2026-08.json');
  phase0.writeEnvelopeAtomic(file, phase0.projectPeriod(main, dq, '2026-08'));
  assert.deepEqual(phase0.validateEnvelope(JSON.parse(fs.readFileSync(file, 'utf8')), '2026-08').snapshot, main.snapshots['2026-08']);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith('.tmp')), false);
});

test('simulated crash before rename preserves prior generation and cleans partial temp', () => {
  const { main, dq } = roots();
  const file = path.join(dir, 'crash', '2026-08.json');
  const first = phase0.projectPeriod(main, dq, '2026-08');
  phase0.writeEnvelopeAtomic(file, first);
  const before = fs.readFileSync(file);
  const changedRoots = roots();
  changedRoots.main.snapshots['2026-08'].catalog[0].c16 = 'Thuốc B';
  assert.throws(() => phase0.writeEnvelopeAtomic(file, phase0.projectPeriod(changedRoots.main, changedRoots.dq, '2026-08'), {
    beforeRename: () => { throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' }); },
  }), { code: 'SIMULATED_CRASH' });
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith('.tmp')), false);
});

test('retention is deterministic, unique, and keeps newest periods only', () => {
  assert.deepEqual(phase0.retainedPeriods(['2026-06', '2026-08', '2026-07', '2026-08'], 2), ['2026-07', '2026-08']);
  assert.throws(() => phase0.retainedPeriods(['08.2026'], 2), { code: 'CATALOG_PERIOD_INVALID' });
});

test('phase 0 helper is not imported by the production catalog runtime', () => {
  const runtimeFiles = ['catalogManagement.js', 'employeeCost.js', 'routes.js'];
  for (const name of runtimeFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
    assert.equal(source.includes('catalogPeriodLkgPhase0'), false, `${name} must not activate Phase 0 code`);
  }
});
