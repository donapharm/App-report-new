import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_UNITS, isGrantableColumn, grantableColumns, unitsByEmployee, groupsForUnits, buildGrantPanel,
  toggleColumn, setColumnGroups, applyColumnsToMany, grantSavePayload, dirtyRows, grantSummary, columnScopeLabel,
  isGroupChecked, isColumnAllGroups, toggleColumnGroup, setColumnAllGroups, toggleGroupAllColumns, grantCounts,
  verifySavedGrants,
} from '../src/catalogCostGrantsModel.js';

const CATALOG = [
  { emp_code: 'DN001', unit_code: '120.HTNT' },
  { emp_code: 'DN001', unit_code: '021.TTYT' },
  { emp_code: 'DN002', unit_code: '033.BVĐK' },
];
// Ví dụ nguyên văn CEO nêu 08/08 để khoá đúng cách gộp nhóm.
const CEO_CATALOG = [
  { emp_code: 'DN002', unit_code: '001.BVĐK Đồng Nai' },
  { emp_code: 'DN002', unit_code: '001.BVĐK Đồng Nai-Khu C' },
  { emp_code: 'DN002', unit_code: '001.NT-BVĐK Đồng Nai' },
  { emp_code: 'DN008', unit_code: '033.PKĐK An Long Thành' },
  { emp_code: 'DN008', unit_code: '033.PKĐK Long Khánh' },
];
const CEO_GROUPS = {
  '001.BVĐK Đồng Nai': { key: '001', label: '001 · BVĐK Đồng Nai' },
  '001.BVĐK Đồng Nai-Khu C': { key: '001', label: '001 · BVĐK Đồng Nai' },
  '001.NT-BVĐK Đồng Nai': { key: '001', label: '001 · BVĐK Đồng Nai' },
  '033.PKĐK An Long Thành': { key: '033', label: '033 · PKĐK An Long Thành' },
  '033.PKĐK Long Khánh': { key: '033', label: '033 · PKĐK An Long Thành' },
};
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

test('tra nhóm KHÔNG phân biệt hoa/thường — đơn vị có nhóm không bị báo nhầm "chưa có nhóm"', () => {
  // Lỗi CEO chụp 08/08: backend trả bảng tra theo mã gốc ('001.BVĐK Đồng Nai'),
  // panel giữ mã đã viết hoa ⇒ tra trượt, báo 28 đơn vị "chưa nhận diện được nhóm"
  // trong khi chúng phân giải ra BV bình thường.
  const { groups, ungroupedUnits } = groupsForUnits(
    ['001.BVĐK ĐỒNG NAI'],
    { '001.BVĐK Đồng Nai': { key: 'BV', label: 'BV · Bệnh viện' } },
  );
  assert.deepEqual(ungroupedUnits, [], 'không được báo nhầm là chưa có nhóm');
  assert.deepEqual(groups.map((g) => g.key), ['BV']);
});

test('NHÓM = mã đơn vị (001, 033), KHÔNG phải loại đơn vị (CEO đính chính 08/08)', () => {
  const { groups } = groupsForUnits(
    ['001.BVĐK Đồng Nai', '001.BVĐK Đồng Nai-Khu C', '001.NT-BVĐK Đồng Nai'],
    CEO_GROUPS,
  );
  // Gộp theo LOẠI thì '001.NT-…' rơi sang nhóm NT, tách khỏi chính bệnh viện của nó.
  assert.equal(groups.length, 1, 'ba mã 001.* phải là MỘT nhóm');
  assert.equal(groups[0].key, '001');
  assert.equal(groups[0].unitCount, 3);
});

test('mỗi nhóm mang theo DANH SÁCH đơn vị bên trong — CEO thấy tick nhóm là mở mã nào', () => {
  const { groups } = groupsForUnits(['033.PKĐK An Long Thành', '033.PKĐK Long Khánh'], CEO_GROUPS);
  assert.deepEqual(groups[0].units, ['033.PKĐK An Long Thành', '033.PKĐK Long Khánh']);
});

