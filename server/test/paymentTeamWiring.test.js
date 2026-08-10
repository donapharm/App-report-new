'use strict';
/**
 * ‼ BẢNG "THANH TOÁN CP TOÀN ĐỘI" — nối dây đúng chỗ.
 *
 * Sự việc 04/08/2026: bản `bd4ceb4` deploy PASS nhưng nghiệm thu FAIL. Bot soi API
 * live: T07 có đủ **21 NV subtotal**, tổng tạm tính ~3.224.290.181đ, nhưng
 * `paymentTeam.rows = 0`. Nguyên nhân: `employeeSubtotals` do `transformPeriod` sinh
 * ra ở bước SAU, nên đọc `merged.employeeSubtotals` luôn ra `undefined`.
 *
 * Bot đề xuất dời việc dựng bảng xuống SAU `transformReport`. KHÔNG làm vậy: ở đó
 * subtotals tính trên rows ĐÃ LỌC (`numbered`) ⇒ CEO gõ ô tìm kiếm là bảng thanh
 * toán toàn đội co lại theo, mà nhìn vẫn như số thật. Lỗi tiền, nặng hơn bảng rỗng.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const employeeCostTable = require('../src/employeeCostTable');

const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
const block = source.slice(source.indexOf('const merged = employeeCostTable.mergeEmployeeReports'),
  source.indexOf('// Export giữ nguyên đường audit/build riêng'));

test('‼ KHÔNG được đọc merged.employeeSubtotals — trường đó chưa tồn tại ở bước này', () => {
  assert.doesNotMatch(block, /subtotals:\s*merged\?\.employeeSubtotals/,
    'đọc trường chưa tồn tại ⇒ bảng đội rỗng tuyệt đối, đúng lỗi bd4ceb4');
});

test('‼ subtotals phải tính từ rows nghiệp vụ CHƯA LỌC, không lấy từ transformReport', () => {
  assert.match(block, /employeeCostTable\.employeeSubtotals\([\s\S]{0,200}teamPeriod\.rows/,
    'phải tự tính tại chỗ từ rows chưa lọc');
  assert.match(block, /reconciliationSynthetic\s*!==\s*true/,
    'hàng chênh lệch shadow chỉ để hiển thị, không được lọt vào sổ thanh toán');
  // Nếu ai đó dời xuống sau transformReport thì `numbered` (đã lọc) sẽ lọt vào.
  assert.doesNotMatch(block, /transformReport[\s\S]{0,200}paymentTeam/,
    'dựng bảng đội sau transformReport ⇒ bảng co theo bộ lọc của người xem');
});

test('phải lấy ĐÚNG kỳ đang xem, không vơ đại kỳ đầu tiên', () => {
  assert.match(block, /find\(\(item\) => String\(item\.period\) === String\(range\.to\)\)/);
  assert.doesNotMatch(block, /periods\?\.\[0\]\?\.employeeSubtotals/, 'lấy periods[0] là sai kỳ khi xem nhiều tháng');
});

test('‼ dựng subtotals từ rows chưa lọc ra ĐỦ người, lọc rồi thì THIẾU', () => {
  const columns = [{ key: 'c41', kind: 'money' }];
  const rows = [
    { employeeCode: 'DN001', employeeName: 'A', province: 'Đồng Nai', c41: 10 },
    { employeeCode: 'DN002', employeeName: 'B', province: 'Bình Dương', c41: 20 },
    { employeeCode: 'DN003', employeeName: 'C', province: 'Bình Dương', c41: 30 },
  ];
  const full = employeeCostTable.employeeSubtotals(rows, columns, {});
  assert.equal(full.length, 3, 'rows chưa lọc ⇒ đủ 3 NV');

  // Mô phỏng đúng cái bẫy: nếu dựng sau bộ lọc thì chỉ còn 2 NV — bảng thanh toán
  // toàn đội tự co lại mà không báo gì.
  const afterFilter = employeeCostTable.employeeSubtotals(
    rows.filter((row) => row.province === 'Bình Dương'), columns, {},
  );
  assert.equal(afterFilter.length, 2, 'chứng minh bẫy có thật: lọc xong mất 1 NV');
  assert.notDeepEqual(full.map((item) => item.employeeCode), afterFilter.map((item) => item.employeeCode));
});

test('hàng reconciliation shadow không đổi rowCount hay tổng của bảng thanh toán', () => {
  const columns = [{ key: 'c41', kind: 'money' }];
  const rows = [
    { employeeCode: 'DN005', employeeName: 'A', c41: 100, rowMonthlyTotal: 100 },
    { employeeCode: 'DN005', employeeName: 'A', c41: null, quantity: 20, reconciliationSynthetic: true },
  ];
  const paymentRows = rows.filter((row) => row?.reconciliationSynthetic !== true);
  const subtotals = employeeCostTable.employeeSubtotals(paymentRows, columns, {});
  assert.equal(subtotals[0].rowCount, 1);
  assert.equal(subtotals[0].monthlyTotal, 100);
});

test('subtotals sinh ra phải đúng khoá mà bảng thanh toán cần đọc', () => {
  const subtotals = employeeCostTable.employeeSubtotals(
    [{ employeeCode: 'DN009', employeeName: 'Trần Thị Thanh Huyền', c41: 336_334_260 }],
    [{ key: 'c41', kind: 'money' }], {},
  );
  const { afterPenaltyOf } = require('../src/paymentTeamSummary');
  assert.equal(subtotals[0].employeeCode, 'DN009');
  assert.equal(subtotals[0].employeeName, 'Trần Thị Thanh Huyền');
  // afterPenaltyOf phải rút ra được tổng — không rút được thì bảng đội lại rỗng.
  assert.notEqual(afterPenaltyOf(subtotals[0]), null, 'không đọc được tổng ⇒ NV bị loại khỏi bảng đội');
});

/* ── CEO 04/08 21:04: 4 NV vẫn bị loại khỏi bảng đội ────────────────────────── */

