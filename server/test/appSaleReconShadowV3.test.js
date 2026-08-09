'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROW_KEYS, canonicalRow, normalizeContractorCode, checksum, combinePages, loadSnapshot,
} = require('../src/appSaleReconShadowV3');

function row(ordinal, overrides = {}) {
  const value = {
    reconciliation_line_id: `r${ordinal}`, row_ordinal: ordinal, period: '2026-07', contractor_code: 'NT1',
    unit_code: 'U', product_code: 'P', product_name: null, uom: null, confirmation_id: 'c', confirmed_by: 'VP018',
    confirmed_at: '2026-08-09T00:00:00.987Z', confirmation_provenance: 'ACCOUNTING_RECON_IMMUTABLE_CONFIRMATION',
    match_status: 'MATCHED', match_reason: 'EXACT', source_system: 'sale', immutable_order_id: `i${ordinal}`,
    immutable_order_code: `o${ordinal}`, immutable_source_line_id: `l${ordinal}`, canonical_employee_code: 'VP018',
    identity_candidate_count: 1, reverse_candidate_count: 1, quantity: '1.000', matched_order_quantity: '1', quantity_delta: '0.000',
    unit_price: '10.00', source_amount: '10.00', source_amount_basis: 'BEFORE_VAT', amount_excluding_vat: '10.00',
    amount_including_vat: '10.50', quantity_price_amount_delta: '0', amount_validation_status: 'OK', amount_rounding_tolerance: '0.01',
    currency: 'VND', rounding_mode: 'HALF_AWAY_FROM_ZERO_2DP', vat_basis: 'INCLUDING_VAT', vat_rate: '5.000000',
    vat_divisor: '1.050000', vat_source: 'invoice.vat', vat_missing_reason: null, cost_candidate_status: 'READY',
    cost_candidate_reason: 'EXACT_POLICY', cost_policy_version: 3, cost_policy_checksum: 'c'.repeat(64), c32_base_amount: '10.00',
    c47_total_candidate_amount: '14.00',
  };
  for (let code = 33; code <= 46; code += 1) value[`c${code}_candidate_amount`] = '1.00';
  return { ...value, ...overrides };
}
function envelope(rows, overrides = {}) {
  const sum = checksum(rows);
  return {
    contract: 'app-sale-reconciliation-shadow-v3', shadow_only: true, effective_values_changed: false,
    period: '2026-07', contractor_code: 'NT1', contractor_name: 'N', reconciliation_version: 3,
    reconciliation_rows_checksum_v2: 'b'.repeat(64), shadow_snapshot_version: 2, shadow_snapshot_checksum: sum,
    immutable_version: 2, immutable_checksum: sum, snapshot_source: 'DURABLE_MAPPING', confirmed_by: 'VP018',
    confirmed_at: '2026-08-09T00:00:00.987Z', total_rows: rows.length, ...overrides,
  };
}

test('contractor canonicalization matches deploy-safe App Sale Unicode path contract', () => {
  assert.equal(normalizeContractorCode('20.hđs'), '20.HĐS');
  assert.equal(normalizeContractorCode('05.A&B'), '05.A&B');
  for (const invalid of [
    '20.HỒS'.normalize('NFD'), 'NT/1', 'NT\\1', '../NT1', 'NT..1', 'ＮＴ１', 'NТ1', 'NT\u202e1', ' NT 1 ',
  ]) assert.equal(normalizeContractorCode(invalid), '', invalid);
});

test('canonical consumer matches the exact App Sale v3 permitted wire fields', () => {
  assert.deepEqual(Object.keys(canonicalRow(row(1))), ROW_KEYS);
  assert.equal(ROW_KEYS.some((key) => /rate_percent/i.test(key)), false);
  assert.throws(() => canonicalRow({ ...row(1), c33_rate_percent: '10' }), /Invalid App Sale/);
});

