'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDormantService } = require('../src/dormantService');
const { createDormantNotificationStore } = require('../src/dormantNotifications');

function makeFixture({ unitACount = 12, unitBCount = 4 } = {}) {
  const files = new Map();
  const persist = {
    load: (name, fallback) => files.has(name) ? structuredClone(files.get(name)) : structuredClone(fallback),
    save: (name, value) => files.set(name, structuredClone(value)),
  };
  let now = new Date('2026-07-20T02:00:00Z');
  let throughDate = '2026-07-19';
  const rows = [
    ...Array.from({ length: unitACount }, (_, i) => ({ emp_code: 'DN016', employee_name: 'Chị Ánh', unit_code: '001.BV A', unit_name: 'BV A', iit_code: `A-${i + 1}`, product_name: `Thuốc A${i + 1}`, route: 'CL', date: '2026-04-01', revenue: 100000000 - i, quantity: 1 })),
    ...Array.from({ length: unitBCount }, (_, i) => ({ emp_code: 'DN016', employee_name: 'Chị Ánh', unit_code: '002.BV B', unit_name: 'BV B', iit_code: `B-${i + 1}`, product_name: `Thuốc B${i + 1}`, route: 'CL', date: '2026-04-01', revenue: 1000000 - i, quantity: 1 })),
  ];
  const store = {
    periodKys: () => ['04.2026', '07.2026'],
    listPeriods: () => [{ ky: '04.2026', dateTo: '2026-04-30' }, { ky: '07.2026', dateTo: throughDate }],
    periodFreshness: () => ({ throughDate }),
    getRowsRange: ({ scope = {} } = {}) => rows.filter((r) => !scope.empCode || r.emp_code === scope.empCode),
    getCst: () => [],
  };
  const notificationStore = createDormantNotificationStore({ persist, clock: () => now });
  const service = createDormantService({ store, persist, notificationStore, clock: () => now });
  return {
    service, files, rows,
    setNow: (value) => { now = new Date(value); },
    setThroughDate: (value) => { throughDate = value; },
  };
}
function actionsFor(gate, follow = '2026-08-03', status = 'scheduled') {
  return gate.required_items.map((item) => ({ key: item.key, status, next_follow_up: follow, note: '' }));
}

test('one reminder focuses one unit and cascades its QLNB in batches of five only', () => {
  const f = makeFixture();
  const first = f.service.gateFor({ empCode: 'DN016', source: 'revenue' });
  assert.equal(first.trigger, 'weekly_unit_focus');
  assert.equal(first.required_items.length, 5);
  assert.equal(first.focus_unit.unit_code, '001.BV A');
  assert.equal(first.focus_unit.eligible_total, 12);
  assert.ok(first.required_items.every((x) => x.unit_code === '001.BV A'));

  const second = f.service.submitActions({ empCode: 'DN016', source: 'revenue', checkpoint_key: first.checkpoint_key, actions: actionsFor(first) });
  assert.equal(second.trigger, 'same_unit_next_batch');
  assert.equal(second.focus_unit.unit_code, '001.BV A');
  assert.equal(second.focus_unit.batch_number, 2);
  assert.equal(second.required_items.length, 5);

  const third = f.service.submitActions({ empCode: 'DN016', source: 'revenue', checkpoint_key: second.checkpoint_key, actions: actionsFor(second) });
  assert.equal(third.focus_unit.batch_number, 3);
  assert.equal(third.required_items.length, 2);

  const done = f.service.submitActions({ empCode: 'DN016', source: 'revenue', checkpoint_key: third.checkpoint_key, actions: actionsFor(third) });
  assert.equal(done.must_answer, false, 'không được nhảy ngay sang đơn vị khác trong cùng lần làm việc');
  const cp = f.files.get('dormant_qlnb_checkpoints').acknowledgements[first.checkpoint_key];
  assert.equal(cp.status, 'completed');
  assert.equal(cp.unit_code, '001.BV A');
  assert.equal(cp.handled_keys.length, 12);
});

test('another unit already due is shown on the next screen open, not auto-switched in the same response', () => {
  const f = makeFixture({ unitACount: 1, unitBCount: 1 });
  f.service.analyzeScope('DN016');
  const state = f.files.get('dormant_qlnb_state');
  for (const item of Object.values(state.items)) {
    item.status = 'scheduled';
    item.next_follow_up = '2026-07-20';
    item.action_updated_at = '2026-07-06';
    item.action_cycle = 1;
  }
  f.files.set('dormant_qlnb_state', state);

  const first = f.service.gateFor({ empCode: 'DN016' });
  assert.equal(first.focus_unit.unit_code, '001.BV A');
  const closed = f.service.submitActions({ empCode: 'DN016', checkpoint_key: first.checkpoint_key, actions: actionsFor(first) });
  assert.equal(closed.must_answer, false, 'lô cuối phải đóng canh cửa trước');
  const reopened = f.service.gateFor({ empCode: 'DN016' });
  assert.equal(reopened.focus_unit.unit_code, '002.BV B');
  assert.equal(reopened.required_items[0].selection_reason, 'follow_up_due');
});

