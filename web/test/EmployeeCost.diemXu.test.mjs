import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeeVatKhoanDeduction, employeeVatKhoanViewModel } from '../src/employeeVatKhoanModel.js';

const fixture = {
  available: true,
  source: 'App VAT',
  emp_code: 'DN001',
  emp_name: 'Nhân viên Một',
  selected: { month: 7, year: 2026, quarter: 3 },
  quarter_label: 'Q3/2026 (07-09)',
  diem_thang: 12.34,
  diem_quy: 28.5,
  xu_thang: 9.1,
  xu_quy: 20.25,
  xu_quy_tong: 22.25,
  carry: 2,
  pct_thang: 73.74,
  pct_quy: 78.07,
  thieu_du: -6.25,
  thieu_xu: 6.25,
  du_xu: 0,
  phat_du_kien: 1_800_000,
  rule_version: 'khoan-ssot-v2026-05-r1',
  penalty_rule: '2đ thiếu = 600Kđ phạt',
};

test('view model preserves App VAT SSOT fields without recomputing points/xu/penalty', () => {
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
  assert.equal(model.ruleVersion, 'khoan-ssot-v2026-05-r1');
});

test('missing source fails closed with exact note and no invented KPI values', () => {
  const model = employeeVatKhoanViewModel({ note: 'chưa lấy được điểm/xu kỳ này' });
  assert.equal(model.available, false);
  assert.equal(model.note, 'chưa lấy được điểm/xu kỳ này');
  assert.equal(model.diemThang, null);
  assert.equal(model.xuQuyTong, null);
  assert.equal(model.phatDuKien, null);
});

test('display-only deduction keeps source cost separate and does not mutate it', () => {
  const result = employeeVatKhoanDeduction(10_000_000, 1_800_000);
  assert.deepEqual(result, { baseCost: 10_000_000, deduction: -1_800_000, remaining: 8_200_000 });
  assert.deepEqual(employeeVatKhoanDeduction(null, 1_800_000), { baseCost: null, deduction: null, remaining: null });
});

test('Employee Cost UI has three KPIs, source/version, early warning and separate display-only deduction', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /Điểm \(tháng · quý\)/);
  assert.match(page, /Xu tích lũy \(tháng · quý\)/);
  assert.match(page, /Phạt dự kiến/);
  assert.match(page, /Nguồn: \$\{khoan\.source\} · \$\{khoan\.ruleVersion\}/);
  assert.match(page, /khoan\.pctQuy < 90/);
  assert.match(page, /floor\(điểm thiếu ÷ 2\) × tiền mỗi bậc theo rule App VAT/);
  assert.match(page, /App Report không tự tính lại/);
  assert.match(page, /Cấn trừ do thiếu xu chi tiêu \(quý\) · dự kiến/);
  assert.match(page, /Chưa hiển thị phép cấn trừ cho kỳ nhiều tháng/);
  assert.match(page, /multiMonth=\{multiple\}/);
  assert.match(page, /Chi phí gốc/);
  assert.match(page, /Chi phí gốc − cấn trừ thiếu xu = còn lại/);
  assert.match(page, /Còn lại \(display-only\)/);
  assert.match(page, /Không ghi DataHub\/payroll/);
  assert.match(page, /setKhoanPayload\(\{ note: 'chưa lấy được điểm\/xu kỳ này' \}\);\s*setKhoanLoading\(true\)/);
});

test('frontend calls only the Report proxy and contains no App VAT credential or upstream URL', () => {
  const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(api, /employeeCostDiemXu/);
  assert.match(api, /\/employee-cost\/diem-xu/);
  assert.doesNotMatch(`${api}\n${page}`, /VAT_SERVICE_TOKEN|VAT_BASE|\/api\/khoan\/dashboard|Bearer \$\{.*VAT/);
});
