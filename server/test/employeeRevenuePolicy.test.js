'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../src/employeeRevenuePolicy');
const store = require('../src/store');
const ords = require('../src/ords');

test('chỉ VP018 bị chặn phân bổ doanh thu vì là Telesaler', () => {
  assert.deepEqual([...policy.REVENUE_ATTRIBUTION_BLOCKED_EMP_CODES], ['VP018']);
  assert.equal(policy.isRevenueAttributionBlocked(' vp018 '), true);
  for (const code of ['DN001', 'DN022', 'VP004']) {
    assert.equal(policy.isRevenueAttributionBlocked(code), false);
  }
});

test('store giữ tổng doanh thu nhưng cách ly phân bổ VP018 về UNALLOCATED', () => {
  const source = { emp_code: 'vp018', emp_name: 'Telesaler', revenue: 123_456, unit_code: '001' };
  const row = store.normalizeEmpForReport(source);
  assert.equal(row.emp_code, 'UNALLOCATED');
  assert.equal(row.emp_name, 'Chưa phân bổ');
  assert.equal(row.raw_emp_code, 'vp018');
  assert.equal(row.blocked_emp_code, 'VP018');
  assert.equal(row.attribution_status, 'NON_SALES_ROLE_QUARANTINED');
  assert.equal(row.revenue, 123_456);
  assert.equal(store.normalizeEmpForReport({ emp_code: 'DN001', revenue: 10 }).emp_code, 'DN001');
});

test('ORDS fallback cũng fail-closed nếu nguồn gán VP018', () => {
  const row = ords.mapRow({ EMP_NUMBER: 'VP018', REVENUE: 789, DONVI: '001' }, '07.2026');
  assert.equal(row.emp_code, 'UNALLOCATED');
  assert.equal(row.raw_emp_code, 'VP018');
  assert.equal(row.attribution_status, 'NON_SALES_ROLE_QUARANTINED');
  assert.equal(row.revenue, 789);
});
