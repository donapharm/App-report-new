'use strict';
/**
 * QUY TRÌNH ĐỀ NGHỊ NHẬN LẦN 2 / LẦN 3 — CEO chốt 04/08/2026 21:30.
 *
 * CEO: *"một số trường hợp có thể được phép đề nghị sớm hơn, nhưng phải có đường để
 * NV gửi yêu cầu mở khoá"* · *"khi sếp từ chối thì quay về kế hoạch để NV đề nghị lại"*.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/paymentLedgerStore');
const { buildPaymentSchedule } = require('../src/paymentSchedule');

const memStore = () => ({ data: {}, load(n, d) { return this.data[n] ?? d; }, save(n, v) { this.data[n] = v; } });
const stateOf = (entry, key = 'second') => entry.flow[key]?.state || 'plan';

test('‼ đường đi đầy đủ: kế hoạch → đề nghị → duyệt → đã trả', () => {
  const s = memStore();
  assert.equal(stateOf(store.requestPayment('DN006', '2026-07', 'second', { actor: 'DN006', store: s })), 'requested');
  assert.equal(stateOf(store.approvePayment('DN006', '2026-07', 'second', { actor: 'CEO', store: s })), 'approved');
  const paid = store.recordPayment('DN006', '2026-07', 'second', {
    amount: 236_077_399, paidAt: '2026-09-16', actor: 'CEO', store: s,
  });
  assert.equal(paid.paid.second.amount, 236_077_399);
});

test('‼ CEO TỪ CHỐI ⇒ quay về kế hoạch, NV đề nghị LẠI được', () => {
  const s = memStore();
  store.requestPayment('DN006', '2026-07', 'second', { actor: 'DN006', store: s });
  assert.equal(stateOf(store.rejectPayment('DN006', '2026-07', 'second', { actor: 'CEO', note: 'chưa tới lượt', store: s })), 'plan');
  // Đề nghị lại được ngay — không bị khoá cứng.
  assert.equal(stateOf(store.requestPayment('DN006', '2026-07', 'second', { actor: 'DN006', store: s })), 'requested');
});

test('‼ xin mở khoá sớm: NV xin → CEO mở → NV mới được đề nghị', () => {
  const s = memStore();
  assert.equal(stateOf(store.requestUnlock('DN006', '2026-07', 'second', { actor: 'DN006', note: 'kẹt tiền', store: s })), 'unlock_requested');
  // Chưa mở khoá mà đòi đề nghị thẳng ⇒ TỪ CHỐI, không im lặng nhảy nấc.
  assert.throws(() => store.requestPayment('DN006', '2026-07', 'second', { actor: 'DN006', store: s }), /không chuyển sang/);
  const unlocked = store.grantUnlock('DN006', '2026-07', 'second', { actor: 'CEO', store: s });
  assert.equal(stateOf(unlocked), 'unlocked');
  assert.equal(unlocked.flow.second.unlockedBy, 'CEO');
  assert.equal(stateOf(store.requestPayment('DN006', '2026-07', 'second', { actor: 'DN006', store: s })), 'requested');
});

test('‼ đứng sai nấc thì TỪ CHỐI kèm nấc hiện tại, không ghi đè lặng lẽ', () => {
  const s = memStore();
  assert.throws(() => store.approvePayment('DN006', '2026-07', 'second', { actor: 'CEO', store: s }),
    /Đang ở nấc "plan"/, 'chưa ai đề nghị mà đã duyệt là sai');
  assert.throws(() => store.grantUnlock('DN006', '2026-07', 'second', { actor: 'CEO', store: s }), /Đang ở nấc "plan"/);
});

test('‼ đã ghi nhận TRẢ rồi thì đóng — không quay lại quy trình được nữa', () => {
  const s = memStore();
  store.recordPayment('DN006', '2026-07', 'second', { amount: 1000, paidAt: '2026-09-16', actor: 'CEO', store: s });
  for (const move of ['requestPayment', 'requestUnlock', 'approvePayment', 'rejectPayment']) {
    assert.throws(() => store[move]('DN006', '2026-07', 'second', { actor: 'CEO', store: s }),
      /đã ghi nhận trả/, `${move} phải bị chặn sau khi đã trả`);
  }
});

test('‼ Lần 1 KHÔNG nằm trong quy trình này — đó là việc của App Salary', () => {
  const s = memStore();
  assert.throws(() => store.requestPayment('DN006', '2026-07', 'advance', { actor: 'DN006', store: s }),
    /Chỉ thao tác được Lần 2 hoặc Lần 3/);
});

test('mọi bước đều có nhật ký ai · lúc nào · từ nấc nào sang nấc nào', () => {
  const s = memStore();
  store.requestUnlock('DN006', '2026-07', 'second', { actor: 'DN006', note: 'Cần nhận sớm', store: s });
  store.grantUnlock('DN006', '2026-07', 'second', { actor: 'CEO', store: s });
  const entry = store.requestPayment('DN006', '2026-07', 'second', { actor: 'DN006', store: s });
  assert.deepEqual(entry.audit.map((row) => [row.by, row.from, row.to]), [
    ['DN006', 'plan', 'unlock_requested'],
    ['CEO', 'unlock_requested', 'unlocked'],
    ['DN006', 'unlocked', 'requested'],
  ]);
  assert.ok(entry.audit.every((row) => row.at), 'thiếu mốc thời gian thì không đối chiếu được');
});

test('‼ thiếu người thực hiện thì KHÔNG ghi — tiền phải có người chịu trách nhiệm', () => {
  const s = memStore();
  assert.throws(() => store.requestPayment('DN006', '2026-07', 'second', { store: s }), /Thiếu người thực hiện/);
});

/* ── Nối vào sổ hiển thị ────────────────────────────────────────────────────── */

const base = { period: '2026-07', totalAfterPenalty: 200_000_000, firstAdvanceAmount: 50_000_000 };

test('‼ chưa tới mốc: KHÔNG cho đề nghị thẳng, chỉ cho xin mở khoá', () => {
  const item = buildPaymentSchedule({ ...base, today: '2026-08-04' }).installments[1];
  assert.equal(item.canRequest, false);
  assert.equal(item.canRequestUnlock, true);
});

test('tới mốc thì đề nghị thẳng, hết cần xin mở khoá', () => {
  const item = buildPaymentSchedule({ ...base, today: '2026-09-14' }).installments[1];
  assert.equal(item.canRequest, true);
  assert.equal(item.canRequestUnlock, false);
});

test('được mở khoá sớm thì đề nghị được dù chưa tới mốc', () => {
  const item = buildPaymentSchedule({ ...base, today: '2026-08-04', flow: { second: { state: 'unlocked' } } }).installments[1];
  assert.equal(item.canRequest, true);
});

test('đã đề nghị / đã duyệt thì không bấm đề nghị lại được', () => {
  for (const state of ['requested', 'approved', 'unlock_requested']) {
    const item = buildPaymentSchedule({ ...base, today: '2026-09-14', flow: { second: { state } } }).installments[1];
    assert.equal(item.canRequest, false, `nấc ${state} không được đề nghị lại`);
  }
});

test('‼ Lần 1 không bao giờ có nút đề nghị', () => {
  const first = buildPaymentSchedule({ ...base, today: '2026-09-14' }).installments[0];
  assert.equal(first.flowState, 'n/a');
  assert.notEqual(first.canRequest, true);
});
