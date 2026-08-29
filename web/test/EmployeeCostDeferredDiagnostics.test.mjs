import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

test('Employee Cost never launches heavy badge-only diagnostics behind the primary table', () => {
  assert.doesNotMatch(source, /api\.employeeCostGapsSummary\(/);
  assert.doesNotMatch(source, /api\.employeeCostDataQualitySummary\(/);
  assert.match(source, /view !== 'gaps'[\s\S]*?gapPayload\?\.coverage/);
  assert.match(source, /view !== 'dq'[\s\S]*?dqPayload\?\.summary/);
});
