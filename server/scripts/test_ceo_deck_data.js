'use strict';
const assert = require('node:assert/strict');
const deckData = require('../src/report/deckData');
const analytics = require('../src/analytics');
const diemXu = require('../src/diemXu');

const close = (actual, expected, message) => {
  const tolerance = Math.max(1e-6, Math.abs(expected) * 1e-12);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} !== ${expected}`);
};
const groupTotal = (rows) => rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);

async function main() {
  const data = await deckData.build({ kind: 'week' });

  assert.equal(data.scope, 'CEO');
  assert.equal(data.kind, 'week');
  assert.ok(Array.isArray(data.currentRows));
  assert.ok(Array.isArray(data.previousRows));
  assert.ok(Array.isArray(data.dailyBars) && data.dailyBars.length > 0);
  assert.ok(Array.isArray(data.routeBreakdown));
  assert.ok(Array.isArray(data.sourceBreakdown));
  assert.ok(Array.isArray(data.customerTypeBreakdown));
  assert.ok(Array.isArray(data.therapyBreakdown));
  assert.ok(data.groupRows.employee && data.groupRows.unit && data.groupRows.product);
  assert.ok(data.diffTop.employee && data.diffTop.unit && data.diffTop.product);
  assert.ok(data.narrativeFacts.promises && data.narrativeFacts.risks && data.narrativeFacts.opportunities);

  const rowRevenue = analytics.sum(data.currentRows, (row) => Number(row.revenue || 0));
  close(data.totalRevenue, rowRevenue, 'CEO deck total must equal its current rows');
  close(groupTotal(data.routeBreakdown), data.totalRevenue, 'Route breakdown must reconcile');
  close(groupTotal(data.sourceBreakdown), data.totalRevenue, 'Source breakdown must reconcile');
  close(groupTotal(data.customerTypeBreakdown), data.totalRevenue, 'Customer type breakdown must reconcile');
  close(groupTotal(data.therapyBreakdown), data.totalRevenue, 'Therapy breakdown must reconcile');
  close(groupTotal(data.groupRows.unit), data.totalRevenue, 'Unit groups must reconcile');
  close(groupTotal(data.groupRows.product), data.totalRevenue, 'Product groups must reconcile');
  close(data.dailyBars.reduce((sum, day) => sum + day.revenue, 0), data.totalRevenue, 'Daily bars must reconcile');

  for (const employee of data.groupRows.employee) assert.ok(!diemXu.EXCLUDE.has(String(employee.key).toUpperCase()), `Excluded employee leaked into ranking: ${employee.key}`);
  for (const score of data.scores) assert.ok(!diemXu.EXCLUDE.has(String(score.empCode).toUpperCase()), `Excluded employee leaked into score table: ${score.empCode}`);
  assert.equal(data.scorePolicy.period, 'quarter');
  assert.equal(data.scorePolicy.carryForward, false);

  await assert.rejects(() => deckData.build({ kind: 'employee' }), /Unsupported deck kind/);

  console.log(JSON.stringify({
    ok: true,
    kind: data.kind,
    range: data.range,
    currentRows: data.currentRows.length,
    previousRows: data.previousRows.length,
    totalRevenue: data.totalRevenue,
    previousRevenue: data.previousRevenue,
    routes: data.routeBreakdown.map((x) => x.key),
    employees: data.groupRows.employee.length,
    units: data.groupRows.unit.length,
    products: data.groupRows.product.length,
    scoreRows: data.scores.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
