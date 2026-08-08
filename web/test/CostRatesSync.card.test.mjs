import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('nút Đồng bộ chỉ hiện với CEO khi dữ liệu đúng kỳ; backend chặn độc lập bằng requireCeo', () => {
  assert.match(page, /\{isCeo && !actionsLocked && <CostRatesSyncCard period=\{period\} \/>\}/);
  assert.match(page, /const actionsLocked = !!loadingPeriod \|\| periodMismatch/,
    'khi đang tải/giữ bảng kỳ cũ phải ẩn thao tác đồng bộ để không trộn kỳ');
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