test('legacy v1 checkpoint does not reopen known unplanned backlog in the same week', () => {
  const f = makeFixture({ unitACount: 3, unitBCount: 0 });
  const initial = f.service.gateFor({ empCode: 'DN016' });
  const known = f.service.analyzeScope('DN016').items.map((x) => x.key);
  f.files.set('dormant_qlnb_checkpoints', { version: 1, acknowledgements: { [initial.checkpoint_key]: { at: '2026-07-20T02:00:00Z', item_keys: known, known_keys: known } } });
  const migrated = f.service.gateFor({ empCode: 'DN016' });
  assert.equal(migrated.must_answer, false);
});

test('next week selects the next unit after the focused unit is fully planned', () => {
  const f = makeFixture({ unitACount: 6, unitBCount: 3 });
  let gate = f.service.gateFor({ empCode: 'DN016' });
  gate = f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: actionsFor(gate) });
  assert.equal(gate.required_items.length, 1);
  gate = f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: actionsFor(gate) });
  assert.equal(gate.must_answer, false);

  f.setNow('2026-07-27T02:00:00Z');
  const nextWeek = f.service.gateFor({ empCode: 'DN016' });
  assert.equal(nextWeek.focus_unit.unit_code, '002.BV B');
  assert.equal(nextWeek.required_items.length, 3);
  assert.ok(nextWeek.required_items.every((x) => x.iit_code.startsWith('B-')));
});

test('a unit containing a due review ranks before a higher-scored unplanned unit', () => {
  const f = makeFixture({ unitACount: 5, unitBCount: 1 });
  f.service.analyzeScope('DN016');
  const state = f.files.get('dormant_qlnb_state');
  const bKey = Object.keys(state.items).find((key) => key.includes('002.BV%20B'));
  state.items[bKey].status = 'scheduled';
  state.items[bKey].next_follow_up = '2026-07-20';
  state.items[bKey].action_updated_at = '2026-07-06';
  state.items[bKey].action_cycle = 1;
  f.files.set('dormant_qlnb_state', state);

  const gate = f.service.gateFor({ empCode: 'DN016' });
  assert.equal(gate.focus_unit.unit_code, '002.BV B');
  assert.equal(gate.required_items[0].selection_reason, 'follow_up_due');
});

test('follow-up date is required after today and capped at fourteen days', () => {
  const f = makeFixture({ unitACount: 1, unitBCount: 0 });
  const gate = f.service.gateFor({ empCode: 'DN016' });
  const key = gate.required_items[0].key;
  assert.equal(gate.follow_up_max, '2026-08-03');
  assert.throws(() => f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status: 'scheduled', next_follow_up: '2026-07-20', note: '' }] }), /sau ngày hiện tại/);
  assert.throws(() => f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status: 'scheduled', next_follow_up: '2026-08-04', note: '' }] }), /tối đa 14 ngày/);
  const done = f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status: 'scheduled', next_follow_up: '2026-08-03', note: '' }] });
  assert.equal(done.must_answer, false);
});

test('new CEO-approved blocking reasons are accepted and require an audit note', () => {
  for (const status of ['national_tender_forecast', 'debt_blocked', 'insurance_mapping_blocked']) {
    const f = makeFixture({ unitACount: 1, unitBCount: 0 });
    const gate = f.service.gateFor({ empCode: 'DN016' });
    const key = gate.required_items[0].key;
    assert.throws(() => f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status, next_follow_up: '2026-08-03', note: '' }] }), /ghi rõ lý do/);
    const done = f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status, next_follow_up: '2026-08-03', note: 'Đã xác minh với đơn vị' }] });
    assert.equal(done.must_answer, false);
  }
});

test('CEO can drill down plans by employee and unit with management metrics', () => {
  const f = makeFixture({ unitACount: 2, unitBCount: 1 });
  const gate = f.service.gateFor({ empCode: 'DN016' });
  f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: actionsFor(gate) });
  const detail = f.service.plansForAdmin({ empCode: 'DN016', unitCode: '001.BV A' });
  assert.equal(detail.read_only, true);
  assert.equal(detail.selected_emp_code, 'DN016');
  assert.equal(detail.selected_unit_code, '001.BV A');
  assert.equal(detail.selected_summary.total, 2);
  assert.equal(detail.selected_summary.in_progress, 2);
  assert.ok(detail.employees.some((item) => item.emp_code === 'DN016'));
  assert.ok(detail.units.some((item) => item.unit_code === '002.BV B'));
  assert.ok(detail.items.every((item) => item.emp_code === 'DN016' && item.unit_code === '001.BV A'));
});

