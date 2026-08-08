import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_UNITS, isGrantableColumn, grantableColumns, unitsByEmployee, groupsForUnits, buildGrantPanel,
  toggleColumn, setColumnGroups, applyColumnsToMany, grantSavePayload, dirtyRows, grantSummary, columnScopeLabel,
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
// Bảng tra "đơn vị → nhóm" — thực tế do backend phân giải (endpoint unit-groups).
const GROUPS_BY_UNIT = {
  '120.HTNT': { key: 'HTNT', label: 'HTNT' },
  '021.TTYT': { key: 'TTYT', label: 'TTYT · Trung tâm y tế' },
  '033.BVĐK': { key: 'BV', label: 'BV · Bệnh viện' },
};
const panelOf = (grants = []) => buildGrantPanel({
  grants, columns: COLUMNS, catalogRows: CATALOG, groupsByUnit: GROUPS_BY_UNIT,
  employees: [{ code: 'DN001', name: 'NV Một' }, { code: 'DN002', name: 'NV Hai' }],
});
const rowOf = (panel, code) => panel.rows.find((row) => row.empCode === code);

test('whitelist khớp server: C33–C46, chặn C32/C47', () => {
  for (const key of ['c33', 'c41', 'c46']) assert.equal(isGrantableColumn(key), true, key);
  for (const key of ['c32', 'c47', 'c31', 'c48', 'revenue', '']) assert.equal(isGrantableColumn(key), false, key);
  assert.deepEqual(grantableColumns(COLUMNS).map((c) => c.key), ['c36', 'c41', 'c43'], 'C47 phải bị loại khỏi menu');
});

test('đơn vị + nhóm chọn được suy từ chính bảng phân công — không tự chế danh sách', () => {
  assert.deepEqual([...unitsByEmployee(CATALOG)], [['DN001', ['021.TTYT', '120.HTNT']], ['DN002', ['033.BVĐK']]]);
  const { groups } = groupsForUnits(['120.HTNT', '021.TTYT'], GROUPS_BY_UNIT);
  assert.deepEqual(groups.map((group) => group.key), ['HTNT', 'TTYT']);
});

test('đơn vị không phân giải được nhóm thì NÓI RA, không âm thầm biến mất', () => {
  const { groups, ungroupedUnits } = groupsForUnits(['120.HTNT', '999'], GROUPS_BY_UNIT);
  assert.deepEqual(groups.map((group) => group.key), ['HTNT']);
  assert.deepEqual(ungroupedUnits, ['999'], 'phải liệt kê để CEO biết chỉ "*" mới phủ tới');
});

test('mặc định TẮT: NV chưa cấp hiện "không thấy cột nào", không để trống gây hiểu nhầm', () => {
  const panel = panelOf();
  assert.deepEqual(rowOf(panel, 'DN001').columns, {});
  assert.equal(grantSummary(rowOf(panel, 'DN001')), 'Không thấy cột % nào');
  assert.equal(dirtyRows(panel).length, 0, 'mới tải thì chưa có gì để lưu');
});

test('tick cột ⇒ mặc định mọi nhóm; bỏ tick ⇒ cột biến mất khỏi ma trận', () => {
  let panel = panelOf([{ empCode: 'DN001', columns: { c41: ['*'] } }]);
  panel = toggleColumn(panel, 'DN001', 'c43');
  assert.deepEqual(rowOf(panel, 'DN001').columns, { c41: [ALL_UNITS], c43: [ALL_UNITS] });
  panel = toggleColumn(panel, 'DN001', 'c41');
  panel = toggleColumn(panel, 'DN001', 'c43');
  assert.deepEqual(rowOf(panel, 'DN001').columns, {}, 'không để lại quyền treo');
});

test('cột ngoài whitelist bấm cũng không ăn', () => {
  const panel = panelOf();
  assert.equal(toggleColumn(panel, 'DN001', 'c47'), panel, 'panel không đổi');
  assert.equal(toggleColumn(panel, 'DN001', 'c32'), panel);
});