test('cấp nhóm CHỈ phủ đơn vị NV thực sự phụ trách — không mở thêm mã lạ cùng nhóm', () => {
  // DN002 chỉ phụ trách 001.BVĐK Đồng Nai (không có Khu C / NT).
  const panel = buildGrantPanel({
    grants: [], columns: COLUMNS, groupsByUnit: CEO_GROUPS,
    catalogRows: [{ emp_code: 'DN002', unit_code: '001.BVĐK Đồng Nai' }],
    employees: [{ code: 'DN002', name: 'NV Hai' }],
  });
  const row = panel.rows.find((item) => item.empCode === 'DN002');
  assert.deepEqual(row.availableGroups.map((g) => g.key), ['001']);
  assert.deepEqual(row.availableGroups[0].units, ['001.BVĐK ĐỒNG NAI'],
    'chỉ đúng mã họ phụ trách, dù nhóm 001 ngoài đời còn Khu C và NT');
});

/* ── Màn chi tiết một NV (CEO yêu cầu 09/08) ───────────────────────────────── */

const detailPanel = () => buildGrantPanel({
  grants: [], columns: COLUMNS, groupsByUnit: CEO_GROUPS, catalogRows: CEO_CATALOG,
  employees: [{ code: 'DN002', name: 'NV Hai' }, { code: 'DN008', name: 'NV Tám' }],
});

test('lưới chi tiết: tick MỘT ô (cột × nhóm), không đụng ô khác', () => {
  let panel = detailPanel();
  panel = toggleColumnGroup(panel, 'DN008', 'c41', '033');
  const row = rowOf(panel, 'DN008');
  assert.equal(isGroupChecked(row, 'c41', '033'), true);
  assert.equal(isGroupChecked(row, 'c43', '033'), false, 'cột khác không bị đụng');
});

test('tick đủ MỌI nhóm ⇒ tự gom về "*" để nhóm mới sau này cũng được phủ', () => {
  let panel = detailPanel();
  // DN002 chỉ có đúng một nhóm 001 ⇒ tick nó là đủ mọi nhóm.
  panel = toggleColumnGroup(panel, 'DN002', 'c41', '001');
  assert.deepEqual(rowOf(panel, 'DN002').columns.c41, [ALL_UNITS]);
  assert.equal(isColumnAllGroups(rowOf(panel, 'DN002'), 'c41'), true);
});

test('đang "*" mà bỏ tick một nhóm ⇒ nở ra danh sách tường minh, giữ nhóm còn lại', () => {
  let panel = buildGrantPanel({
    grants: [], columns: COLUMNS, groupsByUnit: CEO_GROUPS,
    catalogRows: [
      { emp_code: 'DN009', unit_code: '001.BVĐK Đồng Nai' },
      { emp_code: 'DN009', unit_code: '033.PKĐK Long Khánh' },
    ],
    employees: [{ code: 'DN009', name: 'NV Chín' }],
  });
  panel = setColumnAllGroups(panel, 'DN009', 'c41', true);
  assert.deepEqual(rowOf(panel, 'DN009').columns.c41, [ALL_UNITS]);
  panel = toggleColumnGroup(panel, 'DN009', 'c41', '001');
  assert.deepEqual(rowOf(panel, 'DN009').columns.c41, ['033'], 'phải giữ nhóm 033, không mất oan');
});

test('hàng "Mọi nhóm" bật/tắt cả cột', () => {
  let panel = detailPanel();
  panel = setColumnAllGroups(panel, 'DN008', 'c43', true);
  assert.deepEqual(rowOf(panel, 'DN008').columns.c43, [ALL_UNITS]);
  panel = setColumnAllGroups(panel, 'DN008', 'c43', false);
  assert.equal(rowOf(panel, 'DN008').columns.c43, undefined, 'tắt cả cột = không cấp cột đó');
});

test('bật cả HÀNG: một nhóm, mọi cột — thao tác nhanh theo cụm đơn vị', () => {
  let panel = detailPanel();
  const keys = ['c36', 'c41', 'c43'];
  panel = toggleGroupAllColumns(panel, 'DN008', '033', keys, true);
  const row = rowOf(panel, 'DN008');
  for (const key of keys) assert.equal(isGroupChecked(row, key, '033'), true, key);
  panel = toggleGroupAllColumns(panel, 'DN008', '033', keys, false);
  assert.deepEqual(rowOf(panel, 'DN008').columns, {}, 'tắt hết hàng ⇒ không còn cấp gì');
});

