import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ratesLookup } from '../src/catalogCostGrantsModel.js';
import { setMasked, MASK_TEXT } from '../src/privacyMask.js';
import { pct } from '../src/util.js';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const model = fs.readFileSync(new URL('../src/catalogCostGrantsModel.js', import.meta.url), 'utf8');
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

/* ── LƯU XONG PHẢI KIỂM LẠI + QUAY VỀ DANH SÁCH (CEO 09/08/2026) ──────────────
 * CEO: *"khi nhấn phân quyền cho một NV xong nó vẫn cứ kẹt lại… đáng lẽ phải báo đã
 * xác nhận hoàn thành và màn hình quay về trạng thái lúc vào phân quyền để tiếp tục
 * phân quyền NV khác"* và *"tôi sợ phân quyền xong vẫn bị lủng, không đúng mã đơn vị,
 * không đúng cột thì nguy to."*                                                    */

test('‼ lưu xong ĐỌC LẠI TỪ MÁY CHỦ rồi so — không tin vào việc lệnh ghi không ném lỗi', () => {
  assert.match(page, /const fresh = await load\(\);/);
  assert.match(page, /const check = verifySavedGrants\(fresh, expected\);/);
  assert.match(page, /const expected = new Map\(pending\.map\(\(row\) => \[row\.empCode, grantSavePayload\(row\)\.columns\]\)\)/);
});

test('khớp ⇒ báo hoàn thành + QUAY VỀ danh sách NV để cấp tiếp', () => {
  assert.match(page, /Đã lưu và KIỂM LẠI TỪ MÁY CHỦ: đúng \$\{check\.checked\} nhân viên/);
  assert.match(page, /chọn người tiếp theo để cấp quyền/);
  assert.match(page, /setSelected\(''\);/);
});

test('‼ lệch ⇒ Ở LẠI màn đó, nêu ĐÍCH DANH lệch ở đâu, cấm dùng phân quyền đó', () => {
  assert.match(page, /ĐÃ LƯU NHƯNG KIỂM LẠI THẤY LỆCH/);
  assert.match(page, /cần "\$\{item\.wanted\}" nhưng máy chủ đang giữ "\$\{item\.got\}"/);
  assert.match(page, /KHÔNG dùng phân quyền này cho tới khi sửa xong/);
  // Lệch thì KHÔNG được quay về danh sách như thể xong việc.
  const saveBody = page.slice(page.indexOf('const save = async ()'), page.indexOf('const pending = panel ?'));
  const mismatchBranch = saveBody.slice(saveBody.indexOf('if (!check.ok)'), saveBody.indexOf('const who ='));
  assert.doesNotMatch(mismatchBranch, /setSelected\(''\)/);
});

test('không đọc lại được NV nào ⇒ coi là LỆCH, không lặng lẽ bỏ qua', () => {
  assert.match(model, /if \(!row\) \{ mismatches\.push\(\{ empCode: code, wanted: columnsKey\(wantedColumns\), got: '\(không đọc lại được\)' \}\); continue; \}/);
});

test('so sánh KHÔNG phụ thuộc thứ tự cột/nhóm — sắp xếp trước khi so', () => {
  assert.match(model, /const scopeKey = \(scope\) => \(Array\.isArray\(scope\) \? \[\.\.\.scope\]\.sort\(\)\.join\('\+'\) : ''\)/);
  assert.match(model, /\.sort\(\)\s*\n\s*\.join\('\|'\)/);
});
