'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeAssignedQuarter } = require('../src/targetKpi');

function maps(rows) {
  const targets = new Map();
  const revenues = new Map();
  for (const row of rows) {
    if (!targets.has(row.ky)) targets.set(row.ky, new Map());
    if (!revenues.has(row.ky)) revenues.set(row.ky, new Map());
    targets.get(row.ky).set(row.code, row.target);
    revenues.get(row.ky).set(row.code, row.revenue);
  }
  return { targets, revenues };
}

test('quarter KPI with only T07 assigned equals T07 target and T07 achieved average', () => {
  const { targets, revenues } = maps([
    { ky: '07.2026', code: 'DN006', target: 2_500_000_000, revenue: 3_229_579_687 },
    { ky: '08.2026', code: 'DN006', target: 0, revenue: 900_000_000 },
    { ky: '09.2026', code: 'DN006', target: 0, revenue: 700_000_000 },
  ]);
  const result = summarizeAssignedQuarter({
    ky: '07.2026', quarterKys: ['07.2026', '08.2026', '09.2026'], codes: ['DN006'],
    targetByKy: targets, revenueByKy: revenues,
  });
  assert.deepEqual(result.month, { target: 2_500_000_000, achieved: 3_229_579_687 });
  assert.equal(result.quarter.target, 2_500_000_000);
  assert.equal(result.quarter.achieved, 3_229_579_687);
  assert.deepEqual(result.quarter.assigned_kys, ['07.2026']);
  assert.equal(result.quarter.calculation_label, 'Target quý = trung bình các tháng đã giao');
});

test('quarter KPI averages three assigned monthly targets and achievements instead of summing them', () => {
  const { targets, revenues } = maps([
    { ky: '07.2026', code: 'DN006', target: 2_400_000_000, revenue: 2_640_000_000 },
    { ky: '08.2026', code: 'DN006', target: 2_700_000_000, revenue: 2_970_000_000 },
    { ky: '09.2026', code: 'DN006', target: 3_000_000_000, revenue: 3_300_000_000 },
  ]);
  const result = summarizeAssignedQuarter({
    ky: '09.2026', quarterKys: ['07.2026', '08.2026', '09.2026'], codes: ['DN006'],
    targetByKy: targets, revenueByKy: revenues,
  });
  assert.equal(result.quarter.target, 2_700_000_000);
  assert.equal(result.quarter.achieved, 2_970_000_000);
  assert.deepEqual(result.quarter.assigned_kys, ['07.2026', '08.2026', '09.2026']);
  assert.equal(result.quarter.assigned_month_count, 3);
});

test('admin KPI sums each employee average so employees with different assigned months stay correctly weighted', () => {
  const { targets, revenues } = maps([
    { ky: '07.2026', code: 'DN006', target: 100, revenue: 110 },
    { ky: '08.2026', code: 'DN006', target: 300, revenue: 330 },
    { ky: '07.2026', code: 'DN007', target: 50, revenue: 45 },
    { ky: '08.2026', code: 'DN007', target: 0, revenue: 999 },
  ]);
  const result = summarizeAssignedQuarter({
    ky: '08.2026', quarterKys: ['07.2026', '08.2026', '09.2026'], codes: ['DN006', 'DN007'],
    targetByKy: targets, revenueByKy: revenues,
  });
  assert.equal(result.quarter.target, 250); // avg(100,300) + avg(50)
  assert.equal(result.quarter.achieved, 265); // avg(110,330) + avg(45); excludes DN007 unassigned T08
});
