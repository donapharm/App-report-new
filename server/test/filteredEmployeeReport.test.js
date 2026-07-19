'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const dormant = require('../src/dormantQlnb');
const {
  normalizeFilters, filterCatalogRows, assertEmployeeIsolation, analyzeEmployeeReadOnly,
  createFilteredEmployeeReportService,
} = require('../src/filteredEmployeeReport');

function catalogRow(overrides = {}) {
  return {
    emp_code: 'DN001', emp_name: 'Nhân viên Một', province: 'Đồng Nai', route: 'NT', contractor_code: 'NT01',
    unit_code: '001.BV A', qlnb_code: 'QLNB-A', product_name: 'Thuốc A', active_ingredient: 'Hoạt chất A', strength: '10mg', uom: 'Viên',
    bid_price: 10000, cst_initial: 100, cst_remaining: 8, effective_from: '2026-01', effective_to: null, active: true,
    ...overrides,
  };
}
function sale(overrides = {}) {
  return {
    emp_code: 'DN001', unit_code: '001.BV A', iit_code: 'QLNB-A', unit_name: 'BV A', product_name: 'Thuốc A', route: 'NT',
    date: '2026-04-01', revenue: 1050000, quantity: 10,
    ...overrides,
  };
}
function cst(overrides = {}) {
  return {
    emp_code: 'DN001', unit_code: '001.BV A', iit_code: 'QLNB-A', remain_qty: 8, remain_amount: 80000,
    cst_initial: 100, cst_remaining: 8, active: true,
    ...overrides,
  };
}
function fixtures() {
  const catalogRows = [
    catalogRow(),
    catalogRow({ emp_code: 'DN002', emp_name: 'Nhân viên Hai', province: 'TP.HCM', route: 'TW', contractor_code: 'NT02', unit_code: '002.BV B', qlnb_code: 'QLNB-B', product_name: 'Thuốc B', cst_initial: 200, cst_remaining: 120 }),
  ];
  const cstRows = [
    cst(),
    cst({ emp_code: 'DN002', unit_code: '002.BV B', iit_code: 'QLNB-B', cst_initial: 200, cst_remaining: 120, remain_qty: 120 }),
  ];
  const sales = [
    sale(),
    sale({ emp_code: 'DN002', unit_code: '002.BV B', iit_code: 'QLNB-B', product_name: 'Thuốc B', date: '2026-07-18', revenue: 2100000, quantity: 20 }),
  ];
  const users = { DN001: { emp_code: 'DN001', name: 'Nhân viên Một' }, DN002: { emp_code: 'DN002', name: 'Nhân viên Hai' } };
  const store = {
    latestKy: () => '07.2026',
    listPeriods: () => [{ ky: '04.2026', dateFrom: '2026-04-01', dateTo: '2026-04-30' }, { ky: '07.2026', dateFrom: '2026-07-01', dateTo: '2026-07-31' }],
    periodKys: () => ['04.2026', '07.2026'],
    periodFreshness: (ky) => ({ throughDate: ky === '04.2026' ? '2026-04-30' : '2026-07-19' }),
    getCst: ({ scope } = {}) => scope?.empCode ? cstRows.filter((row) => row.emp_code === scope.empCode) : cstRows,
    getRowsRange: ({ kys, scope } = {}) => sales.filter((row) => {
      const ky = `${row.date.slice(5, 7)}.${row.date.slice(0, 4)}`;
      return (!scope?.empCode || row.emp_code === scope.empCode) && (!kys || kys.includes(ky));
    }),
    getRows: ({ ky, scope } = {}) => sales.filter((row) => (!scope?.empCode || row.emp_code === scope.empCode) && (!ky || row.date.startsWith(`${ky.slice(3)}-${ky.slice(0, 2)}`))),
    getTargets: ({ scope } = {}) => [{ emp_code: scope.empCode, target: scope.empCode === 'DN001' ? 1000000 : 3000000 }],
    findUserByCode: (code) => users[code] || null,
  };
  const catalogManagement = {
    toHubPeriod: (value) => /^\d{2}\.\d{4}$/.test(value) ? `${value.slice(3)}-${value.slice(0, 2)}` : value,
    getSnapshot: async () => ({ rows: catalogRows, meta: { source: 'fixture' } }),
    buildCatalogRows: (rows, scopedCstRows) => {
      const byPair = new Map(scopedCstRows.map((row) => [`${row.unit_code}\u001f${row.iit_code}`, row]));
      return rows.map((row) => ({ ...row, ...(byPair.get(`${row.unit_code}\u001f${row.qlnb_code}`) || {}) }));
    },
  };
  const appSaleCst = {
    fetchTenderQuota: async () => ({ rows: [] }),
    enrichCstRowsWithC30: (rows) => ({ rows: rows.map((row) => row.iit_code === 'QLNB-A' ? { ...row, c30: { option_qty: 25, status_label: 'Còn C30', actionable: true } } : row), meta: { available: true, complete: true, stale: false, rowCount: 3006 } }),
  };
  const persist = { load: () => ({ version: 1, items: {} }) };
  return { store, catalogManagement, appSaleCst, persist, catalogRows, cstRows, sales };
}

