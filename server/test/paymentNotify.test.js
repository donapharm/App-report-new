'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const notify = require('../src/paymentNotify');
const { buildPaymentSchedule } = require('../src/paymentSchedule');

const memStore = () => ({ data: {}, load(n, d) { return this.data[n] ?? d; }, save(n, v) { this.data[n] = v; } });
const book = (today, over = {}) => buildPaymentSchedule({
  period: '2026-07', totalAfterPenalty: 200_000_000, firstAdvanceAmount: 50_000_000,
  firstAdvancePaid: true, today, ...over,
});

test('tới ngày thì nhắn MỞ CỬA SỔ, có số tiền và hạn', () => {
  const notices = notify.planNotices(book('2026-09-14'), { empCode: 'DN001', employeeName: 'Nguyễn A' });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'open');
  assert.match(notices[0].text, /Lần 2 · Ứng kỳ 2026-07: 90\.000\.000đ đã có thể nhận/);
  assert.match(notices[0].text, /Hạn 14\/09\/2026/);
});

test('quá hạn thì cảnh báo ĐỎ kèm số ngày và sổ còn nợ', () => {
  const notices = notify.planNotices(book('2026-10-01'), { empCode: 'DN001' });
  assert.deepEqual(notices.map((n) => n.kind), ['overdue', 'overdue']);
  assert.match(notices[0].text, /🔴 QUÁ HẠN/);
  assert.match(notices[0].text, /đã quá 17 ngày/);
  assert.match(notices[0].text, /Sổ còn nợ: 150\.000\.000đ/);
});

test('‼ đã ghi nhận trả thì THÔI nhắc lần đó', () => {
  const paidBook = book('2026-10-01', { paid: { second: { amount: 90_000_000, paidAt: '2026-09-14', by: 'CEO' } }, secondOverride: 90_000_000 });
  const notices = notify.planNotices(paidBook, { empCode: 'DN001' });
  assert.deepEqual(notices.map((n) => n.installmentKey), ['final'], 'chỉ còn nhắc lần chưa trả');
});

test('KHÔNG nhắc Lần 1 — đó là việc của App Salary', () => {
  const notices = notify.planNotices(book('2026-12-01'), { empCode: 'DN001' });
  assert.ok(notices.every((n) => n.installmentKey !== 'advance'));
});

test('‼ KHÔNG spam: mỗi (NV·kỳ·lần·loại) chỉ nhắn một lần', async () => {
  const store = memStore();
  const sentTexts = [];
  const send = async (text) => sentTexts.push(text);
  const schedules = [{ empCode: 'DN001', employeeName: 'A', schedule: book('2026-10-01') }];
  const first = await notify.runPaymentNotices(schedules, { send, store });
  assert.equal(first.delivered.length, 2);
  const second = await notify.runPaymentNotices(schedules, { send, store });
  assert.deepEqual(second.planned, [], 'lần chạy sau không nhắn lại');
  assert.equal(sentTexts.length, 2);
});

test('gửi lỗi thì KHÔNG đánh dấu đã gửi — lần sau nhắc lại, không nuốt mất tin', async () => {
  const store = memStore();
  let fail = true;
  const send = async () => { if (fail) throw new Error('telegram down'); };
  const schedules = [{ empCode: 'DN001', schedule: book('2026-10-01') }];
  const first = await notify.runPaymentNotices(schedules, { send, store });
  assert.equal(first.delivered.length, 0);
  fail = false;
  const second = await notify.runPaymentNotices(schedules, { send, store });
  assert.equal(second.delivered.length, 2, 'phải nhắc lại sau khi kênh hồi phục');
});

test('sổ chưa dựng được thì không nhắn gì', () => {
  const broken = buildPaymentSchedule({ period: '2026-07', totalAfterPenalty: null, firstAdvanceAmount: 50_000_000 });
  assert.deepEqual(notify.planNotices(broken, { empCode: 'DN001' }), []);
  assert.deepEqual(notify.planNotices(null, { empCode: 'DN001' }), []);
});

test('dryRun chỉ lên kế hoạch, không gửi và không đánh dấu', async () => {
  const store = memStore();
  const result = await notify.runPaymentNotices([{ empCode: 'DN001', schedule: book('2026-10-01') }], { store, dryRun: true });
  assert.equal(result.planned.length, 2);
  assert.deepEqual(result.delivered, []);
  assert.deepEqual(notify.readState(store), {});
});
