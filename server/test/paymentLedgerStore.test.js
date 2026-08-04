'use strict';
// GĐ2 — SỔ GHI NHẬN (SPEC_THANH_TOAN_CP_SELFVIEW.md §8). Đây là TIỀN THẬT:
// chỉ người có quyền được ghi, không tự đánh dấu, mọi thay đổi đều có nhật ký.
const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../src/paymentLedgerStore');
const { buildPaymentSchedule } = require('../src/paymentSchedule');

const memStore = () => ({ data: {}, load(n, d) { return this.data[n] ?? d; }, save(n, v) { this.data[n] = v; } });
const base = { period: '2026-07', totalAfterPenalty: 200_000_000, firstAdvanceAmount: 50_000_000, firstAdvancePaid: true };

test('chưa ai ghi nhận ⇒ mãi là KẾ HOẠCH, không tự đánh dấu đã trả', () => {
  const store = memStore();
  const entry = ledger.readEntry('DN001', '2026-07', { store });
  assert.deepEqual(entry.paid, {});
  assert.equal(entry.secondOverride, null);
  const book = buildPaymentSchedule({ ...base, paid: entry.paid });
  assert.deepEqual(book.installments.slice(1).map((i) => i.status), ['plan', 'plan']);
  assert.equal(book.received, 50_000_000, 'chỉ tính lần 1 đã chốt');
});

test('ghi nhận Lần 2 ⇒ chốt luôn số Lần 2, Lần 3 tự co lại, tổng KHÔNG đổi', () => {
  const store = memStore();
  ledger.recordPayment('DN001', '2026-07', 'second', { amount: 88_000_000, paidAt: '2026-09-14', actor: 'ceo', store });
  const entry = ledger.readEntry('DN001', '2026-07', { store });
  assert.equal(entry.secondOverride, 88_000_000, 'số THẬT đã chuyển thắng số kế hoạch');
  const book = buildPaymentSchedule({ ...base, secondOverride: entry.secondOverride, paid: entry.paid });
  assert.deepEqual(book.installments.map((i) => i.amount), [50_000_000, 88_000_000, 62_000_000]);
  assert.equal(book.installments.reduce((s, i) => s + i.amount, 0), 200_000_000);
  assert.equal(book.received, 138_000_000);
  assert.equal(book.outstanding, 62_000_000);
  assert.equal(book.invariantOk, true);
});

test('‼ KHÔNG ai được ghi đè Lần 1 — đó là số App Salary', () => {
  const store = memStore();
  assert.throws(
    () => ledger.recordPayment('DN001', '2026-07', 'advance', { amount: 1, paidAt: '2026-07-31', actor: 'ceo', store }),
    { code: 'PAYMENT_KEY_INVALID' },
  );
});

test('‼ không có người chịu trách nhiệm thì KHÔNG ghi', () => {
  const store = memStore();
  for (const call of [
    () => ledger.recordPayment('DN001', '2026-07', 'second', { amount: 1_000, paidAt: '2026-09-14', actor: '', store }),
    () => ledger.setSecondOverride('DN001', '2026-07', 1_000, { actor: '  ', store }),
    () => ledger.undoPayment('DN001', '2026-07', 'second', { actor: null, store }),
  ]) assert.throws(call, { code: 'PAYMENT_ACTOR_REQUIRED' });
});

test('số tiền / ngày bậy thì chặn ngay, không lưu', () => {
  const store = memStore();
  for (const [patch, code] of [
    [{ amount: -1 }, 'PAYMENT_AMOUNT_INVALID'],
    [{ amount: 'abc' }, 'PAYMENT_AMOUNT_INVALID'],
    [{ amount: null }, 'PAYMENT_AMOUNT_INVALID'],
    [{ amount: 1.5 }, 'PAYMENT_AMOUNT_INVALID'],
    [{ paidAt: '14/09/2026' }, 'PAYMENT_DATE_INVALID'],
    [{ paidAt: '' }, 'PAYMENT_DATE_INVALID'],
  ]) {
    assert.throws(
      () => ledger.recordPayment('DN001', '2026-07', 'second', { amount: 1_000, paidAt: '2026-09-14', actor: 'ceo', ...patch, store }),
      { code },
    );
  }
  assert.deepEqual(ledger.readEntry('DN001', '2026-07', { store }).paid, {});
});

test('‼ MỌI thay đổi đều có nhật ký: ai · khi nào · số cũ → số mới', () => {
  const store = memStore();
  let clock = 0;
  const now = () => `2026-09-14T00:00:0${clock++}Z`;
  ledger.setSecondOverride('DN001', '2026-07', 90_000_000, { actor: 'ceo', now, store });
  ledger.recordPayment('DN001', '2026-07', 'second', { amount: 88_000_000, paidAt: '2026-09-14', actor: 'admin1', now, store });
  ledger.undoPayment('DN001', '2026-07', 'second', { actor: 'ceo', now, store });
  const { audit } = ledger.readEntry('DN001', '2026-07', { store });
  assert.deepEqual(audit.map((a) => a.action), ['set_second', 'pay_second', 'set_second', 'undo_second']);
  assert.deepEqual(audit[0], { at: '2026-09-14T00:00:00Z', by: 'CEO', action: 'set_second', from: null, to: 90_000_000 });
  assert.equal(audit[1].by, 'ADMIN1');
  assert.equal(audit[1].from, null);
  assert.equal(audit[1].to, 88_000_000);
  assert.equal(audit[3].from, 88_000_000, 'gỡ ghi nhận vẫn để lại vết, không xoá lịch sử');
  assert.ok(audit.every((a) => a.at && a.by), 'không mục nào được thiếu ai/khi nào');
});

test('gỡ ghi nhận ⇒ quay lại KẾ HOẠCH, đã nhận trừ lại đúng', () => {
  const store = memStore();
  ledger.recordPayment('DN001', '2026-07', 'second', { amount: 88_000_000, paidAt: '2026-09-14', actor: 'ceo', store });
  ledger.undoPayment('DN001', '2026-07', 'second', { actor: 'ceo', store });
  const entry = ledger.readEntry('DN001', '2026-07', { store });
  const book = buildPaymentSchedule({ ...base, secondOverride: entry.secondOverride, paid: entry.paid });
  assert.equal(book.installments[1].status, 'plan');
  assert.equal(book.received, 50_000_000);
});

test('trả lệch số kế hoạch thì NÓI RA, không im lặng', () => {
  const book = buildPaymentSchedule({
    ...base, secondOverride: 90_000_000,
    paid: { second: { amount: 85_000_000, paidAt: '2026-09-14', by: 'CEO' } },
  });
  assert.equal(book.installments[1].paidAmount, 85_000_000);
  assert.equal(book.installments[1].paidDiff, -5_000_000, 'phải nêu chênh lệch giữa số thật và số kế hoạch');
});

test('bản ghi hỏng trong kho bị bỏ qua, không dựng số rác', () => {
  const store = memStore();
  store.save(ledger.FILE, {
    [ledger.keyOf('DN001', '2026-07')]: { secondOverride: 'bậy', paid: { second: { amount: -5, paidAt: 'x' }, final: { amount: 10 } }, audit: null },
  });
  const entry = ledger.readEntry('DN001', '2026-07', { store });
  assert.equal(entry.secondOverride, null);
  assert.deepEqual(entry.paid, {}, 'thiếu ngày hoặc số bậy ⇒ không tính là đã trả');
  assert.deepEqual(entry.audit, []);
});
