/**
 * BỘ LỌC DÙNG CHUNG hai menu chi phí (CEO yêu cầu 09/08/2026).
 *
 * Trọng tâm: luật "gõ nhóm mã PHẢI CÓ DẤU CHẤM" — CEO nhấn mạnh hai lần trong cùng
 * một tin. Thiếu dấu chấm mà vẫn lọc thì nhóm 001 nuốt luôn 0011, và cái sai đó
 * không nhìn bằng mắt mà thấy được.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const costFilters = require('../src/costFilters');

const row = (patch = {}) => ({
  empCode: 'DN001', unitCode: '033.PKĐK AN LONG KHÁNH', productCode: 'G1.A',
  contractorCode: '01.DONA', contractorName: 'CTY DONAPHARM', route: 'TUYẾN A', priority: 'H.A*', ...patch,
});

/* ── Gõ nhóm mã: DẤU CHẤM là bắt buộc ─────────────────────────────────────── */

test('‼ gõ "033." (CÓ dấu chấm) ⇒ lọc đúng cụm 033', () => {
  const filters = costFilters.normalizeFilters({ groupQuery: '033.' });
  assert.equal(costFilters.groupQueryPrefix('033.'), '033');
  assert.equal(costFilters.passes(row(), filters), true);
  assert.equal(costFilters.passes(row({ unitCode: '120.HTNT' }), filters), false);
});

test('‼ gõ "033" (THIẾU dấu chấm) ⇒ KHÔNG lọc theo nhóm, và NÓI RA lý do', () => {
  // Không lọc là cố ý: "033" còn dính 0330, 1033… nên lọc theo nó là lọc sai.
  assert.equal(costFilters.groupQueryPrefix('033'), null);
  const note = costFilters.groupQueryNote('033');
  assert.match(note, /dấu chấm/);
  assert.match(note, /033\./);
  // Lặng lẽ bỏ qua mới là lỗi: CEO tưởng đã lọc mà bảng vẫn full.
  assert.notEqual(note, '');
});

test('nhóm 001 KHÔNG được nuốt nhóm 0011 — đúng lý do CEO bắt phải có dấu chấm', () => {
  const filters = costFilters.normalizeFilters({ groupQuery: '001.' });
  assert.equal(costFilters.passes(row({ unitCode: '001.BVĐK ĐỒNG NAI' }), filters), true);
  assert.equal(costFilters.passes(row({ unitCode: '0011.TRẠM Y TẾ' }), filters), false);
});

test('ô nhóm để trống ⇒ không có ghi chú, không lọc gì', () => {
  assert.equal(costFilters.groupQueryNote(''), '');
  assert.equal(costFilters.passes(row(), costFilters.normalizeFilters({})), true);
});

/* ── Group DONA / đối tác ──────────────────────────────────────────────────── */

test('mã nhà thầu có "DONA" ⇒ Group-DONA; còn lại ⇒ Group-đối tác', () => {
  assert.equal(costFilters.partnerGroupOf('01.DONA'), 'DONA');
  assert.equal(costFilters.partnerGroupOf('02.AFP'), 'PARTNER');
  assert.equal(costFilters.partnerGroupOf('04.NGUYEN'), 'PARTNER');
});

test('‼ KHÔNG có mã nhà thầu ⇒ trả rỗng, KHÔNG đoán bừa là đối tác', () => {
  // Đoán bừa thì một dòng chưa gán nhà thầu sẽ nằm im trong nhóm "đối tác" và
  // không ai đi tìm nó nữa.
  assert.equal(costFilters.partnerGroupOf(''), '');
  assert.equal(costFilters.partnerGroupOf(null), '');
  const filters = costFilters.normalizeFilters({ partnerGroups: ['PARTNER'] });
  assert.equal(costFilters.passes(row({ contractorCode: '' }), filters), false);
});

test('lọc theo Group-DONA chỉ giữ hàng nhà mình', () => {
  const filters = costFilters.normalizeFilters({ partnerGroups: ['DONA'] });
  assert.equal(costFilters.passes(row(), filters), true);
  assert.equal(costFilters.passes(row({ contractorCode: '02.AFP' }), filters), false);
});

/* ── Tám chiều lọc CEO nêu ─────────────────────────────────────────────────── */

