'use strict';
// SỔ "THANH TOÁN CP CỦA TÔI" — GĐ1. Nghiệm thu theo SPEC_THANH_TOAN_CP_SELFVIEW.md mục 10.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPaymentSchedule, DEFAULT_SPLIT_THRESHOLD_VND } = require('../src/paymentSchedule');

const base = { period: '2026-07', totalAfterPenalty: 200_000_000, firstAdvanceAmount: 50_000_000, firstAdvancePaid: true };

test('ví dụ CEO chốt: 200tr − ứng 50tr ⇒ lần 2 = 90tr, lần 3 = 60tr', () => {
  const book = buildPaymentSchedule({ ...base, c44Amount: 15_176_446 });
  assert.deepEqual(book.installments.map((i) => i.amount), [50_000_000, 90_000_000, 60_000_000]);
  assert.equal(book.received, 50_000_000);
  assert.equal(book.outstanding, 150_000_000, 'sổ còn nợ cộng dồn phần chưa nhận');
  assert.equal(book.invariantOk, true);
  // C44 là sổ RIÊNG — không cộng vào tổng, không nằm trong bất kỳ lần nào.
  assert.equal(book.c44.amount, 15_176_446);
  assert.equal(book.c44.includedInTotal, false);
  assert.equal(book.installments.reduce((s, i) => s + i.amount, 0), book.total);
});

test('sửa Lần 2 thì Lần 3 tự tính lại, tổng KHÔNG đổi', () => {
  const book = buildPaymentSchedule({ ...base, secondOverride: 120_000_000 });
  assert.deepEqual(book.installments.map((i) => i.amount), [50_000_000, 120_000_000, 30_000_000]);
  assert.equal(book.installments.reduce((s, i) => s + i.amount, 0), 200_000_000);
  assert.equal(book.invariantOk, true);
  // Lần 3 là phần còn lại, KHÔNG cho nhập tay.
  assert.equal(book.installments[2].editable, false);
  assert.equal(book.installments[1].editable, true);
});

test('sửa Lần 2 vượt phần còn lại thì bị kẹp và BÁO, không đẻ ra lần 3 âm', () => {
  const book = buildPaymentSchedule({ ...base, secondOverride: 999_000_000 });
  assert.equal(book.installments[1].amount, 150_000_000);
  assert.equal(book.installments[2].amount, 0);
  assert.ok(book.warnings.includes('second_override_capped_to_remainder'));
  assert.equal(book.invariantOk, true);
});

test('tổng < 60tr ⇒ chỉ 2 lần, Lần 2 là TẤT TOÁN, bỏ lần 3', () => {
  const book = buildPaymentSchedule({ period: '2026-07', totalAfterPenalty: 40_000_000, firstAdvanceAmount: 10_000_000 });
  assert.equal(book.twoInstalmentsOnly, true);
  assert.equal(book.installments.length, 2);
  assert.match(book.installments[1].label, /Tất toán/);
  assert.deepEqual(book.installments.map((i) => i.amount), [10_000_000, 30_000_000]);
  assert.equal(book.splitThresholdVnd, DEFAULT_SPLIT_THRESHOLD_VND);
});

test('ngưỡng 60tr lấy từ CẤU HÌNH, không ghi cứng', () => {
  const book = buildPaymentSchedule({ ...base, splitThresholdVnd: 500_000_000 });
  assert.equal(book.twoInstalmentsOnly, true, 'nâng ngưỡng lên thì 200tr thành nhóm 2 lần');
  assert.equal(book.installments.length, 2);
});

test('‼ thiếu nguồn thì "—", TUYỆT ĐỐI không suy thành 0', () => {
  for (const [patch, reason] of [
    [{ totalAfterPenalty: null }, 'total_unavailable'],
    [{ totalAfterPenalty: '' }, 'total_unavailable'],
    [{ firstAdvanceAmount: null }, 'first_advance_unavailable'],
    [{ firstAdvanceAmount: '' }, 'first_advance_unavailable'],
    [{ period: 'bậy' }, 'period_invalid'],
  ]) {
    const book = buildPaymentSchedule({ ...base, ...patch });
    assert.equal(book.available, false);
    assert.equal(book.reason, reason);
    assert.equal(book.total, null, 'không được trả 0 thay cho "chưa có số"');
    assert.deepEqual(book.installments, []);
  }
});

