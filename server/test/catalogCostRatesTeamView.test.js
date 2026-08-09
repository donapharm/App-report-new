/**
 * ‼ CEO LÀ NGƯỜI DUY NHẤT THẤY TOÀN "—" TRONG BẢNG DANH MỤC (CEO bắt 09/08/2026)
 *
 * Ngay sau khi bấm đồng bộ thành công "21/21 NV · 27.719 cặp", mọi ô % ở bảng danh
 * mục vẫn là "—". Gốc: đường % gọi `getForSession` theo MÃ NGƯỜI ĐANG ĐĂNG NHẬP;
 * CEO là tài khoản quản trị, không có sổ chi phí riêng ⇒ route thoát sớm với
 * `pairs: []`. Đúng người được phép xem tất cả lại không thấy gì.
 *
 * Nay CEO đọc % từ KHO CỤC BỘ — thứ chính nút Đồng bộ vừa ghi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routes = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../../web/src/pages/CatalogManagement.jsx'), 'utf8');
const block = routes.slice(routes.indexOf('function localTeamRatePairs('), routes.indexOf("router.get('/catalog-management/cost-rates/local-status'"));

test('CEO lấy % toàn đội từ KHO CỤC BỘ, không phụ thuộc DataHub còn sống', () => {
  assert.match(block, /persist\.load\(costRatesSync\.FILE, \{\}\)\[String\(month\)\]/);
  assert.match(block, /costAmounts\.pairRates\(entry\.employees\[empCode\], columnKeys\)/);
  // Không được quay lại kiểu hỏi DataHub theo mã người đăng nhập cho nhánh CEO.
  assert.doesNotMatch(block.slice(0, block.indexOf('router.get')), /getForSession/);
});

test('‼ hai NV khai lệch nhau trên cùng một cặp ⇒ null, KHÔNG lấy bừa một bên', () => {
  assert.match(block, /if \(current\.percents\[columnKey\] !== incoming\) current\.percents\[columnKey\] = null/);
  assert.match(block, /rate\.conflict \? null :/);
});

test('kho chưa đồng bộ thì nói ĐÚNG lý do rỗng, không lẫn với "menu không cần số"', () => {
  assert.match(block, /reason: wantPairs && isCeo \? 'LOCAL_RATES_EMPTY' : 'NO_EMPLOYEE_SCOPE'/);
});

test('chỉ màn cần SỐ mới gửi pairs=1 — menu phân quyền không tải hàng vạn cặp', () => {
  assert.match(block, /const wantPairs = String\(req\.query\.pairs \|\| ''\) === '1'/);
  assert.match(page, /api\.catalogCostRates\(period \? \{ period, pairs: 1 \} : \{ pairs: 1 \}\)/);
  // Menu phân quyền gọi không cờ.
  assert.match(page, /api\.catalogCostGrants\(\), api\.catalogCostRates\(\), api\.catalogCostUnitGroups\(distinctUnits\)/);
});

test('nhánh CEO KHÔNG áp hàng rào quyền cột/nhóm — CEO xem tất cả', () => {
  assert.match(block, /CEO thấy mọi cột, mọi nhóm/);
  // Nhưng nhánh NV bên dưới vẫn giữ nguyên hai lớp chặn.
  const empBranch = routes.slice(routes.indexOf('const matchColumns = columns.filter'), routes.indexOf("router.post('/catalog-management/cost-rates/sync'"));
  assert.match(empBranch, /!isCeo && !catalogCostColumnGrants\.unitInScope\(grant, unitCode\)/);
  assert.match(empBranch, /!isCeo && !catalogCostColumnGrants\.columnScopeAllows\(grant, column\.key, unitCode\)/);
});
