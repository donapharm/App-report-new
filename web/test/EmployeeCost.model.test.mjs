import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildEmployeeCostColumns, currentMonthValue, employeeBonusViewModel, employeeCostColumnKpis, employeeCostViewModel,
  employeeCostHighlightParts, employeeCostKpiMatch, employeeCostPageItems, employeeTargetViewModel, filterSortEmployeeCostRows, formatEmployeeCostCell, formatMatchRate,
  formatMonthLabel, normalizeEmployeeCostSearch,
} from '../src/employeeCostModel.js';
import { normalizeTargetNavigation, targetAdminKyAfterPeriods } from '../src/targetNavigationModel.js';

test('target model preserves backend month, quarter, sources and percentages without recomputing', () => {
  const target = employeeTargetViewModel({
    emp_code: 'DN006', ky: '07.2026', basis: 'revenue_before_vat', basis_label: 'Target và doanh thu đều so trước VAT.',
    month: { ky: '07.2026', label: 'T07/2026', target: 100_000_000, achieved: 72_500_000, pct: 72.5, assigned: true, source: 'manual', source_label: 'Sửa tay', source_ky: '07.2026' },
    quarter: {
      label: 'Q3/2026', target: 100_000_000, achieved: 72_500_000, pct: 72.5,
      months: [
        { ky: '07.2026', label: 'T07/2026', target: 100_000_000, achieved: 72_500_000, pct: 72.5, assigned: true, source: 'manual', source_label: 'Sửa tay' },
        { ky: '08.2026', label: 'T08/2026', target: 0, achieved: 0, pct: null, assigned: false, source_label: 'Chưa giao target' },
        { ky: '09.2026', label: 'T09/2026', target: 0, achieved: 0, pct: null, assigned: false, source_label: 'Chưa giao target' },
      ],
      unassigned_kys: ['08.2026', '09.2026'],
      calculation: 'average_assigned_months', calculation_label: 'Target quý = trung bình các tháng đã giao',
      clarification: 'Target quý = trung bình các tháng đã giao: T07/2026 (T08/2026/T09/2026 chưa giao target).',
    },
  });
  assert.equal(target.available, true);
  assert.deepEqual([target.month.target, target.month.achieved, target.month.pct], [100_000_000, 72_500_000, 72.5]);
  assert.deepEqual([target.quarter.target, target.quarter.achieved, target.quarter.pct], [100_000_000, 72_500_000, 72.5]);
  assert.equal(target.quarter.months[0].sourceLabel, 'Sửa tay');
  assert.equal(target.quarter.months[1].assigned, false);
  assert.deepEqual(target.quarter.unassignedKys, ['08.2026', '09.2026']);
  assert.equal(target.quarter.calculationLabel, 'Target quý = trung bình các tháng đã giao');
  assert.match(target.quarter.clarification, /trung bình các tháng đã giao/);
});

test('target KPI and modal display only backend-owned values and keep edit action admin-only', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  const components = fs.readFileSync(new URL('../src/components.jsx', import.meta.url), 'utf8');
  const targetPage = fs.readFileSync(new URL('../src/pages/Target.jsx', import.meta.url), 'utf8');
  const start = page.indexOf('function TargetKpi');
  const end = page.indexOf('function BonusKpi');
  const targetUi = page.slice(start, end);
  assert.match(targetUi, /Target \(tháng · quý\)/);
  assert.match(targetUi, /Chi tiết cách tính target/);
  assert.match(targetUi, /target\.month\.target/);
  assert.match(targetUi, /target\.quarter\.target/);
  assert.match(targetUi, /target\.month\.pct/);
  assert.match(targetUi, /target\.quarter\.pct/);
  assert.match(targetUi, /target\.quarter\.months\.map/);
  assert.match(targetUi, /target\.quarter\.clarification/);
  assert.match(targetUi, /Target quý = trung bình các tháng đã giao/);
  assert.match(targetUi, /target\.basisLabel/);
  assert.match(targetUi, /\{admin && <button[^>]*>Chỉnh target<\/button>\}/);
  assert.match(targetUi, /aria-modal="true"/);
  assert.match(targetUi, /closeRef\.current\?\.focus\(\)/);
  assert.match(targetUi, /event\.key !== 'Tab'/);
  assert.match(components, /role=\{onClick \? 'button' : undefined\}/);
  assert.match(components, /onKeyDown=\{onClick \? activate : undefined\}/);
  assert.match(targetUi, /targetView: 'admin'/);
  assert.match(targetPage, /normalizeTargetNavigation\(payload\)/);
  assert.match(targetPage, /me\.isAdmin && navigation\.openAdmin \? 'admin' : 'now'/);
  assert.match(targetPage, /focusEmp=\{navigation\.emp\}/);
  assert.doesNotMatch(targetUi, /\.reduce\(|\.target\s*\+|achieved\s*\/|target\s*\/\s*achieved/);
});

