'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'DEBTS_INVOICE_SHADOW';
const SCHEMA_VERSION = 1;
const CONTRACT_PATH = '/api/integrations/app-report/sales-ledger';
const REVISION_MODE = 'full_period_replacement';
const MAX_ROWS = 500_000;
const REQUIRED_ROW_FIELDS = Object.freeze([
  'legal_entity', 'invoice_date', 'invoice_number', 'invoice_line_id',
  'unit_code', 'qlnb_code', 'uom', 'quantity', 'unit_price_before_vat',
  'before_vat', 'vat_amount', 'after_vat', 'row_type', 'row_checksum',
]);

class DebtsShadowError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'DebtsShadowError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details) { throw new DebtsShadowError(code, details); }
function text(value, max = 300) { return String(value ?? '').normalize('NFC').trim().slice(0, max); }
function upper(value, max) { return text(value, max).toUpperCase(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function stableValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = stableValue(value[key]);
  }
  return out;
}

function canonicalJson(value) { return JSON.stringify(stableValue(value)); }

function parseDecimal(value, field = 'amount') {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    fail('DEBTS_DECIMAL_INVALID', { field });
  }
  const negative = value.startsWith('-');
  const raw = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = raw.split('.');
  const scale = fraction.length;
  let units = BigInt(whole + fraction);
  if (negative) units = -units;
  return { units, scale };
}

function decimalAtScale(decimal, scale) {
  if (decimal.scale === scale) return decimal.units;
  if (decimal.scale > scale) fail('DEBTS_DECIMAL_SCALE_LOSS');
  return decimal.units * (10n ** BigInt(scale - decimal.scale));
}

function decimalAdd(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { units: decimalAtScale(left, scale) + decimalAtScale(right, scale), scale };
}

function decimalSubtract(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { units: decimalAtScale(left, scale) - decimalAtScale(right, scale), scale };
}

function decimalEqual(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return decimalAtScale(left, scale) === decimalAtScale(right, scale);
}

function decimalString(decimal) {
  const negative = decimal.units < 0n;
  let digits = (negative ? -decimal.units : decimal.units).toString();
  if (decimal.scale) digits = digits.padStart(decimal.scale + 1, '0');
  const value = decimal.scale
    ? `${digits.slice(0, -decimal.scale)}.${digits.slice(-decimal.scale)}`
    : digits;
  return negative && decimal.units !== 0n ? `-${value}` : value;
}

function sumDecimals(values) {
  return values.reduce((total, value) => decimalAdd(total, parseDecimal(value)), { units: 0n, scale: 0 });
}

function normalizePeriod(value) {
  const period = text(value, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail('DEBTS_PERIOD_INVALID');
  return period;
}

function validateSnapshotHeader(snapshot, period) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('DEBTS_SNAPSHOT_MISSING');
  const snapshotId = text(snapshot.snapshotId, 160);
  const sourceRevision = text(snapshot.sourceRevision, 160);
  const checksum = text(snapshot.checksum, 80).toLowerCase().replace(/^sha256:/, '');
  if (!snapshotId || !sourceRevision) fail('DEBTS_SNAPSHOT_IDENTITY_MISSING');
  if (snapshot.period !== period || snapshot.schemaVersion !== SCHEMA_VERSION) fail('DEBTS_SNAPSHOT_CONTRACT_MISMATCH');
  if (snapshot.revisionMode !== REVISION_MODE) fail('DEBTS_REVISION_MODE_UNSUPPORTED');
  if (!Number.isSafeInteger(snapshot.rowCount) || snapshot.rowCount < 0 || snapshot.rowCount > MAX_ROWS) fail('DEBTS_SNAPSHOT_ROW_COUNT_INVALID');
  if (!Number.isSafeInteger(snapshot.invoiceCount) || snapshot.invoiceCount < 0) fail('DEBTS_SNAPSHOT_INVOICE_COUNT_INVALID');
  if (!/^[a-f0-9]{64}$/.test(checksum)) fail('DEBTS_SNAPSHOT_CHECKSUM_INVALID');
  for (const field of ['beforeVat', 'vat', 'afterVat']) parseDecimal(snapshot.totals?.[field], `snapshot.totals.${field}`);
  return { snapshotId, sourceRevision, checksum };
}

