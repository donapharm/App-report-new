const test = require('node:test');
const assert = require('node:assert/strict');
const { filterCstSearch } = require('../src/analytics');

const rows = [
  {
    emp_code: 'DN016', sales_emps: 'DN016', province: 'Đồng Nai', route: 'CL',
    unit_code: '002.BVĐK Thống Nhất ĐN', unit_name: '002.BVĐK Thống Nhất ĐN',
    iit_code: 'G3.ĐY.QĐ141.215.N3.44', product_name: 'Thanh nhiệt tiêu độc Livergood',
    active_ingredient: 'Nhân trần; Bồ công anh; Cúc hoa', c14: 'TH-Thanh nhiệt/Giải độc',
    contractor_code: 'DONA', contractor_name: 'Dược phẩm Donapharm',
    bid_package: 'G3.L1.QĐ141/27.02.25', priority: 'H.B', uom: 'Viên',
  },
  {
    emp_code: 'DN001', sales_emps: 'DN001', province: 'Đồng Nai', route: 'CL',
    unit_code: '001.BVĐK Đồng Nai', unit_name: '001.BVĐK Đồng Nai',
    iit_code: 'G1.GE.QĐ139.2777.N4.583', product_name: 'Eexatovas 10',
    active_ingredient: 'Atorvastatin', c14: 'TM-Tim mạch',
    contractor_code: 'AFP', contractor_name: 'AFP Pharma',
    bid_package: 'G1.L1.QĐ139/27.02.25', priority: 'H.A', uom: 'Viên',
  },
  {
    emp_code: 'DN016', sales_emps: 'DN016', province: 'Đồng Nai', route: 'CL',
    unit_code: '021.TTYT H. Xuân Lộc', unit_name: '021.TTYT H. Xuân Lộc',
    iit_code: 'G3.ĐY.QĐ141.215.N3.44', product_name: 'Thanh nhiệt tiêu độc Livergood',
    active_ingredient: 'Nhân trần; Bồ công anh; Cúc hoa', c14: 'TH-Thanh nhiệt/Giải độc',
    contractor_code: 'DONA', contractor_name: 'Dược phẩm Donapharm',
    bid_package: 'G3.L1.QĐ141/27.02.25', priority: 'H.B', uom: 'Viên',
  },
];

test('CST tìm được Livergood bằng từ rút gọn hoặc gần đúng', () => {
  assert.deepEqual(filterCstSearch(rows, 'live'), [rows[0], rows[2]]);
  assert.deepEqual(filterCstSearch(rows, 'livergood'), [rows[0], rows[2]]);
  assert.deepEqual(filterCstSearch(rows, 'livergod'), [rows[0], rows[2]]);
});

test('CST tìm đa chiều, bỏ dấu và không phụ thuộc thứ tự từ', () => {
  assert.deepEqual(filterCstSearch(rows, 'thong nhat live'), [rows[0]]);
  assert.deepEqual(filterCstSearch(rows, 'live nhat thong'), [rows[0]]);
  assert.deepEqual(filterCstSearch(rows, 'bo cong anh dn016'), [rows[0], rows[2]]);
  assert.deepEqual(filterCstSearch(rows, 'dona qd141'), [rows[0], rows[2]]);
});

test('CST không fuzzy mã định danh để tránh ghép nhầm quyền/dữ liệu', () => {
  assert.deepEqual(filterCstSearch(rows, 'dn017'), []);
  assert.deepEqual(filterCstSearch(rows, 'qd140'), []);
});
