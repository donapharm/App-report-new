import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeeCostViewModel } from '../src/employeeCostModel.js';

const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

test('view model preserves backend-owned DN009 amount and missing null without client math', () => {
  const exact = employeeCostViewModel({
    from: '2026-07', to: '2026-07', periods: [],
    remainingAfterAdvance: {
      available: true, amount: 276_598_207, afterPenaltyTotal: 336_334_260,
      salaryAdvanceAmount: 59_736_053, status: 'provisional', overAdvance: false,
    },
  });
  assert.equal(exact.remainingAfterAdvance.amount, 276_598_207);
  assert.equal(exact.remainingAfterAdvance.afterPenaltyTotal, 336_334_260);
  assert.equal(exact.remainingAfterAdvance.salaryAdvanceAmount, 59_736_053);

  const missing = employeeCostViewModel({
    from: '2026-07', to: '2026-07', periods: [],
    remainingAfterAdvance: { available: false, amount: null, reason: 'salary_advance_unavailable' },
  });
  assert.equal(missing.remainingAfterAdvance.amount, null);
});

test('ALL partial model preserves backend subtotal, contributors, missing count and negative flag', () => {
  const model = employeeCostViewModel({
    empCode: 'ALL', allEmployees: true, from: '2026-07', to: '2026-07', periods: [],
    remainingAfterAdvance: {
      aggregate: true, amount: null, subtotal: 266_598_207,
      employeeCount: 3, contributors: 2, missingCount: 1, missingEmployees: ['DN010'],
      complete: false, status: 'provisional', overAdvance: true, overAdvanceCount: 1,
    },
  });
  assert.equal(model.remainingAfterAdvance.amount, null);
  assert.equal(model.remainingAfterAdvance.subtotal, 266_598_207);
  assert.equal(model.remainingAfterAdvance.contributors, 2);
  assert.equal(model.remainingAfterAdvance.missingCount, 1);
  assert.deepEqual(model.remainingAfterAdvance.missingEmployees, ['DN010']);
  assert.equal(model.remainingAfterAdvance.overAdvanceCount, 1);
});

test('KPI is immediately after Salary, uses exact copy, renders missing dash and never subtracts in frontend', () => {
  assert.match(page, /function RemainingAfterAdvanceKpi\(\{ remainingAfterAdvance, loading \}\)/);
  assert.match(page, /label="Còn lại sau ứng lần 1"/);
  assert.match(page, /Tổng sau phạt − ứng lần 1 · dự kiến · nguồn: App Salary \+ DataHub/);
  assert.match(page, /Tổng sau phạt − ứng lần 1 · đã chốt · nguồn: App Salary \+ DataHub/);
  assert.match(page, /projection\.amount == null[\s\S]{0,120}?value="—"/);
  assert.match(page, /đã ứng vượt — khấu trừ kỳ sau/);
  assert.match(page, /<SalaryAdvanceKpi[\s\S]{0,220}?<RemainingAfterAdvanceKpi/);

  const component = page.slice(page.indexOf('function RemainingAfterAdvanceKpi'), page.indexOf('function PenaltyDetailModal'));
  assert.doesNotMatch(component, /afterPenaltyTotal\s*-|salaryAdvanceAmount\s*-|\.reduce\s*\(/,
    'frontend must display the backend projection and must not recompute money');
  assert.match(component, /projection\.subtotal/);
  assert.match(component, /projection\.contributors/);
  assert.match(component, /projection\.missingCount/);
});
