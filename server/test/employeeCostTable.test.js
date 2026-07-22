'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const table = require('../src/employeeCostTable');

const columns = [
  { key: 'c36', label: 'CP cộng tác viên (%)' },
  { key: 'c44', label: 'Lương cuối năm (%)', annual: true },
  { key: 'c32', label: 'Cấm' },
  { key: 'c47', label: 'Cấm' },
];
const rows = [
  { sourceLineId: '3', date: '2026-07-03', c7: '003.Đức Việt', c5: 'QL3', c16: 'Cerecaps', c36: 3, c44: 1, c32: 'SECRET32', c47: 'SECRET47', revenueBeforeVat: 300, rowMonthlyTotal: 30, rowAnnualTotal: 1, amounts: { c36: 30, c44: 1 } },
  { sourceLineId: '1', date: '2026-07-01', c7: '001.Bệnh viện A', c5: 'QL1', c16: 'Atisyrup', c36: 1, c44: 1, revenueBeforeVat: 100, rowMonthlyTotal: 10, rowAnnualTotal: 1, amounts: { c36: 10, c44: 1 } },
  { sourceLineId: '2', date: '2026-07-02', c7: '002.Đơn vị B', c5: 'QL2', c16: 'Cerecaps Plus', c36: 2, c44: 1, revenueBeforeVat: 200, rowMonthlyTotal: 20, rowAnnualTotal: 1, amounts: { c36: 20, c44: 1 } },
];

function report(sourceRows = rows) {
  return {
    empCode: 'DN001', from: '2026-07', to: '2026-07',
    periods: [{ period: '2026-07', columns, rows: sourceRows, summary: { reliable: true }, match: { matchedRows: 3, totalRows: 3, rate: 100 } }],
  };
}

test('Vietnamese search is accent/case insensitive and supports multi-token AND', () => {
  assert.equal(table.normalizeVietnamese('ĐỨC Việt / Đơn vị'), 'duc viet don vi');
  assert.equal(table.rowMatches(rows[0], columns, 'DUC viet cerecaps'), true);
  assert.equal(table.rowMatches(rows[0], columns, 'duc atisyrup'), false);
  assert.equal(table.rowMatches(rows[2], columns, 'don VI cerecaps'), true);
});

test('filter + sort happen before global STT and pagination, while blocked C32/C47 stay removed', () => {
  const transformed = table.transformReport(report(), { q: 'cerecaps', sortKey: 'date', sortDir: 'desc', page: 2, pageSize: 1, paginate: true });
  const period = transformed.periods[0];
  assert.deepEqual(period.rows.map((row) => [row.stt, row.sourceLineId]), [[2, '2']]);
  assert.deepEqual(period.pagination, { page: 2, pageSize: 1, pageCount: 2, filteredRows: 2, totalRows: 3 });
  assert.equal(period.summary.monthlyTotal, 50);
  assert.equal(period.summary.annualTotal, 2);
  assert.equal(period.columns.some((column) => ['c32', 'c47'].includes(column.key)), false);
  assert.equal(table.rowMatches(rows[0], columns, 'SECRET32'), false);
});

test('ALL merge adds employee identity, backend subtotals, grand total and keeps sort/search exact', () => {
  const roster = [{ emp_code: 'DN001', name: 'Anh Một' }, { emp_code: 'DN002', name: 'Chị Hai' }];
  const second = report([{ ...rows[1], sourceLineId: 'dn2', c16: 'Cerecaps DN2', rowMonthlyTotal: 40, amounts: { c36: 40, c44: 2 } }]);
  second.empCode = 'DN002';
  const merged = table.mergeEmployeeReports([report(), second], roster);
  const transformed = table.transformReport(merged, { allEmployees: true, q: 'cerecaps', sortKey: 'employeeCode', sortDir: 'asc', paginate: false });
  const period = transformed.periods[0];
  assert.equal(transformed.empCode, 'ALL');
  assert.deepEqual(period.rows.map((row) => [row.stt, row.employeeCode]), [[1, 'DN001'], [2, 'DN001'], [3, 'DN002']]);
  assert.deepEqual(period.employeeSubtotals.map((item) => [item.employeeCode, item.rowCount, item.monthlyTotal]), [['DN001', 2, 50], ['DN002', 1, 40]]);
  assert.equal(period.summary.monthlyTotal, 90);
  assert.equal(transformed.summary.periodTotal, 90);
});

test('routes hard-lock ALL to CEO/admin for view and export', () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(source, /wantsAll && !auth\.isAdmin\(req\.session\.role\)/);
  assert.match(source, /requested === 'ALL'[\s\S]*?if \(!admin\)/);
  assert.match(source, /employeeCostAllPayload[\s\S]*?mapWithConcurrency\(roster, 3/);
});
