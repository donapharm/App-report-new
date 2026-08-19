'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const catalogManagement = require('../src/catalogManagement');
const employeeCost = require('../src/employeeCost');

const { projectEmployeeCostCatalogRow, EMPLOYEE_COST_CATALOG_PROJECTION_KEYS } = catalogManagement;

test('phép chiếu catalog phải giữ ĐỦ mọi trường enrich đọc — không chỉ 4 khoá ghép', () => {
  // Sự cố 20/08/2026: worker chiếu tay {c5,c7,c10,c16} nên bỏ rơi c25/uom —
  // 29/2.087 dòng T07 mất đơn vị tính, mọi chỉ báo vẫn xanh, chỉ phép so từng ô
  // giữa hai bản mới lộ ra. Khoá lại: chiếu xong thì các trường hiển thị vẫn còn.
  const full = {
    qlnb_code: 'G1.X.1', unit_code: '001', c10: 'G1', product_name: 'Thuốc A',
    uom: 'Viên', route: 'BV', contractor_name: 'Nhà thầu A', contractor_code: 'NT01',
    strength: '500mg', bid_price: 1234, effective_from: '2026-07', junk_field: 'phải bị loại',
  };
  const projected = projectEmployeeCostCatalogRow(full);
  for (const key of ['qlnb_code', 'unit_code', 'c10', 'product_name', 'uom', 'route',
    'contractor_name', 'contractor_code', 'strength', 'bid_price']) {
    assert.equal(projected[key], full[key], `chiếu xong phải còn "${key}"`);
  }
  assert.ok(!('junk_field' in projected), 'trường ngoài danh sách phải bị loại — chiếu vẫn phải là chiếu');
  assert.ok(!('effective_from' in projected) || EMPLOYEE_COST_CATALOG_PROJECTION_KEYS.includes('effective_from'));
});

test('mọi alias enrichWithRevenue đọc từ catalogRow PHẢI có trong danh sách chiếu', () => {
  // Máy quét thay trí nhớ: thêm alias mới vào enrich mà quên thêm vào danh sách
  // chiếu là ca này đỏ ngay, không đợi tới lúc PROD mất cột như vụ C25.
  const source = fs.readFileSync(require.resolve('../src/employeeCost'), 'utf8');
  const aliasLists = [...source.matchAll(/displayValue\(catalogRow,\s*\[([^\]]+)\]/g)]
    .map((match) => match[1]);
  assert.ok(aliasLists.length >= 6, 'phải quét được các chỗ enrich đọc catalogRow');
  const keys = new Set(EMPLOYEE_COST_CATALOG_PROJECTION_KEYS);
  for (const list of aliasLists) {
    for (const rawAlias of list.split(',')) {
      const alias = rawAlias.trim().replace(/^['"]|['"]$/g, '');
      if (!alias) continue;
      assert.ok(keys.has(alias),
        `enrich đọc catalogRow["${alias}"] nhưng danh sách chiếu không giữ nó — thêm vào EMPLOYEE_COST_CATALOG_PROJECTION_KEYS`);
    }
  }
});

test('các khoá ghép productCodeOf/unitCodeOf/productNameOf cũng phải sống sót qua phép chiếu', () => {
  const byAlias = (row) => projectEmployeeCostCatalogRow(row);
  assert.equal(byAlias({ iit_code: 'A1' }).iit_code, 'A1');
  assert.equal(byAlias({ c5: 'A2' }).c5, 'A2');
  assert.equal(byAlias({ c7: '009' }).c7, '009');
  assert.equal(byAlias({ DONVI: '009.BV X' }).DONVI, '009.BV X');
  assert.equal(byAlias({ c16: 'Tên hàng' }).c16, 'Tên hàng');
});

test('worker KHÔNG được chép tay danh sách trường — phải dùng phép chiếu chung', () => {
  const source = fs.readFileSync(require.resolve('../src/catalogLkgReaderWorker'), 'utf8');
  assert.match(source, /projectEmployeeCostCatalogRow/,
    'worker phải gọi phép chiếu chung của catalogManagement');
  assert.doesNotMatch(source, /c5:\s*row\.c5/,
    'cấm liệt kê trường bằng tay trong worker — đây chính là chỗ đã làm rơi C25');
});

test('dòng đã chiếu đi qua enrich vẫn giữ đơn vị tính C25 — tái hiện đúng vụ 29 dòng', () => {
  const catalogRow = {
    qlnb_code: 'G1.TEST.1', unit_code: '001', product_name: 'Thuốc A',
    uom: 'Viên', strength: '500mg', bid_price: 1000, c10: 'G1',
  };
  const revenueRow = {
    qlnb_code: 'G1.TEST.1', unit_code: '001', product_name: 'Thuốc A',
    revenue: 10000, quantity: 10,
    // CỐ Ý không có uom: đúng tình huống 29 dòng — revenueRow trống thì C25 phải
    // tới từ catalog; catalog bị chiếu cụt là ô này trống theo.
  };
  const enrichFull = employeeCost.enrichWithRevenue(
    { empCode: 'DN001', columns: [], rows: [] },
    { period: '2026-07', revenueRows: [revenueRow], catalogRows: [catalogRow] },
  );
  const enrichProjected = employeeCost.enrichWithRevenue(
    { empCode: 'DN001', columns: [], rows: [] },
    { period: '2026-07', revenueRows: [revenueRow], catalogRows: [projectEmployeeCostCatalogRow(catalogRow)] },
  );
  const c25Full = (enrichFull.rows || [])[0]?.c25;
  const c25Projected = (enrichProjected.rows || [])[0]?.c25;
  assert.equal(c25Projected, c25Full,
    'catalog đã chiếu phải cho ra ĐÚNG C25 như catalog đầy đủ — lệch là tái phát vụ 29 dòng');
  assert.equal(c25Projected, 'Viên');
});
