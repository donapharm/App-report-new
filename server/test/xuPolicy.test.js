const test = require('node:test');
const assert = require('node:assert/strict');
const xuPolicy = require('../src/xuPolicy');

test('tuần thực bắt đầu thứ Hai, không dùng lũy kế đầu tháng', () => {
  const r = xuPolicy.rangesFor('2026-07-19'); // Chủ nhật
  assert.deepEqual(r.week, { from: '2026-07-13', to: '2026-07-19' });
  assert.equal(r.month.from, '2026-07-01');
  assert.equal(r.quarter.from, '2026-07-01');
});

test('nhận diện đúng cuối tháng và cuối quý', () => {
  const june = xuPolicy.rangesFor('2026-06-30');
  assert.equal(june.month.closing, true);
  assert.equal(june.quarter.closing, true);
  assert.equal(june.quarter.end, '2026-06-30');
  const july = xuPolicy.rangesFor('2026-07-31');
  assert.equal(july.month.closing, true);
  assert.equal(july.quarter.closing, false);
  assert.equal(july.quarter.end, '2026-09-30');
});

test('2 Xu thiếu tương ứng 600.000đ và tính tỷ lệ lẻ theo 300.000đ/Xu', () => {
  assert.equal(xuPolicy.moneyForMissing(0), 0);
  assert.equal(xuPolicy.moneyForMissing(1), 300000);
  assert.equal(xuPolicy.moneyForMissing(2), 600000);
  assert.equal(xuPolicy.moneyForMissing(1.25), 375000);
});

test('checkpoint tách tạm tính tháng khỏi quyết toán quý, không cộng hai lần', () => {
  const scoreFn = ({ weekRange }) => ({
    diem_thang: 10, xu_thang: 7, diem_quy: 30, xu_quy: 22,
    xu_tuan: weekRange.from === '2026-06-29' ? 1.3 : -1,
  });
  const out = xuPolicy.buildCheckpoint({ empCode: 'dn009', asOf: '2026-06-30', scoreFn, priorBookedAdjustment: 900000 });
  assert.equal(out.emp_code, 'DN009');
  assert.equal(out.score.xu_tuan_thuc, 1.3);
  assert.equal(out.score.thieu_xu_thang, 3);
  assert.equal(out.score.thieu_xu_quy, 8);
  assert.equal(out.adjustment.month_estimated, 900000);
  assert.equal(out.adjustment.quarter_total_estimated, 2400000);
  assert.equal(out.adjustment.quarter_additional_estimated, 1500000);
  assert.equal(out.adjustment.needs_finance_reconciliation, false);
  assert.equal(out.adjustment.final, true);
});

test('không có số đã hạch toán thì chỉ cảnh báo tạm tính, không tuyên bố quyết toán cuối', () => {
  const out = xuPolicy.buildCheckpoint({
    empCode: 'DN009', asOf: '2026-07-31',
    scoreFn: () => ({ diem_thang: 5, xu_thang: 4, diem_quy: 5, xu_quy: 4, xu_tuan: 0 }),
  });
  assert.equal(out.adjustment.month_estimated, 300000);
  assert.equal(out.adjustment.quarter_additional_estimated, null);
  assert.equal(out.adjustment.needs_finance_reconciliation, true);
  assert.equal(out.adjustment.final, false);
  assert.equal(out.warning.closing_month, true);
});

test('ngày không hợp lệ bị từ chối', () => {
  assert.throws(() => xuPolicy.rangesFor('2026-02-30'), /không hợp lệ/i);
});
