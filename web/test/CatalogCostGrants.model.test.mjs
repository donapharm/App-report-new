import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_UNITS, isGrantableColumn, grantableColumns, unitsByEmployee, buildGrantPanel,
  toggleColumn, setUnits, applyColumnsToMany, grantSavePayload, dirtyRows, grantSummary,
} from '../src/catalogCostGrantsModel.js';

const CATALOG = [
  { emp_code: 'DN001', unit_code: '120.HTNT' },
  { emp_code: 'DN001', unit_code: '021.TTYT' },
  { emp_code: 'DN002', unit_code: '033.BVĐK' },
];
const COLUMNS = [
  { key: 'c36', label: 'C36 CP ctv/khác' }, { key: 'c41', label: 'C41 CP đặt hàng' },
  { key: 'c43', label: 'C43 CP bs/td' }, { key: 'c47', label: 'C47 Tổng thành tiền CP' },
];
const panelOf = (grants = []) => buildGrantPanel({
  grants, columns: COLUMNS, catalogRows: CATALOG,
  employees: [{ code: 'DN001', name: 'NV Một' }, { code: 'DN002', name: 'NV Hai' }],
});
const rowOf = (panel, code) => panel.rows.find((row) => row.empCode === code);

test('whitelist khớp server: C33–C46, chặn C32/C47', () => {
  for (const key of ['c33', 'c41', 'c46']) assert.equal(isGrantableColumn(key), true, key);
  for (const key of ['c32', 'c47', 'c31', 'c48', 'revenue', '']) assert.equal(isGrantableColumn(key), false, key);
  assert.deepEqual(grantableColumns(COLUMNS).map((c) => c.key), ['c36', 'c41', 'c43'], 'C47 phải bị loại khỏi menu');
});

test('đơn vị chọn được suy từ chính bảng phân công — không tự chế danh sách', () => {
  assert.deepEqual([...unitsByEmployee(CATALOG)], [['DN001', ['021.TTYT', '120.HTNT']], ['DN002', ['033.BVĐK']]]);
});

test('mặc định TẮT: NV chưa cấp hiện "không thấy cột nào", không để trống gây hiểu nhầm', () => {
  const panel = panelOf();
  assert.deepEqual(rowOf(panel, 'DN001').columns, []);
  assert.deepEqual(rowOf(panel, 'DN001').units, []);
  assert.equal(grantSummary(rowOf(panel, 'DN001')), 'Không thấy cột % nào');
  assert.equal(dirtyRows(panel).length, 0, 'mới tải thì chưa có gì để lưu');
});

test('bật/tắt cột; bỏ hết cột thì dọn luôn phạm vi (khớp luật backend)', () => {
  let panel = panelOf([{ empCode: 'DN001', columns: ['c41'], units: ['120.HTNT'] }]);
  panel = toggleColumn(panel, 'DN001', 'c43');
  assert.deepEqual(rowOf(panel, 'DN001').columns, ['c41', 'c43']);
  panel = toggleColumn(panel, 'DN001', 'c41');
  panel = toggleColumn(panel, 'DN001', 'c43');
  assert.deepEqual(rowOf(panel, 'DN001').columns, []);
  assert.deepEqual(rowOf(panel, 'DN001').units, [], 'không để lại quyền treo');
});

test('cột ngoài whitelist bấm cũng không ăn', () => {
  const panel = panelOf();
  assert.equal(toggleColumn(panel, 'DN001', 'c47'), panel, 'panel không đổi');
  assert.equal(toggleColumn(panel, 'DN001', 'c32'), panel);
});

test('phạm vi chỉ THU HẸP: không cấp được đơn vị NV không phụ trách', () => {
  let panel = panelOf([{ empCode: 'DN001', columns: ['c41'], units: [ALL_UNITS] }]);
  panel = setUnits(panel, 'DN001', ['120.HTNT', '999.KHONG-PHU-TRACH']);
  assert.deepEqual(rowOf(panel, 'DN001').units, ['120.HTNT'], 'đơn vị lạ bị loại ngay trên giao diện');
  panel = setUnits(panel, 'DN001', [ALL_UNITS, '120.HTNT']);
  assert.deepEqual(rowOf(panel, 'DN001').units, [ALL_UNITS], '"mọi đơn vị" thì các mã lẻ là thừa');
});

test('thao tác hàng loạt áp đúng danh sách NV được chọn, không đụng người khác', () => {
  let panel = panelOf();
  panel = applyColumnsToMany(panel, ['DN001'], ['c41', 'c43']);
  assert.deepEqual(rowOf(panel, 'DN001').columns, ['c41', 'c43']);
  assert.deepEqual(rowOf(panel, 'DN001').units, [ALL_UNITS], 'chưa chọn đơn vị ⇒ mặc định mọi đơn vị phụ trách');
  assert.deepEqual(rowOf(panel, 'DN002').columns, [], 'DN002 không được chọn nên không đổi');
  assert.equal(rowOf(panel, 'DN002').dirty, false);
});

test('chỉ gửi backend những dòng CEO thực sự đổi, payload gọn đúng hợp đồng', () => {
  let panel = panelOf([{ empCode: 'DN002', columns: ['c36'], units: ['033.BVĐK'] }]);
  panel = toggleColumn(panel, 'DN001', 'c41');
  assert.deepEqual(dirtyRows(panel).map((row) => row.empCode), ['DN001']);
  assert.deepEqual(grantSavePayload(rowOf(panel, 'DN001')), { columns: ['c41'], units: [ALL_UNITS] });
  assert.deepEqual(grantSavePayload(rowOf(panel, 'DN002')), { columns: ['c36'], units: ['033.BVĐK'] });
  assert.deepEqual(grantSavePayload({ columns: [], units: ['120.HTNT'] }), { columns: [], units: [] });
});

test('câu mô tả cho CEO đọc lướt nói rõ cả cột lẫn phạm vi', () => {
  const panel = panelOf([{ empCode: 'DN001', columns: ['c41', 'c43'], units: ['120.HTNT'] }]);
  assert.equal(grantSummary(rowOf(panel, 'DN001')), 'C41 · C43 — 1 đơn vị');
  assert.equal(grantSummary({ columns: ['c41'], units: [ALL_UNITS] }), 'C41 — mọi đơn vị đang phụ trách');
});
