'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const recon = require('../src/employeeCostRevenueRecon');

const roster = [{ emp_code: 'DN001' }, { emp_code: 'DN002' }];

test('revenue outside roster has a named leg and makes the invariant balance', () => {
  const source = [
    { emp_code: 'DN001', revenue: 100 },
    { emp_code: 'DN021', revenue: 60 },
    { emp_code: 'DN023', revenue: 40 },
  ];
  const shownRows = [{ employeeCode: 'DN001', revenue: 100 }];
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'], revenueRowsOf: () => source, roster,
    shownRevenue: 100, shownRows,
  });

  assert.equal(result.total, 200);
  assert.equal(result.shown, 100);
  assert.equal(result.outsideRosterAmount, 100);
  assert.equal(result.outsideRosterRows, 2);
  assert.deepEqual(result.outsideRosterCodes, ['DN021', 'DN023']);
  assert.equal(result.gap, 0);
  assert.equal(result.balanced, true);
  assert.equal(shownRows.length, 1, 'dòng ngoài roster không được chèn vào bảng của roster');
});

test('no outside-roster revenue keeps the named leg empty', () => {
  const source = [{ emp_code: 'DN001', revenue: 100 }];
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'], revenueRowsOf: () => source, roster,
    shownRevenue: 100, shownRows: source,
  });

  assert.equal(result.outsideRosterAmount, 0);
  assert.equal(result.outsideRosterRows, 0);
  assert.deepEqual(result.outsideRosterCodes, []);
  assert.equal(result.balanced, true);
});

test('outside-roster revenue is not reassigned to unavailable roster employees', () => {
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'], revenueRowsOf: () => [
      { emp_code: 'DN001', revenue: 100 },
      { emp_code: 'DN021', revenue: 60 },
    ],
    roster, unavailable: ['DN001'], shownRevenue: 0, shownRows: [],
  });

  assert.deepEqual(result.unavailableEmployees, [{ empCode: 'DN001', revenue: 100 }]);
  assert.equal(result.outsideRosterAmount, 60);
  assert.equal(result.balanced, true);
});
