'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAcceptanceProvider } = require('../src/reportdevAcceptanceProvider');

test('provider reads backend-owned rows and returns only aggregate reconciliation counters', async () => {
  const rows = [
    { emp_code: 'DN001', revenue: 100 },
    { emp_code: 'DN021', revenue: 20 },
    { emp_code: 'UNALLOCATED', raw_emp_code: 'VP018', attribution_status: 'NON_SALES_ROLE_QUARANTINED', revenue: 5 },
  ];
  const load = createAcceptanceProvider({
    store: { targetRoster: () => [{ emp_code: 'DN001' }], getRows: () => rows },
    rosterBuilder: (value) => value,
    isLoginBlocked: () => false,
    isTargetOnlyEmployee: (code) => code === 'DN021',
  });
  assert.deepEqual(await load('2026-08'), {
    activeRows: 3, employeeCount: 1, targetOnlyAmount: 20,
    nonSalesRoleQuarantinedAmount: 5, balanced: true,
  });
});

test('provider rejects a period outside the fixed map before reading data', async () => {
  const load = createAcceptanceProvider({ store: { targetRoster: () => { throw new Error('must not read'); } } });
  await assert.rejects(() => load('2026-06'), (error) => error.code === 'ACCEPTANCE_PERIOD_FORBIDDEN');
});
