'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const remaining = require('../src/remainingAfterAdvance');

function salary(amount, { locked = false, suspect = false } = {}) {
  return {
    available: true,
    applicable: true,
    period: '2026-07',
    emp_code: 'DN009',
    amount,
    currency: 'VND',
    locked,
    status: locked ? 'locked' : 'draft',
    reason: null,
    suspect,
    suspect_reason: suspect ? 'amount_exceeds_after_penalty_total' : null,
  };
}

test('backend SSOT subtracts first advance from same-period after-penalty total', () => {
  const projection = remaining.buildRemainingAfterAdvance({
    period: '2026-07',
    afterPenaltyTotal: 336_334_260,
    salaryAdvance: salary(59_736_053),
  });
  assert.equal(projection.amount, 276_598_207);
  assert.equal(projection.afterPenaltyTotal, 336_334_260);
  assert.equal(projection.salaryAdvanceAmount, 59_736_053);
  assert.equal(projection.available, true);
  assert.equal(projection.status, 'provisional');
  assert.equal(projection.suspect, false);
});

test('zero advance is valid and preserves the full after-penalty total', () => {
  const projection = remaining.buildRemainingAfterAdvance({
    period: '2026-07', afterPenaltyTotal: 80_000_000, salaryAdvance: salary(0),
  });
  assert.equal(projection.amount, 80_000_000);
  assert.equal(projection.salaryAdvanceAmount, 0);
});

test('missing source fails closed and never becomes zero', () => {
  const missingSalary = remaining.buildRemainingAfterAdvance({
    period: '2026-07',
    afterPenaltyTotal: 80_000_000,
    salaryAdvance: { available: false, applicable: null, amount: null },
  });
  assert.equal(missingSalary.amount, null);
  assert.equal(missingSalary.reason, 'salary_advance_unavailable');

  const missingCost = remaining.buildRemainingAfterAdvance({
    period: '2026-07', afterPenaltyTotal: null, salaryAdvance: salary(20_000_000),
  });
  assert.equal(missingCost.amount, null);
  assert.equal(missingCost.reason, 'after_penalty_total_unavailable');
});

test('suspect or over-advance input yields dash projection instead of a negative amount', () => {
  const guarded = remaining.buildRemainingAfterAdvance({
    period: '2026-07', afterPenaltyTotal: 50_000_000, salaryAdvance: salary(60_000_000, { suspect: true }),
  });
  assert.equal(guarded.amount, null);
  assert.equal(guarded.suspect, true);
  assert.equal(guarded.reason, 'salary_advance_exceeds_after_penalty_total');

  const independentGuard = remaining.buildRemainingAfterAdvance({
    period: '2026-07', afterPenaltyTotal: 50_000_000, salaryAdvance: salary(60_000_000),
  });
  assert.equal(independentGuard.amount, null);
  assert.equal(independentGuard.suspect, true);
  assert.equal(Object.values(independentGuard).includes(-10_000_000), false);
});

test('status is locked only when cost period and App Salary are both locked', () => {
  assert.equal(remaining.buildRemainingAfterAdvance({
    afterPenaltyTotal: 100, salaryAdvance: salary(20, { locked: true }), periodClosed: true,
  }).status, 'locked');
  assert.equal(remaining.buildRemainingAfterAdvance({
    afterPenaltyTotal: 100, salaryAdvance: salary(20), periodClosed: true,
  }).status, 'provisional');
  assert.equal(remaining.buildRemainingAfterAdvance({
    afterPenaltyTotal: 100, salaryAdvance: salary(20, { locked: true }), periodClosed: false,
  }).status, 'provisional');
});

test('route owns the calculation and ALL keeps Salary fan-out disabled', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
  assert.match(routes, /remainingAfterAdvance\.buildRemainingAfterAdvance\(/);
  assert.match(routes, /afterPenaltyTotal,\s*salaryAdvance: resolvedSalaryAdvance/);
  assert.match(routes, /remainingAfterAdvance: resolvedRemainingAfterAdvance/);
  assert.match(routes, /includeSalaryAdvance:\s*false/);
});
