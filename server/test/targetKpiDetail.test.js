'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTargetKpiDetail } = require('../src/targetKpiDetail');

test('detail stays self-scoped and preserves every backend-owned amount and percentage', () => {
  const summaryCalls = [];
  const resolverCalls = [];
  const periods = {
    '07.2026': {
      ky: '07.2026', quarter_label: 'Q3/2026', quarter_kys: ['07.2026', '08.2026', '09.2026'],
      month: { target: 100, achieved: 50, pct: 12.3 },
      quarter: { target: 130, achieved: 79, pct: 60.8 },
    },
    '08.2026': { month: { target: 0, achieved: 20, pct: null } },
    '09.2026': { month: { target: 30, achieved: 9, pct: 77.7 } },
  };
  const targetKpiSummary = (ky, scope, codes) => {
    summaryCalls.push({ ky, scope, codes });
    return periods[ky];
  };
  const resolveTargets = ({ ky, empCodes }) => {
    resolverCalls.push({ ky, empCodes });
    if (ky === '07.2026') return [{ emp_code: 'DN006', target: 100, source: 'manual', source_label: 'CEO sửa tay', ky }];
    if (ky === '09.2026') return [{ emp_code: 'DN006', target: 30, source: 'upload', source_ky: '09.2026', ky }];
    return [];
  };

  const detail = buildTargetKpiDetail({
    ky: '07.2026', scope: { empCode: 'DN006' }, empCode: 'dn006', targetKpiSummary, resolveTargets,
  });

  assert.deepEqual(summaryCalls, [
    { ky: '07.2026', scope: { empCode: 'DN006' }, codes: ['DN006'] },
    { ky: '08.2026', scope: { empCode: 'DN006' }, codes: ['DN006'] },
    { ky: '09.2026', scope: { empCode: 'DN006' }, codes: ['DN006'] },
  ]);
  assert.deepEqual(resolverCalls, [
    { ky: '07.2026', empCodes: ['DN006'] },
    { ky: '08.2026', empCodes: ['DN006'] },
    { ky: '09.2026', empCodes: ['DN006'] },
  ]);
  assert.equal(detail.emp_code, 'DN006');
  // Deliberately inconsistent mock percentages prove this layer does not recompute them.
  assert.deepEqual([detail.month.target, detail.month.achieved, detail.month.pct], [100, 50, 12.3]);
  assert.deepEqual([detail.quarter.target, detail.quarter.achieved, detail.quarter.pct], [130, 79, 60.8]);
  assert.deepEqual(detail.quarter.months.map((item) => [item.ky, item.target, item.achieved, item.pct]), [
    ['07.2026', 100, 50, 12.3],
    ['08.2026', 0, 20, null],
    ['09.2026', 30, 9, 77.7],
  ]);
  assert.equal(detail.month.source_label, 'CEO sửa tay');
  assert.equal(detail.quarter.months[1].source_label, 'Chưa giao target');
  assert.equal(detail.quarter.months[2].source_label, 'Upload');
  assert.deepEqual(detail.quarter.unassigned_kys, ['08.2026']);
  assert.equal(detail.quarter.clarification, 'Quý hiện tính trên T07/2026 + T09/2026 (T08/2026 chưa giao target). Khi giao thêm, target quý tăng → % đạt quý sẽ đổi.');
  assert.equal(detail.basis_label, 'Target và doanh thu đều so trước VAT.');
});

test('detail refuses an empty employee scope', () => {
  assert.throws(() => buildTargetKpiDetail({
    ky: '07.2026', scope: {}, empCode: '', targetKpiSummary: () => ({}), resolveTargets: () => [],
  }), /Thiếu mã nhân viên/);
});
