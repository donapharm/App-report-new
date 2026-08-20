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
