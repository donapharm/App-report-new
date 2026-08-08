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

test('cascade cuối cùng vẫn là auto/max-content — không có rule phía sau ghi đè về fixed', () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = [...withoutComments.matchAll(/\.catalog-table-products\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(declarations.length > 0, 'phải có rule layout cho bảng danh mục');
  assert.match(declarations.at(-1), /min-width\s*:\s*max-content/);
  assert.match(declarations.at(-1), /table-layout\s*:\s*auto/);
  for (const declaration of declarations) {
    assert.doesNotMatch(declaration, /table-layout\s*:\s*fixed/, 'không rule nào được ghi đè về fixed');
    assert.doesNotMatch(declaration, /min-width\s*:\s*1320px/, 'không giữ min-width cứng của layout 13 cột cũ');
  }
  // Ép width:100% + min-width:0 chính là thứ bóp dẹp cột cuối trên laptop.
  assert.doesNotMatch(withoutComments, /\.catalog-table-products\s*\{[^}]*width\s*:\s*100%[^}]*min-width\s*:\s*0/);
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