test('target edit deep-link keeps exact period and employee after periods hydrate', () => {
  const navigation = normalizeTargetNavigation({ tab: 'target', targetView: 'admin', ky: '07.2026', emp: 'dn006' });
  assert.deepEqual(navigation, { openAdmin: true, ky: '07.2026', emp: 'DN006' });
  assert.equal(targetAdminKyAfterPeriods(navigation.ky, { latest: '09.2026', periods: [{ ky: '08.2026' }, { ky: '09.2026' }] }), '07.2026');
  assert.equal(targetAdminKyAfterPeriods('', { latest: '09.2026', periods: [{ ky: '08.2026' }, { ky: '09.2026' }] }), '09.2026');
  assert.deepEqual(normalizeTargetNavigation({ tab: 'target', targetView: 'now', ky: '07.2026', emp: 'DN006' }), {});
});

test('bonus model keeps backend amounts, month/quarter context and exact unconfigured state', () => {
  assert.equal(employeeBonusViewModel({}).message, 'Chưa cấu hình mức thưởng');
  const bonus = employeeBonusViewModel({
    configured: true, schemaVersion: 3, version: 'v3-test', effectiveFrom: '2026-07-01', base: 'revenue_before_vat', totalCapPct: null, priorityThresholdPct: 101, priorityTargets: { 'H.A*': 4_000_000 }, disclaimer: 'Dự kiến/tham khảo, không phải payroll.', ky: '07.2026', quarterLabel: 'Q3/2026',
    month: { target: 100_000_000, achieved: 105_000_000, pct: 105, bonusPct: 0.15, baseBonusPct: 0.15, baseAmount: 157_500, priorityAmount: 60_000, amount: 217_500, priorityStatus: 'matched', priorityTargetTotal: 4_000_000, priorityTargetAssignedCount: 1, priorityCoverage: { source: 'datahub_catalog_c10', sourceAvailable: true, coveragePct: 80 }, priorityGroups: [{ group: 'H.A*', revenue: 10_000_000, target: 4_000_000, targetStatus: 'assigned', targetSource: 'manual', targetPeriods: [{ period: '2026-07', target: 4_000_000, targetSource: 'manual' }], excess: 6_000_000, ratePct: 1, amount: 60_000, reason: 'matched' }], status: 'matched', tier: { fromPct: 100, toPct: 110, bonusPct: 0.15 } },
    quarter: { target: 300_000_000, achieved: 390_000_000, pct: 130, bonusPct: 0.25, baseAmount: 975_000, priorityAmount: 0, amount: 975_000, status: 'matched' },
  });
  assert.equal(bonus.configured, true);
  assert.equal(bonus.month.amount, 217_500);
  assert.equal(bonus.month.baseAmount, 157_500);
  assert.equal(bonus.month.priorityGroups[0].group, 'H.A*');
  assert.equal(bonus.month.priorityGroups[0].target, 4_000_000);
  assert.equal(bonus.month.priorityGroups[0].excess, 6_000_000);
  assert.equal(bonus.month.priorityGroups[0].reason, 'matched');
  assert.equal(bonus.month.priorityGroups[0].targetSource, 'manual');
  assert.equal(bonus.month.priorityGroups[0].targetPeriods[0].targetSource, 'manual');
  assert.equal(bonus.month.priorityTargetAssignedCount, 1);
  assert.equal(bonus.disclaimer, 'Dự kiến/tham khảo, không phải payroll.');
  assert.deepEqual(bonus.month.tier, { fromPct: 100, toPct: 110, bonusPct: 0.15 });
  assert.equal(bonus.quarter.amount, 975_000);
});

test('bonus KPI contract labels it as forecast/reference and displays month plus quarter', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /label="Thưởng dự kiến"/);
  assert.match(page, /Chưa cấu hình mức thưởng/);
  assert.match(page, /theo mức đạt target · tham khảo/);
  assert.match(page, /lũy kế \$\{bonus\.quarterLabel\}/);
  assert.match(page, /month\.priorityStatus === 'source_unavailable'/);
  assert.match(page, /Phần 1/);
  assert.match(page, /Phần 2/);
  assert.match(page, /DataHub C10/);
  assert.doesNotMatch(page, /if \(month\.amount == null\) return/);
  assert.match(page, /chia cho từng nhóm C10 theo tỷ trọng doanh thu thực/);
  assert.match(page, /rà theo mã QLNB → cột C10/);
  assert.match(page, /được chia từ phần vượt/);
  assert.match(page, /Target quý = trung bình các tháng đã giao/);
  assert.match(page, /không phải payroll hay số chi chính thức/);
});

