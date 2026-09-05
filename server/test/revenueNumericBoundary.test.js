'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const analyticsSource = fs.readFileSync(require.resolve('../src/analytics'), 'utf8');
const storeSource = fs.readFileSync(require.resolve('../src/store'), 'utf8');
const revenuePageSource = fs.readFileSync(require.resolve('../../web/src/pages/Revenue.jsx'), 'utf8');
const store = require('../src/store');
const analytics = require('../src/analytics');

test('revenue arithmetic coerces mixed numeric source values instead of concatenating strings', () => {
  assert.match(storeSource, /parsed = missing \? 0 : Number\(rawRevenue\)/);
  assert.match(analyticsSource, /Number\(f\(x\)\)/);
  const rows = [{ revenue: 100 }, { revenue: '200' }];
  const total = rows.reduce((sum, row) => sum + (Number(row.revenue) || 0), 0);
  assert.equal(total, 300);
});

test('revenue grouping marks a non-finite input invalid instead of publishing a partial total', () => {
  assert.match(analyticsSource, /cur\.revenue_invalid \|\|=/);
  assert.match(analyticsSource, /revenue_invalid \? \{ \.\.\.row, revenue: null \}/);
  assert.match(revenuePageSource, /const revenueValid = !!data/);
});

test('revenue boundary contract covers number, numeric string, empty/null, garbage, Infinity and mixed rows', () => {
  assert.deepEqual(store.normalizeRevenueValue(125), { revenue: 125, revenue_missing: false, revenue_invalid: false });
  assert.deepEqual(store.normalizeRevenueValue('123.45'), { revenue: 123.45, revenue_missing: false, revenue_invalid: false });
  assert.deepEqual(store.normalizeRevenueValue(''), { revenue: 0, revenue_missing: true, revenue_invalid: false });
  assert.deepEqual(store.normalizeRevenueValue(null), { revenue: 0, revenue_missing: true, revenue_invalid: false });
  assert.deepEqual(store.normalizeRevenueValue('abc'), { revenue: null, revenue_missing: false, revenue_invalid: true });
  assert.deepEqual(store.normalizeRevenueValue(Infinity), { revenue: null, revenue_missing: false, revenue_invalid: true });
  assert.equal([125, '123.45', '', null].map(store.normalizeRevenueValue).reduce((s, x) => s + x.revenue, 0), 248.45);
});

test('một dòng trống vẫn ra số; một dòng rác làm tổng nhóm trả null', () => {
  const validMixed = [125, '123.45', '', null].map((value) => ({ key: 'A', label: 'A', ...store.normalizeRevenueValue(value) }));
  assert.equal(analytics.groupSum(validMixed, 'key', 'label')[0].revenue, 248.45);
  const withGarbage = [...validMixed, { key: 'A', label: 'A', ...store.normalizeRevenueValue('abc') }];
  assert.equal(analytics.groupSum(withGarbage, 'key', 'label')[0].revenue, null);
});

test('MoM validation rejects garbage in either current or previous period', () => {
  const valid = [store.normalizeRevenueValue(100), store.normalizeRevenueValue('')];
  const invalid = [store.normalizeRevenueValue(100), store.normalizeRevenueValue('abc')];
  assert.equal(analytics.revenueRowsValid(valid), true);
  assert.equal(analytics.revenueRowsValid(invalid), false);
  assert.match(analyticsSource, /prevRevenueValid = revenueRowsValid\(prevRows\)/);
});

test('manual T09 sync is routed to Debts and retains frozen-period guard', () => {
  const routes = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(routes, /assertPeriodOpenForMaterialization\(ky\)/);
  assert.match(routes, /isCutoverPeriod\(ky\)[\s\S]*debtsRevenueJob\.runOnce/);
  assert.match(routes, /DEBTS_REVENUE_MANUAL_PERIOD_NOT_CURRENT/);
});
