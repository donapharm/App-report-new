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

// Khối chip + câu "Target không phân bổ theo lát cắt này" phải nằm NGOÀI panel thu gọn,
// nếu không thì bấm "Thu gọn" là mất cảnh báo trong lúc bộ lọc vẫn đang áp dụng.
function indexOfPanelClose(source) {
  const open = source.indexOf('<div id="overview-filter-panel"');
  if (open < 0) throw new Error('không tìm thấy panel bộ lọc');
  let depth = 0;
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = open;
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return m.index;
  }
  throw new Error('panel bộ lọc không có thẻ đóng cân bằng');
}

test('active-filter note stays visible when the panel is collapsed', () => {
  assert.ok(PAGE.indexOf('overview-filter-note') > indexOfPanelClose(PAGE));
});
