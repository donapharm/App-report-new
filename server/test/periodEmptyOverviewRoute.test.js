const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');

test('overview response forwards periodCtx emptyPeriod instead of dropping it', () => {
  const start = routesSource.indexOf("router.get('/overview'");
  const end = routesSource.indexOf("router.get('/trend'", start);
  assert.ok(start >= 0 && end > start, 'Không tách được route overview');
  const routeBlock = routesSource.slice(start, end);
  assert.match(routeBlock, /emptyPeriod:\s*pc\.emptyPeriod/);
});
