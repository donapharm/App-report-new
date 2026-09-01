'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const store = require('../src/store');
test('store cannot leak CRM MISA Group-Dona through slot, ORDS or sample fallback from T09', () => {
  const rows = [{ source: 'CRM_MISA', contractor_code: '01.DONA' }, { source: 'CRM_MISA', contractor_code: '02.AFP' },
    { source: 'APP_WEB_PARTNER', contractor_code: '03.PARTNER' }, { source: 'DEBTS_INVOICE_SHADOW', contractor_code: '01.DONA' }];
  assert.deepEqual(store.enforceRevenueSourcePolicy(rows, '09.2026').map((row) => row.source), ['APP_WEB_PARTNER', 'DEBTS_INVOICE_SHADOW']);
  assert.equal(store.enforceRevenueSourcePolicy(rows, '08.2026').length, 4);
});
