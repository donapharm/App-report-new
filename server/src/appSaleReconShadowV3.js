'use strict';

const crypto = require('node:crypto');

const CONTRACT = 'app-sale-reconciliation-shadow-v3';
const PATH_PREFIX = '/api/integrations/app-report/reconciliation-shadow/v3';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PAGE_ROWS = 250;
const MAX_SNAPSHOT_ROWS = 100000;
const CONTRACTOR_MAX_CODE_POINTS = 64;
const CONTRACTOR_MAX_UTF8_BYTES = 192;
// Keep this repertoire byte-for-byte aligned with canonical App Sale v3.
// Vietnamese business identifiers (for example 20.HĐS and 05.A&B) are valid;
// controls, bidi marks, traversal and non-Latin confusables fail closed.
const CONTRACTOR_CHARS = /^[0-9A-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠ-ỹ._&-]+$/u;
const CONTRACTOR_FIRST = /^[0-9A-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠ-ỹ]$/u;
const COST_AMOUNT_KEYS = Object.freeze(Array.from({ length: 14 }, (_, index) => `c${index + 33}_candidate_amount`));
const PAGE_KEYS = Object.freeze([
  'contract', 'shadow_only', 'effective_values_changed', 'period', 'contractor_code', 'contractor_name',
  'reconciliation_version', 'reconciliation_rows_checksum_v2', 'shadow_snapshot_version', 'shadow_snapshot_checksum',
  'immutable_version', 'immutable_checksum', 'snapshot_source', 'confirmed_by', 'confirmed_at', 'rows',
  'offset', 'next_offset', 'has_more', 'total_rows',
]);
const ROW_KEYS = Object.freeze([
  'reconciliation_line_id', 'row_ordinal', 'period', 'contractor_code', 'unit_code', 'product_code',
  'product_name', 'uom', 'confirmation_id', 'confirmed_by', 'confirmed_at', 'confirmation_provenance',
  'match_status', 'match_reason', 'source_system', 'immutable_order_id', 'immutable_order_code',
  'immutable_source_line_id', 'canonical_employee_code', 'identity_candidate_count', 'reverse_candidate_count',
  'quantity', 'matched_order_quantity', 'quantity_delta', 'unit_price', 'source_amount', 'source_amount_basis',
  'amount_excluding_vat', 'amount_including_vat', 'quantity_price_amount_delta', 'amount_validation_status',
  'amount_rounding_tolerance', 'currency', 'rounding_mode', 'vat_basis', 'vat_rate', 'vat_divisor',
  'vat_source', 'vat_missing_reason', 'cost_candidate_status', 'cost_candidate_reason', 'cost_policy_version',
  'cost_policy_checksum', 'c32_base_amount', ...COST_AMOUNT_KEYS, 'c47_total_candidate_amount',
]);
const DECIMAL_SCALES = Object.freeze({
  quantity: 3, matched_order_quantity: 3, quantity_delta: 3,
  unit_price: 2, source_amount: 2, amount_excluding_vat: 2, amount_including_vat: 2,
  quantity_price_amount_delta: 2, amount_rounding_tolerance: 2,
  vat_rate: 6, vat_divisor: 6, c32_base_amount: 2, c47_total_candidate_amount: 2,
  ...Object.fromEntries(COST_AMOUNT_KEYS.map((key) => [key, 2])),
});