test('dynamic columns follow approved order, keep bid price before quantity, and block c32/c47', () => {
  const columns = buildEmployeeCostColumns([
    { key: 'c36', label: 'CP ctv (%)' },
    { key: 'c43', label: 'CP bs (%)' },
    { key: 'c47', label: 'Cấm' },
    { key: 'c32', label: 'Cấm' },
    { key: 'c5', label: 'Không lặp' },
  ]);
  assert.deepEqual(columns.map((column) => column.key), [
    'date', 'orderCode', 'route', 'c7', 'contractorName', 'c5', 'c10', 'c16', 'strength', 'c25',
    'bidPrice', 'quantity', 'revenueBeforeVat', 'c36', 'c43', 'rowMonthlyTotal', 'note',
  ]);
});

test('KPI and period metadata distinguish order lines from unique unit-product keys', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /label="Nhân viên"[\s\S]*sub=\{`Hiện \$\{filteredCount[^`]*\/\$\{totalTableRows[^`]* dòng`\}/);
  assert.match(page, /formatMatchRate\(kpiMatch\)/);
  assert.match(page, /kpiMatch\.matchedRows/);
  assert.match(page, /cặp \(đơn vị×mặt hàng\) · ngưỡng/);
  assert.match(page, /cặp đơn vị×mặt hàng\)/);
  assert.doesNotMatch(page, /matchedRows}\/\$\{[^}]*totalRows} dòng/);
});

test('ALL revenue-match KPI reads merged period match instead of empty top-level match', () => {
  const model = employeeCostViewModel({
    empCode: 'ALL', allEmployees: true, from: '2026-07', to: '2026-07',
    periods: [{
      empCode: 'ALL', period: '2026-07', rows: [], columns: [],
      match: { matchedRows: 1245, totalRows: 1262, rate: 98.7, threshold: 90, low: false },
      summary: { reliable: true },
    }],
    summary: { reliable: true },
  });
  assert.deepEqual(model.match, { matchedRows: 0, totalRows: 0, rate: null, threshold: 90, low: false, unavailablePairs: 0, unavailableEmployeeCount: 0, unavailableEmployees: [] });
  assert.deepEqual(employeeCostKpiMatch(model), { matchedRows: 1245, totalRows: 1262, rate: 98.7, threshold: 90, low: false, unavailablePairs: 0, unavailableEmployeeCount: 0, unavailableEmployees: [] });
  assert.equal(formatMatchRate(employeeCostKpiMatch(model)), '98,7%');
});

test('full-time and part-time template metadata produce exactly 20 and 16 columns', () => {
  const base = ['date', 'orderCode', 'route', 'c7', 'contractorName', 'c5', 'c10', 'c16', 'strength', 'c25', 'bidPrice', 'quantity', 'revenueBeforeVat'];
  const suffix = ['rowMonthlyTotal', 'note'];
  const costs = ['c36', 'c41', 'c43', 'c44', 'c45'].map((key) => ({ key, label: key, annual: key === 'c44' }));
  const fulltime = buildEmployeeCostColumns(costs, { columns: [...base, 'c36', 'c41', 'c43', 'c44', 'c45', ...suffix] });
  const parttime = buildEmployeeCostColumns(costs.slice(0, 1), { columns: [...base, 'c36', ...suffix] });
  assert.equal(fulltime.length, 20);
  assert.equal(parttime.length, 16);
  assert.equal(fulltime.at(-1).key, 'note');
  assert.ok(fulltime.findIndex((column) => column.key === 'bidPrice') < fulltime.findIndex((column) => column.key === 'quantity'));
});