function combineSnapshotPages(pages, { period, contractChecksum } = {}) {
  const expectedPeriod = normalizePeriod(period);
  const contract = text(contractChecksum, 80).toLowerCase().replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(contract)) fail('DEBTS_CONTRACT_CHECKSUM_REQUIRED');
  if (!Array.isArray(pages) || !pages.length) fail('DEBTS_PAGES_EMPTY');
  const first = pages[0];
  const identity = validateSnapshotHeader(first.snapshot, expectedPeriod);
  const rows = [];
  const cursors = new Set();
  pages.forEach((page, index) => {
    const current = validateSnapshotHeader(page?.snapshot, expectedPeriod);
    if (canonicalJson(page.snapshot) !== canonicalJson(first.snapshot)
      || current.snapshotId !== identity.snapshotId || current.sourceRevision !== identity.sourceRevision) {
      fail('DEBTS_SNAPSHOT_DRIFT_BETWEEN_PAGES', { index });
    }
    if (!Array.isArray(page.rows)) fail('DEBTS_PAGE_ROWS_INVALID', { index });
    rows.push(...page.rows);
    const cursor = page.nextCursor == null ? null : text(page.nextCursor, 500);
    if (cursor !== null && (!cursor || cursors.has(cursor))) fail('DEBTS_CURSOR_INVALID', { index });
    if (cursor !== null) cursors.add(cursor);
    const isLast = index === pages.length - 1;
    if (isLast !== (cursor === null)) fail('DEBTS_PAGINATION_INCOMPLETE', { index });
  });
  if (rows.length !== first.snapshot.rowCount) fail('DEBTS_ROW_COUNT_MISMATCH', { expected: first.snapshot.rowCount, actual: rows.length });
  const computedChecksum = snapshotRowsChecksum(rows);
  if (computedChecksum !== identity.checksum) fail('DEBTS_SNAPSHOT_CHECKSUM_MISMATCH');
  return { snapshot: stableValue(first.snapshot), rows, contractChecksum: contract };
}

function snapshotRowsChecksum(rows) {
  if (!Array.isArray(rows)) fail('DEBTS_ROWS_INVALID');
  const ordered = [...rows].sort((a, b) => {
    const ak = `${upper(a?.legal_entity, 80)}|${text(a?.invoice_line_id, 180)}`;
    const bk = `${upper(b?.legal_entity, 80)}|${text(b?.invoice_line_id, 180)}`;
    return ak.localeCompare(bk, 'en');
  });
  return sha256(canonicalJson(ordered));
}

function mappingIndex(mappingSnapshot) {
  if (!mappingSnapshot || typeof mappingSnapshot !== 'object' || !Array.isArray(mappingSnapshot.rows)) fail('DEBTS_MAPPING_SNAPSHOT_INVALID');
  const version = text(mappingSnapshot.version, 160);
  const checksum = text(mappingSnapshot.checksum, 80).toLowerCase().replace(/^sha256:/, '');
  if (!version || !/^[a-f0-9]{64}$/.test(checksum)) fail('DEBTS_MAPPING_IDENTITY_INVALID');
  const byKey = new Map();
  for (const row of mappingSnapshot.rows) {
    const legal = upper(row.legal_entity, 80);
    const unit = upper(row.unit_code, 180);
    const qlnb = upper(row.qlnb_code, 180);
    const emp = upper(row.emp_code, 80);
    if (!legal || !unit || !qlnb || !emp) fail('DEBTS_MAPPING_ROW_INVALID');
    const key = `${legal}|${unit}|${qlnb}`;
    const values = byKey.get(key) || [];
    values.push({ emp_code: emp, uom: upper(row.uom, 100) || null });
    byKey.set(key, values);
  }
  return { version, checksum, byKey };
}

