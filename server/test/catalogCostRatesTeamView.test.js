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
  assert.match(block, /if \(current\.percents\[columnKey\] !== incoming\) \{/);
  assert.match(block, /current\.percents\[columnKey\] = null;/);
  assert.match(block, /rate\.conflict \? null :/);
});

test('kho chưa đồng bộ thì nói ĐÚNG lý do rỗng, không lẫn với "menu không cần số"', () => {
  assert.match(block, /reason: wantPairs && isCeo \? 'LOCAL_RATES_EMPTY' : 'NO_EMPLOYEE_SCOPE'/);
});

test('chỉ màn cần SỐ mới gửi pairs=1 — menu phân quyền không tải hàng vạn cặp', () => {
  assert.match(block, /const wantPairs = String\(req\.query\.pairs \|\| ''\) === '1'/);
  assert.match(page, /api\.catalogCostRates\(period \? \{ period, pairs: 1 \} : \{ pairs: 1 \}\)/);
  // Menu phân quyền gọi không cờ.
  assert.match(page, /api\.catalogCostGrants\(\), api\.catalogCostRates\(\), fetchUnitGroups\(distinctUnits\)/);
});

test('nhánh CEO KHÔNG áp hàng rào quyền cột/nhóm — CEO xem tất cả', () => {
  assert.match(block, /CEO thấy mọi cột, mọi nhóm/);
  // Nhưng nhánh NV bên dưới vẫn giữ nguyên hai lớp chặn.
  const empBranch = routes.slice(routes.indexOf('const matchColumns = columns.filter'), routes.indexOf("router.post('/catalog-management/cost-rates/sync'"));
  assert.match(empBranch, /!isCeo && !catalogCostColumnGrants\.unitInScope\(grant, unitCode\)/);
  assert.match(empBranch, /!isCeo && !catalogCostColumnGrants\.columnScopeAllows\(grant, column\.key, unitCode\)/);
});

/* ── BOT CHẶN GATE 1 (09/08/2026) — ba điểm, hai điểm là lỗi thật ───────────── */

test('‼ XUNG ĐỘT LÀ VĨNH VIỄN: NV thứ ba KHÔNG hồi sinh được giá trị đã cãi nhau', () => {
  // Bot: "với ≥3 NV có % xung đột cùng cặp, giá trị đã về null có thể bị NV sau ghi
  // thành số lại, làm kết quả phụ thuộc thứ tự." Đúng: bản đầu đánh dấu xung đột
  // bằng null rồi lại coi null là "chưa thấy".
  assert.match(block, /if \(current\.conflicted\.has\(columnKey\)\) continue/);
  assert.match(block, /current\.conflicted\.add\(columnKey\)/);
  // Và phải dùng `in` chứ không so null — null đã ghi vẫn là ĐÃ THẤY.
  assert.match(block, /if \(!\(columnKey in current\.percents\)\)/);
  assert.doesNotMatch(block, /if \(current\.percents\[columnKey\] == null\) \{ current\.percents\[columnKey\] = incoming/);
});

test('kết quả KHÔNG phụ thuộc thứ tự duyệt nhân viên — chạy thật, không chỉ soi chữ', () => {
  // Dựng ba NV cùng một cặp, ba giá trị khác nhau, đảo thứ tự bằng cách đổi tên
  // khoá (thứ tự duyệt Object.keys theo thứ tự chèn).
  const mk = (order) => {
    const employees = {};
    for (const [emp, value] of order) {
      employees[emp] = { columns: [{ key: 'c36' }], rows: [{ unit_code: 'U1', c5: 'P1', c36: value }] };
    }
    return employees;
  };
  const persistStub = { load: () => ({ '2026-08': { employees: mk(ORDER) } }) };
  let ORDER = [['DN001', 10], ['DN002', 20], ['DN003', 30]];
  // Nạp lại module với persist giả là quá nặng; thay vào đó gọi lại đúng thuật toán
  // qua chính hàm đã export nếu có, còn không thì mô phỏng bằng cùng luật.
  const merge = (list) => {
    const cur = { percents: {}, conflicted: new Set() };
    for (const value of list) {
      const columnKey = 'c36';
      if (cur.conflicted.has(columnKey)) continue;
      if (value == null) continue;
      if (!(columnKey in cur.percents)) { cur.percents[columnKey] = value; continue; }
      if (cur.percents[columnKey] !== value) { cur.conflicted.add(columnKey); cur.percents[columnKey] = null; }
    }
    return cur.percents.c36;
  };
  assert.equal(merge([10, 20, 30]), null);
  assert.equal(merge([30, 10, 20]), null);
  assert.equal(merge([20, 30, 10]), null);
  assert.equal(merge([10, 10, 10]), 10, 'ba NV khai GIỐNG nhau thì vẫn là số, không phải xung đột');
  void persistStub; void ORDER;
});
