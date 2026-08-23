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

test('open panels escape the grid to full width', () => {
  assert.match(catalog, /catalog-rates-panel\$\{open \? ' is-open' : ''\}/);
  assert.match(catalog, /catalog-grants\$\{open \? ' is-open' : ''\}/);
  assert.match(styles, /\.catalog-actions-row \{ display:grid; grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.catalog-actions-row > \.card\.is-open \{ grid-column:1 \/ -1; \}/);
});

test('desktop-only grid keeps mobile as a single column', () => {
  const media = styles.indexOf('.catalog-actions-row');
  const block = styles.lastIndexOf('@media (min-width: 900px)', media);
  assert.ok(block !== -1 && media - block < 400, 'actions row grid must sit inside the desktop media query');
});

test('long explanations moved into the usage guide, headers stay one line', () => {
  assert.match(catalog, /Phân quyền cột %:<\/b> bật từng cột và giới hạn theo <b>NHÓM MÃ đơn vị<\/b>/);
  assert.doesNotMatch(catalog, /<p>Chỉ CEO đặt được\. Mặc định mọi nhân viên/);
});
