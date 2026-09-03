'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'DEBTS_INVOICE_SHADOW';
const SCHEMA_VERSION = 1;
const CONTRACT_PATH = '/api/integrations/app-report/sales-ledger';
const REVISION_MODE = 'full_period_replacement';
const MAX_ROWS = 100_000;
const MAX_PAGE_ROWS = 1_000;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const ROW_CHECKSUM_ALGORITHM = 'sha256-canonical-json-v1';
const CONTRACT_CHECKSUM = 'c505ff6e46a2ae0f862b15779e9ee8d24205e545297d29fd15d0546b741ba1bc';
const CURRENCY = 'VND';
const HARD_BLOCKED_PERIOD = '2026-06';
const LEGAL_ENTITY_CONTRACT_KIND = 'debts-source-legal-entity-partition-v1';
const DATAHUB_MAPPING_CONTRACT_KIND = 'data-hub.app-report.debts-pinned-mapping.v1';
const DATAHUB_ATTESTATION_CONTRACT_KIND = 'data-hub.app-report.debts-legal-entity-attestation.v1';
const SOURCE_LEGAL_ENTITY_CODES = new Set(['01.DONA', '02.AFP']);
const RECEIPT_SIGNATURE_ALGORITHM = 'HMAC-SHA256';
const LOCK_STALE_MS = 5 * 60 * 1000;
const ALLOWED_ROW_TYPES = new Set(['SALE', 'RETURN', 'ADJUSTMENT', 'CANCEL']);
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

function signingMaterial(key, keyId) {
  if (!Buffer.isBuffer(key) || key.length < 32) fail('DEBTS_RECEIPT_SIGNING_KEY_INVALID');
  const id = text(keyId, 120);
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) fail('DEBTS_RECEIPT_SIGNING_KEY_ID_INVALID');
  return { key, keyId: id };
}

function signReceipt(receipt, { key, keyId } = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('DEBTS_RECEIPT_INVALID');
  const material = signingMaterial(key, keyId);
  const value = crypto.createHmac('sha256', material.key).update(canonicalJson(receipt)).digest('hex');
  return Object.freeze({
    schemaVersion: 1,
    receipt: stableValue(receipt),
    signature: Object.freeze({ algorithm: RECEIPT_SIGNATURE_ALGORITHM, keyId: material.keyId, value: `sha256:${value}` }),
  });
}

function verifySignedReceipt(envelope, { key, keyId } = {}) {
  const material = signingMaterial(key, keyId);
  if (!envelope || envelope.schemaVersion !== 1 || !envelope.receipt || envelope.signature?.algorithm !== RECEIPT_SIGNATURE_ALGORITHM
    || envelope.signature.keyId !== material.keyId || !/^sha256:[a-f0-9]{64}$/.test(String(envelope.signature.value || ''))) {
    fail('DEBTS_RECEIPT_SIGNATURE_INVALID');
  }
  const expected = crypto.createHmac('sha256', material.key).update(canonicalJson(envelope.receipt)).digest();
  const actual = Buffer.from(envelope.signature.value.slice(7), 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) fail('DEBTS_RECEIPT_SIGNATURE_INVALID');
  return stableValue(envelope.receipt);
}

function sourceRowChecksum(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('DEBTS_ROW_INVALID');
  const unsigned = { ...row };
  delete unsigned.row_checksum;
  return sha256(canonicalJson(unsigned));
}

function parseDecimal(value, field = 'amount') {
  if (typeof value !== 'string' || value.length > 48 || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
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

function parseVnd(value, field) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(value)) {
    fail('DEBTS_VND_INTEGER_STRING_REQUIRED', { field });
  }
  return parseDecimal(value, field);
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

function normalizeLegalEntity(value) {
  const legalEntity = upper(value, 80);
  if (legalEntity !== 'DONA' && legalEntity !== 'AFP') fail('DEBTS_LEGAL_ENTITY_INVALID');
  return legalEntity;
}

function normalizeSourceLegalEntityCode(value) {
  if (value === undefined || value === null || value === '') return null;
  const sourceCode = upper(value, 80);
  if (!SOURCE_LEGAL_ENTITY_CODES.has(sourceCode)) fail('DEBTS_SOURCE_LEGAL_ENTITY_CODE_INVALID');
  return sourceCode;
}

function validateSnapshotHeader(snapshot, period, contractChecksum) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('DEBTS_SNAPSHOT_MISSING');
  const snapshotId = text(snapshot.snapshotId, 160);
  const sourceRevision = text(snapshot.sourceRevision, 160);
  const checksum = text(snapshot.checksum, 80).toLowerCase().replace(/^sha256:/, '');
  if (!snapshotId || !sourceRevision) fail('DEBTS_SNAPSHOT_IDENTITY_MISSING');
  const declaredContract = text(snapshot.contractChecksum, 80).toLowerCase().replace(/^sha256:/, '');
  const legalEntity = normalizeLegalEntity(snapshot.legal_entity);
  normalizeSourceLegalEntityCode(snapshot.source_legal_entity_code);
  if (contractChecksum !== CONTRACT_CHECKSUM || declaredContract !== CONTRACT_CHECKSUM) fail('DEBTS_CONTRACT_CHECKSUM_MISMATCH');
  if (snapshot.currency !== CURRENCY) fail('DEBTS_HEADER_CURRENCY_INVALID');
  if (snapshot.period !== period || snapshot.schemaVersion !== SCHEMA_VERSION) fail('DEBTS_SNAPSHOT_CONTRACT_MISMATCH');
  if (snapshot.revisionMode !== REVISION_MODE) fail('DEBTS_REVISION_MODE_UNSUPPORTED');
  if (snapshot.rowChecksumAlgorithm !== ROW_CHECKSUM_ALGORITHM) fail('DEBTS_ROW_CHECKSUM_CONTRACT_UNSUPPORTED');
  if (!Number.isSafeInteger(snapshot.rowCount) || snapshot.rowCount < 0 || snapshot.rowCount > MAX_ROWS) fail('DEBTS_SNAPSHOT_ROW_COUNT_INVALID');
  if (!Number.isSafeInteger(snapshot.invoiceCount) || snapshot.invoiceCount < 0) fail('DEBTS_SNAPSHOT_INVOICE_COUNT_INVALID');
  if (!/^[a-f0-9]{64}$/.test(checksum)) fail('DEBTS_SNAPSHOT_CHECKSUM_INVALID');
  for (const field of ['beforeVat', 'vat', 'afterVat']) parseVnd(snapshot.totals?.[field], `snapshot.totals.${field}`);
  return { snapshotId, sourceRevision, checksum, legalEntity };
}

