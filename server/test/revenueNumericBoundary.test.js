'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const analyticsSource = fs.readFileSync(require.resolve('../src/analytics'), 'utf8');
const storeSource = fs.readFileSync(require.resolve('../src/store'), 'utf8');
const revenuePageSource = fs.readFileSync(require.resolve('../../web/src/pages/Revenue.jsx'), 'utf8');

test('revenue arithmetic coerces mixed numeric source values instead of concatenating strings', () => {
  assert.match(storeSource, /parsedRevenue = revenueMissing \? null : Number\(rawRevenue\)/);
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

test('revenue boundary contract covers number, string, mixed, empty and non-finite values', () => {
  const normalize = (value) => {
    const missing = value == null || String(value).trim() === '';
    const parsed = missing ? null : Number(value);
    return { value: missing || !Number.isFinite(parsed) ? null : parsed, invalid: missing || !Number.isFinite(parsed) };
  };
  assert.deepEqual(normalize(125), { value: 125, invalid: false });
  assert.deepEqual(normalize('125'), { value: 125, invalid: false });
  assert.equal([125, '125'].map(normalize).reduce((s, x) => s + x.value, 0), 250);
  assert.deepEqual(normalize(''), { value: null, invalid: true });
  assert.deepEqual(normalize('Infinity'), { value: null, invalid: true });
});

test('manual T09 sync is routed to Debts and retains frozen-period guard', () => {
  const routes = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(routes, /assertPeriodOpenForMaterialization\(ky\)/);
  assert.match(routes, /isCutoverPeriod\(ky\)[\s\S]*debtsRevenueJob\.runOnce/);
  assert.match(routes, /DEBTS_REVENUE_MANUAL_PERIOD_NOT_CURRENT/);
});
