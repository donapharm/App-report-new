'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDormantNotificationStore } = require('../src/dormantNotifications');
const { createDormantFeedbackStore, sensitivePreviewText } = require('../src/dormantFeedback');

function fixture({ mappings = [{ emp_code: 'DN016', telegram_id: '123456789' }] } = {}) {
  const files = new Map();
  let now = new Date('2026-07-20T02:00:00.000Z');
  const persist = {
    load: (name, fallback) => files.has(name) ? structuredClone(files.get(name)) : structuredClone(fallback),
    save: (name, value) => files.set(name, structuredClone(value)),
  };
  const notifications = createDormantNotificationStore({ persist, clock: () => now });
  const feedback = createDormantFeedbackStore({ persist, notificationStore: notifications, listTelegramMap: () => mappings, clock: () => now, publicUrl: 'https://report.donapharm.asia/' });
  const item = { key: 'DN016|001.BV%20A|QLNB-1', emp_code: 'DN016', employee_name: 'Chị Ánh', unit_code: '001.BV A', unit_name: 'Bệnh viện A', iit_code: 'QLNB-1', product_name: 'Thuốc A 500mg', dormant_cycle: 2 };
  return { files, notifications, feedback, item, setNow: (value) => { now = new Date(value); } };
}

test('CEO feedback is immutable, idempotent and creates one employee notification', () => {
  const f = fixture();
  const payload = { item: f.item, type: 'approved', note: 'Tiếp tục triển khai', actionCycle: 3, actor: 'CEO', requestId: 'request-feedback-0001' };
  const first = f.feedback.create(payload);
  assert.equal(first.duplicate, false);
  assert.equal(first.action_cycle, 3);
  assert.equal(first.telegram_preview.send_enabled, false);
  assert.equal(first.telegram_preview.provider_called, false);
  assert.equal(first.telegram_preview.status, 'preview_only');
  assert.match(first.telegram_preview.deep_link, /focus_key=/);
  assert.equal(sensitivePreviewText(first.telegram_preview.message), false);
  assert.ok(/^[a-f0-9]{64}$/.test(first.telegram_preview.manifest_digest));

  const duplicate = f.feedback.create(payload);
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.telegram_preview.manifest_digest, first.telegram_preview.manifest_digest);
  const feed = f.notifications.feed({ audience: 'employee', empCode: 'DN016', today: '2026-07-20' });
  assert.equal(feed.events.filter((event) => event.type === 'ceo_feedback').length, 1);
  assert.equal(feed.events[0].feedback_id, first.id);
  assert.deepEqual(feed.events[0].item_keys, [f.item.key]);

  f.setNow('2026-07-20T03:00:00.000Z');
  const second = f.feedback.create({ ...payload, type: 'priority', note: 'Ưu tiên liên hệ', requestId: 'request-feedback-0002' });
  assert.notEqual(second.id, first.id);
  const history = f.feedback.listForItem(f.item.key, { empCode: 'DN016' });
  assert.equal(history.length, 2, 'phản hồi mới phải append, không overwrite');
  assert.equal(history[0].type, 'approved');
  assert.equal(history[1].type, 'priority');
  assert.equal(Object.hasOwn(history[0], 'request_id'), false);
  assert.equal(Object.hasOwn(history[0], 'notification_id'), false);
  assert.equal(Object.hasOwn(history[0], 'telegram_preview'), false);
});

test('Telegram preview sanitizes an entity name that resembles a financial term without blocking the event', () => {
  const f = fixture();
  const item = { ...f.item, unit_name: 'Bệnh viện Đa khoa Đồng Nai' };
  const created = f.feedback.create({ item, type: 'approved', note: '', actionCycle: 1, actor: 'CEO', requestId: 'request-safe-entity-name' });
  assert.equal(created.telegram_preview.status, 'preview_only');
  assert.match(created.telegram_preview.message, /mã đơn vị 001\.BV A/);
  assert.equal(sensitivePreviewText(created.telegram_preview.message), false);
});

