/**
 * ENDPOINT % CHI PHÍ CHO DANH MỤC QL — ba lớp lọc phải còn nguyên
 * (SPEC_CATALOG_COST_COLUMNS.md · CEO chốt 06/08/2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
const at = SOURCE.indexOf("router.get('/catalog-management/cost-rates'");
assert.ok(at >= 0, 'không tìm thấy route cost-rates');
const BODY = SOURCE.slice(at, SOURCE.indexOf("router.get('/catalog-management/cost-columns/my-grant'"));

test('lớp ①: nhân viên chỉ hỏi được sổ của chính mình', () => {
  assert.match(BODY, /employeeCost\.resolveScopedEmployee\(\{[\s\S]*?scope: auth\.scopeOf\(req\.session\)/);
});

test('lớp ②: chỉ trả cột CEO đã cấp, và chỉ trong whitelist hợp đồng', () => {
  assert.match(BODY, /catalogCostColumnGrants\.isAllowedColumn/);
  assert.match(BODY, /catalogCostColumnGrants\.visibleColumns/);
  assert.match(BODY, /reason: 'NO_COLUMN_GRANTED'/);
});

test('lớp ③: đơn vị ngoài phạm vi bị loại khỏi kết quả', () => {
  assert.match(BODY, /!isCeo && !catalogCostColumnGrants\.unitInScope\(grant, unitCode\)/);
});

test('chưa được cấp gì thì DỪNG SỚM — không gọi DataHub, không tốn truy vấn', () => {
  const earlyExit = BODY.indexOf("reason: 'NOT_GRANTED'");
  const dataHubCall = BODY.indexOf('employeeCost.getForSession');
  assert.ok(earlyExit >= 0 && dataHubCall > earlyExit, 'phải thoát trước khi gọi nguồn chi phí');
});

test('thiếu % ⇒ null, TUYỆT ĐỐI không suy 0%', () => {
  assert.match(BODY, /raw == null \|\| raw === '' \|\| !Number\.isFinite\(Number\(raw\)\)\s*\?\s*null/);
  assert.match(BODY, /TUYỆT ĐỐI không suy 0%/);
});

test('route KHÔNG tự tính lại %; cờ nguồn kẹt được truyền thẳng ra màn hình', () => {
  // Không có phép nhân/chia nào trên giá trị % — số là của DataHub.
  const rateBlock = BODY.slice(BODY.indexOf('const rates = {}'), BODY.indexOf('pairs.push'));
  assert.doesNotMatch(rateBlock, /[*/]\s*\d|\d\s*[*/]/, 'không được nhân/chia lại tỷ lệ');
  assert.match(BODY, /rateStale/);
});

test('% đi đường riêng, không chui vào payload danh mục (catalog chặn C32–C47)', () => {
  const catalogRoute = SOURCE.slice(SOURCE.indexOf("router.get('/catalog-management'"));
  const firstLine = catalogRoute.slice(0, catalogRoute.indexOf('\n'));
  assert.doesNotMatch(firstLine, /cost-rates/);
  assert.match(BODY, /chặn cứng mọi trường C32–C47|CATALOG|catalogManagement/);
});
