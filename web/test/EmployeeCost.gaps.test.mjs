import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeeCostGapView, gapReasonLabel, normalizeEmployeeCostGaps } from '../src/employeeCostGapModel.js';

const payload = {
  from: '2026-07', to: '2026-07', scope: { admin: true },
  coverage: { matchedPairs: 171, totalPairs: 184, rate: 92.9, gapPairCount: 13 },
  coverageByEmployee: [
    { employeeCode: 'DN001', employeeName: 'Anh Trung', matchedPairs: 171, totalPairs: 184, rate: 92.9, gapPairCount: 13 },
    { employeeCode: 'DN002', employeeName: 'NV 2', matchedPairs: 8, totalPairs: 9, rate: 88.9, gapPairCount: 1 },
  ],
  pairs: [
    { period: '2026-07', employeeCode: 'DN001', unitCode: '130', unitLabel: '130.NT-BV TIM TÂM ĐỨC', productCode: 'QĐ1572.1699.N4.754', productName: 'VALGESIC 10', revenueAffected: 5000000, reason: 'qd_mismatch', suggestedCatalogCode: 'QĐ1572.1699.N4.754.A' },
    { period: '2026-07', employeeCode: 'DN001', unitCode: '175', unitLabel: '175.BVĐK Vũng Tàu', productCode: 'G1.GE.QĐ139.3104.N5.484', productName: 'RELIPOREX 2000 IU', revenueAffected: 7000000, reason: 'missing' },
    { period: '2026-07', employeeCode: 'DN002', unitCode: '175', unitLabel: '175.BVĐK Vũng Tàu', productCode: 'G1.GE.QĐ139.3104.N5.484', productName: 'RELIPOREX 2000 IU', revenueAffected: 3000000, reason: 'missing' },
  ],
};

test('gap model groups by QLNB and orders by affected revenue', () => {
  const view = employeeCostGapView(payload);
  assert.equal(view.items.length, 2);
  assert.equal(view.items[0].productCode, 'G1.GE.QĐ139.3104.N5.484');
  assert.equal(view.items[0].revenueAffected, 10000000);
  assert.equal(view.items[0].employeeCount, 2);
  assert.equal(view.items[0].unitCount, 1);
  assert.equal(view.remainingPairs, 3);
  assert.equal(view.remainingCodes, 2);
});

test('gap filters cover employee, unit, reason, and accent-insensitive search', () => {
  const byEmployee = employeeCostGapView(payload, { employee: 'dn001' });
  assert.equal(byEmployee.pairs.length, 2);
  assert.equal(byEmployee.coverage.rate, 92.9);
  const mismatch = employeeCostGapView(payload, { reason: 'qd_mismatch', q: 'tam duc' });
  assert.equal(mismatch.pairs.length, 1);
  assert.equal(mismatch.pairs[0].suggestedCatalogCode, 'QĐ1572.1699.N4.754.A');
  const unit = employeeCostGapView(payload, { unit: 'Vung Tau' });
  assert.equal(unit.pairs.length, 2);
  assert.equal(gapReasonLabel('qd_mismatch'), 'Lệch mã QĐ/QLNB');
});

test('normalization drops malformed pairs and does not synthesize financial fields', () => {
  const model = normalizeEmployeeCostGaps({ pairs: [{ productCode: 'X' }, payload.pairs[0]] });
  assert.equal(model.pairs.length, 1);
  assert.equal('percent' in model.pairs[0], false);
  assert.equal('amount' in model.pairs[0], false);
});

test('Employee Cost UI uses secure gap API, admin tab, filters, progress, and authenticated export', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  assert.match(page, /Mặt hàng chưa có % chi phí/);
  assert.match(page, /Gộp theo mã QLNB/);
  assert.match(page, /employeeCostGaps/);
  assert.match(page, /downloadEmployeeCostGaps/);
  assert.match(page, /role="progressbar"/);
  assert.match(api, /Authorization: 'Bearer ' \+ getToken\(\)/);
  assert.match(api, /X-Device-Id/);
});
