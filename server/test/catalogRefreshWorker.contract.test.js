const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');

test('production refresh runs fetch, validation, merge, stringify and atomic write outside web process', () => {
  const catalog = src('catalogManagement.js');
  const parent = src('catalogRefreshWorker.js');
  const child = src('catalogRefreshWorkerChild.js');
  assert.match(catalog, /require\('\.\/catalogRefreshWorker'\)\.refresh\(period\)/);
  assert.match(parent, /fork\(path\.join\(__dirname, 'catalogRefreshWorkerChild\.js'\)/);
  assert.match(parent, /CATALOG_REFRESH_WORKER_CHILD: '1'/);
  assert.match(child, /refreshAndPersistForWorker\(period\)/);
  assert.match(catalog, /writeCacheAtomic\(snapshot\)/);
  assert.match(catalog, /CATALOG_REFRESH_WORKER_ONLY/);
});

test('worker receipt is checked against atomically persisted LKG before serving', () => {
  const catalog = src('catalogManagement.js');
  assert.match(catalog, /catalogLkgReader\.invalidate\(\)/);
  assert.match(catalog, /CATALOG_REFRESH_RECEIPT_MISMATCH/);
  assert.match(catalog, /snapshot\.rows\.length !== result\.rows/);
  assert.match(catalog, /snapshot\.catalog\.length !== result\.catalog/);
  assert.match(catalog, /snapshot\.meta\?\.checksum \|\| ''\) !== result\.checksum/);
});

test('refresh worker is single-flight and bounded by timeout', () => {
  const parent = src('catalogRefreshWorker.js');
  assert.match(parent, /if \(inFlight\.has\(period\)\) return inFlight\.get\(period\)/);
  assert.match(parent, /CATALOG_REFRESH_WORKER_TIMEOUT_MS/);
  assert.match(parent, /--max-old-space-size=2048/);
});
