const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(serverRoot, 'scripts', 'materialize_july_revenue.js'), 'utf8');
const uploadSource = fs.readFileSync(path.join(serverRoot, 'src', 'upload.js'), 'utf8');
const legacySource = fs.readFileSync(path.join(serverRoot, 'scripts', 'import_legacy.js'), 'utf8');
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

test('fail-closed guard runs before candidate file write and active-slot replacement', () => {
  const guardAt = source.indexOf('const materializeGuard = evaluateRevenueCandidate');
  const fileWriteAt = source.indexOf('writeJson(file, rows)', guardAt);
  const deactivateAt = source.indexOf('s.active = false', guardAt);
  assert.ok(guardAt >= 0, 'materialize guard must be called');
  assert.ok(fileWriteAt > guardAt, 'candidate file must be written only after guard pass');
  assert.ok(deactivateAt > guardAt, 'previous active slot must be kept until guard pass');
  assert.match(source, /revenue_2source_rejected_/);
  assert.match(source, /REVENUE_MATERIALIZE_GUARD_REJECTED/);
  assert.match(source, /acquireMaterializeLock\(\)/);
  assert.match(source, /ACTIVE_SLOT_CHANGED_DURING_MATERIALIZE/);
  assert.match(source, /SLOT_ID_COLLISION/);
  assert.match(source, /writeJson = writeJsonAtomic/);
});

test('APP WEB partner period uses only the effective revenue date, not order-created date', () => {
  const fetchPartnerAt = source.indexOf('async function fetchPartner()');
  const mainAt = source.indexOf('async function main()', fetchPartnerAt);
  assert.ok(fetchPartnerAt >= 0 && mainAt > fetchPartnerAt, 'fetchPartner block must be present');
  const fetchPartnerSource = source.slice(fetchPartnerAt, mainAt);
  assert.match(fetchPartnerSource, /Quy kỳ theo MỘT mốc ngày duy nhất/);
  assert.doesNotMatch(fetchPartnerSource, /AND\s+o\.created_at\s+>=/,
    'partner revenue must not be filtered by order creation start date');
  assert.doesNotMatch(fetchPartnerSource, /AND\s+o\.created_at\s+</,
    'partner revenue must not be filtered by order creation end date');
  assert.match(fetchPartnerSource, /COALESCE\(partner\.effective_date, \(o\.created_at AT TIME ZONE 'Asia\/Bangkok'\)::date\) >= \$1::date/);
  assert.match(fetchPartnerSource, /COALESCE\(partner\.effective_date, \(o\.created_at AT TIME ZONE 'Asia\/Bangkok'\)::date\) <= \$2::date/);
});

test('all slot writers share the same lock and atomic JSON writer', () => {
  for (const [label, text] of [['manual upload', uploadSource], ['legacy import', legacySource]]) {
    assert.match(text, /revenue_materialize\.lock/, `${label} must use the shared lock path`);
    assert.match(text, /acquireFileLock/, `${label} must acquire the shared lock`);
    assert.match(text, /writeJsonAtomic/, `${label} must write JSON atomically`);
  }
});