test('view model renders percent without percent sign and reads pre-VAT sale fields/summary', () => {
  const model = employeeCostViewModel({
    empCode: 'DN001', period: '07.2026', template: { key: 'fulltime', label: 'FULL-TIME', columns: ['date', 'orderCode', 'strength', 'bidPrice', 'quantity', 'revenueBeforeVat', 'c36', 'c44', 'rowMonthlyTotal', 'note'] },
    columns: [{ key: 'c36', label: 'CP (%)' }, { key: 'c44', label: 'Cuối năm', annual: true }],
    rows: [{ orderCode: 'DH-01', sourceLineId: 'DH-01-1', date: '2026-07-02', strength: '500 mg', bidPrice: 1_050, quantity: 10, revenueBeforeVat: 10_000_000, c36: 8, c44: 0.3, rowMonthlyTotal: 800000, note: 'Data Hub' }],
    match: { matchedRows: 1, totalRows: 1, rate: 100, threshold: 90, low: false },
    summary: {
      reliable: true, monthlyTotal: 800000, annualTotal: 30000, revenueBeforeVatTotal: 10_000_000,
      columnTotals: { c36: 800_000, c44: 30_000 }, annualColumnKeys: ['c44'], annualLabels: ['Cuối năm'],
    },
  });
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].rowMonthlyTotal, 800000);
  assert.equal(model.rows[0].orderCode, 'DH-01');
  assert.equal(model.rows[0].date, '2026-07-02');
  assert.equal(model.rows[0].revenueBeforeVat, 10_000_000);
  assert.equal(model.costColumns[1].annual, true);
  assert.equal(model.summary.monthlyTotal, 800000);
  assert.equal(model.summary.revenueBeforeVatTotal, 10_000_000);
  assert.deepEqual(employeeCostColumnKpis(model), [
    { key: 'c36', label: 'CP (%)', annual: false, value: 800_000, provisional: false },
    { key: 'c44', label: 'Cuối năm', annual: true, value: 30_000, provisional: false },
  ]);
  assert.equal(formatEmployeeCostCell(8, model.costColumns[0]), '8.0');
  assert.equal(formatEmployeeCostCell(0.3, model.costColumns[1]), '0.3');
  assert.equal(formatEmployeeCostCell(10, { kind: 'percent' }), '10.0');
  assert.equal(formatEmployeeCostCell(1200000, { kind: 'money' }), '1.200.000đ');
  assert.equal(formatEmployeeCostCell(13246800, { kind: 'dimension', format: 'money' }), '13.246.800đ');
  assert.equal(formatEmployeeCostCell('2026-06-13', { key: 'date', kind: 'dimension' }), '13/06/2026');
  assert.equal(formatMatchRate(model.match), '100,0%');
  assert.equal(formatMatchRate({ rate: null }), '—');
  assert.equal(formatEmployeeCostCell(null, { kind: 'money' }), '—');
});

test('view model preserves only the backend-owned self-scoped first-advance projection', () => {
  const model = employeeCostViewModel({
    empCode: 'DN009', periods: [],
    salaryAdvance: {
      available: true, applicable: true, period: '2026-07', emp_code: 'DN009',
      amount: 59_736_053, currency: 'VND', locked: false, status: 'draft', reason: null,
      payroll_secret: 'must-not-pass',
    },
  });
  assert.deepEqual(model.salaryAdvance, {
    available: true, applicable: true, period: '2026-07', emp_code: 'DN009',
    amount: 59_736_053, currency: 'VND', locked: false, status: 'draft', reason: null,
    suspect: null, suspect_reason: null,
  });
  assert.equal(employeeCostViewModel({ periods: [] }).salaryAdvance, null);
});

test('view model preserves only backend-owned remaining-after-advance fields', () => {
  const model = employeeCostViewModel({
    empCode: 'DN009', periods: [],
    remainingAfterAdvance: {
      available: true, period: '2026-07', amount: 276_598_207,
      afterPenaltyTotal: 336_334_260, salaryAdvanceAmount: 59_736_053,
      currency: 'VND', locked: false, status: 'provisional', suspect: false,
      reason: null, note: 'Dự kiến · chưa chốt.', payroll_secret: 'must-not-pass',
    },
  });
  assert.deepEqual(model.remainingAfterAdvance, {
    available: true, period: '2026-07', amount: 276_598_207,
    afterPenaltyTotal: 336_334_260, salaryAdvanceAmount: 59_736_053,
    currency: 'VND', locked: false, status: 'provisional', suspect: false,
    reason: null, note: 'Dự kiến · chưa chốt.',
  });
  assert.equal(employeeCostViewModel({ periods: [] }).remainingAfterAdvance, null);
});

test('low coverage state preserves null amounts and unreliable totals', () => {
  const model = employeeCostViewModel({
    columns: [{ key: 'c36', label: 'CP (%)' }],
    rows: [{ c36: 8, rowMonthlyTotal: null }],
    match: { matchedRows: 0, totalRows: 1, rate: 0, threshold: 90, low: true },
    summary: { reliable: false, monthlyTotal: null, annualTotal: null, columnTotals: null },
  });
  assert.equal(model.rows[0].rowMonthlyTotal, null);
  assert.equal(model.match.low, true);
  assert.equal(model.summary.monthlyTotal, null);
  assert.deepEqual(employeeCostColumnKpis(model).map((item) => item.value), [null]);
});

