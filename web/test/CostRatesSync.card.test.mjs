import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('thẻ Đồng bộ chỉ dành cho CEO; backend chặn độc lập bằng requireCeo', () => {
  // Thẻ LUÔN hiện với CEO (xem test "không được biến mất" phía dưới); lúc danh mục
  // đang tải thì chỉ KHOÁ NÚT kèm lý do, không ẩn thẻ.
  assert.match(page, /\{isCeo && <CostRatesSyncCard period=\{period\} catalogLoading=\{!!loadingPeriod\} \/>\}/);
  assert.match(page, /const actionsLocked = !!loadingPeriod \|\| periodMismatch/,
    'vẫn phải biết lúc nào đang tải/giữ bảng kỳ cũ để khoá thao tác trộn kỳ');
  const at = routes.indexOf("router.post('/catalog-management/cost-rates/sync'");
  assert.ok(at >= 0, 'thiếu route sync');
  assert.match(routes.slice(at, routes.indexOf('\n', at)), /auth\.requireCeo/);
  const statusAt = routes.indexOf("router.get('/catalog-management/cost-rates/local-status'");
  assert.match(routes.slice(statusAt, routes.indexOf('\n', statusAt)), /auth\.requireCeo/);
});

test('số có căn cước: hiện "đồng bộ lúc nào, bởi ai, bao nhiêu cặp"; chưa có thì NÓI chưa có', () => {
  assert.match(page, /đồng bộ \$\{formatDateTime\(status\.fetchedAt\)\} bởi \$\{status\.fetchedBy\}/);
  assert.match(page, /Kho cục bộ CHƯA có kỳ này/);
});

test('kết quả nói thật cả hai chiều: thành công kèm diff; thất bại nêu ai hỏng + bản cũ giữ nguyên', () => {
  assert.match(page, /thay đổi \{result\.diff\.changed\}/);
  assert.match(page, /bản cũ giữ nguyên, chưa ghi gì/);
  assert.match(page, /result\.failures\.slice\(0, 5\)/);
});

test('client API trỏ đúng hai endpoint sync + local-status', () => {
  assert.match(api, /catalogCostRatesSync: \(period\) => req\('POST', '\/catalog-management\/cost-rates\/sync', \{ period \}\)/);
  assert.match(api, /catalogCostRatesLocalStatus: \(params = \{\}\) => req\('GET', '\/catalog-management\/cost-rates\/local-status\?'/);
});

test('actor lấy từ session ở backend — không có đường giả mạo người bấm', () => {
  const at = routes.indexOf("router.post('/catalog-management/cost-rates/sync'");
  const body = routes.slice(at, routes.indexOf('}));', at));
  assert.match(body, /actor: req\.session\.emp_code/);
  assert.doesNotMatch(body, /actor:\s*req\.body/);
});

/* ── Thẻ đồng bộ % KHÔNG được biến mất lúc danh mục đang tải (CEO 09/08 20:04) ──
 * CEO được hướng dẫn "bấm Đồng bộ từ DataHub" nhưng vào màn thì thẻ không có ở đó:
 * bản cũ ẩn nguyên thẻ theo `actionsLocked`, mà danh mục kỳ 08 tải rất lâu. Nút
 * biến mất không dấu vết còn tệ hơn nút bị khoá — người dùng tưởng app hỏng.     */

test('‼ thẻ đồng bộ % LUÔN hiện với CEO, không bị ẩn theo trạng thái tải danh mục', () => {
  assert.match(page, /\{isCeo && <CostRatesSyncCard period=\{period\} catalogLoading=\{!!loadingPeriod\} \/>\}/);
  assert.doesNotMatch(page, /isCeo && !actionsLocked && <CostRatesSyncCard/, 'không được quay lại kiểu ẩn thẻ');
  // ‼ Và KHÔNG được khoá theo `actionsLocked`: danh mục 502 ⇒ mismatch vĩnh viễn ⇒
  // nút đồng bộ % khoá vĩnh viễn, chặn đúng đường thoát duy nhất (CEO 09/08 23:24).
  assert.doesNotMatch(page, /catalogLoading=\{actionsLocked\}/, 'không khoá nút đồng bộ % vì danh mục hỏng');
});

test('đang tải thì KHOÁ NÚT KÈM LÝ DO và tự mở lại — không khoá câm', () => {
  assert.match(page, /disabled=\{syncing \|\| catalogLoading\}/);
  assert.match(page, /Đang mở danh mục kỳ này — nút tự mở lại ngay khi xong/);
  // Lý do không cho bấm chồng phải nói ra: DataHub từng tự restart vì dồn tải.
  assert.match(page, /để DataHub khỏi quá tải/);
});
