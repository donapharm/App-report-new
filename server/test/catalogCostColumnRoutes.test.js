/**
 * ROUTE PHÂN QUYỀN CỘT % — CHỈ CEO ĐƯỢC GHI (CEO chốt 06/08/2026)
 * Kiểm bằng nguồn: admin thường KHÔNG được dùng cổng admin cho mấy route này,
 * và route "quyền của tôi" không nhận tham số emp để hỏi quyền người khác.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');

function routeLine(method, routePath) {
  const needle = `router.${method}('${routePath}'`;
  const at = SOURCE.indexOf(needle);
  assert.ok(at >= 0, `không tìm thấy route ${method.toUpperCase()} ${routePath}`);
  return SOURCE.slice(at, SOURCE.indexOf('\n', at));
}

test('đọc và ghi phân quyền đều đi qua auth.requireCeo, KHÔNG phải requireAdmin', () => {
  for (const [method, routePath] of [
    ['get', '/catalog-management/cost-columns/grants'],
    ['put', '/catalog-management/cost-columns/grants/:empCode'],
  ]) {
    const line = routeLine(method, routePath);
    assert.match(line, /auth\.requireCeo/, `${routePath} phải chặn bằng requireCeo`);
    assert.doesNotMatch(line, /auth\.requireAdmin/, `${routePath} KHÔNG được dùng cổng admin — admin thường không sửa được`);
  }
});

test('người thao tác lấy từ session, không lấy từ body — không giả mạo được audit', () => {
  const at = SOURCE.indexOf("router.put('/catalog-management/cost-columns/grants/:empCode'");
  const body = SOURCE.slice(at, SOURCE.indexOf('});', at));
  assert.match(body, /actor:\s*req\.session\.emp_code/);
  assert.doesNotMatch(body, /actor:\s*req\.body/);
});

test('route "quyền của tôi" tự khoá theo session, không nhận tham số hỏi hộ người khác', () => {
  const at = SOURCE.indexOf("router.get('/catalog-management/cost-columns/my-grant'");
  const body = SOURCE.slice(at, SOURCE.indexOf('});', at));
  assert.match(body, /readFor\(req\.session\.emp_code\)/);
  assert.doesNotMatch(body, /req\.query\.emp|req\.params\.emp|req\.body\.emp/,
    'nhận emp từ ngoài là mở đường xem quyền của người khác');
});

test('catalog vẫn cấm mang trường chi phí — % phải đi đường riêng, không nhét vào snapshot', () => {
  // Nếu ai đó nhét c33–c46 vào payload catalog, guard của catalogManagement ném 502.
  // Test này khoá ý định thiết kế để đợt sau không "tiện tay" gộp vào.
  const catalogSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalogManagement.js'), 'utf8');
  assert.match(catalogSource, /function isCatalogCostField/);
  assert.match(catalogSource, /CATALOG_FIELD_NOT_APPROVED/);
  const catalogRoute = routeLine('get', '/catalog-management');
  assert.doesNotMatch(catalogRoute, /catalogCostColumnGrants/,
    'route danh mục không được tự gắn % vào — % có endpoint riêng, có kiểm quyền riêng');
});