test('view model normalizes backend-owned combined filter state and dynamic facet counts', () => {
  const model = employeeCostViewModel({
    empCode: 'DN001', filters: { province: 'ĐỒNG NAI', unitGroup: 'BV', route: 'CL', date: '2026-07-02' },
    filterOptions: {
      province: { available: true, source: 'official_row_or_config_or_unassigned', options: [{ value: 'ĐỒNG NAI', label: 'ĐỒNG NAI', count: 3 }] },
      unitGroup: { options: [{ value: 'BV', label: 'BV · Bệnh viện', count: 2 }] },
      route: { options: [{ value: 'CL', label: 'CL', count: 2 }] },
      date: { options: [{ value: '2026-07-02', label: '02/07/2026', count: 2 }] },
    },
    search: { query: 'cerecaps', filteredRows: 2, totalRows: 9 },
    periods: [],
  });
  assert.deepEqual(model.filters, { province: 'ĐỒNG NAI', unitGroup: 'BV', route: 'CL', date: '2026-07-02' });
  assert.deepEqual(model.filterOptions.province, {
    available: true, source: 'official_row_or_config_or_unassigned', options: [{ value: 'ĐỒNG NAI', label: 'ĐỒNG NAI', count: 3 }],
  });
  assert.equal(model.filterOptions.unitGroup.options[0].label, 'BV · Bệnh viện');
  assert.equal(model.filterOptions.date.options[0].label, '02/07/2026');
  assert.deepEqual(model.search, { query: 'cerecaps', filteredRows: 2, totalRows: 9 });
});

test('low coverage still shows provisional totals but flags them and keeps guarded totals null', () => {
  const model = employeeCostViewModel({
    columns: [{ key: 'c36', label: 'CP (%)' }],
    rows: [{ c36: 8, rowMonthlyTotal: 80_000 }],
    match: { matchedRows: 84, totalRows: 100, rate: 84.8, threshold: 90, low: true },
    summary: {
      reliable: false, monthlyTotal: null, annualTotal: null, columnTotals: null,
      provisionalMonthlyTotal: 80_000, provisionalAnnualTotal: 0, provisionalColumnTotals: { c36: 80_000 },
    },
  });
  // Khóa fail-closed giữ nguyên: số "chính thức" vẫn null cho export/nơi khác.
  assert.equal(model.summary.monthlyTotal, null);
  assert.equal(model.summary.columnTotals, null);
  // Nhưng KPI vẫn có số để CEO nhìn, kèm cờ provisional để UI ghi rõ "tạm tính".
  const kpis = employeeCostColumnKpis(model);
  assert.deepEqual(kpis, [{ key: 'c36', label: 'CP (%)', annual: false, value: 80_000, provisional: true }]);
});

test('nguon chi phi loi phai neu DICH DANH ma NV, khong chi dem so luong', () => {
  const model = employeeCostViewModel({
    empCode: 'ALL', allEmployees: true, from: '2026-07', to: '2026-07',
    periods: [{
      empCode: 'ALL', period: '2026-07', columns: [{ key: 'c36', label: 'CP (%)' }], rows: [],
      match: {
        matchedRows: 1074, totalRows: 1080, rate: 99.4, threshold: 90, low: false,
        unavailablePairs: 186, unavailableEmployeeCount: 1, unavailableEmployees: ['DN007'],
      },
      summary: { reliable: false },
    }],
    summary: { reliable: false },
  });
  const match = employeeCostKpiMatch(model);
  assert.deepEqual(match.unavailableEmployees, ['DN007']);
  assert.equal(match.unavailablePairs, 186);
  // Tổng cặp có dữ liệu + cặp lỗi nguồn phải cộng lại đúng toàn bộ.
  assert.equal(match.totalRows + match.unavailablePairs, 1266);
});

test('trang hien banner tu bao khi thieu du lieu, co nêu ma NV', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /Dữ liệu chưa đầy đủ — số đang là TẠM TÍNH/);
  assert.match(page, /unavailableEmpLabel/);
  assert.match(page, /nguồn chi phí DataHub chưa trả dữ liệu/);
});

test('gui worklist xong phai hien BIEN NHAN cua DataHub, khong chi noi da gui', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  // Phải nêu rõ DataHub đã xác nhận + số mã DataHub báo nhận được.
  assert.match(page, /DataHub ĐÃ XÁC NHẬN NHẬN/);
  assert.match(page, /receipt\.received/);
  assert.match(page, /receipt\.worklist_id/);
  // Phải phân biệt worklist mới với bản trùng, và có mã kiểm tra để đối chiếu.
  assert.match(page, /receipt\.deduped === true/);
  assert.match(page, /Mã kiểm tra/);
});