test('ứng lần 1 lớn hơn tổng ⇒ nghi sai nguồn, fail-closed', () => {
  const book = buildPaymentSchedule({ ...base, firstAdvanceAmount: 300_000_000 });
  assert.equal(book.available, false);
  assert.equal(book.reason, 'first_advance_exceeds_total');
});

test('làm tròn không được phá bất biến — quét đủ dải số lẻ', () => {
  for (let total = 60_000_001; total < 60_000_400; total += 37) {
    const book = buildPaymentSchedule({ period: '2026-07', totalAfterPenalty: total, firstAdvanceAmount: 7 });
    assert.equal(book.installments.reduce((s, i) => s + i.amount, 0), total, `lệch ở tổng ${total}`);
    assert.equal(book.invariantOk, true);
    assert.ok(book.installments.every((i) => Number.isSafeInteger(i.amount) && i.amount >= 0));
  }
});

test('mốc ngày: lần 1 cuối tháng kỳ, +45 ngày, +60 ngày; ghi rõ khoảng cách cho NV', () => {
  const book = buildPaymentSchedule(base);
  assert.deepEqual(book.installments.map((i) => i.dueDate), ['2026-07-31', '2026-09-14', '2026-09-29']);
  assert.deepEqual(book.installments.map((i) => i.dayOffset), [0, 45, 60]);
  assert.match(book.installments[1].gapNote, /45 ngày/);
  assert.match(book.installments[2].gapNote, /15 ngày.*60 ngày/);
});

test('quá hạn thì đánh dấu đỏ; lần đã chốt thì giữ nguyên "đã trả"', () => {
  const book = buildPaymentSchedule({ ...base, today: '2026-10-01' });
  assert.equal(book.installments[0].status, 'paid', 'lần đã chốt không bị biến thành quá hạn');
  assert.deepEqual(book.installments.slice(1).map((i) => i.status), ['overdue', 'overdue']);
});

test('GĐ1 chưa ghi nhận trả lần 2/3 ⇒ vẫn là KẾ HOẠCH, không được hiện như đã trả', () => {
  // ‼ CEO chốt 04/08: Lần 1 do App Salary duyệt vào NGÀY CUỐI THÁNG của kỳ. Có số
  // của App Salary nghĩa là việc đó XONG rồi — không phụ thuộc cờ `locked` (hợp đồng
  // provisional/approved vẫn đang chờ App Salary trả lời). Chỉ Lần 2/Lần 3 mới là kế hoạch.
  const book = buildPaymentSchedule({ ...base, firstAdvancePaid: false });
  assert.deepEqual(book.installments.map((i) => i.status), ['paid', 'plan', 'plan']);
  assert.equal(book.received, 50_000_000, 'ứng lần 1 là tiền ĐÃ nhận');
  assert.equal(book.outstanding, 150_000_000);
  assert.equal(book.invariantOk, true);
});

test('tháng 12 sang năm mới: mốc ngày không nhảy sai', () => {
  const book = buildPaymentSchedule({ period: '2026-12', totalAfterPenalty: 100_000_000, firstAdvanceAmount: 20_000_000 });
  assert.deepEqual(book.installments.map((i) => i.dueDate), ['2026-12-31', '2027-02-14', '2027-03-01']);
});

/* ── CEO chốt 04/08/2026 (ảnh chụp T07 của DN009) ──────────────────────────── */

