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
      c45Amount: 7_599_706, afterPenaltyTotal: null,
      warning: { revenueGap: 31_000_000, moneyAtRisk: 7_599_706, text: 'CHƯA TRỪ TIỀN · trước VAT' },
    },
  });
  assert.equal(model.summary.periodTotal, null);
  assert.equal(model.summary.afterPenaltyTotal, null);
  assert.equal(model.penalty.total, 7_599_706);
  assert.equal(model.penalty.appliedAmount, 0);
  assert.equal(model.penalty.warning.revenueGap, 31_000_000);
});

test('employee penalty UI has exactly the four v3.3 KPI labels and fail-closed total gate', () => {
  for (const label of [
    'Phạt dự kiến',
    'Tổng chi phí tháng sau phạt',
    'Phạt thiếu Xu cuối quý',
    'Ứng lần 1 tháng này',
  ]) assert.match(PAGE, new RegExp(label));
  assert.match(PAGE, /model\.summary\.periodTotal != null && <AfterPenaltyKpi/);
  assert.match(PAGE, /value="Chưa đấu nối app lương"/);
  assert.doesNotMatch(PAGE.match(/function SalaryAdvanceKpi\(\)[\s\S]*?\n}/)?.[0] || '', /0đ/);
  assert.match(PAGE, /tone="employee-cost-tone-penalty"/);
  assert.match(CSS, /\.employee-cost-tone-penalty\s*\{/);
});

test('quarter Xu copy, warning detail and admin-only penalty column are present', () => {
  assert.match(PAGE, /Chốt vào cuối quý \(T\$\{endMonth\}\)/);
  assert.match(PAGE, /penalty\.warning\?\.text/);
  assert.match(PAGE, /Chi tiết cách tính phạt/);
  assert.match(PAGE, /role="columnheader">Phạt dự kiến/);
  assert.match(PAGE, /allEmployees && model\.bonus\.configured/);
  assert.match(PAGE, /item\.penalty\?\.total/);
});
