const test = require('node:test');
const assert = require('node:assert/strict');
const { quarantineRosterConflicts } = require('../src/revenueAttributionGuard');

const snapshot = {
  rows: [
    { unit_code: '140.BVĐK BÌNH PHƯỚC', qlnb_code: 'P1', emp_code: 'DN023', effective_from: '2026-07', effective_to: null, active: true },
    { unit_code: '142.BV QUÂN DÂN Y 16', qlnb_code: 'P2', emp_code: 'DN022', effective_from: '2026-07', effective_to: null, active: true },
  ],
};

test('keeps matching source attribution unchanged', () => {
  const row = { unit_code: '140.BVĐK BÌNH PHƯỚC', iit_code: 'P1', emp_code: 'DN023', revenue: 10 };
  const result = quarantineRosterConflicts([row], snapshot, '2026-07', '2026-07-23T01:00:00.000Z');
  assert.equal(result.rows[0], row);
  assert.deepEqual(result.summary, { rows: 0, units: 0, revenue: 0 });
});

test('quarantines a roster conflict without remapping to the expected employee', () => {
  const row = { unit_code: '142.BV QUÂN DÂN Y 16', iit_code: 'P2', emp_code: 'DN023', emp_name: 'Old owner', revenue: 25 };
  const result = quarantineRosterConflicts([row], snapshot, '2026-07', '2026-07-23T01:00:00.000Z');
  assert.equal(result.rows[0].emp_code, 'UNALLOCATED');
  assert.equal(result.rows[0].raw_emp_code, 'DN023');
  assert.notEqual(result.rows[0].emp_code, 'DN022');
  assert.equal(result.rows[0].revenue, 25);
  assert.deepEqual(result.summary, { rows: 1, units: 1, revenue: 25 });
  assert.equal(result.conflicts[0].expected_emp, 'DN022');
});

test('does not guess when no roster pair exists', () => {
  const row = { unit_code: 'UNKNOWN', iit_code: 'P9', emp_code: 'DN023', revenue: 5 };
  const result = quarantineRosterConflicts([row], snapshot, '2026-07');
  assert.equal(result.rows[0], row);
  assert.equal(result.summary.rows, 0);
});

test('fails closed for an empty roster snapshot', () => {
  assert.throws(() => quarantineRosterConflicts([], { rows: [] }, '2026-07'), /ROSTER_SNAPSHOT_EMPTY/);
});