test('V2: mỗi CỘT một phạm vi NHÓM riêng — C41 mọi nhóm, C43 chỉ TTYT', () => {
  let panel = panelOf([{ empCode: 'DN001', columns: { c41: ['*'] } }]);
  panel = toggleColumn(panel, 'DN001', 'c43');
  panel = setColumnGroups(panel, 'DN001', 'c43', ['TTYT']);
  const row = rowOf(panel, 'DN001');
  assert.deepEqual(row.columns, { c41: [ALL_UNITS], c43: ['TTYT'] });
  assert.equal(columnScopeLabel(row, 'c41'), 'mọi nhóm');
  assert.equal(columnScopeLabel(row, 'c43'), '1 nhóm');
});

test('phạm vi chỉ THU HẸP: nhóm NV không phụ trách bị loại; chọn rỗng ⇒ cột tắt luôn', () => {
  let panel = panelOf([{ empCode: 'DN001', columns: { c41: ['*'] } }]);
  panel = setColumnGroups(panel, 'DN001', 'c41', ['TTYT', 'BV']);
  assert.deepEqual(rowOf(panel, 'DN001').columns.c41, ['TTYT'], 'BV không thuộc DN001 nên bị loại ngay trên giao diện');
  panel = setColumnGroups(panel, 'DN001', 'c41', [ALL_UNITS, 'TTYT']);
  assert.deepEqual(rowOf(panel, 'DN001').columns.c41, [ALL_UNITS], '"mọi nhóm" thì các nhóm lẻ là thừa');
  panel = setColumnGroups(panel, 'DN001', 'c41', []);
  assert.deepEqual(rowOf(panel, 'DN001').columns, {}, 'cấp cột mà không nhóm nào = không cấp');
});

test('thao tác hàng loạt áp đúng danh sách NV được chọn, không đụng người khác', () => {
  let panel = panelOf();
  panel = applyColumnsToMany(panel, ['DN001'], ['c41', 'c43']);
  assert.deepEqual(rowOf(panel, 'DN001').columns, { c41: [ALL_UNITS], c43: [ALL_UNITS] });
  assert.deepEqual(rowOf(panel, 'DN002').columns, {}, 'DN002 không được chọn nên không đổi');
  assert.equal(rowOf(panel, 'DN002').dirty, false);
});

test('chỉ gửi backend những dòng CEO thực sự đổi, payload đúng ma trận cột→nhóm', () => {
  let panel = panelOf([{ empCode: 'DN002', columns: { c36: ['BV'] } }]);
  panel = toggleColumn(panel, 'DN001', 'c41');
  assert.deepEqual(dirtyRows(panel).map((row) => row.empCode), ['DN001']);
  assert.deepEqual(grantSavePayload(rowOf(panel, 'DN001')), { columns: { c41: [ALL_UNITS] } });
  assert.deepEqual(grantSavePayload(rowOf(panel, 'DN002')), { columns: { c36: ['BV'] } });
  assert.deepEqual(grantSavePayload({ columns: {} }), { columns: {} });
});

test('câu mô tả cho CEO đọc lướt nói rõ TỪNG CỘT thấy ở nhóm nào', () => {
  const panel = panelOf([{ empCode: 'DN001', columns: { c41: ['*'], c43: ['TTYT'] } }]);
  assert.equal(grantSummary(rowOf(panel, 'DN001')), 'C41: mọi nhóm · C43: TTYT · Trung tâm y tế');
});

test('bản ghi v1 cũ (mảng cột) vẫn đọc được — mỗi cột nhận mọi nhóm', () => {
  const panel = panelOf([{ empCode: 'DN001', columns: ['c41', 'c43'], units: ['120.HTNT'] }]);
  assert.deepEqual(rowOf(panel, 'DN001').columns, { c41: [ALL_UNITS], c43: [ALL_UNITS] });
});
