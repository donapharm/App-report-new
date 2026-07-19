'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/dormantQlnb');

const sale = (overrides = {}) => ({
  emp_code: 'DN001',
  unit_code: '001.BV A',
  iit_code: 'QLNB-A',
  unit_name: 'BV A',
  product_name: 'Thuốc A',
  route: 'CL',
  date: '2026-05-10',
  revenue: 1000000,
  quantity: 10,
  ...overrides,
});

const cst = (overrides = {}) => ({
  emp_code: 'DN001',
  unit_code: '001.BV A',
  iit_code: 'QLNB-A',
  remain_qty: 100,
  remain_amount: 50000000,
  active: true,
  ...overrides,
});

test('day precision: day 59 is not dormant; day 60 is dormant', () => {
  const rows = [sale(), sale({ emp_code: 'DN099', iit_code: 'OTHER', date: '2026-05-11' })];
  const d59 = D.analyze({ salesRows: rows, dataAsOf: '2026-07-08' });
  assert.equal(d59.items.length, 0);
  const d60 = D.analyze({ salesRows: rows, dataAsOf: '2026-07-09' });
  assert.equal(d60.items.length, 1);
  assert.equal(d60.items[0].days_idle, 60);
  assert.equal(d60.items[0].date_precision, 'day');
});

test('monthly aggregate on day 01 uses month end as effective activity date', () => {
  const rows = [
    sale({ date: '2026-01-01' }),
    sale({ emp_code: 'DN002', unit_code: '002.BV B', iit_code: 'QLNB-B', date: '2026-01-01' }),
  ];
  assert.equal(D.detectDatePrecision(rows).get('2026-01'), 'month');
  const before = D.analyze({ salesRows: rows, dataAsOf: '2026-03-31', scope: { empCode: 'DN001' } });
  assert.equal(before.items.length, 0, '31/01 -> 31/03 is only 59 complete days');
  const due = D.analyze({ salesRows: rows, dataAsOf: '2026-04-01', scope: { empCode: 'DN001' } });
  assert.equal(due.items.length, 1);
  assert.equal(due.items[0].last_activity_raw_at, '2026-01-01');
  assert.equal(due.items[0].last_activity_at, '2026-01-31');
  assert.equal(due.items[0].date_precision, 'month');
  assert.equal(due.items[0].days_idle, 60);
});

test('a month containing real daily dates keeps exact day precision', () => {
  const rows = [
    sale({ date: '2026-07-01' }),
    sale({ emp_code: 'DN002', unit_code: '002.BV B', iit_code: 'QLNB-B', date: '2026-07-18' }),
  ];
  assert.equal(D.detectDatePrecision(rows).get('2026-07'), 'day');
  const result = D.analyze({ salesRows: rows, dataAsOf: '2026-08-30', scope: { empCode: 'DN001' } });
  assert.equal(result.items[0].last_activity_at, '2026-07-01');
  assert.equal(result.items[0].date_precision, 'day');
  assert.equal(result.items[0].days_idle, 60);
});

test('business key separates the same QLNB at different units', () => {
  const rows = [
    sale({ unit_code: '001.BV A', date: '2026-04-01' }),
    sale({ unit_code: '002.BV B', unit_name: 'BV B', date: '2026-06-20' }),
  ];
  const result = D.analyze({ salesRows: rows, dataAsOf: '2026-07-19' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].unit_code, '001.BV A');
  assert.notEqual(D.makeKey('DN001', '001.BV A', 'QLNB-A'), D.makeKey('DN001', '002.BV B', 'QLNB-A'));
});

test('negative/return rows do not reset last positive activity', () => {
  const rows = [
    sale({ date: '2026-05-10', revenue: 1000000, quantity: 10 }),
    sale({ date: '2026-06-20', revenue: -1000000, quantity: -10 }),
  ];
  const result = D.analyze({ salesRows: rows, dataAsOf: '2026-07-09' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].last_activity_at, '2026-05-10');
  assert.equal(result.items[0].positive_order_rows, 1);
});

test('never-ordered zero rows are not dormant candidates', () => {
  const result = D.analyze({ salesRows: [sale({ revenue: 0, quantity: 0 })], dataAsOf: '2026-12-31' });
  assert.equal(result.items.length, 0);
});

test('active CST that never had a positive order is separated as not activated', () => {
  const result = D.analyze({ salesRows: [sale()], cstRows: [cst({ iit_code: 'QLNB-NEW' })], dataAsOf: '2026-07-19', scope: { empCode: 'DN001' } });
  assert.equal(result.items.some((x) => x.iit_code === 'QLNB-NEW'), false);
  assert.equal(result.not_activated.length, 1);
  assert.equal(result.not_activated[0].classification, 'not_activated');
  assert.equal(result.summary.not_activated, 1);
});

test('structured workflow includes expected order and no-demand outcomes', () => {
  assert.ok(D.ACTION_STATUSES.includes('expected_order'));
  assert.ok(D.ACTION_STATUSES.includes('no_demand'));
});