const clean = (value) => String(value ?? '').trim();
function normalizeContractorCode(value) {
  const decoded = String(value ?? '');
  if (!decoded || decoded !== decoded.normalize('NFC')) return '';
  const points = Array.from(decoded);
  if (points.length > CONTRACTOR_MAX_CODE_POINTS || Buffer.byteLength(decoded, 'utf8') > CONTRACTOR_MAX_UTF8_BYTES
    || !CONTRACTOR_FIRST.test(points[0] || '') || !CONTRACTOR_CHARS.test(decoded)
    || decoded === '.' || decoded === '..' || decoded.includes('..')) return '';
  const normalized = decoded.toUpperCase();
  return normalized === normalized.normalize('NFC') ? normalized : '';
}
function fail(message = 'Invalid App Sale shadow reconciliation response') {
  const error = new Error(message);
  error.code = 'APP_SALE_RECON_SHADOW_INVALID';
  error.status = 502;
  throw error;
}
function canonDecimal(value, scale, nullable = false) {
  if (value === null && nullable) return null;
  const raw = clean(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) fail();
  let [whole, fraction = ''] = raw.split('.');
  const negative = whole.startsWith('-');
  whole = whole.replace(/^-/, '').replace(/^0+(?=\d)/, '') || '0';
  fraction = fraction.replace(/0+$/, '');
  if (fraction.length > scale) fail();
  return `${negative && (whole !== '0' || fraction) ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
function canonTimestamp(value) {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) fail();
  return date.toISOString();
}
function expectEnum(value, allowed) {
  if (!allowed.includes(value)) fail();
}
function canonicalRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail();
  const actualKeys = Object.keys(row);
  if (actualKeys.length !== ROW_KEYS.length || !ROW_KEYS.every((key) => Object.hasOwn(row, key))) fail();
  const output = {};
  for (const key of ROW_KEYS) output[key] = row[key];
  output.confirmed_at = canonTimestamp(output.confirmed_at);
  for (const [key, scale] of Object.entries(DECIMAL_SCALES)) {
    output[key] = canonDecimal(output[key], scale, key !== 'quantity' && key !== 'source_amount' && key !== 'amount_rounding_tolerance');
  }
  for (const key of ['row_ordinal', 'identity_candidate_count', 'reverse_candidate_count']) {
    if (!Number.isSafeInteger(output[key]) || output[key] < (key === 'row_ordinal' ? 1 : 0)) fail();
  }
  if (output.cost_policy_version !== null && (!Number.isSafeInteger(output.cost_policy_version) || output.cost_policy_version < 1)) fail();
  if (output.cost_policy_checksum !== null && !/^[a-f0-9]{64}$/.test(output.cost_policy_checksum)) fail();
  expectEnum(output.confirmation_provenance, ['ACCOUNTING_RECON_IMMUTABLE_CONFIRMATION']);
  expectEnum(output.match_status, ['MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'MISMATCH']);
  expectEnum(output.source_amount_basis, ['BEFORE_VAT', 'INCLUDING_VAT', 'UNKNOWN']);
  expectEnum(output.amount_validation_status, ['OK', 'MISMATCH', 'NOT_EVALUATED']);
  expectEnum(output.currency, ['VND']);
  expectEnum(output.rounding_mode, ['HALF_AWAY_FROM_ZERO_2DP']);
  expectEnum(output.vat_basis, ['BEFORE_VAT', 'INCLUDING_VAT', 'UNKNOWN']);
  expectEnum(output.cost_candidate_status, ['READY', 'BLOCKED']);
  return output;
}
function checksum(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows.map(canonicalRow)), 'utf8').digest('hex');
}
function pinnedMetadata(page) {
  if (!page || typeof page !== 'object' || Array.isArray(page)
    || Object.keys(page).length !== PAGE_KEYS.length || !PAGE_KEYS.every((key) => Object.hasOwn(page, key))) fail();
  return JSON.stringify([
    page.contract, page.shadow_only, page.effective_values_changed, page.period, page.contractor_code,
    page.contractor_name, page.reconciliation_version, page.reconciliation_rows_checksum_v2,
    page.shadow_snapshot_version, page.shadow_snapshot_checksum, page.immutable_version, page.immutable_checksum,
    page.snapshot_source, page.confirmed_by, canonTimestamp(page.confirmed_at), page.total_rows,
  ]);
}
function combinePages(pages, expected = {}) {
  if (!Array.isArray(pages) || pages.length === 0) fail();
  const first = pages[0];
  const pin = pinnedMetadata(first);
  if (first.contract !== CONTRACT || first.shadow_only !== true || first.effective_values_changed !== false
    || first.period !== expected.period || first.contractor_code !== expected.contractorCode
    || !Number.isSafeInteger(first.reconciliation_version) || first.reconciliation_version < 1
    || !Number.isSafeInteger(first.shadow_snapshot_version) || first.shadow_snapshot_version < 1
    || first.immutable_version !== first.shadow_snapshot_version
    || first.immutable_checksum !== first.shadow_snapshot_checksum
    || !/^[a-f0-9]{64}$/.test(clean(first.reconciliation_rows_checksum_v2))
    || !/^[a-f0-9]{64}$/.test(clean(first.shadow_snapshot_checksum))
    || !['DERIVED_FAIL_CLOSED', 'DURABLE_MAPPING'].includes(first.snapshot_source)
    || !Number.isSafeInteger(first.total_rows) || first.total_rows < 0 || first.total_rows > MAX_SNAPSHOT_ROWS) fail();
  const rows = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    if (pinnedMetadata(page) !== pin || page.offset !== offset || !Array.isArray(page.rows)
      || page.rows.length > MAX_PAGE_ROWS) fail();
    const normalized = page.rows.map(canonicalRow);
    for (const row of normalized) {
      if (row.row_ordinal !== rows.length + 1 || row.period !== first.period
        || row.contractor_code !== first.contractor_code || row.confirmation_provenance !== 'ACCOUNTING_RECON_IMMUTABLE_CONFIRMATION'
        || row.confirmed_by !== first.confirmed_by || row.confirmed_at !== canonTimestamp(first.confirmed_at)) fail();
      rows.push(row);
    }
    if (rows.length > MAX_SNAPSHOT_ROWS) fail();
    offset += normalized.length;
    if (page.next_offset !== (page.has_more ? offset : null)
      || (pageIndex < pages.length - 1 && page.has_more !== true)) fail();
  }
  if (pages.at(-1).has_more !== false || rows.length !== first.total_rows
    || checksum(rows) !== first.shadow_snapshot_checksum) fail();
  return { ...first, confirmed_at: canonTimestamp(first.confirmed_at), rows, offset: 0, next_offset: null, has_more: false };
}
async function loadSnapshot({ period, contractorCode, baseUrl, key, fetchImpl = fetch, timeoutMs = 1500 }) {
  const normalizedContractor = normalizeContractorCode(contractorCode);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !normalizedContractor || !key) {
    fail('Invalid App Sale shadow reconciliation input');
  }
  let origin;
  try { origin = new URL(baseUrl); } catch { fail('Invalid App Sale shadow reconciliation config'); }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(origin.hostname);
  if (origin.username || origin.password || origin.search || origin.hash
    || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))) fail('Invalid App Sale shadow reconciliation config');
  const pages = [];
  let offset = 0;
  let version = null;
  for (let pageIndex = 0; pageIndex <= 400; pageIndex += 1) {
    const url = new URL(`${PATH_PREFIX}/${period}/${encodeURIComponent(normalizedContractor)}`, origin);
    url.searchParams.set('offset', String(offset));
    if (version !== null) url.searchParams.set('phien_ban', String(version));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs) || 1500, 250), 10000));
    try {
      const response = await fetchImpl(url, {
        method: 'GET', headers: { accept: 'application/json', 'x-datahub-key': key }, redirect: 'manual', signal: controller.signal,
      });
      if (!response.ok || (response.status >= 300 && response.status < 400)) fail('App Sale shadow reconciliation unavailable');
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail();
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) fail();
      const page = JSON.parse(text);
      pages.push(page);
      if (version === null) version = page.reconciliation_version;
      else if (page.reconciliation_version !== version) fail();
      if (!page.has_more) break;
      offset = page.next_offset;
      if (pageIndex === 400) fail();
    } catch (error) {
      if (error?.code === 'APP_SALE_RECON_SHADOW_INVALID') throw error;
      fail('App Sale shadow reconciliation unavailable');
    } finally { clearTimeout(timer); }
  }
  return combinePages(pages, { period, contractorCode: normalizedContractor });
}

module.exports = {
  CONTRACT, PATH_PREFIX, PAGE_KEYS, ROW_KEYS, COST_AMOUNT_KEYS, normalizeContractorCode,
  canonicalRow, checksum, combinePages, loadSnapshot,
};
