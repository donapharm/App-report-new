'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const policy = require('../src/groupDonaRevenuePolicy');

test('T09 headline keeps measured CRM plus App Web truth instead of the smaller Debts snapshot', () => {
  const crm = [
    { source: 'CRM_MISA', contractor_code: '01.DONA', revenue: 650_404_768 },
    { source: 'CRM_MISA', contractor_code: '02.AFP', revenue: 841_594_420 },
  ];
  const web = [{ source: 'APP_WEB_PARTNER', contractor_code: 'PARTNER', revenue: 452_955_000 }];
  const debts = [
    { source: 'DEBTS_INVOICE_SHADOW', contractor_code: '01.DONA', revenue: 377_879_468 },
    { source: 'DEBTS_INVOICE_SHADOW', contractor_code: '02.AFP', revenue: 835_234_420 },
  ];
  const selected = policy.enforce([...crm, ...web, ...debts], '09.2026');
  const total = selected.accepted.reduce((sum, row) => sum + row.revenue, 0);
  assert.equal(total, 1_944_954_188);
  assert.equal([...crm, ...web].reduce((sum, row) => sum + row.revenue, 0) - [...debts, ...web].reduce((sum, row) => sum + row.revenue, 0), 278_885_300);
  assert.deepEqual(selected.rejected, debts);
});

test('production startup cannot publish Debts over CRM before parity is proven', () => {
  const source = fs.readFileSync(require.resolve('../src/index'), 'utf8');
  assert.doesNotMatch(source, /debtsRevenueJob\.start\(\)/);
  assert.match(source, /revenueRefresh\.start\(\)/);
});
