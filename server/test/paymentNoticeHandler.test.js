'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPaymentSchedule } = require('../src/paymentSchedule');
const { createPaymentNoticeHandler, DELIVERY_STATE_FILE } = require('../src/paymentNoticeHandler');
const paymentNotify = require('../src/paymentNotify');

const memStore = () => ({ data: {}, load(name, fallback) { return this.data[name] ?? fallback; }, save(name, value) { this.data[name] = JSON.parse(JSON.stringify(value)); } });
const schedule = () => buildPaymentSchedule({
  period: '2026-07', totalAfterPenalty: 100_000_000, firstAdvanceAmount: 20_000_000,
  today: '2026-09-14',
});
const auth = { listTelegramMap: () => [
  { emp_code: 'DN001', telegram_id: '101' },
  { emp_code: 'CEO', telegram_id: '999' },
] };
const appStore = { findUserByCode: (code) => ({ emp_code: code, email: '' }) };

test('payment_notice gửi NV + CEO đúng một lần và restart không lặp', async () => {
  const store = memStore();
  const sent = [];
  const handler = createPaymentNoticeHandler({
    loadSchedules: async () => [{ empCode: 'DN001', employeeName: 'A', schedule: schedule() }],
    auth, appStore, stateStore: store, paymentNotify,
    channels: { emailFor: () => '', deliver: async (payload) => { sent.push(payload.telegramId); return { ok: true }; } },
    now: () => '2026-09-14T01:00:00.000Z',
  });
  assert.deepEqual(await handler({ at: '2026-09-14' }), { planned: 1, delivered: 1 });
  assert.deepEqual(sent, ['101', '999']);
  const restarted = createPaymentNoticeHandler({
    loadSchedules: async () => [{ empCode: 'DN001', employeeName: 'A', schedule: schedule() }],
    auth, appStore, stateStore: store, paymentNotify,
    channels: { emailFor: () => '', deliver: async () => { throw new Error('không được gọi lại'); } },
  });
  assert.deepEqual(await restarted({ at: '2026-09-14' }), { planned: 0, delivered: 0 });
});

test('provider lỗi một audience: giữ audience đã gửi và chỉ retry phần còn lại', async () => {
  const store = memStore();
  const sent = [];
  let ceoFail = true;
  const make = () => createPaymentNoticeHandler({
    loadSchedules: async () => [{ empCode: 'DN001', schedule: schedule() }], auth, appStore,
    stateStore: store, paymentNotify,
    channels: { emailFor: () => '', deliver: async ({ telegramId }) => {
      sent.push(telegramId);
      if (telegramId === '999' && ceoFail) return { ok: false, description: 'down' };
      return { ok: true };
    } },
  });
  await assert.rejects(make()({ at: '2026-09-14' }), /Chưa gửi đủ/);
  assert.ok(store.data[DELIVERY_STATE_FILE]['DN001|2026-07|second|open|employee']);
  ceoFail = false;
  assert.deepEqual(await make()({ at: '2026-09-14' }), { planned: 1, delivered: 1 });
  assert.deepEqual(sent, ['101', '999', '999']);
});

test('mapping thiếu fail trước khi gửi và không ghi state', async () => {
  const store = memStore();
  let called = 0;
  const handler = createPaymentNoticeHandler({
    loadSchedules: async () => [{ empCode: 'DN001', schedule: schedule() }],
    auth: { listTelegramMap: () => [{ emp_code: 'CEO', telegram_id: '999' }] }, appStore,
    stateStore: store, paymentNotify,
    channels: { emailFor: () => '', deliver: async () => { called += 1; return { ok: true }; } },
  });
  await assert.rejects(handler({ at: '2026-09-14' }), /Không có kênh nhận tin cho DN001/);
  assert.equal(called, 0);
  assert.deepEqual(store.data, {});
});

test('preview kiểm người nhận/nội dung/chống trùng nhưng gửi 0 và ghi 0', async () => {
  const store = memStore();
  let sends = 0;
  const handler = createPaymentNoticeHandler({
    loadSchedules: async () => [{ empCode: 'DN001', employeeName: 'A', schedule: schedule() }],
    auth, appStore, stateStore: store, paymentNotify,
    channels: { emailFor: () => '', deliver: async () => { sends += 1; return { ok: true }; } },
  });
  assert.deepEqual(await handler.preview({ at: '2026-09-14' }), {
    schedules: 1, planned: 1, audiences: 2, kinds: { open: 1 }, writes: 0, sends: 0,
  });
  assert.equal(sends, 0);
  assert.deepEqual(store.data, {});
});