test('‼ Lần 1 KHÔNG BAO GIỜ bị gắn "quá hạn" — App Salary đã chi từ ngày cuối tháng', () => {
  // Đúng vụ trong ảnh: kỳ 07/2026, hôm nay 04/08 ⇒ màn cũ kêu "quá 4 ngày · quá hạn".
  const book = buildPaymentSchedule({ ...base, today: '2026-08-04' });
  const first = book.installments[0];
  assert.equal(first.status, 'paid', 'phải là ĐÃ HOÀN THÀNH, không phải quá hạn');
  assert.notEqual(first.status, 'overdue');
  assert.equal(first.dueDate, '2026-07-31', 'mốc Lần 1 là ngày cuối tháng của kỳ');
  assert.match(first.gapNote, /chốt ngày cuối tháng 07\/2026/, 'cột Khoảng cách phải nói rõ mốc, không để trống');
});

test('kỳ CHƯA hết tháng thì Lần 1 là "chưa tới ngày duyệt", cũng không phải quá hạn', () => {
  const book = buildPaymentSchedule({ ...base, period: '2026-08', today: '2026-08-04' });
  assert.equal(book.installments[0].status, 'pending');
});

test('‼ App Salary nói KHÔNG CÓ ứng lần 1 ⇒ vẫn dựng sổ ĐỦ, Lần 2/Lần 3 chia trên toàn bộ', () => {
  const book = buildPaymentSchedule({
    period: '2026-07', totalAfterPenalty: 200_000_000,
    firstAdvanceAmount: null, firstAdvanceNone: true, firstAdvanceNoneReason: 'not_eligible',
    today: '2026-08-04',
  });
  assert.equal(book.available, true, 'không có ứng KHÁC với không lấy được số — vẫn phải dựng sổ');
  assert.deepEqual(book.installments.map((i) => i.amount), [0, 120_000_000, 80_000_000]);
  assert.equal(book.installments[0].status, 'none');
  assert.match(book.installments[0].label, /Không ứng/);
  assert.match(book.installments[0].gapNote, /App Salary không ghi nhận ứng lần 1/);
  assert.equal(book.installments[0].noneReason, 'not_eligible');
  assert.equal(book.received, 0, 'không ứng thì chưa nhận đồng nào');
  assert.equal(book.outstanding, 200_000_000);
  assert.equal(book.invariantOk, true);
});

test('‼ GỌI KHÔNG ĐƯỢC vẫn phải fail-closed — cấm hiểu thành "không có ứng"', () => {
  const book = buildPaymentSchedule({
    period: '2026-07', totalAfterPenalty: 200_000_000, firstAdvanceAmount: null, today: '2026-08-04',
  });
  assert.equal(book.available, false);
  assert.equal(book.reason, 'first_advance_unavailable');
});

test('gộp nhiều kỳ: total · đã ứng · lần 2 · lần 3 · C44, kỳ hỏng thì TÁCH ra', () => {
  const { buildPaymentRangeSummary } = require('../src/paymentSchedule');
  const july = buildPaymentSchedule({ ...base, c44Amount: 15_176_446, today: '2026-08-04' });
  const june = buildPaymentSchedule({
    period: '2026-06', totalAfterPenalty: 100_000_000, firstAdvanceAmount: 20_000_000,
    c44Amount: 1_000_000, today: '2026-08-04',
  });
  const broken = buildPaymentSchedule({ period: '2026-05', totalAfterPenalty: null });
  const range = buildPaymentRangeSummary([june, july, broken]);
  assert.equal(range.months, 2);
  assert.equal(range.total, 300_000_000);
  assert.equal(range.firstAdvance, 70_000_000, 'tổng đã ứng lần 1 của cả khoảng');
  assert.equal(range.second + range.final, 230_000_000);
  assert.equal(range.c44, 16_176_446);
  assert.equal(range.received, 70_000_000);
  assert.equal(range.outstanding, 230_000_000);
  assert.deepEqual(range.skipped, [{ period: '2026-05', reason: 'total_unavailable' }],
    'kỳ thiếu nguồn phải hiện ra, không cộng 0 vào tổng');
  assert.equal(range.invariantOk, true);
});
