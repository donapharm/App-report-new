'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const recon = require('../src/employeeCostRevenueRecon');

const roster = [{ emp_code: 'DN001' }, { emp_code: 'DN002' }];

test('target-only revenue has its own named leg and makes the invariant balance', () => {
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
  assert.equal(result.targetOnlyAmount, 100);
  assert.equal(result.targetOnlyRows, 2);
  assert.deepEqual(result.targetOnlyCodes, ['DN021', 'DN023']);
  assert.equal(result.outsideRosterAmount, 0);
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

test('true outside-roster revenue is not reassigned to unavailable roster employees', () => {
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'], revenueRowsOf: () => [
      { emp_code: 'DN001', revenue: 100 },
      { emp_code: 'DN999', revenue: 60 },
    ],
    roster, unavailable: ['DN001'], shownRevenue: 0, shownRows: [],
  });

  assert.deepEqual(result.unavailableEmployees, [{ empCode: 'DN001', revenue: 100 }]);
  assert.equal(result.outsideRosterAmount, 60);
  assert.deepEqual(result.outsideRosterCodes, ['DN999']);
  assert.equal(result.balanced, true);
});

test('T07/T08 target-only and VP018 quarantine are explicit balanced legs', () => {
  const t07 = recon.buildRevenueRecon({
    periods: ['2026-07'], roster: [...roster, { emp_code: 'DN021' }, { emp_code: 'DN023' }],
    revenueRowsOf: () => [
      { emp_code: 'DN021', revenue: 50_328_000 },
      { emp_code: 'DN023', revenue: 9_699_600 },
    ], shownRevenue: 0, shownRows: [],
  });
  assert.equal(t07.targetOnlyAmount, 60_027_600);
  assert.equal(t07.targetOnlyRows, 2);
  assert.deepEqual(t07.targetOnlyCodes, ['DN021', 'DN023']);
  assert.equal(t07.balanced, true);

  const t08 = recon.buildRevenueRecon({
    periods: ['2026-08'], roster: [...roster, { emp_code: 'DN021' }, { emp_code: 'DN023' }],
    revenueRowsOf: () => [
      { emp_code: 'DN021', revenue: 66_528_000 },
      { emp_code: 'DN023', revenue: 226_004_700 },
      { emp_code: 'UNALLOCATED', raw_emp_code: 'VP018', attribution_status: 'NON_SALES_ROLE_QUARANTINED', revenue: 1_795_600 },
    ], shownRevenue: 0, shownRows: [],
  });
  assert.equal(t08.targetOnlyAmount, 292_532_700);
  assert.deepEqual(t08.targetOnlyCodes, ['DN021', 'DN023']);
  assert.equal(t08.nonSalesRoleQuarantinedAmount, 1_795_600);
  assert.equal(t08.nonSalesRoleQuarantinedRows, 1);
  assert.deepEqual(t08.nonSalesRoleQuarantinedCodes, ['VP018']);
  assert.equal(t08.outsideRosterAmount, 0);
  assert.equal(t08.gap, 0);
  assert.equal(t08.balanced, true);
});