function combineSnapshotPages(pages, { period, legalEntity, contractChecksum, lockedPeriods = [] } = {}) {
  const expectedPeriod = normalizePeriod(period);
  const contract = text(contractChecksum, 80).toLowerCase().replace(/^sha256:/, '');
  if (contract !== CONTRACT_CHECKSUM) fail('DEBTS_CONTRACT_CHECKSUM_MISMATCH');
  if (expectedPeriod === HARD_BLOCKED_PERIOD) fail('DEBTS_PERIOD_HARD_BLOCKED', { period: expectedPeriod });
  if (!Array.isArray(lockedPeriods)) fail('DEBTS_LOCKED_PERIODS_INVALID');
  if (lockedPeriods.map(normalizePeriod).includes(expectedPeriod)) fail('DEBTS_PERIOD_LOCKED', { period: expectedPeriod });
  if (!Array.isArray(pages) || !pages.length) fail('DEBTS_PAGES_EMPTY');
  const first = pages[0];
  const identity = validateSnapshotHeader(first.snapshot, expectedPeriod, contract);
  const expectedLegalEntity = normalizeLegalEntity(legalEntity || identity.legalEntity);
  if (identity.legalEntity !== expectedLegalEntity) fail('DEBTS_SNAPSHOT_LEGAL_ENTITY_MISMATCH');
  const rows = [];
  const cursors = new Set();
  pages.forEach((page, index) => {
    const current = validateSnapshotHeader(page?.snapshot, expectedPeriod, contract);
    if (canonicalJson(page.snapshot) !== canonicalJson(first.snapshot)
      || current.snapshotId !== identity.snapshotId || current.sourceRevision !== identity.sourceRevision) {
      fail('DEBTS_SNAPSHOT_DRIFT_BETWEEN_PAGES', { index });
    }
    if (!Array.isArray(page.rows) || page.rows.length > MAX_PAGE_ROWS) fail('DEBTS_PAGE_ROWS_INVALID', { index });
    if (page.rows.some((row) => normalizeLegalEntity(row?.legal_entity) !== identity.legalEntity)) fail('DEBTS_ROW_LEGAL_ENTITY_MISMATCH', { index });
    rows.push(...page.rows);
    const cursor = page.nextCursor == null ? null : text(page.nextCursor, 500);
    if (cursor !== null && (!cursor || cursors.has(cursor))) fail('DEBTS_CURSOR_INVALID', { index });
    if (cursor !== null) cursors.add(cursor);
    const isLast = index === pages.length - 1;
    if (isLast !== (cursor === null)) fail('DEBTS_PAGINATION_INCOMPLETE', { index });
    if (page.finalize !== isLast) fail('DEBTS_FINALIZE_MARKER_INVALID', { index });
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

function mappingArtifactChecksum(rows, declaredCounts, profile) {
  if (!Array.isArray(rows) || !declaredCounts || typeof declaredCounts !== 'object') fail('DEBTS_MAPPING_SNAPSHOT_INVALID');
  return sha256(canonicalJson({ profile, declaredCounts, rows }));
}

function normalizeDataHubLegalEntity(value) {
  const sourceCode = normalizeSourceLegalEntityCode(value);
  return sourceCode === '01.DONA' ? 'DONA' : 'AFP';
}

function adaptDataHubMapping(mappingSnapshot) {
  if (mappingSnapshot?.contractKind !== DATAHUB_MAPPING_CONTRACT_KIND) return mappingSnapshot;
  const body = { ...mappingSnapshot }; delete body.artifactChecksum;
  const artifactChecksum = text(mappingSnapshot.artifactChecksum, 80).toLowerCase().replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(artifactChecksum) || sha256(JSON.stringify(body)) !== artifactChecksum) fail('DEBTS_MAPPING_CHECKSUM_MISMATCH');
  if (mappingSnapshot.immutable !== true || !Array.isArray(mappingSnapshot.candidates)
    || mappingSnapshot.rowCount !== mappingSnapshot.candidates.length
    || canonicalJson(mappingSnapshot.allowedLegalEntities) !== canonicalJson(['01.DONA', '02.AFP'])
    || canonicalJson(mappingSnapshot.keyFields) !== canonicalJson(['legalEntityCode', 'unitCode', 'qlnbCode'])) fail('DEBTS_MAPPING_CONTRACT_INVALID');
  const source = mappingSnapshot.source;
  const sourceManifest = {
    collection: source?.collection, revision: source?.revision, rowCount: source?.rowCount,
    rowsChecksum: source?.rowsChecksum, manifestCode: source?.manifestCode, manifestUpdatedAt: source?.manifestUpdatedAt,
  };
  if (source?.collection !== 'sales_catalog_full' || !Number.isSafeInteger(source?.revision) || source.revision < 1
    || !Number.isSafeInteger(source?.rowCount) || source.rowCount < mappingSnapshot.rowCount
    || !/^[a-f0-9]{64}$/.test(String(source?.rowsChecksum || ''))
    || !/^[a-f0-9]{64}$/.test(String(source?.manifestChecksum || ''))
    || sha256(JSON.stringify(sourceManifest)) !== source.manifestChecksum) fail('DEBTS_MAPPING_IDENTITY_INVALID');

  const groups = new Map();
  const sourceGroups = new Map();
  const attestationRows = new Map();
  for (const candidate of mappingSnapshot.candidates) {
    const legalEntity = normalizeDataHubLegalEntity(candidate?.legalEntityCode);
    const unitCode = upper(candidate?.unitCode, 180); const qlnbCode = upper(candidate?.qlnbCode, 180);
    const employeeCode = upper(candidate?.employeeCode, 80); const uom = upper(candidate?.unitOfMeasure, 100);
    const sourceLineId = text(candidate?.sourceRowId, 240);
    if (!unitCode || !qlnbCode || !employeeCode || !uom || !sourceLineId || !['mapped', 'quarantine'].includes(candidate?.status)) fail('DEBTS_MAPPING_ROW_INVALID');
    const key = `${legalEntity}|${unitCode}|${qlnbCode}`;
    const values = groups.get(key) || [];
    values.push({ employeeCode, uom, sourceLineId }); groups.set(key, values);
    const sourceRows = sourceGroups.get(key) || [];
    sourceRows.push(candidate); sourceGroups.set(key, sourceRows);
    attestationRows.set(key, { legal_entity: legalEntity, source_legal_entity_code: candidate.legalEntityCode, unit_code: unitCode, qlnb_code: qlnbCode });
  }
  for (const [key, values] of groups) {
    const sourceRows = sourceGroups.get(key);
    const expected = {
      duplicateKey: sourceRows.length > 1,
      employee: new Set(values.map((item) => item.employeeCode)).size > 1,
      unitOfMeasure: new Set(values.map((item) => item.uom)).size > 1,
      missingRequiredFields: [],
    };
    for (const candidate of sourceRows) {
      const quarantine = expected.duplicateKey || expected.employee || expected.unitOfMeasure;
      if (canonicalJson(candidate.conflicts) !== canonicalJson(expected)
        || candidate.status !== (quarantine ? 'quarantine' : 'mapped')) fail('DEBTS_MAPPING_CONFLICT_MARKER_INVALID');
    }
  }
  const attestations = mappingSnapshot.legalEntityAttestations;
  if (!Array.isArray(attestations) || attestations.length !== 2) fail('DEBTS_LEGAL_ENTITY_ATTESTATION_INVALID');
  const declaredLegalEntityRows = {};
  for (const attestation of attestations) {
    const legalEntity = normalizeDataHubLegalEntity(attestation?.legalEntityCode);
    const rows = mappingSnapshot.candidates.filter((candidate) => candidate.legalEntityCode === attestation.legalEntityCode);
    if (attestation.contractKind !== DATAHUB_ATTESTATION_CONTRACT_KIND || attestation.rowCount !== rows.length
      || sha256(JSON.stringify(rows)) !== attestation.rowsChecksum) fail('DEBTS_LEGAL_ENTITY_ATTESTATION_INVALID');
    const uniqueRows = new Set(rows.map((row) => `${upper(row.unitCode, 180)}|${upper(row.qlnbCode, 180)}`)).size;
    if (uniqueRows > 0) declaredLegalEntityRows[legalEntity] = uniqueRows;
  }
  const rows = [...groups].map(([key, candidates]) => {
    const [legalEntity, unitCode, qlnbCode] = key.split('|');
    return {
      legalEntity, unitCode, qlnbCode, candidates,
      employeeConflict: new Set(candidates.map((item) => item.employeeCode)).size > 1,
      uomConflict: new Set(candidates.map((item) => item.uom)).size > 1,
    };
  });
  const partitionRows = [...attestationRows.values()];
  const declaredCounts = { mappingRows: rows.length, legalEntityRows: declaredLegalEntityRows };
  return {
    version: `catalog-r${source.revision}`, sourceManifestId: source.manifestCode,
    sourceManifestChecksum: source.manifestChecksum, profile: 'production', declaredCounts,
    checksum: mappingArtifactChecksum(rows, declaredCounts, 'production'),
    contract: { unitCodeColumn: 'c7', qlnbColumn: 'c5', employeeColumn: 'c6', uomColumn: 'c25', uomMode: 'validation' },
    rows,
    legalEntityAttestation: { contract: LEGAL_ENTITY_CONTRACT_KIND, checksum: sha256(canonicalJson(partitionRows)), rows: partitionRows },
  };
}

function mappingIndex(mappingSnapshot) {
  mappingSnapshot = adaptDataHubMapping(mappingSnapshot);
  if (!mappingSnapshot || typeof mappingSnapshot !== 'object' || !Array.isArray(mappingSnapshot.rows)) fail('DEBTS_MAPPING_SNAPSHOT_INVALID');
  const version = text(mappingSnapshot.version, 160);
  const checksum = text(mappingSnapshot.checksum, 80).toLowerCase().replace(/^sha256:/, '');
  const sourceManifestId = text(mappingSnapshot.sourceManifestId, 180);
  const sourceManifestChecksum = text(mappingSnapshot.sourceManifestChecksum, 80).toLowerCase().replace(/^sha256:/, '');
  const profile = text(mappingSnapshot.profile, 80);
  const declaredCounts = mappingSnapshot.declaredCounts;
  const contract = mappingSnapshot.contract;
  if (!version || !sourceManifestId || !['production', 'synthetic-v1'].includes(profile)
    || !/^[a-f0-9]{64}$/.test(checksum) || !/^[a-f0-9]{64}$/.test(sourceManifestChecksum)) fail('DEBTS_MAPPING_IDENTITY_INVALID');
  if (!declaredCounts || !Number.isSafeInteger(declaredCounts.mappingRows) || declaredCounts.mappingRows < 0
    || !declaredCounts.legalEntityRows || typeof declaredCounts.legalEntityRows !== 'object'
    || Array.isArray(declaredCounts.legalEntityRows)) fail('DEBTS_MAPPING_DECLARED_COUNT_INVALID');
  for (const [legalEntity, count] of Object.entries(declaredCounts.legalEntityRows)) {
    if (!upper(legalEntity, 80) || !Number.isSafeInteger(count) || count < 0) fail('DEBTS_MAPPING_DECLARED_COUNT_INVALID');
  }
  if (!contract || contract.unitCodeColumn !== 'c7' || contract.qlnbColumn !== 'c5' || contract.employeeColumn !== 'c6'
    || (contract.productNameColumn != null && contract.productNameColumn !== 'c16')
    || !/^c(?:[1-9]|[1-4]\d|5[0-2])$/.test(String(contract.uomColumn || ''))
    || /^c(?:3[2-9]|4[0-7])$/.test(contract.uomColumn) || contract.uomMode !== 'validation') fail('DEBTS_MAPPING_CONTRACT_INVALID');
  if (mappingArtifactChecksum(mappingSnapshot.rows, declaredCounts, profile) !== checksum) fail('DEBTS_MAPPING_CHECKSUM_MISMATCH');
  if (mappingSnapshot.rows.length !== declaredCounts.mappingRows) fail('DEBTS_MAPPING_ROW_COUNT_MISMATCH');
  const byKey = new Map();
  for (const row of mappingSnapshot.rows) {
    const unit = upper(row.unitCode, 180);
    const qlnb = upper(row.qlnbCode, 180);
    if (!unit || !qlnb || !Array.isArray(row.candidates) || !row.candidates.length) fail('DEBTS_MAPPING_ROW_INVALID');
    const values = row.candidates.map((candidate) => {
      const emp = upper(candidate.employeeCode, 80); const uom = upper(candidate.uom, 100);
      const productName = text(candidate.productName, 300) || null;
      if (!emp || !uom || (contract.productNameColumn === 'c16' && !productName)
        || !text(candidate.sourceLineId, 240)) fail('DEBTS_MAPPING_ROW_INVALID');
      return Object.freeze({ emp_code: emp, uom, product_name: productName, route: upper(candidate.route, 30) || null });
    });
    const employeeConflict = new Set(values.map((item) => item.emp_code)).size > 1;
    const uomConflict = new Set(values.map((item) => item.uom)).size > 1;
    const productNameConflict = new Set(values.map((item) => item.product_name)).size > 1;
    if (row.employeeConflict !== employeeConflict || row.uomConflict !== uomConflict
      || (contract.productNameColumn === 'c16' && row.productNameConflict !== productNameConflict)) fail('DEBTS_MAPPING_CONFLICT_MARKER_INVALID');
    const legalEntity = row.legalEntity == null ? null : normalizeLegalEntity(row.legalEntity);
    const key = `${legalEntity || '*'}|${unit}|${qlnb}`;
    if (byKey.has(key)) fail('DEBTS_MAPPING_DUPLICATE_KEY');
    byKey.set(key, values);
  }
  const attestation = mappingSnapshot.legalEntityAttestation;
  const attestationChecksum = text(attestation?.checksum, 80).toLowerCase().replace(/^sha256:/, '');
  if (attestation?.contract !== LEGAL_ENTITY_CONTRACT_KIND || !Array.isArray(attestation.rows)
    || !/^[a-f0-9]{64}$/.test(attestationChecksum)
    || sha256(canonicalJson(attestation.rows)) !== attestationChecksum) fail('DEBTS_LEGAL_ENTITY_ATTESTATION_INVALID');
  const legalEntityPartitions = new Set();
  const actualLegalEntityRows = new Map();
  for (const row of attestation.rows) {
    const legal = normalizeLegalEntity(row.legal_entity);
    normalizeSourceLegalEntityCode(row.source_legal_entity_code);
    const unit = upper(row.unit_code, 180); const qlnb = upper(row.qlnb_code, 180);
    if (!unit || !qlnb) fail('DEBTS_LEGAL_ENTITY_ATTESTATION_ROW_INVALID');
    const key = `${legal}|${unit}|${qlnb}`;
    if (legalEntityPartitions.has(key)) fail('DEBTS_LEGAL_ENTITY_ATTESTATION_DUPLICATE');
    legalEntityPartitions.add(key);
    actualLegalEntityRows.set(legal, (actualLegalEntityRows.get(legal) || 0) + 1);
  }
  const declaredLegalEntities = Object.entries(declaredCounts.legalEntityRows)
    .map(([legalEntity, count]) => [normalizeLegalEntity(legalEntity), count])
    .sort(([a], [b]) => a.localeCompare(b, 'en'));
  const actualLegalEntities = [...actualLegalEntityRows].sort(([a], [b]) => a.localeCompare(b, 'en'));
  if (canonicalJson(declaredLegalEntities) !== canonicalJson(actualLegalEntities)) fail('DEBTS_MAPPING_LEGAL_ENTITY_ROW_COUNT_MISMATCH');
  return {
    version, checksum, sourceManifestId, sourceManifestChecksum, profile, declaredCounts: stableValue(declaredCounts), contract: stableValue(contract), byKey,
    legalEntityContract: attestation.contract, legalEntityChecksum: attestationChecksum, legalEntityPartitions,
    requiresProductName: contract.productNameColumn === 'c16',
  };
}

function normalizeRow(row, index, mappings) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('DEBTS_ROW_INVALID', { index });
  for (const field of REQUIRED_ROW_FIELDS) if (row[field] === undefined || row[field] === null || row[field] === '') fail('DEBTS_ROW_FIELD_MISSING', { index, field });
  const legalEntity = normalizeLegalEntity(row.legal_entity);
  const sourceLegalEntityCode = normalizeSourceLegalEntityCode(row.source_legal_entity_code);
  const lineId = text(row.invoice_line_id, 180);
  const invoiceNumber = text(row.invoice_number, 180);
  const unitCode = upper(row.unit_code, 180);
  const qlnbCode = upper(row.qlnb_code, 180);
  const uom = upper(row.uom, 100);
  const rowChecksum = text(row.row_checksum, 80).toLowerCase().replace(/^sha256:/, '');
  if (!legalEntity || !lineId || !invoiceNumber || !unitCode || !qlnbCode || !uom) fail('DEBTS_ROW_IDENTITY_INVALID', { index });
  if (!/^[a-f0-9]{64}$/.test(rowChecksum)) fail('DEBTS_ROW_CHECKSUM_INVALID', { index });
  if (sourceRowChecksum(row) !== rowChecksum) fail('DEBTS_ROW_CHECKSUM_MISMATCH', { index });
  const invoiceDate = text(row.invoice_date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
    || new Date(`${invoiceDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== invoiceDate) {
    fail('DEBTS_INVOICE_DATE_INVALID', { index });
  }
  const rawBefore = parseVnd(row.before_vat, 'before_vat');
  const rawVat = parseVnd(row.vat_amount, 'vat_amount');
  const rawAfter = parseVnd(row.after_vat, 'after_vat');
  parseDecimal(row.quantity, 'quantity');
  parseVnd(row.unit_price_before_vat, 'unit_price_before_vat');
  const rowType = upper(row.row_type, 60);
  if (!ALLOWED_ROW_TYPES.has(rowType)) fail('DEBTS_ROW_TYPE_INVALID', { index });
  const amounts = [rawBefore.units, rawVat.units, rawAfter.units];
  if ((rowType === 'SALE' && amounts.some((amount) => amount < 0n))
    || (rowType !== 'SALE' && amounts.some((amount) => amount > 0n))) fail('DEBTS_ROW_SIGN_INVALID', { index, rowType });
  const amountInconsistent = !decimalEqual(decimalAdd(rawBefore, rawVat), rawAfter);
  const canonicalBefore = amountInconsistent ? decimalSubtract(rawAfter, rawVat) : rawBefore;
  const reconstructionDelta = decimalSubtract(canonicalBefore, rawBefore);
  const key = `${legalEntity}|${unitCode}|${qlnbCode}`;
  const candidates = mappings.byKey.get(key) || mappings.byKey.get(`*|${unitCode}|${qlnbCode}`) || [];
  const uniqueEmployees = [...new Set(candidates.map((item) => item.emp_code))];
  const uniqueProductNames = [...new Set(candidates.map((item) => item.product_name).filter(Boolean))];
  const uniqueRoutes = [...new Set(candidates.map((item) => item.route).filter(Boolean))];
  let mappingStatus = 'mapped'; let empCode = uniqueEmployees[0] || null;
  let productName = uniqueProductNames[0] || null;
  let route = uniqueRoutes[0] || null;
  if (!mappings.legalEntityPartitions.has(`${legalEntity}|${unitCode}|${qlnbCode}`)) { mappingStatus = 'legal_entity_unattested'; empCode = null; }
  else if (!candidates.length) mappingStatus = 'unmapped';
  else if (uniqueEmployees.length !== 1) { mappingStatus = 'ambiguous'; empCode = null; }
  else if (mappings.requiresProductName && uniqueProductNames.length === 0) { mappingStatus = 'product_name_missing'; productName = null; }
  else if (mappings.requiresProductName && uniqueProductNames.length !== 1) { mappingStatus = 'product_name_conflict'; productName = null; }
  else if (uniqueRoutes.length > 1) { mappingStatus = 'route_conflict'; empCode = null; route = null; }
  else if (!candidates.some((item) => item.uom === uom)) { mappingStatus = 'uom_mismatch'; empCode = null; }
  const quarantineReasons = [];
  if (amountInconsistent) quarantineReasons.push('amount_inconsistent');
  if (invoiceNumber === '00002319') quarantineReasons.push('invoice_00002319');
  if (mappingStatus !== 'mapped') quarantineReasons.push(mappingStatus);
  return Object.freeze({
    source: SOURCE,
    source_line_id: `DEBTS:${legalEntity}:${lineId}`,
    legal_entity: legalEntity,
    ...(sourceLegalEntityCode ? { source_legal_entity_code: sourceLegalEntityCode } : {}),
    invoice_date: invoiceDate,
    invoice_number: invoiceNumber,
    invoice_line_id: lineId,
    unit_code: unitCode,
    qlnb_code: qlnbCode,
    product_name: productName,
    route,
    uom,
    quantity: row.quantity,
    unit_price_before_vat: row.unit_price_before_vat,
    row_type: rowType,
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
    if (!normalized.invoice_date.startsWith(`${combined.snapshot.period}-`)) fail('DEBTS_ROW_PERIOD_MISMATCH', { index });
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
    mappingSourceManifestId: mappings.sourceManifestId,
    mappingSourceManifestChecksum: mappings.sourceManifestChecksum,
    mappingContract: mappings.contract,
    legalEntityContract: mappings.legalEntityContract,
    legalEntityChecksum: mappings.legalEntityChecksum,
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
    mappedRowsChecksum: sha256(canonicalJson(mapped)),
    quarantineRowsChecksum: sha256(canonicalJson(quarantined)),
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

function fileDescriptor(file) {
  const body = fs.readFileSync(file);
  return Object.freeze({ bytes: body.length, sha256: sha256(body) });
}

function snapshotDirectoryKey(snapshotId) {
  const identity = text(snapshotId, 160);
  if (!identity) fail('DEBTS_SNAPSHOT_ID_INVALID');
  return `snapshot-${sha256(identity)}`;
}

function lockOwnerAlive(owner, host) {
  if (!owner || owner.host !== host || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return true;
  try { process.kill(owner.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function reclaimStaleLock(file, host) {
  let raw; let owner;
  try { raw = fs.readFileSync(file, 'utf8'); owner = JSON.parse(raw); } catch { return false; }
  const acquired = Date.parse(owner.acquiredAt);
  if (!Number.isFinite(acquired) || Date.now() - acquired <= LOCK_STALE_MS || lockOwnerAlive(owner, host)) return false;
  try {
    if (fs.readFileSync(file, 'utf8') !== raw) return false;
    fs.unlinkSync(file);
    fsyncDir(path.dirname(file));
    return true;
  } catch { return false; }
}

function validateMaterializedRows(rows, quarantined, receipt, mapped = null) {
  if (!Array.isArray(rows) || !Array.isArray(quarantined) || !receipt || typeof receipt !== 'object') fail('DEBTS_SHADOW_RESULT_INVALID');
  const expectedQuarantine = rows.filter((row) => row?.quarantine === true);
  const expectedMapped = rows.filter((row) => row?.quarantine === false);
  const invoices = new Set(rows.map((row) => `${row?.legal_entity}|${row?.invoice_number}`));
  if (receipt.rowCount !== rows.length || receipt.invoiceCount !== invoices.size
    || receipt.mappedCount !== expectedMapped.length || receipt.quarantinedCount !== expectedQuarantine.length
    || receipt.rowsChecksum !== sha256(canonicalJson(rows))
    || receipt.mappedRowsChecksum !== sha256(canonicalJson(expectedMapped))
    || receipt.quarantineRowsChecksum !== sha256(canonicalJson(expectedQuarantine))
    || canonicalJson(quarantined) !== canonicalJson(expectedQuarantine)
    || (mapped !== null && (!Array.isArray(mapped) || canonicalJson(mapped) !== canonicalJson(expectedMapped)))) {
    fail('DEBTS_SHADOW_RESULT_INCONSISTENT');
  }
}

function validatePublishedRows(mapped, quarantined, receipt) {
  if (!Array.isArray(mapped) || !Array.isArray(quarantined) || !receipt || typeof receipt !== 'object'
    || mapped.some((row) => row?.quarantine !== false) || quarantined.some((row) => row?.quarantine !== true)
    || receipt.mappedCount !== mapped.length || receipt.quarantinedCount !== quarantined.length
    || receipt.rowCount !== mapped.length + quarantined.length
    || receipt.mappedRowsChecksum !== sha256(canonicalJson(mapped))
    || receipt.quarantineRowsChecksum !== sha256(canonicalJson(quarantined))) {
    fail('DEBTS_SHADOW_RESULT_INCONSISTENT');
  }
}

function acquireShadowLock(dataDir, period) {
  const file = shadowLockFile(dataDir, period);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(24).toString('hex');
  const host = require('node:os').hostname();
  const owner = { schemaVersion: 1, token, pid: process.pid, host, acquiredAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, `${JSON.stringify(owner)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fsyncDir(path.dirname(file));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt === 0 && reclaimStaleLock(file, host)) continue;
      fail('DEBTS_SHADOW_LOCKED', { period: normalizePeriod(period) });
    }
  }
  return () => {
    let current;
    try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('DEBTS_SHADOW_LOCK_OWNERSHIP_LOST'); }
    if (current.token !== token) fail('DEBTS_SHADOW_LOCK_OWNERSHIP_LOST');
    fs.unlinkSync(file); fsyncDir(path.dirname(file));
  };
}

