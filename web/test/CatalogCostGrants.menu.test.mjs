import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('menu CHỈ hiện với tài khoản CEO, lấy danh tính từ backend chứ không suy từ vai admin', () => {
  assert.match(page, /const isCeo = !!me\?\.is_ceo;/);
  assert.match(page, /\{isCeo && data && <CostColumnGrantsPanel/);
  // Suy từ role/isAdmin là sai: CEO thật trên PROD mang role 'admin', và admin
  // thường KHÔNG được sửa phân quyền này.
  assert.doesNotMatch(page, /isCeo\s*=\s*[^;]*isAdmin/);
});

test('ẩn nút không phải lớp bảo vệ — backend vẫn chặn độc lập bằng requireCeo', () => {
  assert.match(page, /Backend chặn độc lập bằng requireCeo/);
  const at = routes.indexOf("router.put('/catalog-management/cost-columns/grants/:empCode'");
  assert.match(routes.slice(at, routes.indexOf('\n', at)), /auth\.requireCeo/);
});

test('menu nói rõ mặc định là KHÔNG THẤY GÌ, không để CEO tự đoán', () => {
  assert.match(page, /không thấy cột % nào/i);
});

test('chỉ lưu những dòng CEO thực sự đổi; lưu hỏng thì giữ nguyên thay đổi chưa lưu', () => {
  assert.match(page, /dirtyRows\(panel\)/);
  assert.match(page, /api\.catalogCostGrantSave\(row\.empCode, grantSavePayload\(row\)\)/);
  assert.match(page, /các dòng chưa lưu vẫn còn nguyên/);
});

test('phạm vi theo NHÓM: chỉ chọn trong nhóm NV đang phụ trách, cột chưa tick thì không có gì để chọn', () => {
  const picker = page.slice(page.indexOf('function ColumnGroupScope'), page.indexOf('MENU PHÂN QUYỀN CỘT % CHI PHÍ'));
  // Danh sách tick chỉ dựng từ availableGroups (nhóm suy từ đơn vị NV thực sự phụ
  // trách + bảng tra backend) — không có đường gõ tay một nhóm lạ vào.
  assert.match(picker, /row\.availableGroups\.map\(\(group\)/);
  assert.match(picker, /Mọi nhóm đang phụ trách/);
  // Cột chưa tick ⇒ không render bộ chọn — không đặt phạm vi cho quyền không tồn tại.
  assert.match(picker, /if \(!scope\) return null/);
  // Đơn vị chưa nhận diện được nhóm phải được NÓI RA, kèm cảnh báo chỉ '*' phủ tới.
  assert.match(picker, /ungroupedUnits/);
  assert.match(picker, /chỉ "Mọi nhóm" mới phủ tới/);
});

test('ma trận NV × CỘT × NHÓM: mỗi ô cột có bộ chọn nhóm RIÊNG (CEO chốt 08/08)', () => {
  const picker = page.slice(page.indexOf('function ColumnGroupScope'), page.indexOf('MENU PHÂN QUYỀN CỘT % CHI PHÍ'));
  // Tick thêm/bớt từng nhóm vào danh sách hiện có ⇒ nhiều nhóm cùng lúc cho MỘT cột.
  assert.match(picker, /current\.includes\(groupKey\) \? current\.filter\(\(item\) => item !== groupKey\) : \[\.\.\.current, groupKey\]/);
  // Bộ chọn gắn vào TỪNG Ô cột trong bảng, nhận đúng columnKey của ô đó.
  assert.match(page, /<ColumnGroupScope row=\{row\} columnKey=\{column\.key\}/);
  assert.match(page, /setColumnGroups\(cur, row\.empCode, column\.key, groups\)/);
  // Bảng tra đơn vị→nhóm hỏi BACKEND, không chép luật tách nhóm sang frontend.
  assert.match(page, /api\.catalogCostUnitGroups\(distinctUnits\)/);
});

test('menu phân quyền KHÔNG phân biệt cột nào — cấp cột nào thấy cột đó (CEO 08/08)', () => {
  // Nhãn "chỉ xem" cũ là rò rỉ phân biệt NỘI BỘ (C38/C42 không nằm trong công thức
  // tính tiền) vào đúng chỗ nó không liên quan. CEO: "bản chất các cột này chức năng
  // đều giống nhau". Phân biệt đó vẫn giữ ở tầng cấu hình + test phía server.
  assert.doesNotMatch(page, /chỉ xem/);
  assert.doesNotMatch(page, /catalog-col-viewonly/);
  assert.match(page, /panel\.columns\.map\(\(column\) => <th key=\{column\.key\} title=\{column\.label\}>/);
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
