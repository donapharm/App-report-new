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

test('DANH SÁCH CỘT lấy từ hợp đồng tại máy, KHÔNG hỏi DataHub theo mã người đăng nhập', () => {
  // Lỗi CEO bắt được 08/08: bản đầu hỏi DataHub theo mã đang đăng nhập ⇒ tài khoản
  // CEO không có sổ chi phí nên luôn `not_configured`, menu phân quyền vĩnh viễn
  // báo "chưa lấy được cột" dù nguồn khoẻ.
  assert.match(BODY, /employeeCostTemplates\.resolveTemplate\(empCode \|\| ''\)/);
  assert.match(BODY, /template\.costColumns/);
  const columnsAt = BODY.indexOf('const sourceColumns');
  const fetchAt = BODY.indexOf('employeeCost.getForSession');
  assert.ok(columnsAt >= 0 && fetchAt > columnsAt, 'cột phải dựng TRƯỚC khi gọi nguồn chi phí');
});

test('CEO mở menu vẫn nhận đủ cột để cấp quyền dù nguồn chi phí đang chết', () => {
  assert.match(BODY, /if \(!empCode \|\| empCode === 'CEO'\)/);
  assert.match(BODY, /reason: 'NO_EMPLOYEE_SCOPE'/);
  const guardAt = BODY.indexOf("empCode === 'CEO'");
  const fetchAt = BODY.indexOf('employeeCost.getForSession');
  assert.ok(guardAt >= 0 && fetchAt > guardAt, 'phải thoát trước khi gọi nguồn cho mã không có sổ chi phí');
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
