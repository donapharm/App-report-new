'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-legacy-projection-'));
const cacheFile = path.join(dir, 'catalog_management_lkg.json');
process.env.CATALOG_MANAGEMENT_CACHE_FILE = cacheFile;

const catalogManagement = require('../src/catalogManagement');
const SEP = '\u001f';
const PERIOD = '2026-08';

function assignment(unit, contractor, qlnb, index) {
  return catalogManagement.normalizeRow({
    id: `a-${index}`, type: 'unit_qlnb', value: [unit, contractor, qlnb].join(SEP),
    emp_code: 'DN005', effective_from: PERIOD,
  });
}

function catalogLine(unit, contractor, qlnb, product, index, uom = 'Hộp') {
  return { c7: unit, c4: contractor, c5: qlnb, c15: `Hoạt chất ${index}`,
    c16: product, c17: `${index}mg`, c25: uom, c31: index + 1000 };
}

function productionShape() {
  const rows = [];
  const catalog = [];
  for (let i = 0; i < 27_989; i += 1) {
    const unit = `DV${String(i).padStart(5, '0')}`;
    const qlnb = `QL${String(i).padStart(5, '0')}`;
    rows.push(assignment(unit, '01.TEST', qlnb, i));
    catalog.push(catalogLine(unit, '01.TEST', qlnb, `Thuốc ${i}`, i));
  }
  const unit = '002.NT-BVĐK Thống Nhất ĐN';
  const qlnb = 'G1.BVTN.QĐ88.08.26.N4';
  rows.push(assignment(unit, '03.TUE.N', qlnb, 27_989));
  rows.push(assignment(unit, '07.TRIEU.G', qlnb, 27_990));
  const products = ['Lycalci', 'Progoldkey', 'Fudophar 800mg', 'Cecorte 18', 'Fexocinco',
    'Levocetirizin OD DWP 5 mg', 'Arbuntec 4', 'Hovinlex', 'Cetigam', 'Ofemil 40mg/1.1g',
    'Novitad', 'Mecefer', 'Amebismo', 'Innilor 0.15', 'Cipostril', 'Gysudo'];
  products.forEach((product, i) => catalog.push(catalogLine(unit, '03.TUE.N', qlnb, product, 30_000 + i)));
  catalog.push(catalogLine(unit, '07.TRIEU.G', qlnb, 'Vikamta', 31_000, 'Viên'));
  return { rows, catalog };
}

function writeRaw(snapshot) {
  fs.writeFileSync(cacheFile, JSON.stringify({ source: 'data-hub-lkg', snapshots: { [PERIOD]: snapshot } }));
  catalogManagement.quenLkg();
}

test('LKG đời cũ 27.991 rows + 28.006 catalog được chiếu lại đúng một lần và nhớ theo căn cước file', () => {
  const legacy = productionShape();
  assert.equal(legacy.rows.length, 27_991);
  assert.equal(legacy.catalog.length, 28_006);
  writeRaw({ period: PERIOD, rows: legacy.rows, catalog: legacy.catalog, history: [],
    meta: { version: 'V31.6', checksum: 'a'.repeat(64) } });
  catalogManagement.resetProjectionBuildsForTests();

  const first = catalogManagement.readCacheForTests(PERIOD);
  assert.notEqual(first, null);
  assert.equal(first.rows.length, 28_006);
  assert.equal(new Set(first.rows.map(catalogManagement.assignmentScopeKey)).size, 27_991);
  const group = first.rows.filter((row) => row.unit_code === '002.NT-BVĐK Thống Nhất ĐN'
    && row.qlnb_code === 'G1.BVTN.QĐ88.08.26.N4');
  assert.equal(group.length, 17);
  assert.equal(group.filter((row) => row.contractor_code === '03.TUE.N').length, 16);
  assert.equal(group.filter((row) => row.contractor_code === '07.TRIEU.G').length, 1);
  assert.equal(group.find((row) => row.contractor_code === '07.TRIEU.G').product_name, 'Vikamta');
  assert.equal(catalogManagement.projectionBuildsForTests(), 1);

  const second = catalogManagement.readCacheForTests(PERIOD);
  assert.equal(second.rows.length, 28_006);
  assert.equal(catalogManagement.projectionBuildsForTests(), 1, 'cache hit không được chiếu lại');
});

test('LKG mang projectionVersion hiện hành không bị chiếu lại', () => {
  const current = productionShape();
  writeRaw({ period: PERIOD, rows: current.rows, catalog: current.catalog, history: [],
    projectionVersion: catalogManagement.CATALOG_PROJECTION_VERSION,
    meta: { version: 'V31.6', checksum: 'b'.repeat(64) } });
  catalogManagement.resetProjectionBuildsForTests();
  const snapshot = catalogManagement.readCacheForTests(PERIOD);
  assert.notEqual(snapshot, null);
  assert.equal(snapshot.rows.length, 27_991);
  assert.equal(catalogManagement.projectionBuildsForTests(), 0);
});

test('đường ghi mới đóng dấu projectionVersion vào snapshot và payload LKG', () => {
  const row = assignment('DV-WRITE', '01.TEST', 'QL-WRITE', 1);
  const line = catalogLine('DV-WRITE', '01.TEST', 'QL-WRITE', 'Thuốc ghi mới', 1);
  catalogManagement.writeCacheForTests({
    period: PERIOD, rows: [row], catalog: [line], history: [],
    meta: { version: 'V-WRITE', checksum: 'c'.repeat(64) },
  });
  const stored = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.equal(stored.projectionVersion, catalogManagement.CATALOG_PROJECTION_VERSION);
  assert.equal(stored.snapshots[PERIOD].projectionVersion, catalogManagement.CATALOG_PROJECTION_VERSION);
});

test.after(() => {
  catalogManagement.quenLkg();
  fs.rmSync(dir, { recursive: true, force: true });
});
