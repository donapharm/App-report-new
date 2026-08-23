import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// CEO 23/08 19:42: vùng đầu trang Chi phí chiếm quá nửa màn hình. Hợp đồng nén
// desktop: bộ lọc dồn ít hàng, hai dải trạng thái thành thanh mỏng nằm ngang.
// Đo thật bằng Chromium 1720/1280/1000px trước khi khoá các quy tắc này.

test('desktop pulls the period chips onto the same row as the employee select', () => {
  assert.match(styles, /\.employee-cost-month-quick \{ flex-basis:auto; \}/);
  assert.match(styles, /\.employee-cost-heading > div:first-child \{ max-width:400px; flex-shrink:0; \}/);
  assert.match(styles, /\.employee-cost-filters label:first-child \{ min-width:0; display:flex; align-items:center; gap:7px; \}/);
});

test('pinned-rate notice becomes a slim muted strip', () => {
  assert.match(styles, /\.employee-cost-pinned-notice \{ padding:5px 12px; font-size:12px; color:var\(--muted\); \}/);
});

test('snapshot card lays out horizontally with the button pinned right', () => {
  assert.match(styles, /\.employee-cost-snapshot-status \{ display:flex; align-items:center; justify-content:space-between; gap:14px; \}/);
  assert.match(styles, /\.employee-cost-snapshot-status > \.btn \{ flex-shrink:0; \}/);
  // small (thông báo/lỗi) phải xuống dòng riêng, không chen ngang tiêu đề
  assert.match(styles, /\.employee-cost-snapshot-status > div small \{ flex-basis:100%; \}/);
});

test('compaction is desktop-only so mobile keeps its vertical layout', () => {
  const at = styles.indexOf('.employee-cost-month-quick { flex-basis:auto; }');
  const media = styles.lastIndexOf('@media (min-width: 900px)', at);
  assert.ok(media !== -1 && at - media < 1600, 'compact rules must live inside the desktop media query');
});

// CEO 23/08 19:46: cuộn bảng danh mục là mất hàng tiêu đề. Sticky từng bị tắt vì
// khung overflow-y:hidden nuốt sticky; hợp đồng mới: khung bảng tự cuộn dọc và
// tiêu đề ghim ở mép trên khung — trên CẢ BA dải màn desktop.
test('catalog table headers stay pinned while the table body scrolls', () => {
  const hits = styles.match(/overflow-y:auto; max-height:calc\(100vh - 150px\)/g) || [];
  assert.ok(hits.length >= 2, 'wide desktop ranges must scroll vertically inside the table box');
  assert.match(styles, /\.catalog-table-card \.table-scroll \{ max-width:100%; overflow-x:auto; overflow-y:auto; max-height:calc\(100vh - 150px\); \}/);
  assert.equal((styles.match(/\.catalog-table-products thead th \{ position:sticky; top:0; \}/g) || []).length, 3);
  assert.doesNotMatch(styles, /\.catalog-table-products thead th \{ position:static; \}/);
});
