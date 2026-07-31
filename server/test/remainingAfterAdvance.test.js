'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const remaining = require('../src/remainingAfterAdvance');
const table = require('../src/employeeCostTable');

function salary(amount, { locked = false } = {}) {
  return {
    available: true, applicable: true, period: '2026-07', emp_code: 'DN009', amount,
    currency: 'VND', locked, status: locked ? 'locked' : 'draft', reason: null,
  };
}

test('DN009 backend SSOT subtracts first advance from after-penalty total exactly', () => {
  const projection = remaining.buildRemainingAfterAdvance({
    period: '2026-07',
    afterPenaltyTotal: 336_334_260,
    salaryAdvance: salary(59_736_053),
    periodClosed: false,
  });
  assert.equal(projection.amount, 276_598_207);
  assert.equal(projection.afterPenaltyTotal, 336_334_260);
  assert.equal(projection.salaryAdvanceAmount, 59_736_053);
  assert.equal(projection.status, 'provisional');
  assert.equal(projection.locked, false);
});

test('zero advance is valid and keeps the full after-penalty total', () => {
  const projection = remaining.buildRemainingAfterAdvance({
    period: '2026-07', afterPenaltyTotal: 336_334_260, salaryAdvance: salary(0),
  });
  assert.equal(projection.available, true);
  assert.equal(projection.salaryAdvanceAmount, 0);
  assert.equal(projection.amount, 336_334_260);
});

test('missing Salary or after-penalty input fails closed instead of treating it as zero', () => {
  const missingSalary = remaining.buildRemainingAfterAdvance({
    period: '2026-07', afterPenaltyTotal: 336_334_260,
    salaryAdvance: { available: false, applicable: null, amount: null, reason: 'employee_not_found' },
  });
  assert.equal(missingSalary.amount, null);
  assert.equal(missingSalary.reason, 'salary_advance_unavailable');

  const missingCost = remaining.buildRemainingAfterAdvance({
    period: '2026-07', afterPenaltyTotal: null, salaryAdvance: salary(59_736_053),
  });
  assert.equal(missingCost.amount, null);
  assert.equal(missingCost.reason, 'after_penalty_unavailable');
});

test('advance above after-penalty total is a fail-closed anomaly, never a plausible negative amount', () => {
  const assessed = remaining.assessSalaryAdvance({
    afterPenaltyTotal: 459_441_306, salaryAdvance: salary(598_978_982),
  });
  assert.equal(assessed.suspect, true);
  assert.equal(assessed.suspectReason, 'amount_exceeds_after_penalty_total');
  assert.equal(assessed.comparisonAfterPenaltyTotal, 459_441_306);

  const projection = remaining.buildRemainingAfterAdvance({
    period: '2026-07', afterPenaltyTotal: 459_441_306, salaryAdvance: assessed,
  });
  assert.equal(projection.available, false);
  assert.equal(projection.amount, null);
  assert.equal(projection.suspect, true);
  assert.equal(projection.status, 'anomaly');
  assert.equal(projection.reason, 'salary_advance_exceeds_after_penalty_total');
  assert.match(projection.note, /nghi sai, đang đối chiếu/);
});

test('status is locked only when both cost period and Salary are locked', () => {
  assert.equal(remaining.buildRemainingAfterAdvance({ afterPenaltyTotal: 100, salaryAdvance: salary(20, { locked: true }), periodClosed: true }).status, 'locked');
  assert.equal(remaining.buildRemainingAfterAdvance({ afterPenaltyTotal: 100, salaryAdvance: salary(20, { locked: false }), periodClosed: true }).status, 'provisional');
  assert.equal(remaining.buildRemainingAfterAdvance({ afterPenaltyTotal: 100, salaryAdvance: salary(20, { locked: true }), periodClosed: false }).status, 'provisional');
});

test('ALL partial aggregate exposes known subtotal and missing coverage without inventing zero', () => {
  const reports = [
    { empCode: 'DN009', remainingAfterAdvance: remaining.buildRemainingAfterAdvance({ period: '2026-07', afterPenaltyTotal: 336_334_260, salaryAdvance: salary(59_736_053) }) },
    { empCode: 'DN010', remainingAfterAdvance: remaining.buildRemainingAfterAdvance({ period: '2026-07', afterPenaltyTotal: 120_000_000, salaryAdvance: { available: false, applicable: null, amount: null } }) },
    { empCode: 'DN011', remainingAfterAdvance: remaining.buildRemainingAfterAdvance({ period: '2026-07', afterPenaltyTotal: 40_000_000, salaryAdvance: salary(50_000_000) }) },
  ];
  const aggregate = remaining.aggregateRemainingAfterAdvance(reports);
  assert.equal(aggregate.amount, null, 'incomplete team total remains fail-closed');
  assert.equal(aggregate.subtotal, 276_598_207, 'suspect and missing employees are both excluded from subtotal');
  assert.equal(aggregate.contributors, 1);
  assert.equal(aggregate.employeeCount, 3);
  assert.equal(aggregate.missingCount, 2);
  assert.deepEqual(aggregate.missingEmployees, ['DN010', 'DN011']);
  assert.equal(aggregate.suspectCount, 1);
  assert.deepEqual(aggregate.suspectEmployees, ['DN011']);
  assert.equal(aggregate.complete, false);

  const merged = table.mergeEmployeeReports(reports, reports.map((item) => ({ emp_code: item.empCode, name: item.empCode })));
  assert.deepEqual(merged.remainingAfterAdvance, aggregate, 'ALL report keeps backend aggregate at top level');
});

test('ALL Salary calls stay inside the existing bounded employee-cost concurrency path', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
  const allBuild = routes.match(/const buildMerged = async \(\) => \{[\s\S]*?return employeeCostTable\.mergeEmployeeReports\(reports, roster\);\n  \};/)?.[0] || '';
  assert.match(allBuild, /mapWithConcurrency\(roster, 3/);
  assert.match(allBuild, /includeSalaryAdvance: true/);
  assert.match(routes, /remainingAfterAdvance\.buildRemainingAfterAdvance\(/);
  assert.match(routes, /afterPenaltyTotal: summary\?\.afterPenaltyTotal/);
});