function normalizeRow(row, index, mappings) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('DEBTS_ROW_INVALID', { index });
  for (const field of REQUIRED_ROW_FIELDS) if (row[field] === undefined || row[field] === null || row[field] === '') fail('DEBTS_ROW_FIELD_MISSING', { index, field });
  const legalEntity = upper(row.legal_entity, 80);
  const lineId = text(row.invoice_line_id, 180);
  const invoiceNumber = text(row.invoice_number, 180);
  const unitCode = upper(row.unit_code, 180);
  const qlnbCode = upper(row.qlnb_code, 180);
  const uom = upper(row.uom, 100);
  const rowChecksum = text(row.row_checksum, 80).toLowerCase().replace(/^sha256:/, '');
  if (!legalEntity || !lineId || !invoiceNumber || !unitCode || !qlnbCode || !uom) fail('DEBTS_ROW_IDENTITY_INVALID', { index });
  if (!/^[a-f0-9]{64}$/.test(rowChecksum)) fail('DEBTS_ROW_CHECKSUM_INVALID', { index });
  const invoiceDate = text(row.invoice_date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
    || new Date(`${invoiceDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== invoiceDate) {
    fail('DEBTS_INVOICE_DATE_INVALID', { index });
  }
  const rawBefore = parseDecimal(row.before_vat, 'before_vat');
  const rawVat = parseDecimal(row.vat_amount, 'vat_amount');
  const rawAfter = parseDecimal(row.after_vat, 'after_vat');
  parseDecimal(row.quantity, 'quantity');
  parseDecimal(row.unit_price_before_vat, 'unit_price_before_vat');
  const amountInconsistent = !decimalEqual(decimalAdd(rawBefore, rawVat), rawAfter);
  const canonicalBefore = amountInconsistent ? decimalSubtract(rawAfter, rawVat) : rawBefore;
  const reconstructionDelta = decimalSubtract(canonicalBefore, rawBefore);
  const key = `${legalEntity}|${unitCode}|${qlnbCode}`;
  const candidates = mappings.byKey.get(key) || [];
  const uniqueEmployees = [...new Set(candidates.map((item) => item.emp_code))];
  let mappingStatus = 'mapped'; let empCode = uniqueEmployees[0] || null;
  if (!candidates.length) mappingStatus = 'unmapped';
  else if (uniqueEmployees.length !== 1) { mappingStatus = 'ambiguous'; empCode = null; }
  else if (!candidates.some((item) => item.uom === null || item.uom === uom)) { mappingStatus = 'uom_mismatch'; empCode = null; }
  const quarantineReasons = [];
  if (amountInconsistent) quarantineReasons.push('amount_inconsistent');
  if (mappingStatus !== 'mapped') quarantineReasons.push(mappingStatus);
  return Object.freeze({
    source: SOURCE,
    source_line_id: `DEBTS:${legalEntity}:${lineId}`,
    legal_entity: legalEntity,
    invoice_date: invoiceDate,
    invoice_number: invoiceNumber,
    invoice_line_id: lineId,
    unit_code: unitCode,
    qlnb_code: qlnbCode,
    uom,
    quantity: row.quantity,
    unit_price_before_vat: row.unit_price_before_vat,
    row_type: upper(row.row_type, 60),
    row_checksum: rowChecksum,
    source_before_vat_raw: decimalString(rawBefore),
    source_vat_raw: decimalString(rawVat),
    source_after_vat_raw: decimalString(rawAfter),
    revenue_before_vat: decimalString(canonicalBefore),
    vat_amount: decimalString(rawVat),
    revenue_after_vat: decimalString(rawAfter),
    revenue: decimalString(rawAfter),
    amount_inconsistent: amountInconsistent,
    amount_reconstructed: amountInconsistent,
    reconstruction_delta: decimalString(reconstructionDelta),
    mapping_status: mappingStatus,
    emp_code: empCode,
    quarantine: quarantineReasons.length > 0,
    quarantine_reasons: Object.freeze(quarantineReasons),
  });
}

function totalsFor(rows, prefix) {
  return Object.freeze({
    beforeVat: decimalString(sumDecimals(rows.map((row) => row[`${prefix}_before`]))),
    vat: decimalString(sumDecimals(rows.map((row) => row[`${prefix}_vat`]))),
    afterVat: decimalString(sumDecimals(rows.map((row) => row[`${prefix}_after`]))),
  });
}

function receiptTotals(rows) {
  const values = rows.map((row) => ({
    raw_before: row.source_before_vat_raw, raw_vat: row.source_vat_raw, raw_after: row.source_after_vat_raw,
    canonical_before: row.revenue_before_vat, canonical_vat: row.vat_amount, canonical_after: row.revenue_after_vat,
  }));
  return Object.freeze({ raw: totalsFor(values, 'raw'), canonical: totalsFor(values, 'canonical') });
}

function materializeShadow(combined, mappingSnapshot, { codeRevision = 'unknown' } = {}) {
  if (!combined?.snapshot || !Array.isArray(combined.rows)) fail('DEBTS_COMBINED_SNAPSHOT_INVALID');
  const mappings = mappingIndex(mappingSnapshot);
  const seen = new Set();
  const rows = combined.rows.map((row, index) => {
    const normalized = normalizeRow(row, index, mappings);
    if (seen.has(normalized.source_line_id)) fail('DEBTS_DUPLICATE_LINE_ID', { sourceLineId: normalized.source_line_id });
    seen.add(normalized.source_line_id);
    return normalized;
  });
  const mapped = rows.filter((row) => !row.quarantine);
  const quarantined = rows.filter((row) => row.quarantine);
  const invoices = new Set(rows.map((row) => `${row.legal_entity}|${row.invoice_number}`));
  if (invoices.size !== combined.snapshot.invoiceCount) fail('DEBTS_INVOICE_COUNT_MISMATCH');
  const rawTotals = receiptTotals(rows).raw;
  const declared = combined.snapshot.totals;
  for (const [actual, expected, field] of [
    [rawTotals.beforeVat, declared.beforeVat, 'beforeVat'], [rawTotals.vat, declared.vat, 'vat'], [rawTotals.afterVat, declared.afterVat, 'afterVat'],
  ]) if (!decimalEqual(parseDecimal(actual), parseDecimal(expected))) fail('DEBTS_TOTAL_MISMATCH', { field });
  const receipt = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    endpoint: CONTRACT_PATH,
    period: combined.snapshot.period,
    snapshotId: combined.snapshot.snapshotId,
    sourceRevision: combined.snapshot.sourceRevision,
    revisionMode: combined.snapshot.revisionMode,
    sourceChecksum: combined.snapshot.checksum,
    contractChecksum: combined.contractChecksum,
    mappingVersion: mappings.version,
    mappingChecksum: mappings.checksum,
    codeRevision: text(codeRevision, 160),
    rowCount: rows.length,
    invoiceCount: invoices.size,
    mappedCount: mapped.length,
    quarantinedCount: quarantined.length,
    mappingStatusCounts: Object.freeze(rows.reduce((acc, row) => { acc[row.mapping_status] = (acc[row.mapping_status] || 0) + 1; return acc; }, {})),
    totals: receiptTotals(rows),
    mappedTotals: receiptTotals(mapped),
    quarantinedTotals: receiptTotals(quarantined),
    reconstructionDelta: decimalString(sumDecimals(rows.map((row) => row.reconstruction_delta))),
    rowsChecksum: sha256(canonicalJson(rows)),
    selectorChanged: false,
  });
  return Object.freeze({ rows: Object.freeze(rows), mapped: Object.freeze(mapped), quarantined: Object.freeze(quarantined), receipt });
}

function fsyncDir(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function atomicJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  fsyncDir(path.dirname(file));
}

function acquireShadowLock(dataDir, period) {
  const file = shadowLockFile(dataDir, period);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(24).toString('hex');
  const owner = { schemaVersion: 1, token, pid: process.pid, host: require('node:os').hostname(), acquiredAt: new Date().toISOString() };
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(owner)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fsyncDir(path.dirname(file));
  } catch (error) {
    if (error.code === 'EEXIST') fail('DEBTS_SHADOW_LOCKED', { period: normalizePeriod(period) });
    throw error;
  }
  return () => {
    let current;
    try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('DEBTS_SHADOW_LOCK_OWNERSHIP_LOST'); }
    if (current.token !== token) fail('DEBTS_SHADOW_LOCK_OWNERSHIP_LOST');
    fs.unlinkSync(file); fsyncDir(path.dirname(file));
  };
}

function publishShadow(result, { dataDir, allowWrite = false } = {}) {
  if (allowWrite !== true) fail('DEBTS_SHADOW_WRITE_DISABLED');
  const root = path.resolve(String(dataDir || ''));
  const suffix = path.join('revenue-shadow', 'debts');
  if (!root.endsWith(suffix)) fail('DEBTS_SHADOW_ROOT_INVALID');
  const period = normalizePeriod(result?.receipt?.period);
  const snapshotId = text(result?.receipt?.snapshotId, 160);
  if (!/^[A-Za-z0-9._-]+$/.test(snapshotId)) fail('DEBTS_SNAPSHOT_PATH_INVALID');
  const releaseLock = acquireShadowLock(root, period);
  try {
    const periodDir = path.join(root, period);
    const target = path.join(periodDir, snapshotId);
    fs.mkdirSync(periodDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(periodDir, 0o700);
    if (fs.existsSync(target)) fail('DEBTS_SHADOW_IMMUTABLE_EXISTS');
    const stage = fs.mkdtempSync(path.join(periodDir, `.stage-${process.pid}-`));
    try {
      fs.chmodSync(stage, 0o700);
      atomicJson(path.join(stage, 'rows.json'), result.rows);
      atomicJson(path.join(stage, 'quarantine.json'), result.quarantined);
      atomicJson(path.join(stage, 'receipt.json'), result.receipt);
      fs.renameSync(stage, target);
      fsyncDir(periodDir);
    } catch (error) {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* best effort */ }
      throw error;
    }
    return target;
  } finally {
    releaseLock();
  }
}

async function fetchSnapshotPages({ endpoint, token, period, contractChecksum, pageSize = 500, fetchImpl = globalThis.fetch } = {}) {
  const expectedPeriod = normalizePeriod(period);
  let base;
  try { base = new URL(String(endpoint || '')); } catch { fail('DEBTS_ENDPOINT_INVALID'); }
  if (base.protocol !== 'https:' || base.pathname !== CONTRACT_PATH) fail('DEBTS_ENDPOINT_NOT_ALLOWLISTED');
  if (!token || typeof fetchImpl !== 'function') fail('DEBTS_S2S_CONTRACT_UNAVAILABLE');
  const pages = [];
  let cursor = null;
  const seen = new Set();
  do {
    const url = new URL(base);
    url.searchParams.set('period', expectedPeriod);
    url.searchParams.set('limit', String(Math.max(1, Math.min(1000, Number(pageSize) || 500))));
    if (cursor) url.searchParams.set('cursor', cursor);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response;
    try {
      response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: controller.signal });
    } catch { fail('DEBTS_S2S_UNAVAILABLE'); }
    finally { clearTimeout(timeout); }
    if (!response?.ok) fail('DEBTS_S2S_UPSTREAM_ERROR', { status: Number(response?.status) || 502 });
    let page;
    try { page = await response.json(); } catch { fail('DEBTS_S2S_RESPONSE_INVALID'); }
    pages.push(page);
    cursor = page.nextCursor == null ? null : text(page.nextCursor, 500);
    if (cursor && seen.has(cursor)) fail('DEBTS_CURSOR_INVALID');
    if (cursor) seen.add(cursor);
    if (pages.length > 1000) fail('DEBTS_PAGE_LIMIT_EXCEEDED');
  } while (cursor);
  return combineSnapshotPages(pages, { period: expectedPeriod, contractChecksum });
}
function shadowLockFile(dataDir, period) {
  const root = path.resolve(String(dataDir || ''));
  if (!root.endsWith(path.join('revenue-shadow', 'debts'))) fail('DEBTS_SHADOW_ROOT_INVALID');
  return path.join(root, `debts_invoice_shadow_${normalizePeriod(period)}.lock`);
}

module.exports = {
  SOURCE, SCHEMA_VERSION, CONTRACT_PATH, REVISION_MODE, REQUIRED_ROW_FIELDS, DebtsShadowError,
  stableValue, canonicalJson, parseDecimal, decimalAdd, decimalSubtract, decimalEqual, decimalString,
  snapshotRowsChecksum, combineSnapshotPages, mappingIndex, materializeShadow,
  publishShadow, shadowLockFile, acquireShadowLock, fetchSnapshotPages,
};
