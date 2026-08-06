const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'Overview.jsx'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'web', 'src', 'styles.css'), 'utf8');

test('overview executive filters are collapsed by default and expose an accessible toggle', () => {
  assert.match(PAGE, /const \[expanded, setExpanded\] = useState\(false\);/);
  assert.match(PAGE, /aria-expanded=\{expanded\}/);
  assert.match(PAGE, /aria-controls="overview-filter-panel"/);
  assert.match(PAGE, /\{expanded \? 'Thu gọn' : 'Mở bộ lọc'\}/);
  assert.match(PAGE, /<div id="overview-filter-panel" hidden=\{!expanded\}>/);
});

test('collapsed filter header stays compact while active-filter count and clear remain visible', () => {
  assert.match(PAGE, /Đang áp dụng \{activeCount\} bộ lọc/);
  assert.match(PAGE, /title="Mở bộ lọc để xem chi tiết"/);
  assert.match(PAGE, /Xoá lọc \(\{activeCount\}\)/);
  assert.match(CSS, /\.overview-filter-head \{[^}]*margin-bottom: 0;/s);
  assert.match(CSS, /\.overview-filter-head\.expanded \{ margin-bottom: 9px; \}/);
  assert.match(CSS, /@media \(max-width: 700px\)[\s\S]*\.overview-filter-head \{[^}]*flex-wrap: wrap;/);
});