function publishShadow(result, { dataDir, allowWrite = false, receiptSigningKey, receiptSigningKeyId } = {}) {
  if (allowWrite !== true) fail('DEBTS_SHADOW_WRITE_DISABLED');
  validateMaterializedRows(result?.rows, result?.quarantined, result?.receipt, result?.mapped);
  const root = path.resolve(String(dataDir || ''));
  const suffix = path.join('revenue-shadow', 'debts');
  if (!root.endsWith(suffix)) fail('DEBTS_SHADOW_ROOT_INVALID');
  const period = normalizePeriod(result?.receipt?.period);
  const snapshotId = text(result?.receipt?.snapshotId, 160);
  const directoryKey = snapshotDirectoryKey(snapshotId);
  const releaseLock = acquireShadowLock(root, period);
  try {
    const periodDir = path.join(root, period);
    const target = path.join(periodDir, directoryKey);
    fs.mkdirSync(periodDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(periodDir, 0o700);
    if (fs.existsSync(target)) {
      const existing = verifyPublishedShadow(target, { receiptSigningKey, receiptSigningKeyId });
      if (existing.receipt.rowsChecksum !== result.receipt.rowsChecksum
        || existing.receipt.quarantineRowsChecksum !== result.receipt.quarantineRowsChecksum
        || existing.receipt.sourceChecksum !== result.receipt.sourceChecksum
        || existing.receipt.mappingChecksum !== result.receipt.mappingChecksum) {
        fail('DEBTS_SHADOW_IMMUTABLE_CONFLICT');
      }
      return target;
    }
    const stage = fs.mkdtempSync(path.join(periodDir, `.stage-${process.pid}-`));
    try {
      fs.chmodSync(stage, 0o700);
      // Official rows contain only attested mappings. Quarantine remains a
      // separate evidence file and can never silently enter reported revenue.
      atomicJson(path.join(stage, 'rows.json'), result.mapped);
      atomicJson(path.join(stage, 'quarantine.json'), result.quarantined);
      const signedReceipt = signReceipt(result.receipt, { key: receiptSigningKey, keyId: receiptSigningKeyId });
      atomicJson(path.join(stage, 'receipt.json'), signedReceipt);
      atomicJson(path.join(stage, 'manifest.json'), {
        schemaVersion: 2, period, snapshotId, directoryKey,
        files: Object.freeze({
          'rows.json': fileDescriptor(path.join(stage, 'rows.json')),
          'quarantine.json': fileDescriptor(path.join(stage, 'quarantine.json')),
          'receipt.json': fileDescriptor(path.join(stage, 'receipt.json')),
        }),
      });
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

function verifyPublishedShadow(target, { receiptSigningKey, receiptSigningKeyId } = {}) {
  let rows; let quarantined; let envelope; let manifest;
  try {
    rows = JSON.parse(fs.readFileSync(path.join(target, 'rows.json'), 'utf8'));
    quarantined = JSON.parse(fs.readFileSync(path.join(target, 'quarantine.json'), 'utf8'));
    envelope = JSON.parse(fs.readFileSync(path.join(target, 'receipt.json'), 'utf8'));
    manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
  } catch { fail('DEBTS_SHADOW_ARTIFACT_INVALID'); }
  if (manifest?.schemaVersion !== 2 || !manifest.files) fail('DEBTS_SHADOW_MANIFEST_INVALID');
  const expectedFiles = ['manifest.json', 'quarantine.json', 'receipt.json', 'rows.json'];
  if (canonicalJson(fs.readdirSync(target).sort()) !== canonicalJson(expectedFiles)) fail('DEBTS_SHADOW_UNEXPECTED_FILE');
  if ((fs.statSync(target).mode & 0o777) !== 0o700) fail('DEBTS_SHADOW_PERMISSION_INVALID');
  for (const file of ['rows.json', 'quarantine.json', 'receipt.json']) {
    const actual = fileDescriptor(path.join(target, file));
    if (manifest.files[file]?.bytes !== actual.bytes || manifest.files[file]?.sha256 !== actual.sha256) fail('DEBTS_SHADOW_FILE_CHECKSUM_MISMATCH', { file });
    if ((fs.statSync(path.join(target, file)).mode & 0o777) !== 0o600) fail('DEBTS_SHADOW_PERMISSION_INVALID', { file });
  }
  if ((fs.statSync(path.join(target, 'manifest.json')).mode & 0o777) !== 0o600) fail('DEBTS_SHADOW_PERMISSION_INVALID', { file: 'manifest.json' });
  const receipt = verifySignedReceipt(envelope, { key: receiptSigningKey, keyId: receiptSigningKeyId });
  validatePublishedRows(rows, quarantined, receipt);
  if (manifest.period !== receipt.period || manifest.snapshotId !== receipt.snapshotId
    || manifest.directoryKey !== snapshotDirectoryKey(receipt.snapshotId)
    || path.basename(target) !== manifest.directoryKey || path.basename(path.dirname(target)) !== receipt.period) fail('DEBTS_SHADOW_IDENTITY_MISMATCH');
  return Object.freeze({ rows: Object.freeze(rows), quarantined: Object.freeze(quarantined), receipt, manifest: stableValue(manifest) });
}

async function readBoundedJson(response) {
  const declaredBytes = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_PAGE_BYTES) fail('DEBTS_S2S_PAGE_TOO_LARGE');
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) { try { await reader.cancel(); } catch { /* best effort */ } fail('DEBTS_S2S_PAGE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
    try { return { value: JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')), bytes }; }
    catch { fail('DEBTS_S2S_RESPONSE_INVALID'); }
  }
  let value;
  try { value = await response.json(); } catch { fail('DEBTS_S2S_RESPONSE_INVALID'); }
  const bytes = Buffer.byteLength(canonicalJson(value));
  if (bytes > MAX_PAGE_BYTES) fail('DEBTS_S2S_PAGE_TOO_LARGE');
  return { value, bytes };
}

function adaptSalesLedgerPages(pages) {
  if (!Array.isArray(pages) || !pages.length || !pages[0]?.header) return pages;
  const first = pages[0];
  const header = first.header;
  const rawRevisionMode = text(first.revision_mode, 80);
  if (first.contract !== 'app-report-sales-ledger' || rawRevisionMode !== 'full-period-replacement') fail('DEBTS_SNAPSHOT_CONTRACT_MISMATCH');
  pages.forEach((page, index) => {
    if (page?.contract !== first.contract || page?.revision_mode !== first.revision_mode
      || canonicalJson(page?.header) !== canonicalJson(header)) fail('DEBTS_SNAPSHOT_DRIFT_BETWEEN_PAGES', { index });
    if (!page?.page || page.page.number !== index + 1 || page.page.count !== page.rows?.length
      || page.page.finalize !== (index === pages.length - 1)) fail('DEBTS_PAGINATION_INCOMPLETE', { index });
  });
  const rawRows = pages.flatMap((page) => Array.isArray(page?.rows) ? page.rows : []);
  rawRows.forEach((row, index) => {
    const declared = text(row?.row_checksum, 80).toLowerCase().replace(/^sha256:/, '');
    if (!/^[a-f0-9]{64}$/.test(declared) || sourceRowChecksum(row) !== declared) fail('DEBTS_ROW_CHECKSUM_MISMATCH', { index });
  });
  const rowChecksums = rawRows.map((row) => text(row?.row_checksum, 80));
  const unsignedHeader = { ...header, generated_at: '' };
  delete unsignedHeader.package_checksum;
  const expectedPackageChecksum = `sha256:${sha256(canonicalJson({ header: unsignedHeader, row_checksums: rowChecksums }))}`;
  if (header.package_checksum !== expectedPackageChecksum) fail('DEBTS_SNAPSHOT_CHECKSUM_MISMATCH');
  const snapshot = {
    snapshotId: header.package_id,
    period: header.period,
    sourceRevision: header.source_revision,
    revisionMode: REVISION_MODE,
    schemaVersion: header.schema_version,
    contractChecksum: header.contract_checksum,
    legal_entity: header.legal_entity,
    source_legal_entity_code: header.legal_entity === 'DONA' ? '01.DONA' : '02.AFP',
    currency: header.currency,
    rowChecksumAlgorithm: header.row_checksum_algorithm,
    rowCount: header.row_count,
    invoiceCount: header.invoice_count,
    checksum: `sha256:${snapshotRowsChecksum(rawRows)}`,
    totals: { beforeVat: header.totals?.before_vat, vat: header.totals?.vat, afterVat: header.totals?.after_vat },
    createdAt: header.generated_at,
    upstreamPackageChecksum: header.package_checksum,
  };
  return pages.map((page) => ({
    snapshot,
    rows: page.rows,
    nextCursor: page.page?.next_cursor || null,
    finalize: page.page?.finalize === true,
  }));
}

async function fetchSnapshotPages({ endpoint, token, period, legalEntity, contractChecksum = CONTRACT_CHECKSUM, lockedPeriods = [], pageSize = 500, requestTimeoutMs = 30_000, fetchImpl = globalThis.fetch } = {}) {
  const expectedPeriod = normalizePeriod(period);
  const expectedLegalEntity = normalizeLegalEntity(legalEntity);
  let base;
  try { base = new URL(String(endpoint || '')); } catch { fail('DEBTS_ENDPOINT_INVALID'); }
  if (base.protocol !== 'https:' || base.pathname !== CONTRACT_PATH || base.username || base.password || base.search || base.hash) fail('DEBTS_ENDPOINT_NOT_ALLOWLISTED');
  if (!token || typeof fetchImpl !== 'function') fail('DEBTS_S2S_CONTRACT_UNAVAILABLE');
  const timeoutMs = Math.max(10, Math.min(30_000, Number(requestTimeoutMs) || 30_000));
  const pages = []; let sourceBytes = 0;
  let cursor = null;
  const seen = new Set();
  do {
    const url = new URL(base);
    url.searchParams.set('period', expectedPeriod);
    url.searchParams.set('legal_entity', expectedLegalEntity);
    url.searchParams.set('limit', String(Math.max(1, Math.min(1000, Number(pageSize) || 500))));
    if (cursor) url.searchParams.set('cursor', cursor);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
    } catch { clearTimeout(timeout); fail('DEBTS_S2S_UNAVAILABLE'); }
    if (!response?.ok) { clearTimeout(timeout); fail('DEBTS_S2S_UPSTREAM_ERROR', { status: Number(response?.status) || 502 }); }
    let decoded;
    try { decoded = await readBoundedJson(response); }
    catch (error) { if (error instanceof DebtsShadowError) throw error; fail('DEBTS_S2S_UNAVAILABLE'); }
    finally { clearTimeout(timeout); }
    const page = decoded.value; sourceBytes += decoded.bytes;
    if (sourceBytes > MAX_SOURCE_BYTES) fail('DEBTS_S2S_SNAPSHOT_TOO_LARGE');
    pages.push(page);
    const rawCursor = page?.page ? page.page.next_cursor : page.nextCursor;
    cursor = rawCursor == null || rawCursor === '' ? null : text(rawCursor, 500);
    if (cursor && seen.has(cursor)) fail('DEBTS_CURSOR_INVALID');
    if (cursor) seen.add(cursor);
    if (pages.length > 1000) fail('DEBTS_PAGE_LIMIT_EXCEEDED');
  } while (cursor);
  return combineSnapshotPages(adaptSalesLedgerPages(pages), { period: expectedPeriod, legalEntity: expectedLegalEntity, contractChecksum, lockedPeriods });
}
function shadowLockFile(dataDir, period) {
  const root = path.resolve(String(dataDir || ''));
  if (!root.endsWith(path.join('revenue-shadow', 'debts'))) fail('DEBTS_SHADOW_ROOT_INVALID');
  return path.join(root, `debts_invoice_shadow_${normalizePeriod(period)}.lock`);
}

module.exports = {
  SOURCE, SCHEMA_VERSION, CONTRACT_PATH, REVISION_MODE, ROW_CHECKSUM_ALGORITHM, CONTRACT_CHECKSUM, CURRENCY, HARD_BLOCKED_PERIOD, LEGAL_ENTITY_CONTRACT_KIND, REQUIRED_ROW_FIELDS, DebtsShadowError,
  stableValue, canonicalJson, normalizeLegalEntity, normalizeSourceLegalEntityCode, parseDecimal, decimalAdd, decimalSubtract, decimalEqual, decimalString,
  sourceRowChecksum, snapshotRowsChecksum, mappingArtifactChecksum, adaptDataHubMapping, adaptSalesLedgerPages, combineSnapshotPages, mappingIndex, materializeShadow,
  signReceipt, verifySignedReceipt, snapshotDirectoryKey, publishShadow, verifyPublishedShadow, shadowLockFile, acquireShadowLock, fetchSnapshotPages,
};