test('Telegram preview fails closed for missing or ambiguous mapping and never exposes recipient id', () => {
  for (const mappings of [[], [{ emp_code: 'DN016', telegram_id: '1' }, { emp_code: 'DN016', telegram_id: '2' }]]) {
    const f = fixture({ mappings });
    const created = f.feedback.create({ item: f.item, type: 'revise', note: 'Vui lòng điều chỉnh', actionCycle: 1, actor: 'CEO', requestId: `request-${mappings.length}-blocked` });
    const preview = f.feedback.telegramPreview(created.id);
    assert.equal(preview.send_enabled, false);
    assert.equal(preview.provider_called, false);
    assert.equal(preview.status, 'blocked');
    assert.match(preview.blocked_reason, /^telegram_mapping_/);
    assert.equal(preview.recipient_masked, null);
    assert.equal(JSON.stringify(preview).includes('telegram_id'), false);
  }
});

test('Telegram preview hard-excludes blocked employee codes even when a mapping exists', () => {
  for (const empCode of ['DN021', 'DN023', 'VP004', 'VP018']) {
    const f = fixture({ mappings: [{ emp_code: empCode, telegram_id: '123456789' }] });
    const item = { ...f.item, key: `${empCode}|001.BV%20A|QLNB-1`, emp_code: empCode };
    const created = f.feedback.create({ item, type: 'approved', note: '', actionCycle: 1, actor: 'CEO', requestId: `request-hard-exclude-${empCode}` });
    assert.equal(created.telegram_preview.status, 'blocked');
    assert.equal(created.telegram_preview.blocked_reason, 'employee_hard_excluded');
    assert.equal(created.telegram_preview.send_enabled, false);
    assert.equal(created.telegram_preview.provider_called, false);
    assert.equal(created.telegram_preview.recipient_masked, null);
  }
});

test('financial/numeric free text is rejected before persistence and idempotency conflicts fail closed', () => {
  const f = fixture();
  assert.throws(() => f.feedback.create({ item: f.item, type: 'other', note: 'Chi phí 600000 đồng', actionCycle: 1, actor: 'CEO', requestId: 'request-sensitive-0001' }), /nhạy cảm/);
  assert.equal(f.files.has('dormant_qlnb_feedback'), false);
  const first = f.feedback.create({ item: f.item, type: 'approved', note: '', actionCycle: 1, actor: 'CEO', requestId: 'request-conflict-0001' });
  assert.throws(() => f.feedback.create({ item: f.item, type: 'priority', note: '', actionCycle: 1, actor: 'CEO', requestId: 'request-conflict-0001' }), /đã được dùng/);
  assert.ok(first.id);
});

test('employee acknowledgement is scoped, immutable and updates notification state', () => {
  const f = fixture();
  const created = f.feedback.create({ item: f.item, type: 'continue_follow_up', note: '', actionCycle: 1, actor: 'CEO', requestId: 'request-ack-feedback' });
  assert.throws(() => f.feedback.acknowledge({ feedbackId: created.id, empCode: 'DN001', kind: 'read', requestId: 'request-cross-scope' }), /phạm vi/);
  const read = f.feedback.acknowledge({ feedbackId: created.id, empCode: 'DN016', kind: 'read', requestId: 'request-ack-read' });
  assert.equal(read.kind, 'read');
  const duplicate = f.feedback.acknowledge({ feedbackId: created.id, empCode: 'DN016', kind: 'read', requestId: 'request-ack-read' });
  assert.equal(duplicate.duplicate, true);
  f.setNow('2026-07-20T04:00:00.000Z');
  f.feedback.acknowledge({ feedbackId: created.id, empCode: 'DN016', kind: 'updated', requestId: 'request-ack-updated' });
  const event = f.notifications.feed({ audience: 'employee', empCode: 'DN016', today: '2026-07-20' }).events.find((row) => row.feedback_id === created.id);
  assert.equal(event.ack_kind, 'updated');
  const history = f.feedback.listForItem(f.item.key, { empCode: 'DN016' })[0].acknowledgements;
  assert.deepEqual(history.map((ack) => ack.kind), ['read', 'updated']);
});

test('Telegram preview revalidates the persisted manifest and fails closed on tampering', () => {
  const f = fixture();
  const created = f.feedback.create({ item: f.item, type: 'approved', note: '', actionCycle: 1, actor: 'CEO', requestId: 'request-manifest-integrity' });
  assert.equal(f.feedback.telegramPreview(created.id).status, 'preview_only');

  const state = f.files.get('dormant_qlnb_feedback');
  state.feedback[0].telegram_preview.message = 'Nội dung đã bị thay đổi';
  f.files.set('dormant_qlnb_feedback', state);
  assert.throws(
    () => f.feedback.telegramPreview(created.id),
    (error) => error?.code === 'TELEGRAM_MANIFEST_INTEGRITY_FAILED',
  );
});