test('pins versions/checksums/provenance across pages and recomputes ordered checksum', () => {
  const rows = [row(1), row(2)];
  const base = envelope(rows);
  const output = combinePages([
    { ...base, rows: [rows[0]], offset: 0, next_offset: 1, has_more: true },
    { ...base, rows: [rows[1]], offset: 1, next_offset: null, has_more: false },
  ], { period: '2026-07', contractorCode: 'NT1' });
  assert.equal(output.rows.length, 2);
  for (const drift of [
    { shadow_snapshot_version: 9 }, { immutable_version: 9 }, { immutable_checksum: 'd'.repeat(64) },
    { reconciliation_rows_checksum_v2: 'e'.repeat(64) }, { confirmed_at: '2026-08-09T00:00:01.987Z' },
  ]) {
    assert.throws(() => combinePages([
      { ...base, rows: [rows[0]], offset: 0, next_offset: 1, has_more: true },
      { ...base, ...drift, rows: [rows[1]], offset: 1, next_offset: null, has_more: false },
    ], { period: '2026-07', contractorCode: 'NT1' }));
  }
  assert.throws(() => combinePages([{ ...base, rows: rows.slice().reverse(), offset: 0, next_offset: null, has_more: false }], { period: '2026-07', contractorCode: 'NT1' }));
  assert.throws(() => combinePages([{ ...base, unexpected_private_field: 'reject', rows, offset: 0, next_offset: null, has_more: false }], { period: '2026-07', contractorCode: 'NT1' }));
});

test('loader pins reconciliation version, uses secondary key header and rejects oversize response', async () => {
  const rows = [row(1), row(2)];
  const base = envelope(rows);
  const calls = [];
  const pages = [
    { ...base, rows: [rows[0]], offset: 0, next_offset: 1, has_more: true },
    { ...base, rows: [rows[1]], offset: 1, next_offset: null, has_more: false },
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const body = JSON.stringify(pages[calls.length - 1]);
    return { ok: true, status: 200, headers: { get: () => String(Buffer.byteLength(body)) }, text: async () => body };
  };
  const snapshot = await loadSnapshot({ period: '2026-07', contractorCode: 'nt1', baseUrl: 'https://sale.invalid', key: 'secondary', fetchImpl });
  assert.equal(snapshot.rows.length, 2);
  assert.match(calls[0].url, /offset=0/);
  assert.doesNotMatch(calls[0].url, /phien_ban/);
  assert.match(calls[1].url, /offset=1.*phien_ban=3|phien_ban=3.*offset=1/);
  assert.equal(calls[0].options.headers['x-datahub-key'], 'secondary');
  assert.equal(calls[0].options.method, 'GET');
  await assert.rejects(() => loadSnapshot({
    period: '2026-07', contractorCode: 'NT1', baseUrl: 'https://sale.invalid', key: 'secondary',
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => String(1024 * 1024 + 1) }, text: async () => '' }),
  }), /Invalid App Sale|unavailable/);
});


test('loader percent-encodes one NFC Vietnamese contractor segment and pins canonical response identity', async () => {
  const contractorCode = '20.HĐS';
  const rows = [row(1, { contractor_code: contractorCode })];
  const page = {
    ...envelope(rows, { contractor_code: contractorCode }), rows, offset: 0, next_offset: null, has_more: false,
  };
  let requested;
  const output = await loadSnapshot({
    period: '2026-07', contractorCode: '20.hđs', baseUrl: 'https://sale.invalid', key: 'secondary',
    fetchImpl: async (url) => {
      requested = String(url);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(page) };
    },
  });
  assert.equal(new URL(requested).pathname, '/api/integrations/app-report/reconciliation-shadow/v3/2026-07/20.H%C4%90S');
  assert.equal(output.contractor_code, contractorCode);
  await assert.rejects(() => loadSnapshot({
    period: '2026-07', contractorCode: '20.HỒS'.normalize('NFD'), baseUrl: 'https://sale.invalid', key: 'secondary',
    fetchImpl: async () => { throw new Error('must not call network'); },
  }), /Invalid App Sale shadow reconciliation input/);
});
