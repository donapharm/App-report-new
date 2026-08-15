const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-period-lkg-'));
process.env.CATALOG_PERIOD_LKG_ROOT = dir;
const sidecar = require('../src/catalogPeriodLkg');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function snapshot(period) {
  return { period, rows: [{ id: period }], catalog: [{ c5: 'Q', c7: 'D' }], history: [], meta: { version: 'V1', checksum: period } };
}
function install(periods = ['2026-06', '2026-07', '2026-08']) {
  const index = { schemaVersion: 1, kind: 'catalog-period-lkg-index', periods: {} };
  for (const period of periods) {
    const envelope = { schemaVersion: 1, kind: 'catalog-period-lkg', period, payloadChecksum: 'phase0', payload: { period, snapshot: snapshot(period), dqSnapshot: snapshot(period) } };
    const raw = JSON.stringify(envelope);
    const file = `${period}.json`;
    fs.writeFileSync(path.join(dir, file), raw, { mode: 0o600 });
    index.periods[period] = { file, checksum: sidecar.hash(raw) };
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index), { mode: 0o600 });
}

test('flag defaults off', () => {
  delete process.env.CATALOG_PERIOD_LKG_READ_ENABLED;
  assert.equal(sidecar.tryReadPeriod('2026-08').reason, 'disabled');
});

test('one-period request reads exactly one fragment', () => {
  install();
  process.env.CATALOG_PERIOD_LKG_READ_ENABLED = 'true';
  const fragmentReads = [];
  const readFile = (file, encoding) => {
    if (/\d{4}-\d{2}\.json$/.test(file)) fragmentReads.push(file);
    return fs.readFileSync(file, encoding);
  };
  const result = sidecar.tryReadPeriod('2026-08', { readFile });
  assert.equal(result.used, true);
  assert.equal(result.payload.snapshot.period, '2026-08');
  assert.equal(fragmentReads.length, 1);
  assert.equal(path.basename(fragmentReads[0]), '2026-08.json');
});

test('checksum/missing sidecar falls back without any source callback', () => {
  install(['2026-08']);
  process.env.CATALOG_PERIOD_LKG_READ_ENABLED = 'true';
  fs.appendFileSync(path.join(dir, '2026-08.json'), 'corrupt');
  let sourceCalls = 0;
  const result = sidecar.tryReadPeriod('2026-08', { sourceFetch: () => { sourceCalls += 1; } });
  assert.equal(result.used, false);
  assert.equal(result.reason, 'CATALOG_PERIOD_CHECKSUM_INVALID');
  assert.equal(sourceCalls, 0);
  assert.equal(sidecar.tryReadPeriod('2026-07').used, false);
});

test('semantic validation failure also falls back instead of publishing sidecar data', () => {
  install(['2026-08']);
  process.env.CATALOG_PERIOD_LKG_READ_ENABLED = 'true';
  const result = sidecar.tryReadPeriod('2026-08', { validate: () => { throw Object.assign(new Error('bad catalog contract'), { code: 'CATALOG_CONTRACT_INVALID' }); } });
  assert.equal(result.used, false);
  assert.equal(result.reason, 'CATALOG_CONTRACT_INVALID');
});

test('range reads fragments sequentially and enforces the hard cap', async () => {
  install();
  let active = 0;
  let peak = 0;
  const seen = [];
  await sidecar.readRangeSequential(['2026-06', '2026-07', '2026-08'], async (payload) => {
    active += 1;
    peak = Math.max(peak, active);
    seen.push(payload.period);
    await Promise.resolve();
    active -= 1;
  }, { maxPeriods: 3 });
  assert.equal(peak, 1);
  assert.deepEqual(seen, ['2026-06', '2026-07', '2026-08']);
  await assert.rejects(() => sidecar.readRangeSequential(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'], async () => {}, { maxPeriods: 6 }), { code: 'CATALOG_PERIOD_RANGE_LIMIT' });
});

test('index cannot escape the sidecar root', () => {
  install(['2026-08']);
  const indexFile = path.join(dir, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  index.periods['2026-08'].file = '../2026-08.json';
  fs.writeFileSync(indexFile, JSON.stringify(index));
  assert.throws(() => sidecar.readPeriod('2026-08'), { code: 'CATALOG_PERIOD_FILE_INVALID' });
});