test('a due review creates the next action cycle instead of extending invisibly', () => {
  const f = makeFixture({ unitACount: 1, unitBCount: 0 });
  let gate = f.service.gateFor({ empCode: 'DN016' });
  const key = gate.required_items[0].key;
  f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status: 'scheduled', next_follow_up: '2026-08-03', note: '' }] });
  assert.equal(f.files.get('dormant_qlnb_state').items[key].action_cycle, 1);

  f.setNow('2026-08-03T02:00:00Z');
  gate = f.service.gateFor({ empCode: 'DN016' });
  assert.equal(gate.required_items[0].selection_reason, 'follow_up_due');
  f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status: 'contacted', next_follow_up: '2026-08-17', note: '' }] });
  assert.equal(f.files.get('dormant_qlnb_state').items[key].action_cycle, 2);
});

test('submission remains strictly scoped to the employee and exact requested keys', () => {
  const f = makeFixture({ unitACount: 1, unitBCount: 0 });
  const gate = f.service.gateFor({ empCode: 'DN016' });
  const foreignKey = gate.required_items[0].key.replace('DN016', 'DN001');
  assert.throws(() => f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key: foreignKey, status: 'scheduled', next_follow_up: '2026-08-03', note: '' }] }), /phản hồi đủ/);
});

test('CEO notification feed receives plan, due review and read state', () => {
  const f = makeFixture({ unitACount: 1, unitBCount: 0 });
  const gate = f.service.gateFor({ empCode: 'DN016' });
  f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: actionsFor(gate) });
  let feed = f.service.notificationsForAdmin();
  assert.equal(feed.events[0].type, 'plan_batch');
  assert.equal(feed.unread_count, 1);
  assert.equal(f.service.markNotificationsRead({ all: true }).unread_count, 0);

  f.setNow('2026-08-03T02:00:00Z');
  feed = f.service.notificationsForAdmin();
  assert.ok(feed.events.some((x) => x.type === 'review_due'));
  assert.equal(feed.unread_count, 1);
  assert.equal(f.service.markNotificationsRead({ ids: [feed.events.find((x) => x.type === 'review_due').id] }).unread_count, 0);
});

test('CEO dashboard keeps overdue items in its top 100 regardless of priority score', () => {
  const f = makeFixture({ unitACount: 101, unitBCount: 0 });
  f.service.analyzeScope('DN016');
  const state = f.files.get('dormant_qlnb_state');
  const dueKey = Object.keys(state.items).find((key) => key.includes('A-101'));
  state.items[dueKey].status = 'scheduled';
  state.items[dueKey].next_follow_up = '2026-07-19';
  state.items[dueKey].action_updated_at = '2026-07-05';
  state.items[dueKey].action_cycle = 1;
  f.files.set('dormant_qlnb_state', state);
  const summary = f.service.summaryFor({ isAdmin: true });
  assert.equal(summary.items.length, 100);
  assert.ok(summary.items.some((item) => item.key === dueKey));
  assert.equal(summary.items[0].attention.status, 'overdue');
});

test('a later positive order resolves the QLNB and creates a CEO success notification even when summary reads first', () => {
  const f = makeFixture({ unitACount: 1, unitBCount: 0 });
  const gate = f.service.gateFor({ empCode: 'DN016' });
  const key = gate.required_items[0].key;
  f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status: 'expected_order', next_follow_up: '2026-08-03', note: '' }] });
  f.rows.push({ emp_code: 'DN016', employee_name: 'Chị Ánh', unit_code: '001.BV A', unit_name: 'BV A', iit_code: 'A-1', product_name: 'Thuốc A1', route: 'CL', date: '2026-07-25', revenue: 5000000, quantity: 2 });
  f.setThroughDate('2026-07-25');
  f.setNow('2026-07-25T02:00:00Z');

  const summary = f.service.summaryFor({ isAdmin: true });
  assert.equal(summary.summary.reactivated, 1);
  const feed = f.service.notificationsForAdmin();
  assert.ok(feed.events.some((x) => x.type === 'reactivated'));
  assert.equal(f.files.get('dormant_qlnb_state').items[key].resolution, 'reactivated_by_positive_order');
});
