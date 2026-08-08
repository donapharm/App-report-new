import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ratesLookup } from '../src/catalogCostGrantsModel.js';
import { setMasked, MASK_TEXT } from '../src/privacyMask.js';
import { pct } from '../src/util.js';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const cost = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
const gapModel = fs.readFileSync(new URL('../src/employeeCostGapModel.js', import.meta.url), 'utf8');

test('tra % theo cặp: không có quyền HOẶC chưa có % đều ra null, không suy 0%', () => {
  const rateOf = ratesLookup([
    { unitCode: '120.HTNT', productCode: 'G1.A', rates: { c41: 1, c43: null } },
  ]);
  assert.equal(rateOf('120.HTNT', 'G1.A', 'c41'), 1);
  assert.equal(rateOf('120.htnt', 'g1.a', 'C41'), 1, 'không phân biệt hoa thường');
  assert.equal(rateOf('120.HTNT', 'G1.A', 'c43'), null, 'chưa có % ⇒ null');
  assert.equal(rateOf('120.HTNT', 'G1.A', 'c45'), null, 'cột không được cấp ⇒ null');
  assert.equal(rateOf('999.KHAC', 'G1.A', 'c41'), null, 'đơn vị ngoài phạm vi ⇒ null');
});

test('cột % trong bảng danh mục đi qua rèm che (đang ẩn số thì che theo)', () => {
  try {
    setMasked(true);
    assert.equal(pct(1.5, 2), MASK_TEXT);
    setMasked(false);
    assert.equal(pct(1.5, 2), '1,5%');
  } finally { setMasked(false); }
  assert.match(page, /function CostRateCell/);
  assert.match(page, /\{pct\(value, 2\)\}/);
});

test('thiếu % thì hiện — kèm chỉ đường sang tab "Mặt hàng thiếu %"', () => {
  assert.match(page, /Chưa có % cho cặp này — xem tab “Mặt hàng thiếu %”/);
  assert.match(page, /value == null/);
});

test('cột % vào CẢ hai bảng: của CEO và của nhân viên', () => {
  assert.equal((page.match(/costColumns\.map\(\(c\) => <th/g) || []).length, 2, 'thiếu header ở một bảng');
  assert.equal((page.match(/<CostRateCell key=\{c\.key\}/g) || []).length, 2, 'thiếu ô dữ liệu ở một bảng');
});

test('nguồn tỷ lệ kẹt thì NÓI RA, không im lặng đưa số cũ', () => {
  assert.match(page, /Nguồn tỷ lệ chi phí đang kẹt/);
  assert.match(page, /costRates\.stale/);
});

test('lỗi tải % KHÔNG được làm hỏng màn danh mục — chỉ mất cột', () => {
  const hook = page.slice(page.indexOf('function useCostRates'), page.indexOf('function EmployeeSections'));
  assert.match(hook, /\.catch\(\(\) =>[\s\S]*columns: \[\]/);
});

test('mã đơn hàng vào tab "Mặt hàng thiếu %": hiện 3 mã + tooltip đủ, KHÔNG bị che', () => {
  assert.match(cost, /<th>Mã đơn hàng<\/th>/);
  assert.match(cost, /item\.orderCodes\.slice\(0, 3\)/);
  assert.match(cost, /title=\{item\.orderCodes\.join\('; '\)\}/);
  assert.match(cost, /mã tra cứu ⇒ KHÔNG bị rèm che/i);
  assert.match(gapModel, /orderCodes: \[\.\.\.item\.orderCodes\]/);
});

test('nút Quay lại có ở cả hai tab con và chỉ đổi tab, giữ nguyên kỳ + bộ lọc', () => {
  assert.equal((cost.match(/employee-cost-back/g) || []).length, 2);
  assert.equal((cost.match(/onBack=\{\(\) => setView\('cost'\)\}/g) || []).length, 2);
});
