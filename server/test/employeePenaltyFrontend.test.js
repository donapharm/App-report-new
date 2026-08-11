'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const PAGE = fs.readFileSync(path.join(ROOT, 'web/src/pages/EmployeeCost.jsx'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'web/src/styles.css'), 'utf8');

async function modelModule() {
  return import(`${pathToFileURL(path.join(ROOT, 'web/src/employeeCostModel.js')).href}?test=${Date.now()}`);
}

test('penalty view model preserves backend numbers and keeps null distinct from zero', async () => {
  const { employeeCostViewModel } = await modelModule();
  const model = employeeCostViewModel({
    from: '2026-07', to: '2026-07', periods: [],
    summary: { reliable: true, periodTotal: null, afterPenaltyTotal: null },
    penalty: {
      mode: 'warn_only', total: 7_599_706, appliedAmount: 0,
      c45Amount: 7_599_706, c45Dropped: false, c45WouldDrop: true, afterPenaltyTotal: null,
      warning: { revenueGap: 31_000_000, moneyAtRisk: 7_599_706, text: 'CHƯA TRỪ TIỀN · trước VAT' },
    },
  });
  assert.equal(model.summary.periodTotal, null);
  assert.equal(model.summary.afterPenaltyTotal, null);
  assert.equal(model.penalty.total, 7_599_706);
  assert.equal(model.penalty.appliedAmount, 0);
  assert.equal(model.penalty.appliedContributors, 0);
  assert.equal(model.penalty.c45Dropped, false);
  assert.equal(model.penalty.c45WouldDrop, true);
  assert.equal(model.penalty.warning.revenueGap, 31_000_000);
});

test('ALL penalty view model preserves backend aggregate coverage and provisional subtotal', async () => {
  const { employeeCostViewModel } = await modelModule();
  const model = employeeCostViewModel({
    empCode: 'ALL', allEmployees: true, from: '2026-07', to: '2026-07', periods: [],
    summary: { reliable: false, periodTotal: null, afterPenaltyTotal: null },
    penalty: {
      aggregate: true, scope: 'team_full_range', mode: 'warn_only', total: null,
      provisionalTotal: 9_999_706, appliedAmount: 0, appliedContributors: 2, baseTotal: null, afterPenaltyTotal: null,
      employeeCount: 2, contributors: 1, unavailableCount: 1, unavailableEmployees: ['DN002'], complete: false,
    },
  });
  assert.equal(model.penalty.aggregate, true);
  assert.equal(model.penalty.scope, 'team_full_range');
  assert.equal(model.penalty.total, null);
  assert.equal(model.penalty.provisionalTotal, 9_999_706);
  assert.equal(model.penalty.appliedAmount, 0);
  assert.equal(model.penalty.appliedContributors, 2);
  assert.equal(model.penalty.employeeCount, 2);
  assert.equal(model.penalty.contributors, 1);
  assert.deepEqual(model.penalty.unavailableEmployees, ['DN002']);
  assert.equal(model.penalty.complete, false);
});

test('employee penalty UI keeps v3.4 KPI labels, adds remaining-after-advance, and preserves fail-closed gates', () => {
  for (const label of [
    'Phạt dự kiến',
    'Tổng chi phí tháng sau phạt',
    'Phạt thiếu Xu cuối quý',
    'Ứng lần 1 tháng này',
    'Còn lại sau ứng lần 1',
  ]) assert.match(PAGE, new RegExp(label));
  // ‼ CEO chốt 31/07: CHỌN 1 NV phải thấy đủ 5 ô liên quan phạt/ứng/còn lại — để chính NV đó biết mình có
  // thể bị phạt bao nhiêu. Luật cũ (ẩn ô "Tổng sau phạt" khi tổng gốc null) đã BỎ:
  // ẩn đi thì người xem tưởng tính năng không tồn tại — CEO đã gặp đúng chuyện này.
  // Fail-closed KHÔNG mất: chuyển vào trong component, hiện CHỮ thay vì ẩn ô.
  assert.doesNotMatch(PAGE, /model\.summary\.periodTotal != null && <AfterPenaltyKpi/,
    'ô "Tổng sau phạt" không được ẩn theo điều kiện ngoài');
  /* Ý giữ nguyên: ALL chỉ ĐỌC `baseTotal` backend, không tự cộng lại từ bảng. Thêm cửa
   * chặn thiếu người ở ngoài (CEO chốt 11/08) — thiếu một NV thì truyền `null` để ô tự
   * nói "Chưa đủ dữ liệu chi phí" thay vì in tổng của phần đội. */
  assert.match(PAGE, /<AfterPenaltyKpi[\s\S]{0,260}?baseTotal=\{thieuNguoi \? null : \(allEmployees \? model\.penalty\.baseTotal : model\.summary\.periodTotal\)\}/,
    'mọi chế độ phải render ô "Tổng sau phạt"; ALL chỉ đọc baseTotal backend, và phải qua cửa chặn thiếu người');
  assert.match(PAGE, /if \(penalty\.aggregate && penalty\.afterPenaltyTotal == null\) \{[\s\S]{0,350}?Chưa đủ dữ liệu phạt/,
    'ALL enforced thiếu số áp dụng phải fail-closed, không được dùng tổng gốc như tổng sau phạt');
  assert.doesNotMatch(PAGE, /label="Phạt dự kiến" value="Chọn 1 NV"/,
    'ALL đã có tổng backend, không được giữ placeholder cũ');
  assert.match(PAGE, /<PenaltyKpi penalty=\{model\.penalty\}/);
  assert.match(PAGE, /<XuPenaltyKpi penalty=\{model\.penalty\}/);
  assert.match(PAGE, /if \(baseTotal == null\) \{[\s\S]{0,400}?Chưa đủ dữ liệu chi phí/,
    'tổng gốc null phải hiện chữ, KHÔNG được suy ra số và KHÔNG được ẩn ô');
  assert.doesNotMatch(PAGE, /if \(baseTotal == null\) return null;/,
    'cấm ẩn ô bằng return null');
  assert.match(PAGE, /function SalaryAdvanceKpi\(\{ salaryAdvance, loading, allEmployees, period \}\)/);
  assert.match(PAGE, /Number\.isSafeInteger\(salaryAdvance\.amount\)/);
  assert.match(PAGE, /Dự kiến · chưa chốt trên App Salary/);
  assert.doesNotMatch(PAGE, /Chưa đấu nối app lương/);
  assert.match(PAGE, /tone="employee-cost-tone-penalty"/);
  assert.match(CSS, /\.employee-cost-tone-penalty\s*\{/);
  assert.match(PAGE, /c45Dropped=\{penalty\?\.c45Dropped\}/,
    'badge/gạch mờ C45 chỉ được điều khiển bởi cờ đã áp dụng');
  assert.doesNotMatch(PAGE, /c45Dropped=\{penalty\?\.c45WouldDrop\}/,
    'cờ chạy thử không được gắn badge hoặc gạch mờ C45');
});

test('quarter Xu copy, warning detail and admin-only penalty column are present', () => {
  assert.match(PAGE, /Chốt vào cuối quý \(T\$\{endMonth\}\)/);
  assert.match(PAGE, /penalty\.warning\?\.text/);
  assert.match(PAGE, /Chi tiết cách tính phạt/);
  assert.match(PAGE, /role="columnheader">Phạt dự kiến/);
  assert.match(PAGE, /allEmployees && model\.bonus\.configured/);
  assert.match(PAGE, /item\.penalty\?\.total/);
});
