import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = fs.readFileSync(path.join(here, '../src/pages/CatalogManagement.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(here, '../src/styles.css'), 'utf8');

// CEO 23/08 09:31: ba thẻ hành động chồng dọc chiếm 2/3 màn hình, bảng danh mục bị
// đẩy khỏi tầm mắt. Hợp đồng: desktop xếp NGANG, thẻ đang mở chiếm cả hàng, mô tả
// dài nằm trong Hướng dẫn sử dụng chứ không chiếm đầu trang.

test('catalog action cards live inside one actions row', () => {
  assert.match(catalog, /<div className="catalog-actions-row">/);
  const row = catalog.slice(catalog.indexOf('catalog-actions-row'));
  const closing = row.indexOf('</div>', row.indexOf('CostColumnGrantsPanel'));
  const inside = row.slice(0, closing);
  assert.match(inside, /CostRatesSyncCard/);
  assert.match(inside, /CostRatesTablePanel/);
  assert.match(inside, /CostColumnGrantsPanel/);
});

// CEO 23/08 15:53: lưới 3 cột làm thẻ thứ TƯ rơi xuống một mình. Số thẻ đổi theo
// quyền nên mọi lưới cố định đều có lúc thừa ô rỗng — hợp đồng nay là chia đều.
test('every action card shares one row whatever the card count', () => {
  assert.match(styles, /\.catalog-actions-row \{ display:flex; flex-wrap:wrap; gap:10px; align-items:stretch; \}/);
  assert.match(styles, /\.catalog-actions-row > \.card \{ flex:1 1 200px; min-width:0; margin:0; \}/);
  assert.doesNotMatch(styles, /\.catalog-actions-row \{ display:grid/);
});

test('open panels take the whole row, native details included', () => {
  assert.match(catalog, /catalog-rates-panel\$\{open \? ' is-open' : ''\}/);
  assert.match(catalog, /catalog-grants\$\{open \? ' is-open' : ''\}/);
  assert.match(styles, /\.catalog-actions-row > details\.card\[open\] \{ flex-basis:100%; \}/);
});

test('buttons line up along the bottom edge instead of floating at each card height', () => {
  assert.match(styles, /\.catalog-grants-head > \.btn \{ margin-top:auto; \}/);
  assert.match(styles, /\.catalog-sync-card > \.catalog-sync-actions \{ margin-top:auto; \}/);
  // Thẻ 52 cột lúc đóng chỉ có một dòng summary — canh giữa cho khỏi rỗng hoác.
  assert.match(styles, /details\.card:not\(\[open\]\) \{ display:flex; flex-direction:column; justify-content:center; \}/);
});

test('desktop-only layout keeps mobile as a single column', () => {
  const media = styles.indexOf('.catalog-actions-row');
  const block = styles.lastIndexOf('@media (min-width: 900px)', media);
  assert.ok(block !== -1 && media - block < 1400, 'actions row layout must sit inside the desktop media query');
});

test('long explanations moved into the usage guide, headers stay one line', () => {
  assert.match(catalog, /Phân quyền cột %:<\/b> bật từng cột và giới hạn theo <b>NHÓM MÃ đơn vị<\/b>/);
  assert.doesNotMatch(catalog, /<p>Chỉ CEO đặt được\. Mặc định mọi nhân viên/);
});
