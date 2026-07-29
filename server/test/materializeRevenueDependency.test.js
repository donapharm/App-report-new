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


test('APP WEB partner includes delivered HOLD_GOLIVE but still excludes zero-delivery rows', () => {
  const fetchPartnerAt = source.indexOf('async function fetchPartner()');
  const mainAt = source.indexOf('async function main()', fetchPartnerAt);
  const fetchPartnerSource = source.slice(fetchPartnerAt, mainAt);
  assert.doesNotMatch(fetchPartnerSource, /o\.status\s*<>\s*['"]HOLD_GOLIVE['"]/, 'HOLD_GOLIVE delivered rows must not be excluded by status alone');
  assert.match(fetchPartnerSource, /HOLD_GOLIVE là cờ kỹ thuật soft-launch\/quota audit/);
  assert.match(fetchPartnerSource, /COALESCE\(partner\.delivered_qty,0\) > 0/, 'only rows with delivered quantity are eligible');
});

test('APP WEB partner response model is one row per order_item_id to prevent double count after status changes', () => {
  const fetchPartnerAt = source.indexOf('async function fetchPartner()');
  const mainAt = source.indexOf('async function main()', fetchPartnerAt);
  const fetchPartnerSource = source.slice(fetchPartnerAt, mainAt);
  assert.match(fetchPartnerSource, /row_number\(\) OVER \(PARTITION BY r\.order_item_id ORDER BY r\.responded_at DESC NULLS LAST, r\.id DESC\) rn/,
    'latest response must be selected per order_item_id');
  assert.match(fetchPartnerSource, /response_one AS \(SELECT \* FROM latest_response WHERE rn=1\)/,
    'only one response row per order_item_id may enter partner CTE');
  assert.match(fetchPartnerSource, /LEFT JOIN partner ON partner\.order_item_id=oi\.id/,
    'order item joins to the deduplicated partner CTE');
  assert.match(source, /source_line_id: `WEB:\$\{r\.order_item_id\}`/,
    'materialized identity is stable by order_item_id, so a later status change cannot create a second source id');
});

test('all slot writers share the same lock and atomic JSON writer', () => {
  for (const [label, text] of [['manual upload', uploadSource], ['legacy import', legacySource]]) {
    assert.match(text, /revenue_materialize\.lock/, `${label} must use the shared lock path`);
    assert.match(text, /acquireFileLock/, `${label} must acquire the shared lock`);
    assert.match(text, /writeJsonAtomic/, `${label} must write JSON atomically`);
  }
});
