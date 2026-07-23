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
  { sourceLineId: '3', date: '2026-07-03', province: 'HỒ CHÍ MINH', unitGroup: 'PKĐK', unitGroupLabel: 'PKĐK · Phòng khám đa khoa', route: 'NCL', c7: '003.Đức Việt', c5: 'QL3', c16: 'Cerecaps', c36: 3, c44: 1, c32: 'SECRET32', c47: 'SECRET47', revenueBeforeVat: 300, rowMonthlyTotal: 30, rowAnnualTotal: 1, amounts: { c36: 30, c44: 1 } },
  { sourceLineId: '1', date: '2026-07-01', province: 'ĐỒNG NAI', unitGroup: 'BV', unitGroupLabel: 'BV · Bệnh viện', route: 'CL', c7: '001.Bệnh viện A', c5: 'QL1', c16: 'Atisyrup', c36: 1, c44: 1, revenueBeforeVat: 100, rowMonthlyTotal: 10, rowAnnualTotal: 1, amounts: { c36: 10, c44: 1 } },
  { sourceLineId: '2', date: '2026-07-02', province: 'ĐỒNG NAI', unitGroup: 'BV', unitGroupLabel: 'BV · Bệnh viện', route: 'CL', c7: '002.Đơn vị B', c5: 'QL2', c16: 'Cerecaps Plus', c36: 2, c44: 1, revenueBeforeVat: 200, rowMonthlyTotal: 20, rowAnnualTotal: 1, amounts: { c36: 20, c44: 1 } },
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
  assert.equal(table.rowMatches(rows[0], columns, 'dviet'), true);
  assert.equal(table.rowMatches(rows[0], columns, 'duc atisyrup'), false);
  assert.equal(table.rowMatches(rows[2], columns, 'don VI cerecaps'), true);
});

test('filter + sort happen before global STT and pagination, while blocked C32/C47 stay removed', () => {
  const transformed = table.transformReport(report(), { q: 'cerecaps', sortKey: 'date', sortDir: 'desc', page: 1, pageSize: 20, paginate: true });
  const period = transformed.periods[0];
  assert.deepEqual(period.rows.map((row) => [row.stt, row.sourceLineId]), [[1, '3'], [2, '2']]);
  assert.deepEqual(period.pagination, { page: 1, pageSize: 20, pageCount: 1, filteredRows: 2, totalRows: 3 });
  assert.equal(period.summary.monthlyTotal, 50);
  assert.equal(period.summary.annualTotal, 2);
  assert.equal(period.columns.some((column) => ['c32', 'c47'].includes(column.key)), false);
  assert.equal(table.rowMatches(rows[0], columns, 'SECRET32'), false);
});

test('province + configurable unit group + route combine on backend and dynamic facets stay scoped', () => {
  const transformed = table.transformReport(report(), {
    province: 'đồng nai', unitGroup: 'BV', route: 'cl', q: 'cerecaps', sortKey: 'date', sortDir: 'desc', paginate: false,
  });
  const period = transformed.periods[0];
  assert.deepEqual(period.rows.map((row) => [row.stt, row.sourceLineId]), [[1, '2']]);
  assert.deepEqual(transformed.filters, { province: 'đồng nai', unitGroup: 'BV', route: 'cl', date: '' });
  assert.equal(period.summary.monthlyTotal, 20);
  assert.deepEqual(period.search, { query: 'cerecaps', filteredRows: 1, totalRows: 3 });
  assert.deepEqual(transformed.filterOptions.province.options.map((item) => item.value), ['ĐỒNG NAI']);
  assert.deepEqual(transformed.filterOptions.unitGroup.options.map((item) => [item.value, item.label, item.count]), [['BV', 'BV · Bệnh viện', 1]]);
  assert.deepEqual(transformed.filterOptions.route.options.map((item) => item.value), ['CL']);
});

test('province facet groups rows without an authoritative source as unassigned instead of guessing', () => {
  const noProvince = report(rows.map(({ province, ...row }) => row));
  const transformed = table.transformReport(noProvince, { paginate: false });
  assert.equal(transformed.filterOptions.province.available, true);
  assert.deepEqual(transformed.filterOptions.province.options.map((item) => [item.value, item.count]), [['Chưa gán tỉnh', 3]]);
  assert.deepEqual(transformed.filterOptions.unitGroup.options.map((item) => item.value), ['BV', 'PKĐK']);
});

test('date filter runs before STT, totals and pagination and exposes only real revenue dates', () => {
  const transformed = table.transformReport(report(), { date: '2026-07-02', page: 9, pageSize: 20, paginate: true, allEmployees: true });
  const period = transformed.periods[0];
  assert.deepEqual(period.rows.map((row) => [row.stt, row.date, row.sourceLineId]), [[1, '2026-07-02', '2']]);
  assert.equal(period.summary.monthlyTotal, 20);
  assert.deepEqual(period.pagination, { page: 1, pageSize: 20, pageCount: 1, filteredRows: 1, totalRows: 3 });
  assert.deepEqual(transformed.filters.date, '2026-07-02');
  assert.deepEqual(transformed.filterOptions.date.options.map((item) => [item.value, item.label]), [
    ['2026-07-01', '01/07/2026'], ['2026-07-02', '02/07/2026'], ['2026-07-03', '03/07/2026'],
  ]);
});

