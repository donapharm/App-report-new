import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeeCostViewModel } from '../src/employeeCostModel.js';

test('EmployeeCost v4 model/UI renders exact children and separate non-financial variance without changing totals', () => {
  const payload = {
    empCode: 'DN005', period: '2026-07',
    template: { key: 'fulltime', label: 'FULL-TIME', columns: ['orderCode', 'quantity', 'shadowReconciledQuantity', 'shadowQuantityDelta', 'revenueBeforeVat', 'c36', 'rowMonthlyTotal'] },
    columns: [{ key: 'c36', label: 'CP (%)' }],
    rows: [
      { sourceLineId: '2524', orderCode: 'DT-260708-0176', quantity: 2400, shadowReconciledQuantity: 2400, shadowQuantityDelta: 0, revenueBeforeVat: 1000, c36: 1, rowMonthlyTotal: 10 },
      { sourceLineId: '2783', orderCode: 'DT-260723-0346', quantity: 4000, shadowReconciledQuantity: 4000, shadowQuantityDelta: 0, revenueBeforeVat: 2000, c36: 1, rowMonthlyTotal: 20 },
      { sourceLineId: 'recon-variance:1', orderCode: null, quantity: 20, shadowReconciledQuantity: 20, shadowQuantityDelta: 20, shadowRowLabel: 'Chênh lệch chưa phân bổ theo đơn', reconciliationSynthetic: true, revenueBeforeVat: null, rowMonthlyTotal: null },
    ],
    match: { matchedRows: 2, totalRows: 2, rate: 100, threshold: 90, low: false },
    summary: { reliable: true, monthlyTotal: 30, annualTotal: 0, revenueBeforeVatTotal: 3000, revenueTotal: 3300, columnTotals: { c36: 30 }, annualColumnKeys: [], annualLabels: [] },
    shadowReconciliationTotals: { orderedQuantity: 6400, reconciledQuantity: 6420, quantityDelta: 20, employeeVarianceRows: 1, mixedEmployeeVarianceCount: 0 },
  };
  const model = employeeCostViewModel(payload);
  assert.deepEqual(model.rows.map((row) => [row.shadowReconciledQuantity, row.shadowQuantityDelta]), [[2400, 0], [4000, 0], [20, 20]]);
  assert.equal(model.rows[2].orderCode, null);
  assert.equal(model.rows[2].quantity, 20);
  assert.equal(model.rows[2].shadowRowLabel, 'Chênh lệch chưa phân bổ theo đơn');
  assert.equal(model.rows[2].c36, undefined);
  assert.deepEqual(model.summary, expectFinancialSummary(model.summary));
  assert.deepEqual(model.periods[0].shadowReconciliationTotals, { orderedQuantity: 6400, reconciledQuantity: 6420, quantityDelta: 20, employeeVarianceRows: 1, mixedEmployeeVarianceCount: 0 });
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /row\.reconciliationSynthetic && row\.shadowRowLabel/);
  assert.match(page, /employee-cost-shadow-variance-row/);
});

function expectFinancialSummary(summary) {
  assert.equal(summary.monthlyTotal, 30);
  assert.equal(summary.annualTotal, 0);
  assert.equal(summary.revenueBeforeVatTotal, 3000);
  assert.equal(summary.revenueTotal, 3300);
  assert.deepEqual(summary.columnTotals, { c36: 30 });
  return summary;
}
