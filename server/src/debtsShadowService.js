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
  let artifact = null;
  if (cfg.allowWrite) {
    artifact = shadow.publishShadow(result, {
      dataDir: cfg.dataDir, allowWrite: true,
      receiptSigningKey: cfg.receiptSigningKey, receiptSigningKeyId: cfg.receiptSigningKeyId,
    });
  }
  return Object.freeze({
    ok: true, shadow: true, selectorChanged: false, persisted: Boolean(artifact),
    period: result.receipt.period, legalEntity: partition, snapshotId: result.receipt.snapshotId,
    rowCount: result.receipt.rowCount, invoiceCount: result.receipt.invoiceCount,
    mappedCount: result.receipt.mappedCount, quarantinedCount: result.receipt.quarantinedCount,
    totals: result.receipt.totals, sourceChecksum: result.receipt.sourceChecksum,
    mappingChecksum: result.receipt.mappingChecksum, rowsChecksum: result.receipt.rowsChecksum,
  });
}

module.exports = { DATA_DIR, DEFAULT_ROOT, enabled, safeMappingFile, loadMapping, config, preview };
