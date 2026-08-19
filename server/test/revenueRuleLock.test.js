'use strict';
// Revenue SSOT lock — exact mirror of the live App Sale KPI SQL approved for VIỆC 0D.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MATERIALIZER_FILE = path.join(ROOT, 'scripts', 'materialize_july_revenue.js');
const MIRROR_FILE = path.join(ROOT, 'src', 'appSaleRevenueMirror.js');
const LOCK_FILE = path.join(ROOT, 'config', 'revenue_rule_lock.json');
const materializer = fs.readFileSync(MATERIALIZER_FILE, 'utf8');
const mirror = fs.readFileSync(MIRROR_FILE, 'utf8');
const {
  assertPeriodOpenForMaterialization,
  CURRENT_FROZEN_PERIOD_PINS,
} = require('../src/revenueMaterializeGuard');

function normalizedRegion(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `không tìm thấy vùng khóa ${label}`);
  return source.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('--'))
    .join('\n');
}

function ruleBody() {
  const sql = normalizedRegion(
    mirror,
    "const CATALOG_REPRICE_CUTOFF = '2026-07-01';",
    'function safeNonNegativeInteger',
    'App Sale SQL mirror',
  );
  const projection = normalizedRegion(
    materializer,
    'function mapMisaMirrorRows',
    'async function readSourceSnapshot',
    'materializer projection',
  );
  return `${sql}\n---APP_REPORT_PROJECTION---\n${projection}`;
}

function ruleHash() {
  return crypto.createHash('sha256').update(ruleBody()).digest('hex');
}

test('‼ đổi luật doanh thu phải nâng version + fingerprint', () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  assert.equal(lock.version, 'revenue-v1.2-canonical-unit-qlnb-mapping');
  assert.equal(ruleHash(), lock.ruleHash, [
    '',
    'LUẬT TÍNH DOANH THU ĐÃ BỊ ĐỔI.',
    'Phải đối chiếu lại exact App Sale KPI, nâng version, cập nhật ruleHash và CHANGELOG.',
    `ruleHash mới: ${ruleHash()}`,
    '',
  ].join('\n'));
});

test('khóa exact App Sale live provenance', () => {
  assert.match(mirror, /APP_SALE_RELEASE = '0e820022814ef8a7f24d47c082446f3e40b17ebe'/);
  assert.match(mirror, /APP_SALE_SOURCE_SHA256 = '3b065456ed1e25b553c0554b97900a0ea2d89a17e9b487bfc5663fad14c220e0'/);
  assert.match(mirror, /APP_SALE_REVENUE_MIRROR_ID = 'APP_SALE_REVENUE_KPI_SQL_0E820022'/);
});

test('CRM mirror khóa sale_order_date + invoice_export_amount + non-excluded', () => {
  const rule = ruleBody();
  assert.match(rule, /sale_order_date >= \$2::date/);
  assert.match(rule, /sale_order_date <= \$3::date/);
  assert.match(rule, /revenue_bucket <> 'excluded'/);
  assert.match(rule, /SUM\(invoice_export_amount\)/);
  assert.doesNotMatch(rule, /l\.revenue_date >=|l\.revenue_date <=/);
});

test('partner mirror khóa created_at + status/cancel + delivered response + C31', () => {
  const rule = ruleBody();
  assert.match(rule, /o\.created_at >= \$2::date/);
  assert.match(rule, /o\.created_at < \(\$3::date \+ 1\)/);
  assert.match(rule, /o\.source_system='APP_SALE'/);
  assert.match(rule, /o\.entity_group='PARTNER'/);
  assert.match(rule, /COALESCE\(o\.is_test,false\) IS NOT TRUE/);
  assert.match(rule, /COALESCE\(o\.status,''\) <> 'DRAFT'/);
  assert.match(rule, /LIKE '%huy%'.*LIKE '%hủy%'.*LIKE '%huỷ%'.*LIKE '%cancel%'/s);
  assert.match(rule, /COALESCE\(MAX\(r\.delivered_qty\),MAX\(r\.qty_delivered\)/);
  assert.match(rule, /public_data->>'C31'/);
  assert.match(rule, /CASE WHEN cpe\.price_count=1 THEN cpe\.price END/);
  assert.match(rule, /CASE WHEN cpu\.price_count=1 THEN cpu\.price END/);
});

test('actual materialization path has no token/invoice/manual_zalo eligibility', () => {
  const rule = ruleBody();
  for (const banned of [
    'PARTNER_TOKEN_INVOICE',
    'manual_zalo',
    'MANUAL_ZALO',
    'partner_order_response_invoices',
    'partner_order_response_invoice_items',
  ]) assert.doesNotMatch(rule, new RegExp(banned, 'i'), `${banned} không được tham gia eligibility`);
});

test('kỳ tự nhảy theo tháng lịch Việt Nam, không ghi cứng kỳ', () => {
  assert.match(materializer, /REVENUE_REFRESH_KY|MATERIALIZE_KY/);
  assert.match(materializer, /function defaultKy\(\)/);
  const fn = materializer.slice(materializer.indexOf('function defaultKy()'), materializer.indexOf('function defaultKy()') + 450);
  assert.match(fn, /Asia\/Bangkok/);
  assert.doesNotMatch(ruleBody(), /['"`]\d{2}\.20\d{2}['"`]/);
});

test('kỳ đã khoá không thể được mở lại bằng biến môi trường tuỳ ý', () => {
  assert.equal(assertPeriodOpenForMaterialization('08.2026'), true);
  for (const ky of Object.keys(CURRENT_FROZEN_PERIOD_PINS)) {
    assert.throws(
      () => assertPeriodOpenForMaterialization(ky),
      new RegExp(`FROZEN_PERIOD_REMATERIALIZATION_REQUIRES_APPROVED_CODE_CHANGE:${ky.replace('.', '\\.')}`),
    );
  }
});
