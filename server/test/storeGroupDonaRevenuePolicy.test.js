'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const store = require('../src/store');
test('store rejects unverified Debts replacement and keeps CRM truth from T09', () => {
  const rows = [{ source: 'CRM_MISA', contractor_code: '01.DONA' }, { source: 'CRM_MISA', contractor_code: '02.AFP' },
    { source: 'APP_WEB_PARTNER', contractor_code: '03.PARTNER' }, { source: 'DEBTS_INVOICE_SHADOW', contractor_code: '01.DONA' }];
  assert.deepEqual(store.enforceRevenueSourcePolicy(rows, '09.2026').map((row) => row.source), ['CRM_MISA', 'CRM_MISA', 'APP_WEB_PARTNER']);
  assert.equal(store.enforceRevenueSourcePolicy(rows, '08.2026').length, 4);
});
