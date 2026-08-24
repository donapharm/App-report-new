'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const shadow = require('../src/debtsInvoiceShadow');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const CONTRACT_SHA = shadow.CONTRACT_CHECKSUM;
const SIGNING_KEY = Buffer.alloc(32, 7);
const SIGNING_KEY_ID = 'test-receipt-key-v1';

function sourceRow(overrides = {}) {
  const row = {
    legal_entity: 'DONA', invoice_date: '2026-08-05', invoice_number: '00000001', invoice_line_id: 'line-1',
    unit_code: '033.BV A', qlnb_code: 'G1.A', uom: 'HOP', quantity: '2.00', unit_price_before_vat: '100',
    before_vat: '200', vat_amount: '10', after_vat: '210', row_type: 'SALE',
  };
  const result = { ...row, ...overrides };
  if (!Object.hasOwn(overrides, 'row_checksum')) result.row_checksum = shadow.sourceRowChecksum(result);
  return result;
}

function mapping(rows = [
  { legal_entity: 'DONA', unit_code: '033.BV A', qlnb_code: 'G1.A', uom: 'HOP', emp_code: 'DN001' },
]) {
  const grouped = new Map();
  rows.forEach((row, index) => {
    const key = `${row.unit_code}|${row.qlnb_code}`;
    const candidates = grouped.get(key) || [];
    candidates.push({ employeeCode: row.emp_code, uom: row.uom, sourceLineId: `catalog-line-${index}` });
    grouped.set(key, candidates);
  });
  const nativeRows = [...grouped].map(([key, candidates]) => {
    const [unitCode, qlnbCode] = key.split('|');
    return {
      unitCode, qlnbCode, candidates,
      employeeConflict: new Set(candidates.map((item) => item.employeeCode)).size > 1,
      uomConflict: new Set(candidates.map((item) => item.uom)).size > 1,
    };
  });
  const partitionRows = rows.length
    ? [...new Map(rows.map((row) => [`${row.legal_entity}|${row.unit_code}|${row.qlnb_code}`, { legal_entity: row.legal_entity, unit_code: row.unit_code, qlnb_code: row.qlnb_code }])).values()]
    : [{ legal_entity: 'DONA', unit_code: '033.BV A', qlnb_code: 'G1.A' }];
  return {
    version: 'V31.7/9', sourceManifestId: 'catalog52-2026-08-v31.7.9',
    sourceManifestChecksum: digest('catalog52-manifest-v31.7.9'),
    checksum: shadow.mappingArtifactChecksum(nativeRows),
    contract: {
      unitCodeColumn: 'c7', qlnbColumn: 'c5', employeeColumn: 'c6', uomColumn: 'c8', uomMode: 'validation',
    },
    rows: nativeRows,
    legalEntityAttestation: {
      contract: shadow.LEGAL_ENTITY_CONTRACT_KIND, checksum: digest(shadow.canonicalJson(partitionRows)), rows: partitionRows,
    },
  };
}

function pagesFor(rows, pageSize = rows.length) {
  const totals = {
    beforeVat: total(rows, 'before_vat'), vat: total(rows, 'vat_amount'), afterVat: total(rows, 'after_vat'),
  };
  const snapshot = {
    snapshotId: 'debts-2026-08-r1', period: '2026-08', sourceRevision: 'r1', revisionMode: 'full_period_replacement', schemaVersion: 1,
    contractChecksum: CONTRACT_SHA, legal_entity: rows[0]?.legal_entity || 'DONA', currency: 'VND',
    rowChecksumAlgorithm: shadow.ROW_CHECKSUM_ALGORITHM,
    rowCount: rows.length, invoiceCount: new Set(rows.map((r) => `${r.legal_entity}|${r.invoice_number}`)).size,
    checksum: `sha256:${shadow.snapshotRowsChecksum(rows)}`, totals, createdAt: '2026-08-18T00:00:00.000Z',
  };
  const pages = [];
  for (let at = 0; at < rows.length; at += pageSize) {
    const pageNo = pages.length + 1;
    const end = Math.min(rows.length, at + pageSize);
    pages.push({ snapshot, rows: rows.slice(at, end), nextCursor: end < rows.length ? `cursor-${pageNo}` : null, finalize: end === rows.length });
  }
  if (!rows.length) pages.push({ snapshot, rows: [], nextCursor: null, finalize: true });
  return pages;
}

