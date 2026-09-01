'use strict';

const fs = require('node:fs');
const path = require('node:path');
const shadow = require('./debtsInvoiceShadow');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_ROOT = path.join(DATA_DIR, 'revenue-shadow', 'debts');

function enabled(env = process.env) {
  return String(env.APP_REPORT_DEBTS_SHADOW_ENABLED || '') === '1';
}

function safeMappingFile(value) {
  const invalid = () => {
    const error = new Error('DEBTS_MAPPING_FILE_INVALID'); error.code = error.message; throw error;
  };
  const file = path.resolve(String(value || ''));
  const dataRoot = path.resolve(DATA_DIR) + path.sep;
  if (!file.startsWith(dataRoot) || !file.endsWith('.json')) invalid();
  /* ‼ Kiểm bằng chuỗi là CHƯA ĐỦ. `path.resolve` chỉ ghép chuỗi, không đi theo
   * liên kết mềm: một symlink NẰM TRONG `server/data` trỏ ra ngoài vẫn lọt qua
   * rồi `readFileSync` đọc thẳng file ngoài kho. Claude dựng đúng cảnh đó và đọc
   * được file ở `/tmp`. Nay so bằng ĐƯỜNG THẬT hai phía.
   * Lợi thêm: PROD để `server/data` là symlink, nên so đường thật cũng tránh việc
   * từ chối oan một file hợp lệ chỉ vì nó được đưa vào bằng đường đã giải symlink. */
  let realRoot;
  let real;
  try {
    realRoot = fs.realpathSync(path.resolve(DATA_DIR)) + path.sep;
    real = fs.realpathSync(file);
  } catch {
    const error = new Error('DEBTS_MAPPING_UNAVAILABLE'); error.code = error.message; throw error;
  }
  if (!real.startsWith(realRoot) || !real.endsWith('.json')) invalid();
  return real;
}

