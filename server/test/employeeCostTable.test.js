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

test('ALL payload preserves each backend-computed penalty in bonus and cost employeeSubtotals', () => {
  const roster = [{ emp_code: 'DN001', name: 'Anh Một' }, { emp_code: 'DN002', name: 'Chị Hai' }];
  const first = report([rows[1]]);
  const second = report([{ ...rows[2], sourceLineId: 'dn2' }]);
  second.empCode = 'DN002';
  for (const [item, amount] of [[first, 2_400_000], [second, 7_599_706]]) {
    const baseTotal = item.periods[0].rows.reduce((sum, row) => sum + row.rowMonthlyTotal, 0);
    item.bonus = {
      configured: false,
      month: { target: 1_000_000_000, achieved: 780_000_000, amount: 0 },
      quarter: {},
      employeeSubtotals: [],
    };
    item.penalty = {
      total: amount,
      appliedAmount: 0,
      afterPenaltyTotal: baseTotal,
      formulaText: `Backend penalty ${amount}`,
    };
    item.summary = { periodTotal: baseTotal, afterPenaltyTotal: baseTotal };
  }
  const merged = table.mergeEmployeeReports([first, second], roster);
  const transformed = table.transformReport(merged, {
    allEmployees: true,
    paginate: false,
  });
  assert.deepEqual(transformed.bonus.employeeSubtotals.map((item) => [item.empCode, item.penalty.total]), [
    ['DN001', 2_400_000],
    ['DN002', 7_599_706],
  ]);
  assert.deepEqual(transformed.periods[0].employeeSubtotals.map((item) => [item.employeeCode, item.penalty.total]), [
    ['DN001', 2_400_000],
    ['DN002', 7_599_706],
  ]);
  assert.equal(transformed.penalty.aggregate, true);
  assert.equal(transformed.penalty.total, 9_999_706);
  assert.equal(transformed.penalty.appliedAmount, 0);
  assert.equal(transformed.penalty.baseTotal, 30);
  assert.equal(transformed.penalty.afterPenaltyTotal, 30);
  assert.equal(transformed.summary.penaltyAppliedAmount, 0);
  assert.equal(transformed.summary.afterPenaltyTotal, 30);

  const filtered = table.transformReport(merged, { allEmployees: true, q: 'không tồn tại', paginate: true });
  assert.equal(filtered.summary.periodTotal, 0, 'table total follows the filtered row slice');
  assert.equal(filtered.penalty.total, 9_999_706, 'team penalty keeps its full backend scope');
  assert.equal(filtered.penalty.baseTotal, 30, 'team after-penalty base must not be recomputed from filtered rows');
});

test('ALL merge giữ provenance policy carry-forward để UI không dùng tỷ lệ ngầm', () => {
  const roster = [{ emp_code: 'DN001', name: 'Anh Một' }, { emp_code: 'DN002', name: 'Chị Hai' }];
  const first = report([rows[0]]);
  const second = report([{ ...rows[1], sourceLineId: 'dn2' }]);
  for (const [item, emp] of [[first, 'DN001'], [second, 'DN002']]) {
    item.empCode = emp;
    item.from = '2026-08'; item.to = '2026-08'; item.rateEffectiveFrom = '2026-07';
    item.periods[0].period = '2026-08'; item.periods[0].rateEffectiveFrom = '2026-07';
  }
  const merged = table.mergeEmployeeReports([first, second], roster);
  assert.equal(merged.rateEffectiveFrom, '2026-07');
  assert.deepEqual(merged.rateEffectiveFroms, ['2026-07']);
  assert.equal(merged.periods[0].rateEffectiveFrom, '2026-07');
  assert.deepEqual(merged.periods[0].rateEffectiveFroms, ['2026-07']);

  // DN002 có exact T08 nên payload cá nhân giữ nguyên, không gắn metadata mới;
  // ALL merge vẫn phải phân biệt exact T08 với DN001 carry-forward từ T07.
  delete second.rateEffectiveFrom;
  delete second.periods[0].rateEffectiveFrom;
  second.sourceOutcome = 'ok';
  const mixed = table.mergeEmployeeReports([first, second], roster);
  assert.equal(mixed.rateEffectiveFrom, '');
  assert.deepEqual(mixed.rateEffectiveFroms, ['2026-07', '2026-08']);
});


test('ALL merge maps only 4xx rejection outcomes to privacy-safe upstream_rejected', () => {
  const outcomes = ['upstream_rejected', 'upstream_400', 'upstream_401', 'upstream_409', 'upstream_499', 'upstream_500', 'upstream_502', 'upstream_unavailable'];
  const reports = outcomes.map((sourceOutcome, index) => {
    const item = report([]);
    item.empCode = `DN${String(index + 1).padStart(3, '0')}`;
    item.sourceOutcome = sourceOutcome;
    item.periods[0].match = { matchedRows: 0, totalRows: 0, rate: null };
    return item;
  });
  const roster = reports.map((item) => ({ emp_code: item.empCode, name: item.empCode }));
  const merged = table.mergeEmployeeReports(reports, roster);
  assert.deepEqual(merged.periods[0].match.unavailableReasons, {
    DN001: 'upstream_rejected', DN002: 'upstream_rejected', DN003: 'upstream_rejected',
    DN004: 'upstream_rejected', DN005: 'upstream_rejected', DN006: 'upstream_unavailable',
    DN007: 'upstream_unavailable', DN008: 'upstream_unavailable',
  });
  assert.doesNotMatch(JSON.stringify(merged.periods[0].match.unavailableReasons), /upstream_4|upstream_5|credential|body/);
});

test('routes hard-lock ALL to CEO/admin for view and export', () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(source, /wantsAll && !auth\.isAdmin\(req\.session\.role\)/);
  assert.match(source, /requested === 'ALL'[\s\S]*?if \(!admin\)/);
  assert.match(source, /employeeCostAllPayload[\s\S]*?mapWithConcurrency\(roster, 3/);
  assert.match(source, /date: req\.query\.date/);
  assert.match(source, /employeeCostTableOptions\(req, \{ paginate: true \}\)/);
  assert.match(source, /targetKpiSummary\(ky, \{ empCode \}, \[empCode\]\)/);
  assert.match(source, /target: empCode \? buildTargetKpiDetail\(\{/);
  assert.match(source, /scope: \{ empCode \}/);
  assert.match(source, /resolveTargets: targetAdmin\.resolveTargets/);
  assert.match(source, /employeeBonus\.buildBonusSummary\(bonusKpi/);
});
