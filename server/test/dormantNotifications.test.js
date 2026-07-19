'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewState, createDormantNotificationStore } = require('../src/dormantNotifications');

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
