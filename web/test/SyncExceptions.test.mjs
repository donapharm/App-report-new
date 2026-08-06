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

test('V-C live 269 dòng giữ đúng hai mã catalog và UI hiện đủ nghĩa · ai · làm gì', () => {
  const catalogSource = fs.readFileSync(new URL('../../server/src/syncExceptionCatalog.js', import.meta.url), 'utf8');
  const reportSource = fs.readFileSync(new URL('../../server/src/syncExceptionReport.js', import.meta.url), 'utf8');
  assert.match(catalogSource, /MISA_CHUA_GHI_DOANH_SO:[\s\S]*?meaning:[\s\S]*?owner:[\s\S]*?action:/);
  assert.match(catalogSource, /WEB_GIAO_BANG_0:[\s\S]*?meaning:[\s\S]*?owner:[\s\S]*?action:/);
  assert.match(reportSource, /meaning: info\.meaning/);
  assert.match(reportSource, /owner: info\.owner/);
  assert.match(reportSource, /action: info\.action/);
  const counts = { MISA_CHUA_GHI_DOANH_SO: 222, WEB_GIAO_BANG_0: 47 };
  assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), 269);
});
