import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('KHÔNG khai bề rộng theo VỊ TRÍ cột cho bảng danh mục (số cột đổi theo quyền)', () => {
  // Lỗi CEO chụp 08/08: khai cứng width cho đúng 13 cột, cộng vừa khít min-width
  // 1306px. Thêm cột % ⇒ các cột sau không còn px nào, chữ tiêu đề chồng lên nhau.
  // Số cột thay đổi theo quyền từng người (0–7 cột %) nên đánh số vị trí là sai gốc.
  const positional = css.match(/\.catalog-table-products th:nth-child\(\d+\)[^{]*\{[^}]*(?<![-\w])width:/g) || [];
  assert.deepEqual(positional, [], 'không được khai width theo nth-child nữa');
  const employeePositional = css.match(/\.catalog-table-employee th:nth-child\(\d+\)[^{]*\{[^}]*(?<![-\w])width:/g) || [];
  assert.deepEqual(employeePositional, [], 'bảng NV cũng vậy — nó lệch một cột so với bảng CEO');
});

test('bảng tự giãn theo nội dung, không bị ép vừa 100% màn', () => {
  assert.match(css, /\.catalog-table-products \{ min-width:max-content; table-layout:auto; \}/);
  // Ép width:100% + min-width:0 chính là thứ bóp dẹp cột cuối trên laptop.
  assert.doesNotMatch(css, /\.catalog-table-products \{ width:100%; min-width:0; \}/);
});

test('cột số/tiền/% đủ rộng cho tiêu đề "C36 (%)"', () => {
  assert.match(css, /\.catalog-table-products th\.catalog-money \{ min-width:82px; \}/);
});

test('mọi cỡ màn desktop đều có thanh kéo ngang — cấm cắt cụt cột lặng lẽ', () => {
  for (const range of ['(min-width:900px) and (max-width:1279px)', '(min-width:1280px) and (max-width:1499px)', '(min-width:1500px)']) {
    const at = css.indexOf(`@media ${range}`);
    assert.ok(at >= 0, `thiếu dải ${range}`);
    const block = css.slice(at, css.indexOf('\n}', at));
    assert.match(block, /overflow-x:auto/, `${range} phải cuộn ngang được`);
    assert.doesNotMatch(block, /overflow-x:clip|overflow:visible/, `${range} không được cắt cụt`);
  }
});
