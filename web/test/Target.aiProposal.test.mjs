import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// ‼ 04/08/2026 — Gate 1 của bot bắt được: bản trước dùng `aiRows`/`setAiRows`
// nhưng KHÔNG khai báo state ⇒ bấm "Tạo đề xuất AI" là crash trang Target, mà
// build vẫn xanh vì lỗi chỉ xảy ra lúc chạy. Test này chặn đúng lỗi đó.
const source = fs.readFileSync(new URL('../src/pages/Target.jsx', import.meta.url), 'utf8');

test('mọi ký hiệu của khối AI đề xuất target đều được khai báo', () => {
  for (const symbol of ['aiRows', 'setAiRows', 'aiRow', 'setAiRow', 'aiSelected', 'aiInvalidCount', 'aiEditedCount']) {
    const declared = source.includes(`const [${symbol}`) || source.includes(`const ${symbol} =`)
      || source.includes(`, ${symbol}] = useState`);
    assert.ok(declared, `thiếu khai báo \`${symbol}\``);
  }
});

test('AI đề xuất target phải hiện HẾT nhân viên, không cắt bớt', () => {
  // CEO 04/08: bản cũ `slice(0, 8)` chỉ hiện 8 người nhưng nút vẫn ghi target cho
  // cả đội — CEO không nhìn thấy phần còn lại mà số vẫn bị ghi.
  assert.doesNotMatch(source, /ai\.items\.slice\(/, 'cấm cắt bớt danh sách NV trong đề xuất AI');
  assert.match(source, /ai\.items\.map\(/, 'phải render toàn bộ ai.items');
});

test('cho chọn và sửa từng nhân viên, nút ghi rõ áp cho bao nhiêu người', () => {
  assert.match(source, /type="checkbox"[\s\S]*setAiRow\(r\.emp_code, \{ on:/, 'thiếu ô tích chọn từng NV');
  assert.match(source, /setAiRow\(r\.emp_code, \{ target:/, 'thiếu ô sửa target từng NV');
  assert.match(source, /Áp dụng \{aiSelected\.length\}\/\{ai\.items\.length\} NV/, 'nút phải ghi rõ số NV được áp');
});
