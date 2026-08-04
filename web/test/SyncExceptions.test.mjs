import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Màn "Chưa đồng bộ" — CEO 29/07. Kiểm những điều KHÔNG được phép sai.
const source = fs.readFileSync(new URL('../src/pages/SyncExceptions.jsx', import.meta.url), 'utf8');

test('‼ "chưa chạy phân loại" phải nói thẳng, KHÔNG được để tưởng sạch', () => {
  assert.match(source, /!data\?\.ran/);
  assert.match(source, /Kỳ này chưa chạy phân loại/);
  assert.match(source, /không phải.*<\/b> là "không có dòng nào bị loại"/s);
});

test('‼ không cân thì báo đỏ và nêu ĐÚNG số lệch', () => {
  assert.match(source, /KHÔNG CÂN — có dòng rơi ở chỗ chưa ai khai báo/);
  assert.match(source, /money\(totals\.amountDiff\)/);
  assert.match(source, /totals\.rowDiff/);
});

test('thiếu căn cứ thì KHÔNG kết luận đã cân', () => {
  assert.match(source, /report\.balanced === null/);
  assert.match(source, /Không kết luận là đã cân/);
});

test('mã lý do lạ phải hiện ra', () => {
  assert.match(source, /report\.unknownCodes\.length/);
  assert.match(source, /chưa khai báo/);
});

test('mỗi dòng và mỗi lý do đều kèm AI XỬ LÝ và LÀM GÌ', () => {
  assert.match(source, /<th>Ai xử lý<\/th><th>Làm gì<\/th>/);
  assert.match(source, /\{row\.owner\} · \{row\.action\}/);
});

test('tách rõ nhóm "vào đủ tiền nhưng thiếu thông tin" — nhóm nguy hiểm nhất', () => {
  assert.match(source, /incomplete: \{ text: 'Vào đủ tiền nhưng THIẾU THÔNG TIN'/);
  assert.match(source, /nhìn tổng thì đúng, lọc ra thì mất/);
});

test('danh sách bị cắt bớt phải nói ra', () => {
  assert.match(source, /data\.truncated/);
  assert.match(source, /bảng chi tiết chưa đủ dòng/);
});
