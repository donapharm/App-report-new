import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CostAmounts.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('tab riêng, KHÔNG gộp vào màn nào có sẵn — đúng lệnh CEO tách C32/C47 ra', () => {
  assert.match(app, /key: 'costAmounts'.*C: CostAmounts, costAmountsOnly: true/);
  // Ẩn/hiện theo cờ backend, không tự suy từ role ở frontend.
  assert.match(app, /!t\.costAmountsOnly \|\| me\.costAmountsEnabled/);
  assert.doesNotMatch(app, /costAmountsOnly.*me\.isAdmin/);
});

test('cờ costAmountsEnabled do BACKEND chốt (CEO hoặc công tắc), frontend chỉ đọc', () => {
  assert.match(routes, /const costAmountsEnabled = auth\.isCeoActor\(req\.session\)/);
  assert.match(routes, /costAmounts\.decisionFor\(req\.session\.emp_code, employeeCostRosterRows\(\)\)\.enabled/);
});

test('route dữ liệu tự chặn độc lập — ẩn tab không phải hàng rào quyền', () => {
  const at = routes.indexOf("router.get('/catalog-management/cost-amounts'");
  assert.ok(at >= 0, 'thiếu route cost-amounts');
  const body = routes.slice(at, routes.indexOf("router.get('/catalog-management/cost-amounts.xlsx'", at));
  assert.match(body, /COST_AMOUNTS_DISABLED/);
  assert.match(body, /res\.status\(403\)/);
  // Không nhận tham số emp ⇒ không có đường hỏi tiền của người khác.
  assert.doesNotMatch(body, /req\.query\.emp\b/);
});

test('công tắc CHỈ CEO đặt (requireCeo, không phải requireAdmin)', () => {
  const at = routes.indexOf("router.put('/catalog-management/cost-amounts/visibility'");
  assert.ok(at >= 0);
  const line = routes.slice(at, routes.indexOf('\n', at));
  assert.match(line, /auth\.requireCeo/);
  assert.doesNotMatch(line, /requireAdmin/);
  // Actor lấy từ session — không có đường giả mạo người bấm.
  assert.match(routes.slice(at, at + 400), /actor: req\.session\.emp_code/);
});

test('công tắc ba tầng giống hai tab Chi phí của tôi / Thanh toán CP (CEO yêu cầu)', () => {
  assert.match(page, /Toàn phòng Kinh doanh/);
  assert.match(page, /Theo nhóm/);
  assert.match(page, /Theo từng nhân viên/);
  assert.match(page, /inheritLabel="Theo toàn phòng"/);
  assert.match(page, /inheritLabel="Theo nhóm"/);
  assert.match(page, /Mặc định an toàn là TẮT/);
});

test('bốn cột tiền đúng như CEO chốt + tiền tự tính, không kéo C32/C47 từ DataHub', () => {
  const server = fs.readFileSync(new URL('../../server/src/costAmounts.js', import.meta.url), 'utf8');
  assert.match(server, /c32NoVat.*\n.*c32WithVat|'c32NoVat'/);
  assert.match(server, /employeeCost\.calculateAmount/);
  // Không có lệnh gọi nguồn nào trong module tính tiền.
  assert.doesNotMatch(server, /fetchRawEmployeeCost|getForSession/);
});

test('thiếu %/xung đột ⇒ "—" kèm lý do, không hiện nửa tổng như tổng thật', () => {
  assert.match(page, /XUNG_DOT/);
  assert.match(page, /Thiếu % ở cột/);
  assert.match(page, /tổng C47 chỉ chốt khi đủ % mọi cặp/);
});

test('ô tiền đi qua rèm che ẩn số; export qua backend theo quyền người tải', () => {
  assert.match(page, /data-sensitive=""/);
  assert.match(api, /downloadCostAmounts/);
  const xlsx = routes.slice(routes.indexOf("router.get('/catalog-management/cost-amounts.xlsx'"));
  assert.match(xlsx.slice(0, 120), /auth\.requireAuth/);
});

test('chưa đồng bộ % thì chỉ đường rõ, không hiện bảng trắng khó hiểu', () => {
  assert.match(page, /CHUA_DONG_BO/);
  assert.match(page, /Đồng bộ % chi phí/);
});

test('bảng dài chia 50 dòng/trang theo lệnh CEO 08/08', () => {
  assert.match(page, /const PAGE_SIZE = 50/);
  assert.match(page, /rows\.slice\(\(safePage - 1\) \* PAGE_SIZE, safePage \* PAGE_SIZE\)/);
});