test('normalizeFilters accepts multi values and normalizes employee/period', () => {
  const filters = normalizeFilters({ period: '07.2026', emp_codes: ['dn001', ' DN002 '], provinces: ['Đồng Nai'], cst_band: 'le10', dormant_status: 'bad' });
  assert.equal(filters.period, '2026-07');
  assert.deepEqual(filters.emp_codes, ['DN001', 'DN002']);
  assert.equal(filters.cst_band, 'le10');
  assert.equal(filters.dormant_status, 'all');
});

test('filterCatalogRows composes scope, CST, dormant, review and C30 filters', () => {
  const rows = [
    { ...catalogRow(), dormant_status: 'dormant', review_status: 'unplanned', c30_option_qty: 25, c30_actionable: true },
    { ...catalogRow({ qlnb_code: 'QLNB-X', cst_remaining: 80 }), dormant_status: 'normal', review_status: 'none', c30_option_qty: null, c30_actionable: false },
  ];
  const filters = normalizeFilters({ emp_codes: ['DN001'], provinces: ['Đồng Nai'], routes: ['NT'], units: ['001.BV A'], contractors: ['NT01'], qlnb_codes: ['QLNB-A'], query: 'thuoc a qlnb-a', cst_band: 'le10', dormant_status: 'dormant', review_status: 'unplanned', c30_status: 'actionable' });
  const result = filterCatalogRows(rows, filters);
  assert.equal(result.length, 1);
  assert.equal(result[0].qlnb_code, 'QLNB-A');
});

test('scope guard fails closed when another employee appears', () => {
  assert.throws(() => assertEmployeeIsolation([catalogRow({ emp_code: 'DN002' })], 'DN001'), (error) => error.code === 'FILTERED_REPORT_SCOPE_LEAK');
});

test('preview splits reports by employee, counts only exportable files and never sends', async () => {
  const service = createFilteredEmployeeReportService(fixtures());
  const result = await service.preview({ period: '07.2026', emp_codes: ['DN001', 'DN002'], dormant_status: 'dormant' });
  assert.equal(result.selected_employees, 2);
  assert.equal(result.total_employees, 1);
  assert.equal(result.empty_employees, 1);
  assert.equal(result.total_rows, 1);
  assert.equal(result.send_enabled, false);
  assert.equal(result.employees.find((row) => row.emp_code === 'DN001').dormant_count, 1);
  assert.equal(result.employees.find((row) => row.emp_code === 'DN002').row_count, 0);
  assert.ok(result.preview_id);
});

test('export requires matching preview and workbook contains only one employee without sensitive sections', async () => {
  const service = createFilteredEmployeeReportService(fixtures());
  const payload = { period: '07.2026', emp_codes: ['DN001', 'DN002'], provinces: ['Đồng Nai'] };
  await assert.rejects(() => service.employeeReport(payload, 'DN001'), (error) => error.code === 'FILTERED_REPORT_PREVIEW_REQUIRED');
  const preview = await service.preview(payload);
  const report = await service.employeeReport({ ...payload, preview_id: preview.preview_id }, 'DN001');
  assert.equal(report.rows.length, 1);
  assert.ok(report.rows.every((row) => row.emp_code === 'DN001'));
  const buffer = await service.excelBuffer(report);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Tổng quan cá nhân', 'Danh mục CST', 'QLNB cần hành động']);
  const values = workbook.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity).filter((x) => typeof x === 'string').join(' | ');
  assert.ok(values.includes('DN001'));
  assert.equal(values.includes('DN002'), false);
  for (const forbidden of ['CP Total', 'chi phí', 'lợi nhuận', 'margin']) assert.equal(values.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
});

