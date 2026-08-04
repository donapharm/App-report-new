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

test('‼ subtotals phải tính từ rows CHƯA LỌC, không lấy từ transformReport', () => {
  assert.match(block, /employeeCostTable\.employeeSubtotals\(teamPeriod\.rows/,
    'phải tự tính tại chỗ từ rows chưa lọc');
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
