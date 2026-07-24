import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeeVatKhoanDeduction, employeeVatKhoanViewModel } from '../src/employeeVatKhoanModel.js';

const fixture = {
  available: true,
  source: 'App Report',
  source_label: 'App Report (điểm) + App VAT (xu)',
  emp_code: 'DN001',
  emp_name: 'Nhân viên Một',
  selected: { month: 7, year: 2026, quarter: 3 },
  quarter_label: 'Q3/2026 (07-09)',
  point_month: 12.34,
  point_quarter: 28.5,
  xu_month: 9.1,
  xu_quarter: 20.25,
  xu_quarter_total: 22.25,
  carry: 2,
  pct_month: 73.74,
  pct_quarter: 78.07,
  missing_quarter: 6.25,
  excess_quarter: 0,
  penalty_display: 1_800_000,
  point_rule_version: 'point-local-2026-05-r1',
  point_rule_effective_from: '2026-05',
  xu_rule_version: 'xu-v2026-05-r1',
  quarter_status: 'đang đối soát',
  parity: { available: false, status: 'đang đối soát', note: 'đang đối soát' },
};

test('view model preserves local point + VAT xu fields without inventing hidden values', () => {
  const model = employeeVatKhoanViewModel(fixture);
  assert.equal(model.available, true);
  assert.equal(model.empCode, 'DN001');
  assert.equal(model.diemQuy, 28.5);
  assert.equal(model.xuQuy, 20.25);
  assert.equal(model.xuQuyTong, 22.25);
  assert.equal(model.carry, 2);
  assert.equal(model.pctQuy, 78.07);
  assert.equal(model.thieuXu, 6.25);
  assert.equal(model.phatDuKien, 1_800_000);
  assert.equal(model.ruleVersion, 'point-local-2026-05-r1');
  assert.equal(model.pointRuleVersion, 'point-local-2026-05-r1');
  assert.equal(model.pointSource, 'App Report');
  assert.equal(model.pointLocalActive, true);
  assert.equal(model.xuRuleVersion, 'xu-v2026-05-r1');
  assert.equal(model.quarterStatus, 'đang đối soát');
});

test('missing source fails closed with exact note and no invented KPI values', () => {
  const model = employeeVatKhoanViewModel({ note: 'chưa lấy được xu kỳ này' });
  assert.equal(model.available, false);
  assert.equal(model.note, 'chưa lấy được xu kỳ này');
  assert.equal(model.diemThang, null);
  assert.equal(model.xuQuyTong, null);
  assert.equal(model.phatDuKien, null);
  assert.equal(model.pointSource, 'App VAT');
  assert.equal(model.pointLocalActive, false);
});

test('point source falls back to App VAT until the local rule is active', () => {
  assert.equal(employeeVatKhoanViewModel({ available: true, source: 'App VAT', rule_version: 'khoan-ssot-v2026-05-r1' }).pointSource, 'App VAT');
  assert.equal(employeeVatKhoanViewModel({ available: true, source: 'App Report' }).pointSource, 'App VAT');
});

test('display-only deduction keeps source cost separate and does not mutate it', () => {
  const result = employeeVatKhoanDeduction(10_000_000, 1_800_000);
  assert.deepEqual(result, { baseCost: 10_000_000, deduction: -1_800_000, remaining: 8_200_000 });
  assert.deepEqual(employeeVatKhoanDeduction(null, 1_800_000), { baseCost: null, deduction: null, remaining: null });
});

test('Employee Cost UI groups reward/penalty and moves Xu to the four-card deduction row', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(page, /Điểm \(tháng · quý\)/);
  assert.match(page, /Xu tích lũy \(tháng · quý\)/);
  assert.match(page, /Phạt dự kiến/);
  assert.match(page, /const pointSource = `Nguồn: \$\{source\}/);
  assert.match(page, /Nguồn: App VAT/);
  assert.match(page, /khoan\.pctQuy < 90/);
  assert.match(page, /floor\(điểm thiếu quý ÷ 2\) × 600\.000đ/);
  assert.match(page, /đang đối soát/);
  assert.match(page, /Cấn trừ do thiếu xu chi tiêu \(quý\) · dự kiến/);
  assert.match(page, /Chưa hiển thị phép cấn trừ cho kỳ nhiều tháng/);
  assert.match(page, /multiMonth=\{multiple\}/);
  assert.match(page, /Chi phí gốc/);
  assert.match(page, /Chi phí gốc − cấn trừ thiếu xu = còn lại/);
  assert.match(page, /Còn lại \(display-only\)/);
  assert.match(page, /Không ghi DataHub\/payroll/);
  assert.ok(page.indexOf('<BonusKpi') < page.indexOf('<KhoanPenaltyKpi'), 'Thưởng phải đứng ngay trước Phạt');
  assert.doesNotMatch(page.match(/<div className="kpi-grid employee-cost-kpis">[\s\S]*?<\/div>/)?.[0] || '', /Xu tích lũy/);
  assert.match(page, /className="employee-cost-khoan-equation"[\s\S]*className="xu"[\s\S]*Chi phí gốc[\s\S]*<strong>−<\/strong>[\s\S]*Cấn trừ thiếu xu[\s\S]*<strong>=<\/strong>[\s\S]*Còn lại/);
  assert.match(styles, /#4338ca/);
  assert.match(styles, /#eef2ff/);
  assert.match(styles, /#047857/);
  assert.match(styles, /#b91c1c/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*\.employee-cost-kpis \{ grid-template-columns:1fr; \}/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*\.employee-cost-khoan-equation \{ grid-template-columns:1fr; \}/);
  assert.match(app, /\['catalogManagement', 'dailySales', 'products', 'dormantReports', 'employeeCost'\]\.includes\(tab\)/);
  assert.match(page, /setKhoanPayload\(\{ note: 'chưa lấy được xu kỳ này' \}\);\s*setKhoanLoading\(true\)/);
});

test('frontend calls only the Report proxy and contains no App VAT credential or upstream URL', () => {
  const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(api, /employeeCostDiemXu/);
  assert.match(api, /\/employee-cost\/diem-xu/);
  assert.doesNotMatch(`${api}\n${page}`, /VAT_SERVICE_TOKEN|VAT_BASE|\/api\/khoan\/dashboard|Bearer \$\{.*VAT/);
});