test('tóm tắt cho dòng danh sách: mấy cột, mấy nhóm', () => {
  // NV có HAI nhóm để phân biệt được "một nhóm" với "mọi nhóm".
  let panel = buildGrantPanel({
    grants: [], columns: COLUMNS, groupsByUnit: CEO_GROUPS,
    catalogRows: [
      { emp_code: 'DN009', unit_code: '001.BVĐK Đồng Nai' },
      { emp_code: 'DN009', unit_code: '033.PKĐK Long Khánh' },
    ],
    employees: [{ code: 'DN009', name: 'NV Chín' }],
  });
  assert.deepEqual(grantCounts(rowOf(panel, 'DN009')), { columnCount: 0, allGroups: false, groupCount: 0 });
  panel = toggleColumnGroup(panel, 'DN009', 'c41', '033');
  assert.deepEqual(grantCounts(rowOf(panel, 'DN009')), { columnCount: 1, allGroups: false, groupCount: 1 });
  // Tick nốt nhóm còn lại ⇒ tự gom thành '*'.
  panel = toggleColumnGroup(panel, 'DN009', 'c41', '001');
  assert.equal(grantCounts(rowOf(panel, 'DN009')).allGroups, true);
});

test('NV chỉ phụ trách MỘT nhóm: tick nhóm đó = mọi nhóm, tự gom về "*"', () => {
  let panel = detailPanel();
  panel = toggleColumnGroup(panel, 'DN008', 'c41', '033');
  // DN008 chỉ có nhóm 033 ⇒ tick nó là đã phủ hết, gom '*' cho nhóm mới sau này cũng được phủ.
  assert.deepEqual(rowOf(panel, 'DN008').columns.c41, [ALL_UNITS]);
});

/* ── verifySavedGrants: bằng chứng, không phải lời hứa (CEO lo 09/08/2026) ───── */

test('khớp đúng thì ok, dù thứ tự nhóm/cột khác nhau', () => {
  const panel = { rows: [{ empCode: 'DN004', columns: { c43: ['018', '015'], c41: ['*'] }, availableGroups: [] }] };
  const expected = new Map([['DN004', { c41: ['*'], c43: ['015', '018'] }]]);
  const result = verifySavedGrants(panel, expected);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 1);
});

test('‼ máy chủ giữ ÍT hơn thứ đã tick ⇒ báo lệch, nêu cả hai bên', () => {
  // Đúng nỗi lo của CEO: backend chuẩn hoá bỏ bớt nhóm/cột mà vẫn trả 200.
  const panel = { rows: [{ empCode: 'DN004', columns: { c41: ['*'] }, availableGroups: [] }] };
  const expected = new Map([['DN004', { c41: ['*'], c43: ['*'] }]]);
  const result = verifySavedGrants(panel, expected);
  assert.equal(result.ok, false);
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].empCode, 'DN004');
  assert.match(result.mismatches[0].wanted, /C43/);
  assert.doesNotMatch(result.mismatches[0].got, /C43/);
});

test('‼ máy chủ giữ NHIỀU hơn (quyền thừa) cũng là lệch — không chỉ soi thiếu', () => {
  const panel = { rows: [{ empCode: 'DN004', columns: { c41: ['*'], c45: ['*'] }, availableGroups: [] }] };
  const expected = new Map([['DN004', { c41: ['*'] }]]);
  assert.equal(verifySavedGrants(panel, expected).ok, false);
});

test('sai NHÓM (đúng cột, khác mã đơn vị) vẫn bị bắt', () => {
  const panel = { rows: [{ empCode: 'DN004', columns: { c43: ['021'] }, availableGroups: [] }] };
  const expected = new Map([['DN004', { c43: ['015'] }]]);
  assert.equal(verifySavedGrants(panel, expected).ok, false);
});

test('không đọc lại được NV ⇒ LỆCH, không coi như xong', () => {
  const result = verifySavedGrants({ rows: [] }, new Map([['DN004', { c41: ['*'] }]]));
  assert.equal(result.ok, false);
  assert.match(result.mismatches[0].got, /không đọc lại được/);
});
