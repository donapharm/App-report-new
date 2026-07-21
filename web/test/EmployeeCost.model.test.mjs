import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmployeeCostColumns, currentMonthValue, employeeCostViewModel, formatEmployeeCostCell, formatMatchRate, formatMonthLabel,
} from '../src/employeeCostModel.js';

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
  assert.equal(formatMatchRate({ rate: null }), '—');
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

test('month input and label use stable local YYYY-MM values', () => {
  assert.equal(currentMonthValue(new Date(2026, 6, 21)), '2026-07');
  assert.equal(formatMonthLabel('2026-07'), '07/2026');
});

test('multi-month model keeps blocks separate and exposes only non-annual range total', () => {
  const period = (month, revenue) => ({
    empCode: 'DN001', period: month,
    columns: [{ key: 'c36', label: 'CP tháng' }, { key: 'c44', label: 'Cuối năm', annual: true }],
    rows: [{ c5: 'QL1', c7: 'U1', c16: 'A', c36: 10, c44: 5, amounts: { c36: revenue * 0.1, c44: revenue * 0.05 } }],
    match: { matchedRows: 1, totalRows: 1, rate: 100, threshold: 90, low: false },
    summary: { reliable: true, monthlyTotal: revenue * 0.1, annualTotal: revenue * 0.05, annualLabels: ['Cuối năm'] },
  });
  const model = employeeCostViewModel({
    empCode: 'DN001', from: '2026-06', to: '2026-07',
    periods: [period('2026-06', 1_000_000), period('2026-07', 2_000_000)],
    match: { matchedRows: 2, totalRows: 2, rate: 100, threshold: 90, low: false },
    summary: { reliable: true, periodTotal: 300_000, annualTotal: 150_000 },
  });
  assert.deepEqual(model.periods.map((item) => item.period), ['2026-06', '2026-07']);
  assert.deepEqual(model.periods.map((item) => item.summary.monthlyTotal), [100_000, 200_000]);
  assert.equal(model.summary.periodTotal, 300_000);
  assert.equal(model.summary.annualTotal, 150_000);
  assert.equal(model.rows.length, 2);
});

test('daily UI model expands grounded dates and keeps annual amounts out of each day total', () => {
  const model = employeeCostViewModel({
    empCode: 'DN001', from: '2026-07', to: '2026-07', periods: [{
      empCode: 'DN001', period: '2026-07',
      columns: [{ key: 'c36', label: 'CP tháng' }, { key: 'c44', label: 'Cuối năm', annual: true }],
      rows: [{
        c5: 'QL1', c7: 'U1', c16: 'A', c36: 10, c44: 5,
        amounts: { c36: 300_000, c44: 150_000 },
        dailyAmounts: {
          '2026-07-01': { c36: 100_000, c44: 50_000 },
          '2026-07-02': { c36: 200_000, c44: 100_000 },
        },
        dayRevenueMatched: true,
      }],
      match: { matchedRows: 1, totalRows: 1, rate: 100, threshold: 90, low: false },
      summary: { reliable: true, monthlyTotal: 300_000, annualTotal: 150_000, annualLabels: ['Cuối năm'] },
      daily: { reliable: true, dates: ['2026-07-01', '2026-07-02'], totals: [] },
    }],
    match: { matchedRows: 1, totalRows: 1, rate: 100, threshold: 90, low: false },
    summary: { reliable: true, periodTotal: 300_000, annualTotal: 150_000 },
  });
  assert.equal(model.periods[0].daily.rows.length, 2);
  assert.deepEqual(model.periods[0].daily.rows.map((row) => row.monthlyTotal), [100_000, 200_000]);
  assert.equal(model.periods[0].daily.rows[0].c44_amount, 50_000);
});

test('legacy one-month payload remains supported without inventing daily data', () => {
  const model = employeeCostViewModel({
    empCode: 'DN001', period: '2026-07', columns: [{ key: 'c36', label: 'CP' }],
    rows: [{ c36: 8, amounts: { c36: 80_000 } }],
    match: { matchedRows: 1, totalRows: 1, rate: 100 },
    summary: { reliable: true, monthlyTotal: 80_000, annualTotal: 0 },
  });
  assert.equal(model.periods.length, 1);
  assert.equal(model.summary.periodTotal, 80_000);
  assert.equal(model.periods[0].daily.reliable, false);
  assert.deepEqual(model.periods[0].daily.rows, []);
});
