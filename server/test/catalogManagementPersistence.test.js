const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-lkg-perf-'));
process.env.CATALOG_MANAGEMENT_CACHE_FILE = path.join(dir, 'catalog.json');
process.env.EMPLOYEE_COST_DQ_CATALOG_CACHE_FILE = path.join(dir, 'catalog.dq.json');
process.env.CATALOG_MANAGEMENT_CACHE_INDEX_FILE = path.join(dir, 'catalog.index.json');
process.env.DATA_HUB_BASE_URL = 'https://data-hub.test';
process.env.DATA_HUB_ASSIGNMENT_KEY = 'test-key';
const catalogManagement = require('../src/catalogManagement');

function snapshot({
  period = '2026-07', version = 'v1', checksum = 'semantic-1', product = 'Thuốc A',
  updatedAt = '2026-07-30T00:00:00Z', lastSyncAt = '2026-07-30T00:00:00Z', message = 'first',
} = {}) {
  return {
    period,
    rows: [catalogManagement.normalizeRow({
      id: 'a1', emp_code: 'DN016', scope: 'unit_qlnb', code: `DV01\u001fQL01`,
      unit_code: 'DV01', unit_name: 'BV A', qlnb_code: 'QL01', effective_from: period,
    })],
    catalog: [{ c4: 'NT01', c5: 'QL01', c7: 'DV01', c10: 'H.A', c15: 'HC A', c16: product, c17: '500mg', c25: 'Viên', c31: 1000 }],
    history: [{ id: 'h1' }],
    meta: { source: 'data-hub', version, checksum, updatedAt, lastSyncAt, message },
  };
}

function identity(file) {
  const stat = fs.statSync(file, { bigint: true });
  return { ino: stat.ino, mtimeNs: stat.mtimeNs, bytes: fs.readFileSync(file) };
}

function assertIdentityStable(file, before) {
  const after = identity(file);
  assert.equal(after.ino, before.ino, `${path.basename(file)} inode`);
  assert.equal(after.mtimeNs, before.mtimeNs, `${path.basename(file)} mtime`);
  assert.deepEqual(after.bytes, before.bytes, `${path.basename(file)} bytes`);
}

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('unchanged semantic snapshot preserves LKG/DQ inode, mtime, bytes, and persisted metadata', () => {
  const first = catalogManagement.writeCacheAtomic(snapshot());
  assert.deepEqual({ main: first.mainWritten, dq: first.dqWritten }, { main: true, dq: true });
  const before = {
    main: identity(catalogManagement.CACHE_FILE),
    dq: identity(catalogManagement.DQ_CACHE_FILE),
    index: identity(catalogManagement.CACHE_INDEX_FILE),
  };

  const second = catalogManagement.writeCacheAtomic(snapshot({
    updatedAt: '2026-07-30T12:34:56Z',
    lastSyncAt: '2026-07-30T12:34:56Z',
    message: 'fresh response only',
  }));
  assert.deepEqual(
    { main: second.mainWritten, dq: second.dqWritten, index: second.indexWritten, written: second.written },
    { main: false, dq: false, index: false, written: false },
  );
  assertIdentityStable(catalogManagement.CACHE_FILE, before.main);
  assertIdentityStable(catalogManagement.DQ_CACHE_FILE, before.dq);
  assertIdentityStable(catalogManagement.CACHE_INDEX_FILE, before.index);
  const persisted = JSON.parse(fs.readFileSync(catalogManagement.CACHE_FILE, 'utf8')).snapshots['2026-07'];
  assert.equal(persisted.meta.lastSyncAt, '2026-07-30T00:00:00Z');
  assert.equal(persisted.meta.message, 'first');
});

test('indexed LKG replacement is atomically repaired even when its semantic payload still matches', () => {
  for (const file of [catalogManagement.CACHE_FILE, catalogManagement.DQ_CACHE_FILE]) {
    const replacement = `${file}.replacement`;
    fs.copyFileSync(file, replacement);
    fs.renameSync(replacement, file);
  }
  const replacedMain = identity(catalogManagement.CACHE_FILE);
  const repaired = catalogManagement.writeCacheAtomic(snapshot());
  assert.deepEqual({ main: repaired.mainWritten, dq: repaired.dqWritten }, { main: true, dq: true });
  assert.notEqual(identity(catalogManagement.CACHE_FILE).ino, replacedMain.ino);
});

test('changed semantic payload atomically rewrites even when upstream version/checksum did not change', () => {
  const before = identity(catalogManagement.CACHE_FILE);
  const changed = catalogManagement.writeCacheAtomic(snapshot({ product: 'Thuốc B' }));
  assert.deepEqual({ main: changed.mainWritten, dq: changed.dqWritten }, { main: true, dq: true });
  const after = identity(catalogManagement.CACHE_FILE);
  assert.notEqual(after.ino, before.ino);
  assert.match(after.bytes.toString('utf8'), /Thuốc B/);
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
});

test('concurrent same-period refreshes coalesce into one Data Hub fetch and one write', async () => {
  const oldFetch = global.fetch;
  let fetches = 0;
  global.fetch = async () => {
    fetches += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    const value = snapshot({ period: '2026-08', version: 'v8', checksum: 'semantic-8', product: 'Thuốc Tám' });
    return {
      ok: true,
      json: async () => ({
        catalog: value.catalog,
        rows: [{
          id: 'a8', emp_code: 'DN016', scope: 'unit_qlnb', code: `DV01\u001fQL01`,
          unit_code: 'DV01', unit_name: 'BV A', qlnb_code: 'QL01', effective_from: '2026-08',
        }],
        history: value.history,
        version: value.meta.version,
        checksum: value.meta.checksum,
        updatedAt: value.meta.updatedAt,
      }),
    };
  };
  try {
    const results = await Promise.all([
      catalogManagement.getSnapshot('08.2026'),
      catalogManagement.getSnapshot('2026-08'),
      catalogManagement.getSnapshot('2026-08-15'),
    ]);
    assert.equal(fetches, 1);
    assert.equal(results.every((value) => value === results[0]), true, 'callers share one in-memory snapshot');
    const root = JSON.parse(fs.readFileSync(catalogManagement.CACHE_FILE, 'utf8'));
    assert.equal(root.snapshots['2026-08'].catalog[0].c16, 'Thuốc Tám');
  } finally {
    global.fetch = oldFetch;
  }
});
