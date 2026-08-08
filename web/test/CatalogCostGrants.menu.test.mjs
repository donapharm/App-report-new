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

test('phạm vi đơn vị chỉ chọn trong đơn vị NV đang phụ trách', () => {
  assert.match(page, /row\.availableUnits\.map\(\(unit\)/);
  assert.match(page, /Mọi đơn vị đang phụ trách/);
  // Chưa cấp cột nào thì ô phạm vi phải khoá — tránh đặt phạm vi cho quyền không tồn tại.
  assert.match(page, /disabled=\{!row\.columns\.length\}/);
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
