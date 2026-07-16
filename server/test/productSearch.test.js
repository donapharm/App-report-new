const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SEARCH_FIELDS,
  editDistanceWithin,
  filterProductRows,
  matchesProductSearch,
} = require('../src/productSearch');

const row = {
  product_name: 'Amoxicillin 500 mg',
  iit_code: 'QLNB-139-N1-001',
  uom: 'Hộp',
  province: 'Đồng Nai',
  route: 'NCL',
  unit_code: '001.BVTN',
  unit_name: 'Bệnh viện Thống Nhất',
  emp_code: 'DN016',
  emp_name: 'Trần Thị Ngọc Ánh',
  contractor_code: 'NT-AFP',
  contractor_name: 'Công ty AFP Pharma',
  bid_package: 'Gói thầu QĐ139',
  priority: 'Ưu tiên 1',
};

const cstMeta = {
  active_ingredient: 'Amoxicillin trihydrat',
  strength: 'Tương đương 500 mg amoxicillin',
};

test('tìm không dấu và không phụ thuộc thứ tự token', () => {
  assert.equal(matchesProductSearch(row, 'thong nhat benh vien'), true);
  assert.equal(matchesProductSearch(row, 'dong nai amoxicillin'), true);
  assert.equal(matchesProductSearch(row, 'tran anh ngoc'), true);
});

test('tìm trên toàn bộ field nghiệp vụ an toàn đã duyệt', () => {
  const cases = [
    ['amoxicillin', 'product_name'], ['qlnb 139', 'iit_code'], ['hop', 'uom'],
    ['dong nai', 'province'], ['ncl', 'route'], ['001 bvtn', 'unit_code'],
    ['benh vien thong nhat', 'unit_name'], ['dn016', 'emp_code'], ['ngoc anh', 'emp_name'],
    ['nt afp', 'contractor_code'], ['afp pharma', 'contractor_name'], ['goi thau qd139', 'bid_package'],
    ['uu tien 1', 'priority'],
  ];
  for (const [query, field] of cases) assert.equal(matchesProductSearch(row, query), true, field);
  assert.deepEqual(SEARCH_FIELDS.includes('cost_price'), false);
  assert.deepEqual(SEARCH_FIELDS.includes('profit'), false);
});

test('metadata CST được tìm trước khi lọc nhưng không được thêm vào row đầu ra', () => {
  const source = [{ ...row }];
  const byActiveIngredient = filterProductRows(source, 'trihydrat amoxicillin', () => cstMeta);
  const byStrength = filterProductRows(source, 'tuong duong 500', () => cstMeta);
  assert.equal(byActiveIngredient.length, 1);
  assert.equal(byStrength.length, 1);
  assert.strictEqual(byActiveIngredient[0], source[0]);
  assert.equal(Object.hasOwn(byActiveIngredient[0], 'active_ingredient'), false);
  assert.equal(Object.hasOwn(byActiveIngredient[0], 'strength'), false);
});

test('typo tolerance bảo thủ theo độ dài token', () => {
  assert.equal(matchesProductSearch(row, 'amoxcillin'), true, '10 ký tự cho phép sai 2');
  assert.equal(matchesProductSearch(row, 'amxxcillxn'), false, 'không cho phép quá 2 lỗi');
  assert.equal(matchesProductSearch(row, 'pharmx'), true, '6 ký tự cho phép sai 1');
  assert.equal(matchesProductSearch(row, 'phxrxm'), false, '6 ký tự không cho phép sai 2');
  assert.equal(matchesProductSearch(row, 'dn017'), false, 'mã gần giống không được khớp nhầm');
  assert.equal(matchesProductSearch(row, 'ncm'), false, 'token ngắn không fuzzy');
});

test('bounded edit distance dừng ngoài ngưỡng và tính đúng trong ngưỡng', () => {
  assert.equal(editDistanceWithin('amoxicillin', 'amoxcillin', 2), 1);
  assert.equal(editDistanceWithin('priority', 'priorty', 2), 1);
  assert.equal(editDistanceWithin('abcdefgh', 'xyzuvw', 2), 3);
});

test('query rỗng giữ nguyên mảng để exact filters không đổi hành vi', () => {
  const rows = [row];
  assert.strictEqual(filterProductRows(rows, ''), rows);
  assert.strictEqual(filterProductRows(rows, null), rows);
});
