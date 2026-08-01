const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const routesSource = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
const start = routesSource.indexOf('function currentKyVN(');
const end = routesSource.indexOf("\n\nrouter.get('/periods'", start);
assert.ok(start >= 0 && end > start, 'Không tách được currentKyVN từ routes.js');
const currentKyVN = new Function(`${routesSource.slice(start, end)}; return currentKyVN;`)();

test('backend xác định kỳ theo ranh giới lịch Việt Nam', () => {
  assert.equal(currentKyVN(new Date('2026-07-31T16:59:59.999Z')), '07.2026');
  assert.equal(currentKyVN(new Date('2026-07-31T17:00:00.000Z')), '08.2026');
  assert.equal(currentKyVN(new Date('2026-12-31T17:00:00.000Z')), '01.2027');
});

test('/api/periods chỉ thêm kỳ rỗng vào response và trả metadata noData đầy đủ', () => {
  const routeBlock = routesSource.slice(routesSource.indexOf("router.get('/periods'"), routesSource.indexOf("router.get('/admin/revenue-refresh/status'"));
  assert.match(routeBlock, /const periods = store\.listPeriods\(\)\.map/);
  assert.doesNotMatch(routeBlock, /store\.listPeriods\(\)\.push/);
  assert.match(routeBlock, /source: 'calendar'/);
  assert.match(routeBlock, /noData: true/);
  assert.match(routeBlock, /dayCovered: 0/);
  assert.match(routeBlock, /res\.json\(\{ periods, latest: store\.latestKy\(\), currentKy \}\)/);
});
