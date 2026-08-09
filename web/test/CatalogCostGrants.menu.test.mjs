import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('menu CHỈ hiện với CEO khi dữ liệu đúng kỳ, lấy danh tính từ backend chứ không suy từ vai admin', () => {
  assert.match(page, /const isCeo = !!me\?\.is_ceo;/);
  assert.match(page, /\{isCeo && data && !actionsLocked && <CostColumnGrantsPanel/);
  assert.match(page, /const actionsLocked = !!loadingPeriod \|\| periodMismatch/,
    'khi đang tải/giữ bảng kỳ cũ phải ẩn thao tác cấp quyền để không trộn kỳ');
  // Suy từ role/isAdmin là sai: CEO thật trên PROD mang role 'admin', và admin
  // thường KHÔNG được sửa phân quyền này.
  assert.doesNotMatch(page, /isCeo\s*=\s*[^;]*isAdmin/);
});

test('ẩn nút không phải lớp bảo vệ — backend vẫn chặn độc lập bằng requireCeo', () => {
  assert.match(page, /Backend chặn độc lập bằng requireCeo/);
  const at = routes.indexOf("router.put('/catalog-management/cost-columns/grants/:empCode'");
  assert.match(routes.slice(at, routes.indexOf('\n', at)), /auth\.requireCeo/);
});

test('menu nói rõ mặc định TẮT và nhóm theo MÃ số, không để CEO hiểu nhầm theo loại đơn vị', () => {
  assert.match(page, /không thấy cột % nào/i);
  assert.match(page, /NHÓM MÃ đơn vị.*001 · 033 · 120/s);
  assert.doesNotMatch(page, /NHÓM đơn vị<\/b> \(BV · TTYT · PKĐK/);
});

test('chỉ lưu những dòng CEO thực sự đổi; lưu hỏng thì giữ nguyên thay đổi chưa lưu', () => {
  assert.match(page, /dirtyRows\(panel\)/);
  assert.match(page, /api\.catalogCostGrantSave\(row\.empCode, grantSavePayload\(row\)\)/);
  assert.match(page, /các dòng chưa lưu vẫn còn nguyên/);
});

test('menu phân quyền KHÔNG phân biệt cột nào — cấp cột nào thấy cột đó (CEO 08/08)', () => {
  // Nhãn "chỉ xem" cũ là rò rỉ phân biệt NỘI BỘ (C38/C42 không nằm trong công thức
  // tính tiền) vào chỗ nó không liên quan. CEO: "bản chất các cột này chức năng đều
  // giống nhau". Phân biệt đó vẫn giữ ở tầng cấu hình + test phía server.
  assert.doesNotMatch(page, /chỉ xem/);
  assert.doesNotMatch(page, /catalog-col-viewonly/);
});

test('bảng ma trận nhét-trong-ô đã BỎ — không quay lại thiết kế cũ (CEO 09/08)', () => {
  // CEO: "tích vào từng cột như vậy và chỉ hiển thị mục rất nhỏ và tóm gọn không thể
  // phân quyền chi tiết và đúng hết được đâu."
  assert.doesNotMatch(page, /ColumnGroupScope/, 'popup nhỏ trong ô bảng đã bỏ hẳn');
});

test('không lấy được danh sách cột thì NÓI RA, không hiện bảng rỗng như thể đã cấu hình xong', () => {
  assert.match(page, /Chưa lấy được danh sách cột % từ nguồn chi phí/);
});

test('client API trỏ đúng ba endpoint phân quyền + endpoint tỷ lệ', () => {
  assert.match(api, /catalogCostGrants: \(\) => req\('GET', '\/catalog-management\/cost-columns\/grants'\)/);
  assert.match(api, /catalogCostGrantSave: \(empCode, payload\) => req\('PUT'/);
  assert.match(api, /catalogCostMyGrant: \(\) => req\('GET', '\/catalog-management\/cost-columns\/my-grant'\)/);
  assert.match(api, /catalogCostRates: \(params = \{\}\) => req\('GET', '\/catalog-management\/cost-rates\?'/);
});

test('nhật ký thay đổi hiện ngay trong menu — ai đổi gì cho ai', () => {
  assert.match(page, /Nhật ký thay đổi/);
  assert.match(page, /item\.actor/);
  assert.match(page, /item\.empCode/);
});

/* ── Màn chi tiết theo từng NV (CEO yêu cầu 09/08) ─────────────────────────── */

test('hai bước: danh sách NV → chọn người mới mở lưới chi tiết', () => {
  // CEO 09/08: bảng ma trận 21 NV × 7 cột nhét vào ô nhỏ không làm chi tiết được.
  assert.match(page, /const \[selected, setSelected\] = useState\(''\)/);
  assert.match(page, /\{!selected \? <>/);
  assert.match(page, /<EmployeeGrantDetail/);
  assert.match(page, /onClick=\{\(\) => setSelected\(row\.empCode\)\}/);
  assert.match(page, /onBack=\{\(\) => setSelected\(''\)\}/);
});

test('lưới chi tiết: HÀNG = nhóm mã đơn vị, CỘT = C36…C45, tick ở cấp nhóm', () => {
  const detail = page.slice(page.indexOf('function EmployeeGrantDetail'), page.indexOf('MENU PHÂN QUYỀN CỘT % CHI PHÍ'));
  assert.match(detail, /<th>Nhóm mã đơn vị<\/th>/);
  assert.match(detail, /row\.availableGroups\.map\(\(group\)/);
  assert.match(detail, /toggleColumnGroup\(cur, row\.empCode, column\.key, group\.key\)/);
  // Mỗi hàng liệt kê các mã bên trong — CEO nhìn thấy đang mở cho đơn vị nào.
  assert.match(detail, /group\.units\.join\(' · '\)/);
});

test('thao tác nhanh: hàng "Mọi nhóm" bật cả cột, nút cuối hàng bật cả hàng', () => {
  const detail = page.slice(page.indexOf('function EmployeeGrantDetail'), page.indexOf('MENU PHÂN QUYỀN CỘT % CHI PHÍ'));
  assert.match(detail, /Mọi nhóm<\/b><small>gồm cả nhóm mới sau này<\/small>/);
  assert.match(detail, /setColumnAllGroups\(cur, row\.empCode, column\.key, e\.target\.checked\)/);
  assert.match(detail, /toggleGroupAllColumns\(cur, row\.empCode, group\.key, keys, !rowOn\)/);
  assert.match(detail, /Tắt hết cho NV này/);
});

test('thao tác nhanh: mỗi CỘT có nút bật/tắt cả cột ngay dưới tên cột (CEO 09/08)', () => {
  // CEO: "cho chọn hết tất cả theo cột, ví dụ DN001 chọn hết tất cả cột C41, thay vì
  // phải đi tích từng dòng một." Việc này vốn làm được bằng ô tích hàng "Mọi nhóm",
  // nhưng nhãn đó không đọc ra thành thao tác nên không ai thấy.
  const detail = page.slice(page.indexOf('function EmployeeGrantDetail'), page.indexOf('MENU PHÂN QUYỀN CỘT % CHI PHÍ'));
  assert.match(detail, /catalog-grant-colbtn/);
  assert.match(detail, /columnOn \? 'Bỏ cả cột' : 'Chọn cả cột'/);
  // Dùng LẠI đúng hàm của ô tích "Mọi nhóm" — hai lối vào, một nguồn sự thật.
  assert.match(detail, /setColumnAllGroups\(cur, row\.empCode, column\.key, !columnOn\)/);
  assert.match(detail, /const columnOn = isColumnAllGroups\(row, column\.key\)/);
});

test('nút cả cột nói rõ nó phủ cả nhóm mới sau này — không để CEO tưởng chỉ 114 nhóm hiện có', () => {
  const detail = page.slice(page.indexOf('function EmployeeGrantDetail'), page.indexOf('MENU PHÂN QUYỀN CỘT % CHI PHÍ'));
  assert.match(detail, /gồm cả nhóm mới sau này`/);
});

test('đơn vị chưa nhận diện được nhóm vẫn được NÓI RA trong màn chi tiết', () => {
  const detail = page.slice(page.indexOf('function EmployeeGrantDetail'), page.indexOf('MENU PHÂN QUYỀN CỘT % CHI PHÍ'));
  assert.match(detail, /row\.ungroupedUnits\.length/);
  assert.match(detail, /chỉ hàng <b>"Mọi nhóm"<\/b> mới phủ tới/);
  // NV không có nhóm nào thì nói thẳng, không hiện lưới rỗng khó hiểu.
  assert.match(detail, /chưa có đơn vị nào nhận diện được nhóm/);
});
