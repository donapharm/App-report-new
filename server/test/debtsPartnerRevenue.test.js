'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const partner = require('../src/debtsPartnerRevenue');
test('partner projection preserves App Sale partition and never creates CRM MISA rows', () => {
  const rows = partner.project([{ order_item_id: 7, order_code: 'WEB-1', created_at: '2026-09-03T01:00:00+07:00', contractor_code: '03.PARTNER',
    employee_code: 'DN001', unit_code: 'U1', qlnb_code: 'Q1', delivered_qty: '2', delivered_amount: '200', unit_price: '100' }], '2026-09');
  assert.equal(rows.length, 1); assert.equal(rows[0].source, 'APP_WEB_PARTNER'); assert.equal(rows[0].source_line_id, 'WEB:7');
  assert.equal(rows.some((row) => row.source === 'CRM_MISA'), false); assert.deepEqual(partner.summary(rows), { rows: 1, orders: 1, revenue: 200 });
});
