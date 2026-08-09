import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CostAmounts.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('tab riêng, KHÔNG gộp vào màn nào có sẵn — đúng lệnh CEO tách C32/C47 ra', () => {
  assert.match(app, /key: 'costAmounts'.*C: CostAmounts, costAmountsOnly: true/);
  // Ẩn/hiện theo cờ backend, không tự suy từ role ở frontend. Luật nằm trong
  // `tabAccess.isTabAllowed` — MỘT chỗ duy nhất quyết tab nào hiện.
  const tabAccess = fs.readFileSync(new URL('../src/tabAccess.js', import.meta.url), 'utf8');
  assert.match(tabAccess, /!tab\.costAmountsOnly \|\| !!me\.costAmountsEnabled/);
  assert.doesNotMatch(tabAccess, /costAmountsOnly[^\n]*isAdmin/);
});

test('cờ costAmountsEnabled do BACKEND chốt (CEO hoặc công tắc), frontend chỉ đọc', () => {
  assert.match(routes, /const costAmountsEnabled = auth\.isCeoActor\(req\.session\)/);
  assert.match(routes, /costAmounts\.decisionFor\(req\.session\.emp_code, employeeCostRosterRows\(\)\)\.enabled/);
});

test('route dữ liệu tự chặn độc lập — ẩn tab không phải hàng rào quyền', () => {
  // Cổng nằm ở MỘT hàm dùng chung, và CẢ HAI route (xem màn + tải file) đều phải đi
  // qua nó. Một cổng khoá, một cổng mở thì coi như không khoá gì cả.
  const gate = routes.slice(routes.indexOf('function costAmountsGate('), routes.indexOf("router.get('/catalog-management/cost-amounts'"));
  assert.match(gate, /COST_AMOUNTS_DISABLED/);
  assert.match(gate, /res\.status\(403\)/);
  assert.match(gate, /auth\.isCeoActor\(req\.session\)/);
  for (const route of ["router.get('/catalog-management/cost-amounts'", "router.get('/catalog-management/cost-amounts.xlsx'"]) {
    const at = routes.indexOf(route);
    assert.ok(at >= 0, `thiếu route ${route}`);
    const body = routes.slice(at, at + 400);
    assert.match(body, /if \(!costAmountsGate\(req, res\)\) return undefined;/, `${route} phải qua cổng`);
    // Không nhận tham số emp ⇒ không có đường hỏi tiền của người khác.
    assert.doesNotMatch(body, /req\.query\.emp\b/);
  }
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

/* ── CHI TIẾT TỪNG DÒNG ĐƠN HÀNG: CEO chốt "tôi muốn CẢ HAI" (màn + Excel) ───── */

test('xem chi tiết NGAY TRÊN MÀN — có công tắc và bảng riêng', () => {
  assert.match(page, /const \[level, setLevel\] = useState\('pair'\)/);
  assert.match(page, /Xem chi tiết từng đơn hàng/);
  assert.match(page, /level === 'order' && <div className="card table-card">/);
  assert.match(page, /<b>Chi tiết từng dòng đơn hàng<\/b>/);
  // Cột lấy từ backend, không chép tay nhãn sang frontend.
  assert.match(page, /\(data\.detailColumns \|\| \[\]\)\.map\(\(column\) => <th/);
});

test('xuất Excel cũng có sheet chi tiết — "cả hai" nghĩa là cả hai', () => {
  assert.match(routes, /if \(result\.level === 'order'\) \{/);
  assert.match(routes, /addWorksheet\('Chi tiet don hang'\)/);
  assert.match(routes, /result\.detailColumns\.map\(\(column\) => column\.label\)/);
  // Màn và file dùng CHUNG params ⇒ file không bao giờ khác cái đang nhìn.
  assert.match(page, /downloadCostAmounts\(params\)/);
  assert.match(page, /const params = useMemo\(\(\) => \(\{ from, to, level, \.\.\.costFilterParams\(filters\) \}\)/);
});

test('‼ tiền/giá trong bảng chi tiết vẫn nằm dưới con mắt che số', () => {
  const detail = page.slice(page.indexOf("level === 'order' && <div"), page.indexOf('<b>Tổng theo NV</b>'));
  const cells = detail.match(/<td key=\{column\.key\} className="catalog-money"[^>]*>/g) || [];
  assert.ok(cells.length >= 1, 'phải có ô tiền trong bảng chi tiết');
  for (const cell of cells) assert.match(cell, /data-sensitive/);
});

test('cắt bớt dòng thì NÓI TO kèm cách lấy đủ, không cắt lặng lẽ', () => {
  assert.match(page, /orderRowsTruncated && <div className="catalog-alert error"/);
  assert.match(page, /Lọc hẹp lại \(một nhân viên · một kỳ · một nhóm mã\)/);
  assert.match(routes, /‼ CẮT BỚT: tổng \$\{result\.orderRowsTotal/);
});

test('‼ màn NÓI RÕ "lệch định dạng mã" ≠ "DataHub thiếu %" — hai cách xử lý ngược nhau', () => {
  assert.match(page, /KHÔNG khớp được cặp nào — đây KHÔNG phải "DataHub thiếu %"/);
  assert.match(page, /đòi DataHub bổ sung % sẽ không giải quyết được gì/);
  // Phải in mẫu mã HAI BÊN để sửa được ngay, không bắt đi mò.
  assert.match(page, /Mã bên kho %:/);
  assert.match(page, /Mã bên doanh thu:/);
  assert.match(page, /data\.joinHealth\.sampleRateKeys/);
  assert.match(page, /data\.joinHealth\.sampleRevenueKeys/);
});

test('ghép được MỘT PHẦN cũng phải nói — tổng chỉ là tổng phần ghép được', () => {
  assert.match(page, /Chỉ ghép được <b>\{Number\(data\.joinHealth\.matchedPairs\)/);
  assert.match(page, /tổng của <b>phần ghép được<\/b>, không phải toàn bộ/);
});
