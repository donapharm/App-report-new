import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAiTargetInput } from '../src/targetAiModel.js';

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

test('input target AI fail-closed, không biến ô trống/chữ thành số 0', () => {
  for (const raw of ['', '   ', 'abc', '12abc34', '-1', '1e9', '1.2', '1,00,000', '1.000,000']) {
    assert.deepEqual(parseAiTargetInput(raw), { target: null, valid: false }, `phải chặn: ${JSON.stringify(raw)}`);
  }
});

test('input target AI nhận số nguyên và cách phân nhóm nghìn nhất quán', () => {
  for (const [raw, target] of [
    ['0', 0],
    ['1000000000', 1_000_000_000],
    ['1.000.000.000', 1_000_000_000],
    ['1,000,000,000', 1_000_000_000],
    ['1 000 000 000', 1_000_000_000],
    ['1\u00a0000\u00a0000\u00a0000', 1_000_000_000],
  ]) {
    assert.deepEqual(parseAiTargetInput(raw), { target, valid: true }, `phải nhận: ${JSON.stringify(raw)}`);
  }
});

test('UI dùng cùng strict parser để báo lỗi và chặn Apply', () => {
  assert.doesNotMatch(source, /Number\(String\(row\.target\)\.replace/, 'cấm parser permissive cũ ở từng dòng');
  assert.match(source, /const parsed = parseAiTargetInput\(row\.target\);[\s\S]*const invalid = row\.on && !parsed\.valid;/);
  assert.match(source, /disabled=\{busy \|\| !aiSelected\.length \|\| !!aiInvalidCount\}/);
});

test('refresh đề xuất phải xoá proposal cũ trước khi gọi API', () => {
  const block = source.slice(source.indexOf('async function proposeAi()'), source.indexOf('const aiRow ='));
  assert.match(block, /setAi\(null\)/);
  assert.match(block, /setAiRows\(\{\}\)/);
  assert.ok(block.indexOf('setAi(null)') < block.indexOf('await api.adminTargetAiPropose()'));
});


test('xác nhận cuối phải cảnh báo rõ số dòng target bằng 0', () => {
  assert.match(source, /const aiZeroCount = aiSelected\.filter\(\(item\) => item\.valid && item\.target === 0\)\.length/);
  assert.match(source, /⚠ \${aiZeroCount} dòng target = 0/);
  assert.match(source, /confirm\(`Áp target kỳ \${ai\.next_ky}/);
});