test('tab phai hien BADGE so ma/so cap va so exception, khong bat phai bam vao moi thay', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  // Badge nằm ngay trên nút tab.
  assert.match(page, /Mặt hàng thiếu %\{!gapBadge\.loaded/);
  assert.match(page, /Kiểm soát dữ liệu\{!dqBadge\.loaded/);
  // Hiện đủ số mã + số cặp cho tab thiếu %, số exception cho tab kiểm soát.
  assert.match(page, /gapBadge\.codeCount\} mã · \$\{gapBadge\.pairCount\} cặp/);
  assert.match(page, /dqBadge\.count\} exception/);
  // Số đếm phải tải BẤT KỂ đang ở tab nào (không phụ thuộc view === 'gaps').
  assert.match(page, /api\.employeeCostGapsSummary\(range\)/);
  assert.match(page, /api\.employeeCostDataQualitySummary\(range\)/);
});

test('gap coverage panel states the full arithmetic so pair count reconciles with match KPI', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /đã khớp \+ \{remainingPairs/);
  assert.match(page, /cặp thiếu gộp thành/);
  assert.match(page, /remainingPairs=\{view\.remainingPairs\}/);
  assert.match(page, /item\.pairCount\.toLocaleString/);
  assert.match(page, /Số cặp thiếu<\/th>/);
});

test('KPI column cards stay dynamic for part-time templates and never invent annual columns', () => {
  const model = employeeCostViewModel({
    empCode: 'DN021', period: '2026-07',
    template: { key: 'parttime', columns: ['date', 'c36', 'rowMonthlyTotal', 'note'] },
    columns: [{ key: 'c36', label: 'C36 CP ctv/khác (%)' }],
    rows: [{ date: '2026-07-01', c36: 8, rowMonthlyTotal: 80_000 }],
    match: { matchedRows: 1, totalRows: 1, rate: 100, threshold: 90, low: false },
    summary: {
      reliable: true, monthlyTotal: 80_000, annualTotal: 0, revenueBeforeVatTotal: 1_000_000,
      columnTotals: { c36: 80_000 }, annualColumnKeys: [], annualLabels: [],
    },
  });
  assert.deepEqual(employeeCostColumnKpis(model), [
    { key: 'c36', label: 'C36 CP ctv/khác (%)', annual: false, value: 80_000, provisional: false },
  ]);
});

test('month input and label use stable local YYYY-MM values', () => {
  assert.equal(currentMonthValue(new Date(2026, 6, 21)), '2026-07');
  assert.equal(formatMonthLabel('2026-07'), '07/2026');
});

