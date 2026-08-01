import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

test('remaining KPI is immediately after first advance and stays self-scoped', () => {
  assert.match(page, /function RemainingAfterAdvanceKpi\(\{ remainingAfterAdvance, loading, allEmployees, period \}\)/);
  assert.match(page, /label="Còn lại sau ứng lần 1"/);
  assert.match(page, /<SalaryAdvanceKpi[\s\S]{0,300}?<RemainingAfterAdvanceKpi/);
  assert.match(page, /if \(allEmployees\) return <Kpi label="Còn lại sau ứng lần 1" value="Chọn 1 NV"/);
  assert.match(page, /Không tổng hợp hoặc gọi App Salary cho toàn đội/);
});

test('missing and suspect inputs render dash without inventing zero or a negative amount', () => {
  const component = page.slice(page.indexOf('function RemainingAfterAdvanceKpi'), page.indexOf('function PenaltyDetailModal'));
  assert.match(component, /projection\.suspect \|\| projection\.reason === 'salary_advance_exceeds_after_penalty_total'/);
  assert.match(component, /value="—"[\s\S]{0,180}?Số ứng nghi sai; chưa thể tính số còn lại/);
  assert.match(component, /value="—"[\s\S]{0,180}?Chưa đủ dữ liệu, không coi là 0/);
  assert.doesNotMatch(component, /afterPenaltyTotal\s*-\s*salaryAdvanceAmount|Math\.max\(/,
    'frontend must not recalculate or clamp the backend-owned amount');
});

test('valid amount shows exact formula inputs and provisional or locked status', () => {
  const component = page.slice(page.indexOf('function RemainingAfterAdvanceKpi'), page.indexOf('function PenaltyDetailModal'));
  assert.match(component, /projection\.locked \? 'Đã chốt' : 'Dự kiến · chưa chốt'/);
  assert.match(component, /projection\.afterPenaltyTotal\.toLocaleString\('vi-VN'\)/);
  assert.match(component, /projection\.salaryAdvanceAmount\.toLocaleString\('vi-VN'\)/);
  assert.match(component, /projection\.amount\.toLocaleString\('vi-VN'\).*₫/s);
  assert.match(component, /nguồn App Report \+ App Salary/);
});
