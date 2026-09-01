const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

test('real refresh child writes atomic LKG while parent event loop remains responsive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-refresh-child-'));
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      version: '3.14', sourceVersion: '31.8', checksum: 'worker-checksum',
      catalog: [{ c4: 'NT01', c5: 'QL01', c7: 'DV01', c15: 'HC', c16: 'Thuốc', c17: '500mg', c25: 'Viên', c31: 1000 }],
      rows: [{ id: 'a1', emp_code: 'DN001', scope: 'unit_qlnb', code: `DV01\u001fNT01\u001fQL01`, effective_from: '2026-09' }],
      history: [],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.DATA_HUB_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.DATA_HUB_ASSIGNMENT_KEY = 'test-only';
  process.env.CATALOG_MANAGEMENT_CACHE_FILE = path.join(dir, 'catalog.json');
  process.env.EMPLOYEE_COST_DQ_CATALOG_CACHE_FILE = path.join(dir, 'catalog.dq.json');
  process.env.CATALOG_MANAGEMENT_CACHE_INDEX_FILE = path.join(dir, 'catalog.index.json');
  process.env.CATALOG_LKG_STAT_INTERVAL_MS = '0';
  const catalogManagement = require('../src/catalogManagement');
  let last = Date.now(); let maxLag = 0;
  const heartbeat = setInterval(() => {
    const now = Date.now(); maxLag = Math.max(maxLag, now - last); last = now;
  }, 5);
  try {
    const snapshot = await catalogManagement.getSnapshot('2026-09', { forceRemote: true });
    assert.equal(snapshot.meta.checksum, 'worker-checksum');
    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.catalog.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(process.env.CATALOG_MANAGEMENT_CACHE_FILE, 'utf8')).snapshots['2026-09'].meta.sourceVersion, '31.8');
    assert.ok(maxLag < 250, `parent event loop lag ${maxLag}ms`);
    assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
  } finally {
    clearInterval(heartbeat);
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