test('multi-month model keeps blocks separate and exposes only non-annual range total', () => {
  const period = (month, revenue) => ({
    empCode: 'DN001', period: month,
    columns: [{ key: 'c36', label: 'CP tháng' }, { key: 'c44', label: 'Cuối năm', annual: true }],
    rows: [{ c5: 'QL1', c7: 'U1', c16: 'A', c36: 10, c44: 5, rowMonthlyTotal: revenue * 0.1 }],
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
        rowMonthlyTotal: 300_000,
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
  assert.deepEqual(model.periods[0].daily.rows.map((row) => row.rowMonthlyTotal), [100_000, 200_000]);
  assert.equal(model.periods[0].daily.rows[0].c44, 5);
});

test('legacy one-month payload remains supported without inventing daily data', () => {
  const model = employeeCostViewModel({
    empCode: 'DN001', period: '2026-07', columns: [{ key: 'c36', label: 'CP' }],
    rows: [{ c36: 8, rowMonthlyTotal: 80_000 }],
    match: { matchedRows: 1, totalRows: 1, rate: 100 },
    summary: { reliable: true, monthlyTotal: 80_000, annualTotal: 0 },
  });
  assert.equal(model.periods.length, 1);
  assert.equal(model.summary.periodTotal, 80_000);
  assert.equal(model.periods[0].daily.reliable, false);
  assert.deepEqual(model.periods[0].daily.rows, []);
});

test('smart table search is Vietnamese accent-insensitive, multi-token AND, stable sorted and renumbers STT', () => {
  const columns = buildEmployeeCostColumns([{ key: 'c36', label: 'CP cộng tác viên (%)' }]);
  const rows = [
    { sourceLineId: 'a', c7: 'Đức Việt', c16: 'Cerecaps', date: '2026-07-02', revenueBeforeVat: 100 },
    { sourceLineId: 'b', c7: 'Đơn vị khác', c16: 'Cerecaps Plus', date: '2026-07-01', revenueBeforeVat: 300 },
    { sourceLineId: 'c', c7: 'Đức Việt', c16: 'Atisyrup', date: '2026-07-03', revenueBeforeVat: 200 },
  ];
  assert.equal(normalizeEmployeeCostSearch('ĐỨC Việt'), 'duc viet');
  const result = filterSortEmployeeCostRows(rows, columns, 'duc CERECAPS', { key: 'revenueBeforeVat', dir: 'desc' });
  assert.deepEqual(result.map((row) => [row.stt, row.sourceLineId]), [[1, 'a']]);
  assert.deepEqual(filterSortEmployeeCostRows(rows, columns, 'dviet').map((row) => row.sourceLineId), ['a', 'c']);
  assert.deepEqual(filterSortEmployeeCostRows(rows, columns, 'cerecaps', { key: 'revenueBeforeVat', dir: 'desc' }).map((row) => row.sourceLineId), ['b', 'a']);
});

test('highlight maps accent-free query back to original Vietnamese text', () => {
  assert.deepEqual(employeeCostHighlightParts('Bệnh viện Đức Việt', 'duc viet').filter((part) => part.match).map((part) => part.text), ['Đức', 'Việt']);
  assert.deepEqual(employeeCostHighlightParts('Đức Việt', 'dviet').filter((part) => part.match).map((part) => part.text), ['Đức Việt']);
});

test('numbered pager keeps the current window clickable and contracts long ranges with ellipses', () => {
  assert.deepEqual(employeeCostPageItems(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(employeeCostPageItems(9, 25), [1, '…', 7, 8, 9, 10, 11, '…', 25]);
  assert.deepEqual(employeeCostPageItems(25, 25), [1, '…', 21, 22, 23, 24, 25]);
});

test('acceptance contract includes CEO-only ALL, compact full-label columns, sticky, pagination and exact export params', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(page, /<option value="ALL">Tất cả nhân viên<\/option>/);
  assert.match(page, /employee-cost-sticky-stt[^>]*>STT/);
  assert.match(page, /employee-cost-employee/);
  assert.match(page, /<small title=\{row\.employeeName\}>/);
  assert.match(page, /<button type="button" onClick=\{\(\) => sortHeader\(column\)\}>\{column\.label\}/);
  assert.doesNotMatch(page, /column\.kind === 'percent' \? column\.shortLabel/);
  assert.match(page, /title=\{column\.kind === 'percent' \? column\.label/);
  assert.match(page, /employee-cost-annual-badge">cuối năm/);
  assert.match(page, /Không dấu, nhiều từ khóa \(AND\)/);
  assert.match(page, /q: tableQuery, sortKey: tableSort\.key, sortDir: tableSort\.dir/);
  assert.match(api, /'q', 'sortKey', 'sortDir', 'page', 'pageSize'/);
  assert.match(page, /<span>Vùng\/Tỉnh<\/span>/);
  assert.match(page, /<span>Nhóm mã đơn vị<\/span>/);
  assert.match(page, /<span>Tuyến<\/span>/);
  assert.match(page, /<span>Ngày doanh thu<\/span>/);
  assert.match(page, /Tất cả ngày/);
  assert.match(page, /EMPLOYEE_COST_PAGE_SIZES = \[20, 50, 100\]/);
  assert.match(page, /employeeCostPageItems/);
  assert.match(page, /location="top"/);
  assert.match(page, /location="bottom"/);
  assert.match(page, /Tới trang/);
  assert.match(page, /\.\.\.tableFilters/);
  assert.match(api, /'province', 'unitGroup', 'route', 'date'/);
  assert.match(css, /\.employee-cost-sticky-product/);
  assert.match(css, /\.employee-cost-table \.employee-cost-col-revenueBeforeVat \{ width:148px; min-width:136px; max-width:158px; \}/);
  assert.match(css, /\.employee-cost-table th\.employee-cost-col-revenueBeforeVat > button \{ line-height:1\.2; white-space:normal; \}/);
  assert.match(css, /\.employee-cost-table \.employee-cost-col-strength \{ width:126px; min-width:112px; max-width:142px; \}/);
  assert.match(css, /\.employee-cost-table \.employee-cost-col-c7 \{ width:250px; min-width:230px; max-width:285px; \}/);
  assert.match(css, /\.employee-cost-table \.employee-cost-col-contractorName \{ width:235px; min-width:215px; max-width:270px; \}/);
  assert.match(css, /\.employee-cost-table th\.employee-cost-percent > button \{ line-height:1\.2; text-align:right; white-space:normal; \}/);
  assert.match(css, /\.employee-cost-employee \{ width:160px; min-width:160px; max-width:160px;/);
  assert.doesNotMatch(css, /\.employee-cost-table\.is-all-employees \.employee-cost-sticky-product/);
  assert.match(css, /\.employee-cost-sticky-product \{ position:sticky !important; left:48px;/);
  assert.match(css, /\.employee-cost-pagination\.is-top \{ position:sticky/);
  assert.match(css, /\.employee-cost-page-numbers button\.active/);
  assert.match(css, /max-height:72vh/);
});

// Bug 2026-07-27: backend trả `exceptionCount` nhưng FE đọc `count` → badge luôn 0
// dù bảng có exception. Khoá lại: phải đọc exceptionCount VÀ truyền kỳ đang xem.
test('badge Kiểm soát dữ liệu đọc exceptionCount và đếm đúng kỳ đang xem', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /data\.exceptionCount/);
  assert.match(page, /employeeCostDataQualitySummary\(range\)/);
  const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  assert.match(api, /employeeCostDataQualitySummary: \(range = \{\}\)/);
});

// CEO 2026-07-27: C10 là căn cứ chia thưởng P2 → phải thấy NGAY cạnh mã QLNB
// trong bảng "Chi phí của tôi", không phải đi tra chỗ khác.
test('bảng Chi phí của tôi có cột C10 ngay cạnh Mã hàng (QLNB)', () => {
  const model = fs.readFileSync(new URL('../src/employeeCostModel.js', import.meta.url), 'utf8');
  assert.match(model, /key: 'c10', label: 'C10'/);
  const order = ['c5', 'c10'];
  const idx = order.map((k) => model.indexOf(`'${k}', 'c16'`) >= 0 || model.indexOf(`key: '${k}'`) >= 0);
  assert.ok(idx.every(Boolean), 'c5 và c10 phải cùng có trong danh sách cột');
  // c10 phải đứng NGAY SAU c5 trong thứ tự cột mặc định
  assert.match(model, /'c5', 'c10', 'c16'/);
});

// Bug 27/07: layout do template quy định GHI ĐÈ DEFAULT_PREFIX → cột C10 khai ở
// mặc định không bao giờ hiện trên production (mẫu FULL-TIME/PART-TIME chưa có c10).
// Khoá lại: template thiếu c10 thì phải TỰ CHÈN ngay sau c5.
test('template layout thiếu c10 → vẫn phải chèn C10 ngay sau Mã hàng (QLNB)', () => {
  const costs = [{ key: 'c36', label: 'c36' }];
  const layoutNoC10 = ['date', 'orderCode', 'route', 'c7', 'contractorName', 'c5', 'c16',
    'strength', 'c25', 'bidPrice', 'quantity', 'revenueBeforeVat', 'c36', 'rowMonthlyTotal', 'note'];
  const keys = buildEmployeeCostColumns(costs, { columns: layoutNoC10 }).map((c) => c.key);
  assert.equal(keys[keys.indexOf('c5') + 1], 'c10', 'C10 phải nằm ngay sau c5');
  // template ĐÃ có c10 thì giữ nguyên, không chèn trùng
  const layoutWithC10 = ['c5', 'c10', 'c16'];
  const keys2 = buildEmployeeCostColumns([], { columns: layoutWithC10 }).map((c) => c.key);
  assert.deepEqual(keys2, ['c5', 'c10', 'c16']);
});

// CEO 27/07: cứ deploy xong là badge "biến mất" một lúc (cache bị xoá, phải tính lại)
// → nhìn tưởng hỏng mất tính năng. Khoá: đang tính phải hiện "…", và lỗi tạm thời
// KHÔNG được xoá số cũ đang hiển thị.
test('badge hiện … khi đang tính và KHÔNG biến mất khi lỗi tạm thời', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  // có nhánh loading hiển thị dấu …
  assert.match(page, /employee-cost-tab-badge loading/);
  assert.match(page, /Đang đếm/);
  // khi lỗi chỉ tắt cờ loading, KHÔNG set loaded:false (không xoá số cũ)
  assert.doesNotMatch(page, /catch\(\(\) => \{ if \(alive\) setGapBadge\(\(current\) => \(\{ \.\.\.current, loaded: false \}\)\); \}\)/);
  assert.match(page, /setGapBadge\(\(current\) => \(\{ \.\.\.current, loading: false \}\)\)/);
  assert.match(page, /setDqBadge\(\(current\) => \(\{ \.\.\.current, loading: false \}\)\)/);
});