test('đủ tám chiều: mã NT · tên NT · group · NV · tuyến · mã ĐV · nhóm mã · ưu tiên', () => {
  const cases = [
    ['contractors', '01.DONA', '09.KHAC'],
    ['contractorNames', 'CTY DONAPHARM', 'CTY KHÁC'],
    ['partnerGroups', 'DONA', 'PARTNER'],
    ['employees', 'DN001', 'DN002'],
    ['routes', 'TUYẾN A', 'TUYẾN B'],
    ['units', '033.PKĐK AN LONG KHÁNH', '120.HTNT'],
    ['groups', '033', '120'],
    ['priorities', 'H.A*', 'H.B'],
  ];
  for (const [key, hit, miss] of cases) {
    assert.equal(costFilters.passes(row(), costFilters.normalizeFilters({ [key]: [hit] })), true, `${key} phải khớp`);
    assert.equal(costFilters.passes(row(), costFilters.normalizeFilters({ [key]: [miss] })), false, `${key} phải loại`);
  }
});

test('lọc KHÔNG phân biệt hoa thường — CEO gõ tay không phải canh chữ hoa', () => {
  assert.equal(costFilters.passes(row(), costFilters.normalizeFilters({ contractors: ['01.dona'] })), true);
  assert.equal(costFilters.passes(row({ contractorCode: '01.dona' }), costFilters.normalizeFilters({ contractors: ['01.DONA'] })), true);
});

test('nhiều chiều cùng lúc là VÀ, không phải HOẶC', () => {
  const filters = costFilters.normalizeFilters({ groups: ['033'], priorities: ['H.B'] });
  assert.equal(costFilters.passes(row(), filters), false, 'khớp nhóm nhưng sai ưu tiên thì phải loại');
});

test('tìm tự do quét mọi chiều', () => {
  assert.equal(costFilters.passes(row(), costFilters.normalizeFilters({ search: 'donapharm' })), true);
  assert.equal(costFilters.passes(row(), costFilters.normalizeFilters({ search: 'không có chuỗi này' })), false);
});

/* ── Danh sách chọn thu TRƯỚC khi lọc ─────────────────────────────────────── */

test('collector gom đủ tám chiều để dựng danh sách chọn', () => {
  const seen = costFilters.collector();
  seen.add(row());
  seen.add(row({ empCode: 'DN002', unitCode: '120.HTNT', contractorCode: '02.AFP', contractorName: 'CTY AFP' }));
  const options = seen.result();
  assert.deepEqual(options.employees, ['DN001', 'DN002']);
  assert.deepEqual(options.groups, ['033', '120']);
  assert.deepEqual(options.partnerGroups, ['DONA', 'PARTNER']);
  assert.deepEqual(options.contractorNames, ['CTY AFP', 'CTY DONAPHARM']);
});

/* ── Đọc chiều lọc từ dòng doanh thu ──────────────────────────────────────── */

test('dimsOfRevenueRow đọc được nhiều kiểu đặt tên trường của nguồn', () => {
  assert.deepEqual(costFilters.dimsOfRevenueRow({ contractor_code: 'X', contractor_name: 'Y', route: 'R', c10: 'H.A' }),
    { contractorCode: 'X', contractorName: 'Y', route: 'R', priority: 'H.A' });
  assert.deepEqual(costFilters.dimsOfRevenueRow({ CONTRACTOR_CODE: 'X', TUYEN: 'R' }),
    { contractorCode: 'X', contractorName: '', route: 'R', priority: '' });
});

test('‼ thiếu tên nhà thầu thì để RỖNG, KHÔNG lấy mã thay tên', () => {
  // Lấy mã thay tên thì hai chiều lọc khác nhau hoá thành một, và người dùng
  // tưởng nguồn đã có tên.
  assert.equal(costFilters.dimsOfRevenueRow({ contractor_code: '01.DONA' }).contractorName, '');
});

/* ── isActive: khi nào được phép giấu dòng rỗng ───────────────────────────── */

test('isActive chỉ bật khi thật sự có điều kiện lọc', () => {
  assert.equal(costFilters.isActive({}), false);
  assert.equal(costFilters.isActive({ groups: ['033'] }), true);
  assert.equal(costFilters.isActive({ search: 'abc' }), true);
  // Gõ nhóm thiếu dấu chấm KHÔNG lọc ⇒ cũng không được tính là đang lọc.
  assert.equal(costFilters.isActive({ groupQuery: '033' }), false);
  assert.equal(costFilters.isActive({ groupQuery: '033.' }), true);
});

test('nhóm mã dùng ĐÚNG hàm gốc của app, không có bản regex thứ hai', () => {
  const { groupOf } = require('../src/catalogCostColumnGrants');
  assert.equal(costFilters.groupOf, groupOf);
});