function loadMapping(file) {
  let fd;
  try {
    const safe = safeMappingFile(file);
    fd = fs.openSync(safe, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.realpathSync(`/proc/self/fd/${fd}`);
    const realRoot = fs.realpathSync(path.resolve(DATA_DIR)) + path.sep;
    if (!opened.startsWith(realRoot) || !opened.endsWith('.json') || !fs.fstatSync(fd).isFile()) {
      const error = new Error('DEBTS_MAPPING_FILE_INVALID'); error.code = error.message; throw error;
    }
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  }
  catch (error) {
    if (error.code === 'DEBTS_MAPPING_FILE_INVALID') throw error;
    const wrapped = new Error('DEBTS_MAPPING_UNAVAILABLE'); wrapped.code = wrapped.message; throw wrapped;
  }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function config(env = process.env) {
  return {
    enabled: enabled(env),
    endpoint: String(env.APP_REPORT_DEBTS_ENDPOINT || '').trim(),
    token: String(env.APP_REPORT_DEBTS_TOKEN || '').trim(),
    mappingFile: String(env.APP_REPORT_DEBTS_MAPPING_FILE || '').trim(),
    allowWrite: String(env.APP_REPORT_DEBTS_SHADOW_WRITE_ENABLED || '') === '1',
    dataDir: DEFAULT_ROOT,
    receiptSigningKey: env.APP_REPORT_DEBTS_RECEIPT_SIGNING_KEY
      ? Buffer.from(String(env.APP_REPORT_DEBTS_RECEIPT_SIGNING_KEY), 'base64') : null,
    receiptSigningKeyId: String(env.APP_REPORT_DEBTS_RECEIPT_SIGNING_KEY_ID || '').trim(),
  };
}

function readiness(env = process.env, { requireMapping = true } = {}) {
  const cfg = config(env);
  const checks = {
    enabled: cfg.enabled,
    endpoint: /^https:\/\//i.test(cfg.endpoint),
    token: Boolean(cfg.token),
    mappingFile: Boolean(cfg.mappingFile),
    mappingReadable: false,
    receiptSigningKey: Buffer.isBuffer(cfg.receiptSigningKey) && cfg.receiptSigningKey.length >= 32,
    receiptSigningKeyId: Boolean(cfg.receiptSigningKeyId),
    writeEnabled: cfg.allowWrite,
  };
  if (checks.mappingFile) {
    try { loadMapping(cfg.mappingFile); checks.mappingReadable = true; } catch { /* chỉ báo thiếu, không lộ path/lỗi */ }
  }
  const requiredForPreview = requireMapping ? ['enabled', 'endpoint', 'token', 'mappingFile', 'mappingReadable'] : ['enabled', 'endpoint', 'token'];
  const requiredForPublish = [...requiredForPreview, 'receiptSigningKey', 'receiptSigningKeyId', 'writeEnabled'];
  return Object.freeze({
    ok: requiredForPublish.every((key) => checks[key]),
    previewReady: requiredForPreview.every((key) => checks[key]),
    publishReady: requiredForPublish.every((key) => checks[key]),
    checks: Object.freeze(checks),
    missingForPreview: requiredForPreview.filter((key) => !checks[key]),
    missingForPublish: requiredForPublish.filter((key) => !checks[key]),
  });
}

async function preview({ period, legalEntity, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = config(env);
  if (!cfg.enabled) {
    const error = new Error('DEBTS_SHADOW_DISABLED'); error.code = error.message; error.status = 503; throw error;
  }
  if (period === shadow.HARD_BLOCKED_PERIOD) {
    const error = new Error('DEBTS_PERIOD_HARD_BLOCKED'); error.code = error.message; error.status = 409; throw error;
  }
  const partition = shadow.normalizeLegalEntity(legalEntity);
  const combined = await shadow.fetchSnapshotPages({
    endpoint: cfg.endpoint, token: cfg.token, period, legalEntity: partition,
    lockedPeriods: [shadow.HARD_BLOCKED_PERIOD], fetchImpl,
  });
  const result = shadow.materializeShadow(combined, loadMapping(cfg.mappingFile), { codeRevision: 'debts-shadow-preview-v1' });
  return Object.freeze({
    ok: true, shadow: true, selectorChanged: false, persisted: false,
    period: result.receipt.period, legalEntity: partition, snapshotId: result.receipt.snapshotId,
    rowCount: result.receipt.rowCount, invoiceCount: result.receipt.invoiceCount,
    mappedCount: result.receipt.mappedCount, quarantinedCount: result.receipt.quarantinedCount,
    totals: result.receipt.totals, sourceChecksum: result.receipt.sourceChecksum,
    mappingChecksum: result.receipt.mappingChecksum, rowsChecksum: result.receipt.rowsChecksum,
    mappingVersion: result.receipt.mappingVersion,
    mappingStatusCounts: result.receipt.mappingStatusCounts,
    quarantineReasonCounts: Object.freeze(result.quarantined.reduce((counts, row) => {
      for (const reason of row.quarantine_reasons || []) counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {})),
    quarantineRows: Object.freeze(result.quarantined.map((row) => Object.freeze({
      sourceLineId: row.source_line_id,
      invoiceDate: row.invoice_date,
      invoiceNumber: row.invoice_number,
      invoiceLineId: row.invoice_line_id,
      unitCode: row.unit_code,
      qlnbCode: row.qlnb_code,
      uom: row.uom,
      mappingStatus: row.mapping_status,
      reasons: row.quarantine_reasons,
    }))),
  });
}

function proofOf(result) {
  return Object.freeze({
    legalEntity: result.rows[0]?.legal_entity || null,
    snapshotId: result.receipt.snapshotId,
    sourceChecksum: result.receipt.sourceChecksum,
    mappingChecksum: result.receipt.mappingChecksum,
    rowsChecksum: result.receipt.rowsChecksum,
    mappedCount: result.receipt.mappedCount,
    quarantinedCount: result.receipt.quarantinedCount,
  });
}

function assertProof(result, proof, legalEntity) {
  const actual = proofOf(result);
  if (!proof || proof.legalEntity !== legalEntity
    || !['snapshotId', 'sourceChecksum', 'mappingChecksum', 'rowsChecksum', 'mappedCount', 'quarantinedCount']
      .every((key) => proof[key] === actual[key])) {
    const error = new Error('DEBTS_PUBLISH_PROOF_MISMATCH'); error.code = error.message; error.status = 409; throw error;
  }
}

async function publishPeriod({
  period, proofs, expectedMappedCount, expectedQuarantinedCount, confirmation,
  env = process.env, fetchImpl = globalThis.fetch, dataDir,
} = {}) {
  const cfg = config(env);
  const ready = readiness(env);
  if (!ready.publishReady) {
    const error = new Error('DEBTS_PUBLISH_NOT_READY'); error.code = error.message; error.status = 503; throw error;
  }
  const mapped = Number(expectedMappedCount);
  const quarantined = Number(expectedQuarantinedCount);
  const expectedConfirmation = `PUBLISH_DEBTS_${period}_${mapped}_${quarantined}`;
  if (!Number.isSafeInteger(mapped) || mapped < 0 || !Number.isSafeInteger(quarantined) || quarantined < 0
    || confirmation !== expectedConfirmation) {
    const error = new Error('DEBTS_PUBLISH_CONFIRMATION_INVALID'); error.code = error.message; error.status = 400; throw error;
  }
  const mapping = loadMapping(cfg.mappingFile);
  const results = await Promise.all(['DONA', 'AFP'].map(async (legalEntity) => {
    const combined = await shadow.fetchSnapshotPages({
      endpoint: cfg.endpoint, token: cfg.token, period, legalEntity,
      lockedPeriods: [shadow.HARD_BLOCKED_PERIOD], fetchImpl,
    });
    const result = shadow.materializeShadow(combined, mapping, { codeRevision: 'debts-publish-v1' });
    assertProof(result, proofs?.[legalEntity], legalEntity);
    return [legalEntity, result];
  }));
  const totalMapped = results.reduce((sum, [, result]) => sum + result.receipt.mappedCount, 0);
  const totalQuarantined = results.reduce((sum, [, result]) => sum + result.receipt.quarantinedCount, 0);
  if (totalMapped !== mapped || totalQuarantined !== quarantined) {
    const error = new Error('DEBTS_PUBLISH_COUNT_MISMATCH'); error.code = error.message; error.status = 409; throw error;
  }
  const artifacts = results.map(([legalEntity, result]) => {
    const target = shadow.publishShadow(result, {
      dataDir: dataDir || cfg.dataDir, allowWrite: true,
      receiptSigningKey: cfg.receiptSigningKey, receiptSigningKeyId: cfg.receiptSigningKeyId,
    });
    const verified = shadow.verifyPublishedShadow(target, {
      receiptSigningKey: cfg.receiptSigningKey, receiptSigningKeyId: cfg.receiptSigningKeyId,
    });
    return Object.freeze({ legalEntity, snapshotId: verified.receipt.snapshotId, rowsChecksum: verified.receipt.rowsChecksum,
      mappedCount: verified.receipt.mappedCount, quarantinedCount: verified.receipt.quarantinedCount });
  });
  return Object.freeze({ ok: true, persisted: true, period, mappedCount: totalMapped,
    quarantinedCount: totalQuarantined, selectorChanged: false, artifacts: Object.freeze(artifacts) });
}

module.exports = { DATA_DIR, DEFAULT_ROOT, enabled, safeMappingFile, loadMapping, config, readiness, preview, proofOf, assertProof, publishPeriod };
