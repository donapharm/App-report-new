/**
 * CỘT CHỈ-ĐỂ-XEM C38 · C42 (CEO chốt 08/08/2026: "cho thêm 2 cột C38 và C42 vào phân quyền")
 *
 * Ranh giới sống còn được khoá ở đây: cột chỉ-để-xem KHÔNG bao giờ được lọt vào
 * `costColumns` — đó là các cột TÍNH TIỀN (rowMonthlyTotal/C47/thưởng/phạt). Lọt vào
 * là đổi số tiền của nhân viên mà không ai nâng FORMULA_VERSION.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const templates = require('../src/employeeCostTemplates');
const grants = require('../src/catalogCostColumnGrants');

test('C38 và C42 vào được danh mục phân quyền', () => {
  const catalog = templates.grantableColumnCatalog('DN001').map((column) => column.key);
  assert.ok(catalog.includes('c38'), 'thiếu C38');
  assert.ok(catalog.includes('c42'), 'thiếu C42');
  // Vẫn giữ đủ 5 cột tính tiền cũ.
  for (const key of ['c36', 'c41', 'c43', 'c44', 'c45']) assert.ok(catalog.includes(key), `mất cột ${key}`);
  // Xếp theo số cột cho CEO dễ đọc.
  assert.deepEqual(catalog, ['c36', 'c38', 'c41', 'c42', 'c43', 'c44', 'c45']);
});

test('‼ C38/C42 KHÔNG được nằm trong cột tính tiền — không đổi một đồng nào của ai', () => {
  for (const empCode of ['DN001', 'DN022', '']) {
    const template = templates.resolveTemplate(empCode);
    assert.ok(!template.costColumns.includes('c38'), `${empCode}: C38 lọt vào cột tính tiền`);
    assert.ok(!template.costColumns.includes('c42'), `${empCode}: C42 lọt vào cột tính tiền`);
  }
  // Full-time vẫn đúng 5 cột tính tiền như trước.
  assert.deepEqual(templates.resolveTemplate('DN001').costColumns, ['c36', 'c41', 'c43', 'c44', 'c45']);
  // Part-time (DN022) vẫn đúng 1 cột.
  assert.deepEqual(templates.resolveTemplate('DN022').costColumns, ['c36']);
});

test('cột chỉ-để-xem mang cờ viewOnly để menu nói rõ, tránh CEO hiểu nhầm là tính tiền', () => {
  const catalog = templates.grantableColumnCatalog('DN001');
  const byKey = new Map(catalog.map((column) => [column.key, column]));
  assert.equal(byKey.get('c38').viewOnly, true);
  assert.equal(byKey.get('c42').viewOnly, true);
  assert.equal(byKey.get('c36').viewOnly, false);
});

test('C38/C42 nằm trong whitelist cấp quyền C33–C46; C32/C47 vẫn cấm vĩnh viễn', () => {
  assert.equal(grants.isAllowedColumn('c38'), true);
  assert.equal(grants.isAllowedColumn('c42'), true);
  assert.equal(grants.isAllowedColumn('c32'), false);
  assert.equal(grants.isAllowedColumn('c47'), false);
});

test('CEO cấp được C38/C42 cho nhân viên như cột thường', () => {
  const data = {};
  const store = { load: (n, d) => data[n] ?? d, save: (n, v) => { data[n] = v; } };
  const saved = grants.setGrant('DN001', { columns: ['c38', 'c42'], units: ['*'] }, { actor: 'CEO', store });
  assert.deepEqual(saved.columnKeys, ['c38', 'c42']);
  assert.deepEqual(saved.columns, { c38: ['*'], c42: ['*'] });
  assert.deepEqual(
    grants.visibleColumns({ emp_code: 'DN001', isCeo: false }, ['c36', 'c38', 'c42'], { store }),
    ['c38', 'c42'],
    'chỉ cột được cấp mới hiện — C36 chưa cấp thì không được thấy',
  );
});

test('cấu hình sai bị chặn: khai cột chỉ-để-xem trùng cột tính tiền, hoặc khai C32/C47', () => {
  assert.throws(() => templates.normalizeViewOnlyColumns({ c36: 'trùng' }, ['c36', 'c41']), /đã là cột tính tiền/);
  assert.throws(() => templates.normalizeViewOnlyColumns({ c32: 'cấm' }, ['c36']), /không hợp lệ/);
  assert.throws(() => templates.normalizeViewOnlyColumns({ c47: 'cấm' }, ['c36']), /không hợp lệ/);
  // Không khai gì cũng hợp lệ (quay về trạng thái trước 08/08).
  assert.deepEqual(templates.normalizeViewOnlyColumns(undefined, ['c36']), {});
});
