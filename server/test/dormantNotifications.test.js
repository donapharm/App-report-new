'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewState, businessDaysBetween, createDormantNotificationStore } = require('../src/dormantNotifications');

function memory() {
  const files = new Map();
  return {
    files,
    persist: { load: (n, d) => files.has(n) ? structuredClone(files.get(n)) : structuredClone(d), save: (n, v) => files.set(n, structuredClone(v)) },
  };
}

test('review status follows the fourteen-day action deadline', () => {
  const item = { action: { status: 'scheduled', next_follow_up: '2026-08-03' } };
  assert.equal(reviewState(item, '2026-07-20').status, 'in_progress');
  assert.equal(reviewState(item, '2026-07-31').status, 'upcoming');
  assert.equal(reviewState(item, '2026-08-03').status, 'due');
  assert.deepEqual(reviewState(item, '2026-08-05'), { status: 'overdue', days_left: -2, overdue_days: 2 });
  assert.equal(reviewState({ action: {} }, '2026-08-03').status, 'unplanned');
});

test('business-day escalation skips Saturday and Sunday', () => {
  assert.equal(businessDaysBetween('2026-07-17T02:00:00Z', '2026-07-22T02:00:00Z'), 3); // Friday → Wednesday
  assert.equal(businessDaysBetween('2026-07-17T02:00:00Z', '2026-07-20T02:00:00Z'), 1); // weekend does not count
});

test('CEO feed deduplicates stable review events and persists read state', () => {
  const m = memory();
  let now = new Date('2026-08-03T02:00:00Z');
  const store = createDormantNotificationStore({ persist: m.persist, clock: () => now });
  const item = { key: 'DN016|U|Q', emp_code: 'DN016', unit_code: 'U', unit_name: 'BV A', iit_code: 'Q', product_name: 'Thuốc A', action: { status: 'scheduled', next_follow_up: '2026-08-03', cycle: 1 } };
  let feed = store.feed({ items: [item], today: '2026-08-03' });
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0].type, 'review_due');
  feed = store.feed({ items: [item], today: '2026-08-03' });
  assert.equal(feed.events.length, 1, 'same review must not spam duplicate events');
  assert.equal(store.markRead({ all: true }).unread_count, 0);
  assert.equal(store.feed({ items: [item], today: '2026-08-03' }).unread_count, 0);

  now = new Date('2026-08-04T02:00:00Z');
  feed = store.feed({ items: [item], today: '2026-08-04' });
  assert.ok(feed.events.some((x) => x.type === 'review_overdue'));
  assert.equal(feed.unread_count, 1);
  const overdueId = feed.events.find((x) => x.type === 'review_overdue').id;

  now = new Date('2026-08-06T02:00:00Z');
  feed = store.feed({ items: [item], today: '2026-08-06' });
  const refreshed = feed.events.find((x) => x.type === 'review_overdue');
  assert.equal(refreshed.id, overdueId, 'không tạo thông báo quá hạn mới mỗi ngày');
  assert.match(refreshed.title, /quá hạn review 3 ngày/, 'nội dung phải cập nhật số ngày hiện tại');
});

test('v1 CEO review events migrate to audience scope without a duplicate or lost read state', () => {
  const m = memory();
  m.files.set('dormant_qlnb_notifications', {
    version: 1,
    events: [{
      id: 'legacy-review-id', type: 'review_due', severity: 'warning', emp_code: 'DN016',
      unit_code: 'U', qlnb_codes: ['Q'], cycle: 2, ref_date: '2026-08-03',
      title: 'legacy', message: 'legacy', at: '2026-08-03T01:00:00.000Z', read_at: '2026-08-03T01:30:00.000Z',
    }],
  });
  const store = createDormantNotificationStore({ persist: m.persist, clock: () => new Date('2026-08-03T02:00:00Z') });
  const item = {
    key: 'DN016|U|Q', emp_code: 'DN016', unit_code: 'U', iit_code: 'Q', product_name: 'Thuốc A',
    dormant_cycle: 7, action: { status: 'scheduled', next_follow_up: '2026-08-03', cycle: 2 },
  };
  const feed = store.feed({ items: [item], today: '2026-08-03', audience: 'ceo' });
  assert.equal(feed.events.filter((event) => event.type === 'review_due').length, 1);
  assert.equal(feed.unread_count, 0);
  assert.equal(feed.events[0].read_at, '2026-08-03T01:30:00.000Z');
});