test('view pagination defaults to 20 and accepts only 20/50/100', () => {
  const many = Array.from({ length: 55 }, (_, index) => ({ ...rows[index % rows.length], sourceLineId: `row-${index + 1}` }));
  const first = table.transformReport(report(many), { paginate: true });
  const second = table.transformReport(report(many), { paginate: true, page: 2, pageSize: 20 });
  const fifty = table.transformReport(report(many), { paginate: true, pageSize: 50 });
  const invalid = table.transformReport(report(many), { paginate: true, pageSize: 999 });
  assert.equal(first.periods[0].rows.length, 20);
  assert.deepEqual(second.periods[0].rows.slice(0, 1).map((row) => row.stt), [21]);
  assert.equal(fifty.periods[0].rows.length, 50);
  assert.equal(invalid.periods[0].pagination.pageSize, 20);
});

test('dynamic facets never synthesize arbitrary query-string values absent from the scoped dataset', () => {
  const transformed = table.transformReport(report(), { province: 'TỈNH KHÔNG CÓ', unitGroup: 'SECRET', route: 'SECRET', date: '2026-99-99', paginate: false });
  assert.equal(transformed.periods[0].rows.length, 0);
  assert.equal(transformed.filters.date, '');
  assert.equal(transformed.filterOptions.province.options.some((item) => item.value === 'TỈNH KHÔNG CÓ'), false);
  assert.equal(transformed.filterOptions.unitGroup.options.some((item) => item.value === 'SECRET'), false);
  assert.equal(transformed.filterOptions.route.options.some((item) => item.value === 'SECRET'), false);
  assert.equal(transformed.filterOptions.date.options.some((item) => item.value === '2026-99-99'), false);
});

test('a scoped selected facet remains visible with zero count when another facet makes it stale', () => {
  const transformed = table.transformReport(report(), { province: 'ĐỒNG NAI', route: 'NCL', paginate: false });
  assert.equal(transformed.periods[0].rows.length, 0);
  assert.deepEqual(transformed.filterOptions.province.options.map((item) => [item.value, item.count]), [
    ['ĐỒNG NAI', 0],
    ['HỒ CHÍ MINH', 1],
  ]);
  assert.deepEqual(transformed.filterOptions.route.options.map((item) => [item.value, item.count]), [
    ['CL', 2],
    ['NCL', 0],
  ]);
});

test('ALL merge adds employee identity, backend subtotals, grand total and keeps sort/search exact', () => {
  const roster = [{ emp_code: 'DN001', name: 'Anh Một' }, { emp_code: 'DN002', name: 'Chị Hai' }];
  const second = report([{ ...rows[1], sourceLineId: 'dn2', c16: 'Cerecaps DN2', rowMonthlyTotal: 40, amounts: { c36: 40, c44: 2 } }]);
  second.empCode = 'DN002';
  const merged = table.mergeEmployeeReports([report(), second], roster);
  const transformed = table.transformReport(merged, { allEmployees: true, q: 'cerecaps', sortKey: 'employeeCode', sortDir: 'asc', paginate: false });
  const period = transformed.periods[0];
  assert.equal(transformed.empCode, 'ALL');
  assert.equal(transformed.template.label, 'TẤT CẢ NHÂN VIÊN');
  assert.ok(period.rows.length > 0);
  assert.deepEqual(period.rows.map((row) => [row.stt, row.employeeCode]), [[1, 'DN001'], [2, 'DN001'], [3, 'DN002']]);
  assert.deepEqual(period.employeeSubtotals.map((item) => [item.employeeCode, item.rowCount, item.monthlyTotal]), [['DN001', 2, 50], ['DN002', 1, 40]]);
  assert.equal(period.summary.monthlyTotal, 90);
  assert.equal(transformed.summary.periodTotal, 90);

  const byDate = table.transformReport(merged, { allEmployees: true, date: '2026-07-02', paginate: true });
  assert.deepEqual(byDate.periods[0].rows.map((row) => [row.stt, row.employeeCode, row.date]), [[1, 'DN001', '2026-07-02']]);
  assert.deepEqual(byDate.periods[0].employeeSubtotals.map((item) => [item.employeeCode, item.rowCount, item.monthlyTotal]), [['DN001', 1, 20]]);
  assert.equal(byDate.summary.periodTotal, 20);
});

test('routes hard-lock ALL to CEO/admin for view and export', () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(source, /wantsAll && !auth\.isAdmin\(req\.session\.role\)/);
  assert.match(source, /requested === 'ALL'[\s\S]*?if \(!admin\)/);
  assert.match(source, /employeeCostAllPayload[\s\S]*?mapWithConcurrency\(roster, 3/);
  assert.match(source, /date: req\.query\.date/);
  assert.match(source, /employeeCostTableOptions\(req, \{ paginate: true \}\)/);
  assert.match(source, /targetKpiSummary\(ky, \{ empCode \}, \[empCode\]\)/);
  assert.match(source, /employeeBonus\.buildBonusSummary\(bonusKpi/);
});
