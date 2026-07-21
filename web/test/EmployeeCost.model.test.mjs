import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeeCostColumns, employeeCostViewModel, formatEmployeeCostCell, formatMatchRate } from '../src/employeeCostModel.js';

test('dynamic columns follow payload, prepend dimensions once, and block c32/c47', () => {
  const columns = buildEmployeeCostColumns([
    { key: 'c36', label: 'CP ctv (%)' },
    { key: 'c43', label: 'CP bs (%)' },
    { key: 'c47', label: 'Cấm' },
    { key: 'c32', label: 'Cấm' },
    { key: 'c5', label: 'Không lặp' },
  ]);
  assert.deepEqual(columns.map((column) => column.key), ['c5', 'c7', 'c16', 'c25', 'c36', 'c36_amount', 'c43', 'c43_amount']);
});

test('view model renders percent without percent sign and reads grounded amounts/summary', () => {
  const model = employeeCostViewModel({
    empCode: 'DN001', period: '07.2026', columns: [{ key: 'c36', label: 'CP (%)' }, { key: 'c44', label: 'Cuối năm', annual: true }],
    rows: [{ c5: 'QL1', c7: 'U1', c16: 'A', c25: 'Viên', c36: 8, c44: 0.3, amounts: { c36: 800000, c44: 30000 } }],
    match: { matchedRows: 1, totalRows: 1, rate: 100, threshold: 90, low: false },
    summary: { reliable: true, monthlyTotal: 800000, annualTotal: 30000, annualLabels: ['Cuối năm'] },
  });
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].c36_amount, 800000);
  assert.equal(model.costColumns[1].annual, true);
  assert.equal(model.summary.monthlyTotal, 800000);
  assert.equal(formatEmployeeCostCell(8, model.costColumns[0]), '8.0');
  assert.equal(formatEmployeeCostCell(0.3, model.costColumns[1]), '0.3');
  assert.equal(formatEmployeeCostCell(10, { kind: 'percent' }), '10.0');
  assert.equal(formatEmployeeCostCell(1200000, { kind: 'money' }), '1.200.000đ');
  assert.equal(formatMatchRate(model.match), '100,0%');
  assert.equal(formatEmployeeCostCell(null, { kind: 'money' }), '—');
});

test('low coverage state preserves null amounts and unreliable totals', () => {
  const model = employeeCostViewModel({
    columns: [{ key: 'c36', label: 'CP (%)' }],
    rows: [{ c36: 8, amounts: { c36: null } }],
    match: { matchedRows: 0, totalRows: 1, rate: 0, threshold: 90, low: true },
    summary: { reliable: false, monthlyTotal: null, annualTotal: null },
  });
  assert.equal(model.rows[0].c36_amount, null);
  assert.equal(model.match.low, true);
  assert.equal(model.summary.monthlyTotal, null);
});
