'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const policy = require('../src/groupDonaRevenuePolicy');

test('T09 onward Group-Dona keeps CRM truth and rejects unverified Debts without touching partners', () => {
  const rows = [
    { source: 'DEBTS_INVOICE_SHADOW', contractor_code: '01.DONA' },
    { source: 'CRM_MISA', contractor_code: '01.DONA' },
    { source: 'CRM_MISA', contractor_code: '02.AFP' },
    { source: 'APP_WEB_PARTNER', contractor_code: '03.TUE.N' },
  ];
  const result = policy.enforce(rows, '09.2026');
  assert.deepEqual(result.accepted, [rows[1], rows[2], rows[3]]);
  assert.deepEqual(result.rejected, [rows[0]]);
});
test('periods before T09 remain unchanged', () => {
  const row = { source: 'CRM_MISA', contractor_code: '01.DONA' };
  assert.equal(policy.enforce([row], '08.2026').accepted.length, 1);
});