test('C30 filter fails closed when the C30 source is unavailable', async () => {
  const deps = fixtures();
  deps.appSaleCst.enrichCstRowsWithC30 = (rows) => ({ rows, meta: { available: false, complete: false, stale: true, rowCount: 0 } });
  const service = createFilteredEmployeeReportService(deps);
  await assert.rejects(() => service.preview({ period: '07.2026', emp_codes: ['DN001'], c30_status: 'available' }), (error) => error.code === 'FILTERED_REPORT_C30_UNAVAILABLE');
  const safePreview = await service.preview({ period: '07.2026', emp_codes: ['DN001'], c30_status: 'all' });
  assert.equal(safePreview.c30_source.ready, false);
});

test('CEO summary workbook is also locked behind preview and contains no sensitive sections', async () => {
  const service = createFilteredEmployeeReportService(fixtures());
  const payload = { period: '07.2026', emp_codes: ['DN001', 'DN002'] };
  const preview = await service.preview(payload);
  const result = await service.summaryReport({ ...payload, preview_id: preview.preview_id });
  const buffer = await service.summaryExcelBuffer(result);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Tổng hợp CEO']);
  const values = workbook.worksheets[0].getSheetValues().flat(Infinity).filter((value) => typeof value === 'string').join(' | ');
  assert.ok(values.includes('DN001'));
  assert.ok(values.includes('DN002'));
  for (const forbidden of ['CP Total', 'chi phí', 'lợi nhuận', 'margin']) assert.equal(values.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
});

test('preview token is bound to the admin session that created it', async () => {
  const service = createFilteredEmployeeReportService(fixtures());
  const payload = { period: '07.2026', emp_codes: ['DN001'] };
  const preview = await service.preview(payload, 'CEO');
  await assert.rejects(() => service.employeeReport({ ...payload, preview_id: preview.preview_id }, 'DN001', 'ADMIN-OTHER'), (error) => error.code === 'FILTERED_REPORT_PREVIEW_REQUIRED');
  const report = await service.employeeReport({ ...payload, preview_id: preview.preview_id }, 'DN001', 'CEO');
  assert.equal(report.summary.emp_code, 'DN001');
});

test('export fails closed when data changed after preview', async () => {
  const deps = fixtures();
  const service = createFilteredEmployeeReportService(deps);
  const payload = { period: '07.2026', emp_codes: ['DN001'] };
  const preview = await service.preview(payload);
  deps.store.getTargets = ({ scope }) => [{ emp_code: scope.empCode, target: 999999999 }];
  await assert.rejects(() => service.employeeReport({ ...payload, preview_id: preview.preview_id }, 'DN001'), (error) => error.code === 'FILTERED_REPORT_PREVIEW_STALE');
});

test('preview token is bound to the exact approved filter scope', async () => {
  const service = createFilteredEmployeeReportService(fixtures());
  const payload = { period: '07.2026', emp_codes: ['DN001'], cst_band: 'le10' };
  const preview = await service.preview(payload);
  await assert.rejects(
    () => service.employeeReport({ ...payload, cst_band: 'gt30', preview_id: preview.preview_id }, 'DN001'),
    (error) => error.code === 'FILTERED_REPORT_PREVIEW_REQUIRED',
  );
});

test('historical period evaluates dormant state only through the selected period', async () => {
  const service = createFilteredEmployeeReportService(fixtures());
  const historical = await service.preview({ period: '04.2026', emp_codes: ['DN001'], dormant_status: 'dormant' });
  const current = await service.preview({ period: '07.2026', emp_codes: ['DN001'], dormant_status: 'dormant' });
  assert.equal(historical.period_ui, '04.2026');
  assert.equal(historical.total_rows, 0);
  assert.equal(current.total_rows, 1);
});

test('CST stays scoped by employee when two employees share the same unit and QLNB', async () => {
  const deps = fixtures();
  Object.assign(deps.catalogRows[1], { unit_code: '001.BV A', qlnb_code: 'QLNB-A', cst_initial: null, cst_remaining: null });
  Object.assign(deps.cstRows[1], { unit_code: '001.BV A', iit_code: 'QLNB-A', cst_initial: 200, cst_remaining: 120, remain_qty: 120 });
  const service = createFilteredEmployeeReportService(deps);
  const preview = await service.preview({ period: '07.2026', emp_codes: ['DN001', 'DN002'] });
  assert.equal(preview.employees.find((row) => row.emp_code === 'DN001').cst_initial, 100);
  assert.equal(preview.employees.find((row) => row.emp_code === 'DN002').cst_initial, 200);
});

test('historical action state is rebuilt across reactivation and reopening cycles', async () => {
  const deps = fixtures();
  deps.sales[0].date = '2026-01-01';
  deps.store.periodKys = () => ['01.2026', '04.2026', '07.2026'];
  const key = dormant.makeKey('DN001', '001.BV A', 'QLNB-A');
  deps.persist.load = () => ({ version: 1, items: { [key]: {
    first_detected_at: '2026-07-01', last_activity_at: '2026-05-01', status: 'scheduled', next_follow_up: '2026-07-10', note: 'Chu kỳ mới', resolved_at: null, resolution: null, cycle: 2, action_cycle: 1,
    audit: [
      { at: '2026-04-01', actor: 'SYSTEM', type: 'detected_dormant', changes: { last_activity_at: '2026-01-31', days_idle: 60 } },
      { at: '2026-04-02', actor: 'DN001', type: 'action_updated', changes: { status: 'contacted', next_follow_up: '2026-04-10', note: 'Đã liên hệ', action_cycle: 1 } },
      { at: '2026-05-01', actor: 'SYSTEM', type: 'reactivated', changes: { last_activity_at: '2026-05-01' } },
      { at: '2026-07-01', actor: 'SYSTEM', type: 'reopened_dormant', changes: { last_activity_at: '2026-05-01', days_idle: 61 } },
      { at: '2026-07-02', actor: 'DN001', type: 'action_updated', changes: { status: 'scheduled', next_follow_up: '2026-07-10', note: 'Chu kỳ mới', action_cycle: 1 } },
    ],
  } } });
  const analysis = analyzeEmployeeReadOnly({ store: deps.store, persist: deps.persist, empCode: 'DN001', periodUi: '04.2026' });
  assert.equal(analysis.items[0].action.status, 'contacted');
  const service = createFilteredEmployeeReportService(deps);
  const payload = { period: '04.2026', emp_codes: ['DN001'], dormant_status: 'dormant' };
  const preview = await service.preview(payload);
  const report = await service.employeeReport({ ...payload, preview_id: preview.preview_id }, 'DN001');
  assert.equal(report.rows[0].action_status, 'contacted');
  assert.equal(report.rows[0].action_note, 'Đã liên hệ');
  assert.equal(report.rows[0].next_follow_up, '2026-04-10');
  assert.equal(report.rows[0].review_status, 'overdue');
});

test('historical CST and C30 use only the assignment effective in the selected period', async () => {
  const deps = fixtures();
  deps.cstRows.splice(0, 1,
    cst({ cst_initial: 100, cst_remaining: 80, remain_qty: 80, effective_from: '2026-01', effective_to: '2026-05' }),
    cst({ cst_initial: 300, cst_remaining: 250, remain_qty: 250, effective_from: '2026-06', effective_to: null }),
  );
  deps.appSaleCst.enrichCstRowsWithC30 = (rows) => ({
    rows: rows.map((row) => ({ ...row, c30: { option_qty: row.cst_initial, status_label: 'C30 theo kỳ', actionable: true } })),
    meta: { available: true, complete: true, stale: false, rowCount: rows.length },
  });
  const service = createFilteredEmployeeReportService(deps);
  const payload = { period: '04.2026', emp_codes: ['DN001'] };
  const preview = await service.preview(payload);
  const report = await service.employeeReport({ ...payload, preview_id: preview.preview_id }, 'DN001');
  assert.equal(report.rows[0].cst_initial, 100);
  assert.equal(report.rows[0].cst_remaining, 80);
  assert.equal(report.rows[0].c30_option_qty, 100);
});

test('dormant business key stays employee + unit + QLNB', () => {
  assert.notEqual(dormant.makeKey('DN001', '001.BV A', 'QLNB-A'), dormant.makeKey('DN001', '002.BV B', 'QLNB-A'));
});
