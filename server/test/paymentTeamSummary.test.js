'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPaymentTeamSummary } = require('../src/paymentTeamSummary');

const sub = (code, total, penalty = null) => ({ employeeCode: code, employeeName: `NV ${code}`, monthlyTotal: total, penalty });
const advance = (amount) => ({ projection: { available: true, applicable: true, amount, locked: true, status: 'locked' } });

test('bảng toàn đội: cộng đúng, xếp NV quá hạn lên đầu', () => {
  const summary = buildPaymentTeamSummary({
    period: '2026-07', today: '2026-12-01',
    subtotals: [sub('DN001', 200_000_000), sub('DN002', 100_000_000)],
    readSnapshot: (emp) => advance(emp === 'DN001' ? 50_000_000 : 20_000_000),
    readLedger: () => null,
  });
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.totals.total, 300_000_000);
  assert.equal(summary.totals.received, 70_000_000, 'chỉ lần 1 đã chốt');
  assert.equal(summary.totals.outstanding, 230_000_000);
  assert.equal(summary.invariantOk, true, 'đã nhận + còn nợ phải bằng tổng');
  // Ngày 01/12 thì mọi lần 2/3 của kỳ T07 đều quá hạn.
  assert.equal(summary.totals.overdueEmployees, 2);
  assert.equal(summary.rows[0].overdueCount, 2);
});

test('‼ NV thiếu nguồn bị TÁCH RIÊNG kèm lý do, không thành 0 và không cộng vào tổng đội', () => {
  const summary = buildPaymentTeamSummary({
    period: '2026-07',
    subtotals: [sub('DN001', 200_000_000), sub('DN002', null), sub('DN003', 90_000_000)],
    readSnapshot: (emp) => (emp === 'DN003' ? null : advance(50_000_000)),
    readLedger: () => null,
  });
  assert.deepEqual(summary.rows.map((r) => r.empCode), ['DN001']);
  assert.deepEqual(summary.excluded, [
    { empCode: 'DN002', employeeName: 'NV DN002', reason: 'total_unavailable' },
    { empCode: 'DN003', employeeName: 'NV DN003', reason: 'first_advance_unavailable' },
  ]);
  assert.equal(summary.totals.total, 200_000_000, 'NV thiếu nguồn không kéo tổng đội xuống');
  assert.equal(summary.totals.employees, 1);
});

test('đã ghi nhận trả thì đã-nhận toàn đội tăng, còn nợ giảm đúng', () => {
  const summary = buildPaymentTeamSummary({
    period: '2026-07',
    subtotals: [sub('DN001', 200_000_000)],
    readSnapshot: () => advance(50_000_000),
    readLedger: () => ({ secondOverride: 88_000_000, paid: { second: { amount: 88_000_000, paidAt: '2026-09-14', by: 'CEO' } } }),
  });
  assert.equal(summary.totals.received, 138_000_000);
  assert.equal(summary.totals.outstanding, 62_000_000);
  assert.equal(summary.rows[0].nextLabel, 'Lần 3 · Tất toán');
  assert.equal(summary.rows[0].nextAmount, 62_000_000);
  assert.equal(summary.invariantOk, true);
});

test('tổng sau phạt được ưu tiên hơn tổng gốc', () => {
  const summary = buildPaymentTeamSummary({
    period: '2026-07',
    subtotals: [sub('DN001', 200_000_000, { afterPenaltyTotal: 180_000_000 })],
    readSnapshot: () => advance(50_000_000),
    readLedger: () => null,
  });
  assert.equal(summary.rows[0].total, 180_000_000, 'phải lấy số ĐÃ trừ phạt');
});
