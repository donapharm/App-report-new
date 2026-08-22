'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-reader-no-reload-'));
const file = path.join(dir, 'catalog.json');
process.env.CATALOG_MANAGEMENT_CACHE_FILE = file;
process.env.CATALOG_LKG_STAT_INTERVAL_MS = '0';
const reader = require('../src/catalogLkgReader');

function write(mark) { fs.writeFileSync(file, `generation-${mark}-${'x'.repeat(mark)}`); }

test('unchanged file: 100 reads reuse one extracted projection', async () => {
  write(1); reader._resetForTests();
  let builds = 0;
  reader._setReadOverrideForTests(async () => { builds += 1; return { meta: { version: '1' } }; });
  const first = await reader.read('2026-08');
  for (let i = 0; i < 100; i += 1) assert.equal((await reader.read('2026-08')).meta.version, first.meta.version);
  assert.equal(builds, 1);
});

test('changed file: old snapshot remains available while worker builds new generation', async () => {
  write(2); reader._resetForTests();
  let version = 2;
  let release;
  reader._setReadOverrideForTests(async () => {
    const captured = String(version);
    if (version === 3) await new Promise((resolve) => { release = resolve; });
    return { meta: { version: captured } };
  });
  assert.equal((await reader.read('2026-08')).meta.version, '2');
  version = 3; write(3);
  const stale = await reader.read('2026-08');
  assert.equal(stale.meta.version, '2');
  assert.equal(stale.meta.catalogReloading, true);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  const fresh = await reader.read('2026-08');
  assert.equal(fresh.meta.version, '3');
  assert.equal(fresh.meta.catalogReloading, undefined);
});
