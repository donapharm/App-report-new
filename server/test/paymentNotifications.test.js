'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentNotificationFeed } = require('../src/paymentNotifications');

const persist = () => ({ data: {}, load(name, fallback) { return this.data[name] ?? fallback; }, save(name, value) { this.data[name] = value; } });
const ledger = (entries) => ({ listEntries: () => entries });
const audit = [
  { at: '2026-08-05T01:00:00.000Z', by: 'DN001', action: 'flow_second', from: 'plan', to: 'requested', note: 'Đề nghị theo lịch', requestId: 'req-1' },
  { at: '2026-08-05T01:01:00.000Z', by: 'DN001', action: 'flow_final', from: 'plan', to: 'unlock_requested', note: 'Cần xử lý viện phí', requestId: 'req-2' },
  { at: '2026-08-05T01:02:00.000Z', by: 'CEO', action: 'flow_second', from: 'requested', to: 'approved', note: '' },
  { at: '2026-08-05T01:03:00.000Z', by: 'CEO', action: 'pay_second', from: null, to: 25_000_000, paidAt: '2026-08-05' },
  { at: '2026-08-05T01:04:00.000Z', by: 'CEO', action: 'undo_second', from: 25_000_000, to: null },
  { at: '2026-08-05T01:05:00.000Z', by: 'DN001', action: 'note_final', note: 'Nội dung khác', requestId: 'req-3' },
];

test('CEO payment feed has its own request/unlock/custom-note events and deterministic IDs', () => {
  const service = createPaymentNotificationFeed({ persist: persist(), ledger: ledger([{ empCode: 'DN001', period: '2026-07', audit }]) });
  const first = service.feed({ ceo: true });
  const second = service.feed({ ceo: true });
  assert.deepEqual(first.events.map((event) => event.id), second.events.map((event) => event.id));
  assert.deepEqual(new Set(first.events.map((event) => event.type)), new Set(['payment_requested', 'payment_unlock_requested', 'payment_note']));
  assert.ok(first.events.every((event) => event.target.tab === 'paymentSchedule' && event.target.emp_code === 'DN001' && event.target.period === '2026-07'));
});

test('employee sees only own status updates and never receives payment amount', () => {
  const service = createPaymentNotificationFeed({ persist: persist(), ledger: ledger([
    { empCode: 'DN001', period: '2026-07', audit },
    { empCode: 'DN002', period: '2026-07', audit },
  ]) });
  const feed = service.feed({ empCode: 'dn001' });
  assert.deepEqual(new Set(feed.events.map((event) => event.type)), new Set(['payment_approved', 'payment_paid', 'payment_undone']));
  assert.ok(feed.events.every((event) => event.emp_code === 'DN001'));
  assert.ok(feed.events.every((event) => !Object.prototype.hasOwnProperty.call(event, 'amount')));
});

test('mark read/read-all is isolated per authenticated audience and ignores foreign IDs', () => {
  const storage = persist();
  const service = createPaymentNotificationFeed({ persist: storage, ledger: ledger([{ empCode: 'DN001', period: '2026-07', audit }]) });
  const ceo = service.feed({ ceo: true });
  const employee = service.feed({ empCode: 'DN001' });
  assert.equal(service.markRead({ ceo: true, ids: [ceo.events[0].id, employee.events[0].id, 'foreign'] }).changed, 1);
  assert.equal(service.feed({ ceo: true }).unread_count, ceo.unread_count - 1);
  assert.equal(service.feed({ empCode: 'DN001' }).unread_count, employee.unread_count);
  assert.equal(service.markRead({ empCode: 'DN001', ids: 'not-an-array' }).changed, 0);
  assert.equal(service.markRead({ empCode: 'DN001', all: true }).unread_count, 0);
  assert.equal(service.feed({ ceo: true }).unread_count, ceo.unread_count - 1);
});
