'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDormantService } = require('../src/dormantService');

function makeFixture() {
  const files = new Map();
  const persist = {
    load: (name, fallback) => files.has(name) ? JSON.parse(JSON.stringify(files.get(name))) : JSON.parse(JSON.stringify(fallback)),
    save: (name, value) => files.set(name, JSON.parse(JSON.stringify(value))),
  };
  let now = new Date('2026-07-20T02:00:00Z');
  const rows = [{ emp_code: 'DN016', unit_code: '001.BV A', unit_name: 'BV A', iit_code: 'QLNB-A', product_name: 'Thuốc A', route: 'CL', date: '2026-04-01', revenue: 1000000, quantity: 10 }];
  const cst = [
    { emp_code: 'DN016', unit_code: '001.BV A', unit_name: 'BV A', iit_code: 'QLNB-A', product_name: 'Thuốc A', remain_qty: 100, remain_amount: 10000000, active: true },
    { emp_code: 'DN016', unit_code: '001.BV A', unit_name: 'BV A', iit_code: 'QLNB-NEW', product_name: 'Thuốc mới', remain_qty: 50, remain_amount: 5000000, active: true },
  ];
  const store = {
    periodKys: () => ['04.2026', '07.2026'],
    listPeriods: () => [{ ky: '04.2026', dateTo: '2026-04-30' }, { ky: '07.2026', dateTo: '2026-07-19' }],
    periodFreshness: () => ({ throughDate: '2026-07-19' }),
    getRowsRange: ({ scope }) => rows.filter((r) => !scope.empCode || r.emp_code === scope.empCode),
    getCst: ({ scope }) => cst.filter((r) => !scope.empCode || r.emp_code === scope.empCode),
  };
  const service = createDormantService({ store, persist, clock: () => now });
  return { service, files, setNow: (value) => { now = new Date(value); } };
}

test('first entry of week gates once, records structured action, then suppresses until due', () => {
  const f = makeFixture();
  const first = f.service.gateFor({ empCode: 'DN016', source: 'revenue' });
  assert.equal(first.trigger, 'weekly_first_entry');
  assert.equal(first.must_answer, true);
  assert.equal(first.required_items.length, 1);
  assert.equal(first.summary.not_activated, 1);
  const key = first.required_items[0].key;
  const after = f.service.submitActions({ empCode: 'DN016', source: 'revenue', checkpoint_key: first.checkpoint_key, actions: [{ key, status: 'expected_order', next_follow_up: '2026-07-22', note: 'Đơn vị dự kiến đặt hàng' }] });
  assert.equal(after.must_answer, false);
  assert.equal(f.service.gateFor({ empCode: 'DN016', source: 'analysis' }).must_answer, false);
  f.setNow('2026-07-22T02:00:00Z');
  const due = f.service.gateFor({ empCode: 'DN016', source: 'analysis' });
  assert.equal(due.must_answer, true);
  assert.equal(due.trigger, 'new_or_due');
});

test('new week asks once again even when next follow-up is later', () => {
  const f = makeFixture();
  const first = f.service.gateFor({ empCode: 'DN016' });
  const key = first.required_items[0].key;
  f.service.submitActions({ empCode: 'DN016', checkpoint_key: first.checkpoint_key, actions: [{ key, status: 'scheduled', next_follow_up: '2026-08-10', note: '' }] });
  f.setNow('2026-07-27T02:00:00Z');
  const nextWeek = f.service.gateFor({ empCode: 'DN016' });
  assert.equal(nextWeek.trigger, 'weekly_first_entry');
  assert.equal(nextWeek.must_answer, true);
  assert.equal(nextWeek.required_items[0].action.status, 'scheduled');
});

test('submission rejects incomplete keys, missing future date and sensitive reasons without note', () => {
  const f = makeFixture();
  const gate = f.service.gateFor({ empCode: 'DN016' });
  assert.throws(() => f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [] }), /phản hồi đủ/);
  const key = gate.required_items[0].key;
  assert.throws(() => f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status: 'contacted', next_follow_up: '2026-07-20' }] }), /sau ngày hiện tại/);
  assert.throws(() => f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key, status: 'no_demand', next_follow_up: '2026-07-21', note: '' }] }), /ghi rõ lý do/);
});

test('employee scope cannot submit another employee key', () => {
  const f = makeFixture();
  const gate = f.service.gateFor({ empCode: 'DN016' });
  const foreignKey = gate.required_items[0].key.replace('DN016', 'DN001');
  assert.throws(() => f.service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions: [{ key: foreignKey, status: 'scheduled', next_follow_up: '2026-07-21' }] }), /phản hồi đủ/);
});

test('after Top 5 acknowledgement it does not immediately gate the next backlog batch', () => {
  const files = new Map();
  const persist = { load: (n, d) => files.has(n) ? structuredClone(files.get(n)) : structuredClone(d), save: (n, v) => files.set(n, structuredClone(v)) };
  const rows = Array.from({ length: 8 }, (_, i) => ({ emp_code: 'DN016', unit_code: `00${i}.BV`, iit_code: `Q-${i}`, date: '2026-04-01', revenue: 1000000 + i, quantity: 1 }));
  const store = {
    periodKys: () => ['04.2026', '07.2026'],
    listPeriods: () => [{ ky: '07.2026', dateTo: '2026-07-19' }],
    periodFreshness: () => ({ throughDate: '2026-07-19' }),
    getRowsRange: () => rows,
    getCst: () => [],
  };
  const service = createDormantService({ store, persist, clock: () => new Date('2026-07-20T02:00:00Z') });
  const gate = service.gateFor({ empCode: 'DN016' });
  assert.equal(gate.required_items.length, 5);
  const actions = gate.required_items.map((x) => ({ key: x.key, status: 'scheduled', next_follow_up: '2026-08-10', note: '' }));
  const after = service.submitActions({ empCode: 'DN016', checkpoint_key: gate.checkpoint_key, actions });
  assert.equal(after.must_answer, false);
  assert.equal(after.required_items.length, 0);
});
