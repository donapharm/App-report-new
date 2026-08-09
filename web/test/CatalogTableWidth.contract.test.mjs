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

test('bảng có bề rộng nền cố định rồi cuộn — không ép vừa 100% màn, cũng không nở theo chữ', () => {
  assert.match(css, /\.catalog-table-products \{ min-width:1400px; table-layout:auto; \}/);
  // Ép width:100% + min-width:0 chính là thứ bóp dẹp cột cuối trên laptop.
  assert.doesNotMatch(css, /\.catalog-table-products \{ width:100%; min-width:0; \}/);
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

/* ── Nguyên tắc bề rộng cột + số dòng/ô (CEO chốt 09/08) ──────────────────── */

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');

test('KHÔNG dùng max-content — chính nó làm ô hoạt chất kéo dài gần hết màn', () => {
  // CEO chụp màn 09/08: cột "Hoạt chất + Hàm lượng" chiếm gần hết chiều ngang vì
  // max-content = "rộng bằng dòng chữ dài nhất, không xuống dòng".
  assert.doesNotMatch(css, /\.catalog-table-products[^{]*\{[^}]*min-width:max-content/);
});

test('bề rộng gắn theo LOẠI NỘI DUNG bằng class, mỗi loại có min VÀ max', () => {
  // CEO: "các cột nên có nguyên tắc về độ rộng để tránh cột dư quá, cột thiếu quá".
  assert.match(css, /\.catalog-table-products th\.catalog-col-text[^{]*\{ *\n? *min-width:150px; max-width:260px/);
  assert.match(css, /th\.catalog-money[^{]*\{\s*\n?\s*min-width:82px; max-width:120px; white-space:nowrap/);
  assert.match(css, /\.catalog-table-products th, \.catalog-table-products td \{ min-width:64px; max-width:150px; \}/);
});

test('cột chữ dài tràn thì XUỐNG DÒNG rồi cắt, không kéo ngang bảng', () => {
  assert.match(css, /-webkit-line-clamp:var\(--catalog-cell-lines,3\)/);
  assert.match(css, /overflow-wrap:anywhere/);
  // Hai cột chữ dài phải được gắn class ở CẢ th lẫn td, CẢ hai bảng.
  assert.match(page, /<th className="catalog-col-text">Tên thuốc<\/th><th className="catalog-col-text">Hoạt chất \+ Hàm lượng<\/th>/);
  assert.match(page, /<PreviewCell className="catalog-col-text" value=\{ingredientText\}/);
});

test('CEO chọn được 1/2/3 dòng trong một ô, và app nhớ lựa chọn', () => {
  assert.match(page, /<option value=\{1\}>1 dòng<\/option>/);
  assert.match(page, /<option value=\{3\}>3 dòng<\/option>/);
  assert.match(page, /localStorage\.setItem\(CELL_LINES_KEY/);
  // Truyền xuống bảng bằng biến CSS, không nhân bản luật ở nhiều nơi.
  assert.match(page, /style=\{\{ '--catalog-cell-lines': cellLines \}\}/);
  // Cả hai bảng (CEO + NV) đều có nút chọn.
  assert.equal((page.match(/<CellLinesPicker lines=\{cellLines\}/g) || []).length, 2);
});

test('nhãn "Từ kỳ" nói rõ là kỳ BẮT ĐẦU phụ trách — CEO tưởng là kỳ đang xem', () => {
  assert.match(page, /Kỳ nhân viên BẮT ĐẦU phụ trách cặp này — không phải kỳ đang xem/);
  assert.match(page, /Phụ trách từ kỳ/);
});
