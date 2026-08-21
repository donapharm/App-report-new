import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
const model = fs.readFileSync(new URL('../src/employeeCostModel.js', import.meta.url), 'utf8');

test('ALL renders a named outside-roster line only from revenueRecon', () => {
  assert.match(page, /data-testid="employee-cost-outside-roster"/);
  assert.match(page, /Ngoài đội hình: \{model\.revenueRecon\.outsideRosterCodes\.join\(', '\)\}/);
  assert.match(page, /model\.revenueRecon\.outsideRosterAmount > 0/);
  assert.match(model, /outsideRosterAmount: numberOrNull\(payload\.revenueRecon\.outsideRosterAmount\)/);
});

test('ALL separates target-only employees and VP018 from true outside-roster rows', () => {
  assert.match(page, /data-testid="employee-cost-target-only"/);
  assert.match(page, /NV chỉ tính target — không thưởng\/phạt/);
  assert.match(page, /đúng chính sách CEO 21\/08\/2026, <b>không ai phải xử lý<\/b>/);
  assert.match(page, /data-testid="employee-cost-non-sales-quarantined"/);
  assert.match(page, /Telesale — không nhận doanh thu sale/);
  assert.match(model, /targetOnlyAmount: numberOrNull\(payload\.revenueRecon\.targetOnlyAmount\)/);
  assert.match(model, /nonSalesRoleQuarantinedAmount: numberOrNull\(payload\.revenueRecon\.nonSalesRoleQuarantinedAmount\)/);
});

test('balanced target-only/telesale is informational, not an alert', () => {
  assert.match(page, /const reconInformational =/);
  assert.match(page, /role=\{reconInformational \? 'status' : 'alert'\}/);
  assert.match(page, /Doanh thu đã cân đủ; các vế dưới được tách theo chính sách/);
  assert.match(page, /Tổng không bao gồm NV chỉ tính target/);
  assert.match(page, /\['DN', '021'\]\.join\(''\)/);
  assert.match(page, /\['DN', '023'\]\.join\(''\)/);
});

test('outside-roster values cannot feed employee monthly or column totals', () => {
  const forbidden = [
    /monthlyTotal[^\n]{0,160}outsideRoster|outsideRoster[^\n]{0,160}monthlyTotal/,
    /columnTotals[^\n]{0,160}outsideRoster|outsideRoster[^\n]{0,160}columnTotals/,
    /employeeSubtotals[^\n]{0,160}outsideRoster|outsideRoster[^\n]{0,160}employeeSubtotals/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(page, pattern);
    assert.doesNotMatch(model, pattern);
  }
});
