const test = require('node:test');
const assert = require('node:assert/strict');
const employeeCostTable = require('../src/employeeCostTable');

const report = (empCode, matchedRows, totalRows, sourceOutcome) => ({
  empCode, sourceOutcome, from: '2026-07', to: '2026-07',
  periods: [{
    period: '2026-07', columns: [{ key: 'c36', label: 'CP ctv/khác (%)' }], rows: [],
    match: { matchedRows, totalRows, threshold: 90 },
    summary: { reliable: true },
  }],
});
const roster = [{ emp_code: 'DN001', name: 'A' }, { emp_code: 'DN002', name: 'B' }, { emp_code: 'DN003', name: 'C' }];

test('ALL coverage KHÔNG tính NV lỗi nguồn là "thiếu %" (khớp tab Mặt hàng thiếu %)', () => {
  const merged = employeeCostTable.mergeEmployeeReports([
    report('DN001', 600, 610, 'ok'),
    report('DN002', 649, 656, 'ok'),
    report('DN003', 0, 233, 'upstream_unavailable'),
  ], roster);
  const match = merged.periods[0].match;
  // Chỉ cộng NV lấy được nguồn → khớp đúng số của gap tool.
  assert.equal(match.matchedRows, 1249);
  assert.equal(match.totalRows, 1266);
  assert.equal(match.rate, 98.7);
  // Phần lỗi nguồn báo riêng, không trộn vào tỷ lệ thiếu %.
  assert.equal(match.unavailablePairs, 233);
  assert.equal(match.unavailableEmployeeCount, 1);
  // Còn NV chưa lấy được nguồn ⇒ tổng chưa đầy đủ ⇒ giữ trạng thái "tạm tính".
  assert.equal(merged.periods[0].summary.reliable, false);
});

test('mọi NV lấy được nguồn thì coverage đầy đủ và tổng được coi là tin cậy', () => {
  const merged = employeeCostTable.mergeEmployeeReports([
    report('DN001', 600, 610, 'ok'),
    report('DN002', 649, 656, 'ok'),
  ], roster);
  const match = merged.periods[0].match;
  assert.equal(match.unavailablePairs, 0);
  assert.equal(match.unavailableEmployeeCount, 0);
  assert.equal(merged.periods[0].summary.reliable, true);
});
