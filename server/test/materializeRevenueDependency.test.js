const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(serverRoot, 'scripts', 'materialize_july_revenue.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));

test('revenue materializer owns its PostgreSQL dependency', () => {
  assert.match(source, /require\(['"]pg['"]\)/);
  assert.ok(pkg.dependencies?.pg, 'server/package.json must declare pg');
});

test('revenue materializer does not depend on an App Sale checkout path', () => {
  assert.doesNotMatch(source, /workspace-main\/projects\/appsale/);
  assert.doesNotMatch(source, /node_modules['"], ['"]pg/);
  assert.match(source, /APPSALE_(?:DATABASE_URL|PGHOST)/);
});