function total(rows, field) {
  return shadow.decimalString(rows.map((row) => shadow.parseDecimal(row[field]))
    .reduce(shadow.decimalAdd, { units: 0n, scale: 0 }));
}

function materialize(rows, map = mapping()) {
  return shadow.materializeShadow(
    shadow.combineSnapshotPages(pagesFor(rows, 1), { period: '2026-08', contractChecksum: CONTRACT_SHA }),
    map,
    { codeRevision: 'candidate-test' },
  );
}

test('decimal strings keep exact scale/sign and reject float/exponent/thousand separators', () => {
  assert.equal(shadow.decimalString(shadow.parseDecimal('-17329000')), '-17329000');
  assert.equal(shadow.decimalString(shadow.decimalSubtract(shadow.parseDecimal('-17329000'), shadow.parseDecimal('-825190'))), '-16503810');
  assert.equal(shadow.decimalEqual(shadow.parseDecimal('1.0'), shadow.parseDecimal('1.00')), true);
  for (const bad of [1.1, '1e3', '1,000', '1.0000001', '+1', '01']) {
    assert.throws(() => shadow.parseDecimal(bad), { code: 'DEBTS_DECIMAL_INVALID' });
  }
});

test('multi-page snapshot pins one identity, checksum, row/invoice counts and final cursor', () => {
  const rows = [sourceRow(), sourceRow({ invoice_line_id: 'line-2', qlnb_code: 'G1.B', invoice_number: '00000002' })];
  const pages = pagesFor(rows, 1);
  const combined = shadow.combineSnapshotPages(pages, { period: '2026-08', contractChecksum: CONTRACT_SHA });
  assert.equal(combined.rows.length, 2);
  assert.equal(combined.contractChecksum, CONTRACT_SHA);

  const drift = structuredClone(pages); drift[1].snapshot = { ...drift[1].snapshot, sourceRevision: 'r2' };
  assert.throws(() => shadow.combineSnapshotPages(drift, { period: '2026-08', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_SNAPSHOT_DRIFT_BETWEEN_PAGES' });
  const loop = structuredClone(pages); loop[1].nextCursor = 'cursor-1';
  assert.throws(() => shadow.combineSnapshotPages(loop, { period: '2026-08', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_CURSOR_INVALID' });
  const truncated = structuredClone(pages); truncated.pop(); truncated[0].nextCursor = null; truncated[0].finalize = true;
  assert.throws(() => shadow.combineSnapshotPages(truncated, { period: '2026-08', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_ROW_COUNT_MISMATCH' });
  const corrupted = structuredClone(pages); corrupted[0].rows[0].after_vat = '211.00';
  assert.throws(() => shadow.combineSnapshotPages(corrupted, { period: '2026-08', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_SNAPSHOT_CHECKSUM_MISMATCH' });
  const incremental = structuredClone(pages); incremental[0].snapshot = { ...incremental[0].snapshot, revisionMode: 'incremental' };
  assert.throws(() => shadow.combineSnapshotPages(incremental, { period: '2026-08', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_REVISION_MODE_UNSUPPORTED' });
});

test('contract checksum, VND/legal-entity header and final-page marker are mandatory', () => {
  const pages = pagesFor([sourceRow()]);
  assert.throws(() => shadow.combineSnapshotPages(pages, { period: '2026-08', contractChecksum: digest('wrong-contract') }), { code: 'DEBTS_CONTRACT_CHECKSUM_MISMATCH' });
  const wrongDeclared = structuredClone(pages); wrongDeclared[0].snapshot.contractChecksum = digest('wrong-contract');
  assert.throws(() => shadow.combineSnapshotPages(wrongDeclared, { period: '2026-08', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_CONTRACT_CHECKSUM_MISMATCH' });
  const wrongCurrency = structuredClone(pages); wrongCurrency[0].snapshot.currency = 'USD';
  assert.throws(() => shadow.combineSnapshotPages(wrongCurrency, { period: '2026-08', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_HEADER_CURRENCY_INVALID' });
  const mixedEntity = structuredClone(pages); mixedEntity[0].rows[0].legal_entity = 'AFP';
  assert.throws(() => shadow.combineSnapshotPages(mixedEntity, { period: '2026-08', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_ROW_LEGAL_ENTITY_MISMATCH' });
  const unfinished = structuredClone(pages); unfinished[0].finalize = false;
  assert.throws(() => shadow.combineSnapshotPages(unfinished, { period: '2026-08', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_FINALIZE_MARKER_INVALID' });
});

test('period derives from invoice_date, locked periods fail closed and 2026-06 is always blocked', () => {
  assert.throws(() => materialize([sourceRow({ invoice_date: '2026-07-31' })]), { code: 'DEBTS_ROW_PERIOD_MISMATCH' });
  assert.throws(() => shadow.combineSnapshotPages(pagesFor([sourceRow()]), { period: '2026-08', contractChecksum: CONTRACT_SHA, lockedPeriods: ['2026-08'] }), { code: 'DEBTS_PERIOD_LOCKED' });
  const june = pagesFor([sourceRow({ invoice_date: '2026-06-01' })]);
  june.forEach((page) => { page.snapshot.period = '2026-06'; });
  assert.throws(() => shadow.combineSnapshotPages(june, { period: '2026-06', contractChecksum: CONTRACT_SHA }), { code: 'DEBTS_PERIOD_HARD_BLOCKED' });
});

test('VND amounts are integer strings and row-type signs fail closed', () => {
  assert.throws(() => materialize([sourceRow({ before_vat: '200.5', vat_amount: '10', after_vat: '210' })]), { code: 'DEBTS_VND_INTEGER_STRING_REQUIRED' });
  assert.throws(() => materialize([sourceRow({ before_vat: '-200', vat_amount: '-10', after_vat: '-210' })]), { code: 'DEBTS_ROW_SIGN_INVALID' });
  assert.throws(() => materialize([sourceRow({ row_type: 'RETURN', before_vat: '200', vat_amount: '10', after_vat: '210' })]), { code: 'DEBTS_ROW_SIGN_INVALID' });
  assert.equal(materialize([sourceRow({ row_type: 'CANCEL', quantity: '-1', unit_price_before_vat: '0', before_vat: '-200', vat_amount: '-10', after_vat: '-210' })]).rows.length, 1);
});

test('source checksum is order-stable but business-value sensitive', () => {
  const a = sourceRow(); const b = sourceRow({ invoice_line_id: 'line-2' });
  assert.equal(shadow.snapshotRowsChecksum([a, b]), shadow.snapshotRowsChecksum([b, a]));
  assert.notEqual(shadow.snapshotRowsChecksum([a]), shadow.snapshotRowsChecksum([{ ...a, after_vat: '211.00' }]));
});

test('row and mapping checksums plus canonical Catalog52 projection contract fail closed', () => {
  const tamperedRow = sourceRow();
  tamperedRow.after_vat = '211';
  assert.throws(() => materialize([tamperedRow]), { code: 'DEBTS_ROW_CHECKSUM_MISMATCH' });

  const badChecksum = mapping(); badChecksum.checksum = digest('wrong');
  assert.throws(() => materialize([sourceRow()], badChecksum), { code: 'DEBTS_MAPPING_CHECKSUM_MISMATCH' });
  const guessedUom = mapping(); guessedUom.contract.uomMode = 'fallback';
  assert.throws(() => materialize([sourceRow()], guessedUom), { code: 'DEBTS_MAPPING_CONTRACT_INVALID' });
  const sensitiveUom = mapping(); sensitiveUom.contract.uomColumn = 'c32';
  assert.throws(() => materialize([sourceRow()], sensitiveUom), { code: 'DEBTS_MAPPING_CONTRACT_INVALID' });
  const unattested = mapping(); unattested.legalEntityAttestation.rows = [];
  unattested.legalEntityAttestation.checksum = digest(shadow.canonicalJson([]));
  assert.equal(materialize([sourceRow()], unattested).rows[0].mapping_status, 'legal_entity_unattested');
});

test('normal mapped sale preserves raw/canonical triples and uses after-VAT as headline revenue', () => {
  const result = materialize([sourceRow()]);
  assert.equal(result.rows[0].source, 'DEBTS_INVOICE_SHADOW');
  assert.equal(result.rows[0].source_before_vat_raw, '200');
  assert.equal(result.rows[0].revenue_before_vat, '200');
  assert.equal(result.rows[0].vat_amount, '10');
  assert.equal(result.rows[0].revenue_after_vat, '210');
  assert.equal(result.rows[0].revenue, '210');
  assert.equal(result.rows[0].amount_reconstructed, false);
  assert.equal(result.rows[0].mapping_status, 'mapped');
  assert.equal(result.rows[0].emp_code, 'DN001');
  assert.equal(result.mapped.length, 1);
  assert.equal(result.receipt.selectorChanged, false);
});

test('golden 00002319 preserves raw negative triple, reconstructs canonical before and remains quarantined', () => {
  const line = sourceRow({
    invoice_number: '00002319', invoice_line_id: 'adjustment-2319', row_type: 'ADJUSTMENT',
    quantity: '-1', unit_price_before_vat: '0', before_vat: '0', vat_amount: '-825190', after_vat: '-17329000',
  });
  const result = materialize([line]); const row = result.rows[0];
  assert.deepEqual([row.source_before_vat_raw, row.source_vat_raw, row.source_after_vat_raw], ['0', '-825190', '-17329000']);
  assert.deepEqual([row.revenue_before_vat, row.vat_amount, row.revenue_after_vat], ['-16503810', '-825190', '-17329000']);
  assert.equal(row.reconstruction_delta, '-16503810');
  assert.equal(row.amount_inconsistent, true);
  assert.equal(row.amount_reconstructed, true);
  assert.equal(row.quarantine, true);
  assert.deepEqual(row.quarantine_reasons, ['amount_inconsistent', 'invoice_00002319']);
  assert.equal(result.mapped.length, 0);
  assert.equal(result.quarantined.length, 1);
  assert.equal(result.receipt.totals.raw.beforeVat, '0');
  assert.equal(result.receipt.totals.canonical.beforeVat, '-16503810');
  assert.equal(result.receipt.reconstructionDelta, '-16503810');
});

test('invoice 00002319 is quarantined even when its amount triple is internally consistent', () => {
  const row = materialize([sourceRow({ invoice_number: '00002319' })]).rows[0];
  assert.equal(row.amount_inconsistent, false);
  assert.equal(row.quarantine, true);
  assert.deepEqual(row.quarantine_reasons, ['invoice_00002319']);
});

test('mapping is exact legal entity + unit + QLNB; ambiguity/UOM mismatch/unmapped never guesses', () => {
  const base = sourceRow();
  const ambiguous = mapping([
    { legal_entity: 'DONA', unit_code: '033.BV A', qlnb_code: 'G1.A', uom: 'HOP', emp_code: 'DN001' },
    { legal_entity: 'DONA', unit_code: '033.BV A', qlnb_code: 'G1.A', uom: 'HOP', emp_code: 'DN002' },
  ]);
  assert.equal(materialize([base], ambiguous).rows[0].mapping_status, 'ambiguous');
  assert.equal(materialize([base], mapping([{ legal_entity: 'DONA', unit_code: '033.BV A', qlnb_code: 'G1.A', uom: 'CHAI', emp_code: 'DN001' }])).rows[0].mapping_status, 'uom_mismatch');
  assert.equal(materialize([base], mapping([])).rows[0].mapping_status, 'unmapped');
  assert.equal(materialize([sourceRow({ legal_entity: 'AFP' })]).rows[0].mapping_status, 'legal_entity_unattested');
});

test('duplicate immutable line ID fails closed while two equal-value lines with distinct IDs survive', () => {
  const first = sourceRow();
  const second = sourceRow({ invoice_line_id: 'line-2' });
  assert.equal(materialize([first, second]).rows.length, 2);
  assert.throws(() => materialize([first, { ...first }]), { code: 'DEBTS_DUPLICATE_LINE_ID' });
});

test('raw mapped + quarantined balances source independently from canonical reconstruction', () => {
  const normal = sourceRow();
  const bad = sourceRow({
    invoice_line_id: 'bad-2', invoice_number: '00000002', row_type: 'ADJUSTMENT', before_vat: '0', vat_amount: '-5', after_vat: '-100',
  });
  const result = materialize([normal, bad]);
  assert.equal(result.receipt.rowCount, result.receipt.mappedCount + result.receipt.quarantinedCount);
  assert.deepEqual(result.receipt.totals.raw, { beforeVat: '200', vat: '5', afterVat: '110' });
  assert.deepEqual(result.receipt.totals.canonical, { beforeVat: '105', vat: '5', afterVat: '110' });
  assert.equal(result.receipt.reconstructionDelta, '-95');
});

test('shadow writer is opt-in, immutable, private, atomic and confined to separate Debts root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-shadow-'));
  const root = path.join(tmp, 'revenue-shadow', 'debts');
  const result = materialize([sourceRow()]);
  try {
    assert.throws(() => shadow.publishShadow(result, { dataDir: root }), { code: 'DEBTS_SHADOW_WRITE_DISABLED' });
    assert.throws(() => shadow.publishShadow(result, { dataDir: path.join(tmp, 'uploads'), allowWrite: true }), { code: 'DEBTS_SHADOW_ROOT_INVALID' });
    assert.throws(() => shadow.publishShadow({ ...result, receipt: { ...result.receipt, snapshotId: '..' } }, { dataDir: root, allowWrite: true }), { code: 'DEBTS_SNAPSHOT_PATH_INVALID' });
    const target = shadow.publishShadow(result, { dataDir: root, allowWrite: true, receiptSigningKey: SIGNING_KEY, receiptSigningKeyId: SIGNING_KEY_ID });
    assert.equal(target, path.join(root, '2026-08', 'debts-2026-08-r1'));
    assert.deepEqual(fs.readdirSync(target).sort(), ['manifest.json', 'quarantine.json', 'receipt.json', 'rows.json']);
    for (const file of fs.readdirSync(target)) assert.equal(fs.statSync(path.join(target, file)).mode & 0o777, 0o600);
    const verified = shadow.verifyPublishedShadow(target, { receiptSigningKey: SIGNING_KEY, receiptSigningKeyId: SIGNING_KEY_ID });
    assert.equal(verified.receipt.rowsChecksum, result.receipt.rowsChecksum);
    assert.throws(() => shadow.publishShadow(result, { dataDir: root, allowWrite: true, receiptSigningKey: SIGNING_KEY, receiptSigningKeyId: SIGNING_KEY_ID }), { code: 'DEBTS_SHADOW_IMMUTABLE_EXISTS' });
    assert.equal(shadow.shadowLockFile(root, '2026-08'), path.join(root, 'debts_invoice_shadow_2026-08.lock'));
    assert.equal(fs.existsSync(path.join(tmp, 'revenue_materialize.lock')), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('receipt signature binds all receipt fields and rejects key mismatch or tampering', () => {
  const receipt = materialize([sourceRow()]).receipt;
  const envelope = shadow.signReceipt(receipt, { key: SIGNING_KEY, keyId: SIGNING_KEY_ID });
  assert.equal(shadow.verifySignedReceipt(envelope, { key: SIGNING_KEY, keyId: SIGNING_KEY_ID }).rowsChecksum, receipt.rowsChecksum);
  const tampered = structuredClone(envelope); tampered.receipt.rowCount = 99;
  assert.throws(() => shadow.verifySignedReceipt(tampered, { key: SIGNING_KEY, keyId: SIGNING_KEY_ID }), { code: 'DEBTS_RECEIPT_SIGNATURE_INVALID' });
  assert.throws(() => shadow.verifySignedReceipt(envelope, { key: Buffer.alloc(32, 8), keyId: SIGNING_KEY_ID }), { code: 'DEBTS_RECEIPT_SIGNATURE_INVALID' });
  assert.throws(() => shadow.signReceipt(receipt, { key: Buffer.alloc(16), keyId: SIGNING_KEY_ID }), { code: 'DEBTS_RECEIPT_SIGNING_KEY_INVALID' });
});

test('period shadow lock excludes a competing writer and is removed by its owner', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-lock-'));
  const root = path.join(tmp, 'revenue-shadow', 'debts');
  try {
    const release = shadow.acquireShadowLock(root, '2026-08');
    assert.throws(() => shadow.acquireShadowLock(root, '2026-08'), { code: 'DEBTS_SHADOW_LOCKED' });
    release();
    assert.equal(fs.existsSync(shadow.shadowLockFile(root, '2026-08')), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('period shadow lock reclaims only an old dead same-host owner after a crash', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-stale-lock-'));
  const root = path.join(tmp, 'revenue-shadow', 'debts');
  const file = shadow.shadowLockFile(root, '2026-08');
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, token: 'dead', pid: 2147483647, host: os.hostname(), acquiredAt: '2000-01-01T00:00:00.000Z' }));
    const release = shadow.acquireShadowLock(root, '2026-08');
    release();
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('S2S adapter allowlists HTTPS contract path, pins pages and never sends token outside Authorization', async () => {
  const rows = [sourceRow(), sourceRow({ invoice_line_id: 'line-2', invoice_number: '00000002' })];
  const pages = pagesFor(rows, 1);
  const calls = [];
  const combined = await shadow.fetchSnapshotPages({
    endpoint: 'https://debts.example.test/api/integrations/app-report/sales-ledger', token: 'SECRET-S2S', period: '2026-08', legalEntity: 'DONA', contractChecksum: CONTRACT_SHA,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), headers: options.headers, redirect: options.redirect });
      const page = calls.length === 1 ? pages[0] : pages[1];
      return { ok: true, status: 200, json: async () => structuredClone(page) };
    },
  });
  assert.equal(combined.rows.length, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes('cursor=cursor-1'));
  assert.equal(calls.every((call) => call.url.includes('legal_entity=DONA')), true);
  assert.equal(calls.every((call) => !call.url.includes('SECRET-S2S') && call.headers.authorization === 'Bearer SECRET-S2S'), true);
  assert.equal(calls.every((call) => call.redirect === 'error'), true);
  await assert.rejects(() => shadow.fetchSnapshotPages({ endpoint: 'http://debts.example.test/api/integrations/app-report/sales-ledger', token: 'x', period: '2026-08', legalEntity: 'DONA', contractChecksum: CONTRACT_SHA, fetchImpl: async () => ({}) }), { code: 'DEBTS_ENDPOINT_NOT_ALLOWLISTED' });
  await assert.rejects(() => shadow.fetchSnapshotPages({ endpoint: 'https://debts.example.test/api/integrations/app-report/sales-ledger?unsafe=1', token: 'x', period: '2026-08', legalEntity: 'DONA', contractChecksum: CONTRACT_SHA, fetchImpl: async () => ({}) }), { code: 'DEBTS_ENDPOINT_NOT_ALLOWLISTED' });
  await assert.rejects(() => shadow.fetchSnapshotPages({
    endpoint: 'https://debts.example.test/api/integrations/app-report/sales-ledger', token: 'x', period: '2026-08', legalEntity: 'DONA', contractChecksum: CONTRACT_SHA,
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => String(8 * 1024 * 1024 + 1) }, json: async () => pages[0] }),
  }), { code: 'DEBTS_S2S_PAGE_TOO_LARGE' });
  await assert.rejects(() => shadow.fetchSnapshotPages({
    endpoint: 'https://debts.example.test/api/integrations/app-report/sales-ledger', token: 'x', period: '2026-08', legalEntity: 'DONA', contractChecksum: CONTRACT_SHA, requestTimeoutMs: 20,
    fetchImpl: async (_url, options) => ({
      ok: true, status: 200,
      body: { getReader: () => ({
        read: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
        cancel: async () => {},
      }) },
    }),
  }), { code: 'DEBTS_S2S_UNAVAILABLE' });
  await assert.rejects(() => shadow.fetchSnapshotPages({
    endpoint: 'https://debts.example.test/api/integrations/app-report/sales-ledger', token: 'x', period: '2026-08',
    fetchImpl: async () => { throw new Error('must not call'); },
  }), { code: 'DEBTS_LEGAL_ENTITY_INVALID' });

  const afpRequested = structuredClone(pages[0]);
  afpRequested.nextCursor = null;
  afpRequested.finalize = true;
  await assert.rejects(() => shadow.fetchSnapshotPages({
    endpoint: 'https://debts.example.test/api/integrations/app-report/sales-ledger', token: 'x', period: '2026-08', legalEntity: 'AFP', contractChecksum: CONTRACT_SHA,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => afpRequested }),
  }), { code: 'DEBTS_SNAPSHOT_LEGAL_ENTITY_MISMATCH' });
});

test('module is dark/add-only: no route, selector, active slot, WEB guard or frozen pin wiring', () => {
  const root = path.join(__dirname, '..');
  const routes = fs.readFileSync(path.join(root, 'src', 'routes.js'), 'utf8');
  const upload = fs.readFileSync(path.join(root, 'src', 'upload.js'), 'utf8');
  const webGuard = fs.readFileSync(path.join(root, 'src', 'revenueCrossPeriodWebGuard.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(root, 'src', 'debtsInvoiceShadow.js'), 'utf8');
  assert.doesNotMatch(routes, /debtsInvoiceShadow|DEBTS_INVOICE_SHADOW/);
  assert.doesNotMatch(upload, /debtsInvoiceShadow|DEBTS_INVOICE_SHADOW/);
  assert.doesNotMatch(webGuard, /DEBTS_INVOICE_SHADOW/);
  assert.doesNotMatch(moduleSource, /revenue_materialize\.lock|active\s*=|slots\.json|EMPLOYEE_COST/);
  assert.doesNotMatch(moduleSource, /Math\.round|\/\s*1\.05|before_vat\s*>\s*0|after_vat\s*>\s*0/);
  assert.match(moduleSource, /selectorChanged:\s*false/);
});

test('WEB/CRM production identities and revenue rule lock remain byte-identical to parent', () => {
  const { execFileSync } = require('node:child_process');
  const repo = path.join(__dirname, '..', '..');
  for (const file of [
    'server/src/revenuePayloadIdentity.js', 'server/src/revenueCrossPeriodWebGuard.js',
    'server/src/appSaleRevenueMirror.js', 'server/config/revenue_rule_lock.json',
  ]) {
    const current = fs.readFileSync(path.join(repo, file));
    const parent = execFileSync('git', ['show', `c14486a5c43bfd060368dd9bdc5023269ad01712:${file}`], { cwd: repo });
    assert.equal(digest(current), digest(parent), file);
  }
});