const { noneReasonOf } = require('../src/paymentTeamSummary');
const snapshot = require('../src/salaryAdvanceSnapshot');

test('‼ App Salary có HAI kiểu "không có bản ghi" — phải bắt cả hai', () => {
  // Kiểu 1: không thuộc diện ứng.
  assert.equal(noneReasonOf({ available: true, applicable: false, amount: null, reason: 'not_eligible' }), 'not_eligible');
  // Kiểu 2: App Salary không có bản ghi (available:false theo đúng hợp đồng).
  // Bản trước bỏ sót kiểu này ⇒ DN001·DN021·DN022·DN023 bị loại khỏi bảng đội.
  assert.equal(noneReasonOf({ available: false, applicable: null, amount: null, reason: 'employee_not_found' }), 'employee_not_found');
  assert.equal(noneReasonOf({ available: false, applicable: null, amount: null, reason: 'period_not_found' }), 'period_not_found');
});

test('‼ dữ liệu MÂU THUẪN và lỗi vận chuyển vẫn phải fail-closed', () => {
  for (const reason of ['duplicate_employee', 'upstream_timeout', 'unauthorized', 'not_configured', 'contract_mismatch']) {
    assert.equal(noneReasonOf({ available: false, applicable: null, amount: null, reason }), null,
      `${reason} KHÔNG được hiểu thành "không có ứng"`);
    assert.equal(snapshot.isStorable({ available: false, applicable: null, amount: null, reason }), false,
      `${reason} không được đóng băng vào kho`);
  }
});

test('có số thật thì không bao giờ bị coi là "không ứng"', () => {
  assert.equal(noneReasonOf({ available: true, applicable: true, amount: 65_978_975, reason: null }), null);
});

test('‼ route gộp nhiều kỳ phải dùng parseMonthRange, không tự bịa {from,to}', () => {
  // Truyền tay `{from, to}` thiếu `months` ⇒ nổ "range.months is not iterable"
  // ngay giữa màn. Lỗi chỉ nổ lúc chạy, build và test cũ không bắt được.
  assert.match(source, /rangeOverride: employeeCost\.parseMonthRange\(\{ from: period, to: period \}\)/);
  assert.doesNotMatch(source, /rangeOverride: \{ from: period, to: period \}/);
  const range = require('../src/employeeCost').parseMonthRange({ from: '2026-07', to: '2026-07' });
  assert.ok(Array.isArray(range.months) && range.months.length === 1);
});