test('employee scope is strict and shared CST ownership is sanitized', () => {
  const rows = [
    sale({ emp_code: 'DN001', date: '2026-04-10' }),
    sale({ emp_code: 'DN002', date: '2026-04-10' }),
  ];
  const cstRows = [cst({ emp_code: 'DN001,DN002', sales_emps: 'DN001,DN002' })];
  const result = D.analyze({ salesRows: rows, cstRows, dataAsOf: '2026-07-19', scope: { empCode: 'dn001' } });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].emp_code, 'DN001');
  assert.deepEqual(result.items[0].cst.emp_code, 'DN001');
  assert.equal('sales_emps' in result.items[0].cst, false);
  assert.equal(JSON.stringify(result).includes('DN002'), false);
});

test('active CST with no remaining quantity and no C30 excludes candidate', () => {
  const rows = [sale({ date: '2026-04-10' })];
  const noCapacity = D.analyze({ salesRows: rows, cstRows: [cst({ remain_qty: 0, c30_actionable: false })], dataAsOf: '2026-07-19' });
  assert.equal(noCapacity.items.length, 0);
  const withC30 = D.analyze({ salesRows: rows, cstRows: [cst({ remain_qty: 0, c30_actionable: true })], dataAsOf: '2026-07-19' });
  assert.equal(withC30.items.length, 1);
  assert.equal(withC30.items[0].cst.c30_available, true);
});

test('deterministic priority is evidence-based, sorted, and gate is capped at five', () => {
  const rows = Array.from({ length: 7 }, (_, i) => sale({
    unit_code: `${String(i + 1).padStart(3, '0')}.BV ${i + 1}`,
    iit_code: `QLNB-${i + 1}`,
    date: `2026-0${i < 3 ? 2 : 3}-${String(10 + i).padStart(2, '0')}`,
    revenue: (i + 1) * 10000000,
  }));
  const result = D.analyze({ salesRows: rows, dataAsOf: '2026-07-19', maxPriority: 5 });
  assert.equal(result.items.length, 7);
  assert.equal(result.gate.length, 5);
  for (let i = 1; i < result.items.length; i += 1) {
    assert.ok(result.items[i - 1].priority.score >= result.items[i].priority.score);
  }
  assert.equal(result.items[0].priority.model, 'deterministic-v1');
  assert.ok(result.items[0].priority.evidence.some((x) => x.includes('ngày không có đơn dương')));
});

test('injected persistence stores action, suppresses gate until due, then gates overdue', () => {
  let persisted = { version: 1, items: {} };
  const engine = D.createEngine({
    loadState: () => persisted,
    saveState: (next) => { persisted = next; },
  });
  const rows = [sale({ date: '2026-04-10' })];
  const first = engine.analyze({ salesRows: rows, dataAsOf: '2026-07-19' });
  assert.equal(first.gate[0].gate.reason, 'newly_dormant');
  const key = first.items[0].key;
  engine.updateAction({ key, status: 'scheduled', next_follow_up: '2026-07-21', note: 'Gọi lại khoa Dược', actor: 'DN001', now: '2026-07-19' });
  const beforeDue = engine.analyze({ salesRows: rows, dataAsOf: '2026-07-20' });
  assert.equal(beforeDue.gate.length, 0);
  assert.equal(beforeDue.items[0].action.status, 'scheduled');
  const due = engine.analyze({ salesRows: rows, dataAsOf: '2026-07-21' });
  assert.equal(due.gate.length, 1);
  assert.equal(due.gate[0].gate.reason, 'due_today');
  assert.equal(persisted.items[key].audit.at(-1).type, 'action_updated');
});

test('a later positive order automatically resolves and reports reactivation', () => {
  let persisted = { version: 1, items: {} };
  const engine = D.createEngine({ loadState: () => persisted, saveState: (v) => { persisted = v; } });
  const initialRows = [sale({ date: '2026-01-01' })];
  const dormant = engine.analyze({ salesRows: initialRows, dataAsOf: '2026-04-01' });
  assert.equal(dormant.items.length, 1);
  const key = dormant.items[0].key;
  assert.equal(persisted.items[key].last_activity_at, '2026-01-31');

  const withNewOrder = [...initialRows, sale({ date: '2026-04-02', revenue: 2000000 })];
  const next = engine.analyze({ salesRows: withNewOrder, dataAsOf: '2026-04-02' });
  assert.equal(next.items.length, 0);
  assert.equal(next.reactivated.length, 1);
  assert.equal(next.reactivated[0].order_at, '2026-04-02');
  assert.equal(persisted.items[key].resolution, 'reactivated_by_positive_order');
});

test('action status is validated and audit records actor without touching files', () => {
  const key = D.makeKey('DN001', '001.BV A', 'QLNB-A');
  const state = { version: 1, items: { [key]: { first_detected_at: '2026-07-19', last_activity_at: '2026-05-01', audit: [] } } };
  assert.throws(() => D.updateAction({ state, key, status: 'clicked_yes', actor: 'DN001', now: '2026-07-19' }), /không hợp lệ/);
  const next = D.updateAction({ state, key, status: 'contacted', next_follow_up: '2026-07-22', note: 'Đã gọi', actor: 'DN001', now: '2026-07-19' });
  assert.equal(next.items[key].status, 'contacted');
  assert.equal(next.items[key].audit[0].actor, 'DN001');
  assert.equal(state.items[key].status, undefined, 'pure update must not mutate caller state');
});