test('employee feed is server-scoped, grouped by stable unit/item events and does not spam daily', () => {
  const m = memory();
  let now = new Date('2026-07-20T02:00:00Z');
  const store = createDormantNotificationStore({ persist: m.persist, clock: () => now });
  const items = [
    { key: 'DN016|U1|Q1', emp_code: 'DN016', unit_code: 'U1', unit_name: 'BV A', iit_code: 'Q1', product_name: 'Thuốc A', days_idle: 60, last_activity_at: '2026-05-21', dormant_cycle: 1, action: {} },
    { key: 'DN001|U2|Q2', emp_code: 'DN001', unit_code: 'U2', unit_name: 'BV B', iit_code: 'Q2', product_name: 'Thuốc B', days_idle: 90, first_detected_at: '2026-07-20', dormant_cycle: 1, action: {} },
  ];
  let feed = store.feed({ items, today: '2026-07-20', audience: 'employee', empCode: 'DN016' });
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0].type, 'dormant_detected');
  assert.equal(feed.events[0].emp_code, 'DN016');
  assert.deepEqual(feed.events[0].item_keys, ['DN016|U1|Q1']);
  const stableId = feed.events[0].id;

  now = new Date('2026-07-21T02:00:00Z');
  items[0].days_idle = 61;
  feed = store.feed({ items, today: '2026-07-21', audience: 'employee', empCode: 'DN016' });
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0].id, stableId);
  assert.equal(feed.events[0].title, 'QLNB đã ngủ đông 61 ngày');
  assert.equal(feed.events[0].escalation.unread_24h, true);
  assert.equal(feed.events[0].escalation.send_enabled, false);

  store.markRead({ all: true, audience: 'employee', empCode: 'DN001' });
  assert.equal(store.feed({ items, today: '2026-07-21', audience: 'employee', empCode: 'DN016' }).unread_count, 1, 'scope khác không được đánh dấu đọc');
  assert.equal(store.markRead({ ids: [stableId], audience: 'employee', empCode: 'DN016' }).unread_count, 0);
});

test('employee escalation is derived preview state, not a repeated notification', () => {
  const m = memory();
  let now = new Date('2026-07-20T02:00:00Z'); // Monday
  const store = createDormantNotificationStore({ persist: m.persist, clock: () => now });
  store.add({ id: 'feedback-1', audience: 'employee', type: 'ceo_feedback', emp_code: 'DN016', item_keys: ['K'], at: now.toISOString() });
  now = new Date('2026-07-23T02:00:00Z'); // Thursday = 3 business days
  let feed = store.feed({ audience: 'employee', empCode: 'DN016', today: '2026-07-23' });
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0].escalation.unresolved_3_business_days, true);
  assert.equal(feed.events[0].escalation.preview_only, true);
  assert.equal(feed.events[0].escalation.send_enabled, false);
  store.acknowledge({ itemKeys: ['K'], empCode: 'DN016', kind: 'updated' });
  feed = store.feed({ audience: 'employee', empCode: 'DN016', today: '2026-07-23' });
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0].escalation, null);
});

test('reactivation closes employee events, suppresses dead deep-links and permits a later dormant cycle', () => {
  const m = memory();
  let now = new Date('2026-07-20T02:00:00Z');
  const store = createDormantNotificationStore({ persist: m.persist, clock: () => now });
  const item = {
    key: 'DN016|U1|Q1', emp_code: 'DN016', unit_code: 'U1', unit_name: 'BV A',
    iit_code: 'Q1', product_name: 'Thuốc A', days_idle: 60,
    last_activity_at: '2026-05-21', dormant_cycle: 1, action: {},
  };
  const initial = store.feed({ items: [item], today: '2026-07-20', audience: 'employee', empCode: 'DN016' });
  assert.equal(initial.events.length, 1);
  const firstId = initial.events[0].id;

  now = new Date('2026-07-21T02:00:00Z');
  let feed = store.feed({ items: [], reactivated: [{ ...item, order_at: '2026-07-21' }], today: '2026-07-21', audience: 'employee', empCode: 'DN016' });
  assert.equal(feed.events.length, 0, 'resolved QLNB must leave the actionable employee feed');
  assert.equal(feed.unread_count, 0);
  const stored = m.files.get('dormant_qlnb_notifications').events.find((event) => event.id === firstId);
  assert.ok(stored.closed_at, 'closed event remains available for audit');
  assert.equal(stored.closed_reason, 'qlnb_reactivated');

  now = new Date('2026-07-24T02:00:00Z');
  feed = store.feed({ items: [], today: '2026-07-24', audience: 'employee', empCode: 'DN016' });
  assert.equal(feed.events.length, 0, 'closed event must never escalate or expose its old deep-link');

  const secondCycle = { ...item, dormant_cycle: 2, days_idle: 60, last_activity_at: '2026-07-25' };
  feed = store.feed({ items: [secondCycle], today: '2026-09-23', audience: 'employee', empCode: 'DN016' });
  assert.equal(feed.events.length, 1);
  assert.notEqual(feed.events[0].id, firstId, 'a new dormant transition must receive a new event');
});
