'use strict';

// Phase 0 only: pure projection/envelope helpers used by tests and an offline
// benchmark. Runtime catalog readers/writers do not import this module yet.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

function assertPeriod(period) {
  const value = String(period || '');
  if (!periodPattern.test(value)) throw Object.assign(new Error('Invalid catalog LKG period'), { code: 'CATALOG_PERIOD_INVALID' });
  return value;
}

function snapshotAt(root, period) {
  const key = assertPeriod(period);
  if (!root || typeof root !== 'object') return null;
  if (root.snapshots && typeof root.snapshots === 'object') return root.snapshots[key] || null;
  return root.period === key ? root : null;
}

function projectPeriod(mainRoot, dqRoot, period) {
  const key = assertPeriod(period);
  const snapshot = snapshotAt(mainRoot, key);
  if (!snapshot) throw Object.assign(new Error(`Catalog LKG missing ${key}`), { code: 'CATALOG_PERIOD_MISSING' });
  const dqSnapshot = snapshotAt(dqRoot, key);
  if (!dqSnapshot) throw Object.assign(new Error(`Catalog DQ LKG missing ${key}`), { code: 'CATALOG_DQ_PERIOD_MISSING' });
  const payload = { period: key, snapshot, dqSnapshot };
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'catalog-period-lkg',
    period: key,
    payloadChecksum: sha256(payload),
    payload,
  };
}

function validateEnvelope(envelope, expectedPeriod = '') {
  if (!envelope || envelope.schemaVersion !== SCHEMA_VERSION || envelope.kind !== 'catalog-period-lkg') {
    throw Object.assign(new Error('Catalog period envelope schema mismatch'), { code: 'CATALOG_PERIOD_SCHEMA_INVALID' });
  }
  const period = assertPeriod(envelope.period);
  if (expectedPeriod && period !== assertPeriod(expectedPeriod)) {
    throw Object.assign(new Error('Catalog period envelope period mismatch'), { code: 'CATALOG_PERIOD_MISMATCH' });
  }
  if (envelope.payload?.period !== period || !envelope.payload?.snapshot || !envelope.payload?.dqSnapshot) {
    throw Object.assign(new Error('Catalog period envelope payload invalid'), { code: 'CATALOG_PERIOD_PAYLOAD_INVALID' });
  }
  if (sha256(envelope.payload) !== envelope.payloadChecksum) {
    throw Object.assign(new Error('Catalog period envelope checksum mismatch'), { code: 'CATALOG_PERIOD_CHECKSUM_INVALID' });
  }
  return envelope.payload;
}

function fsyncDirectory(dir) {
  const fd = fs.openSync(dir, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeEnvelopeAtomic(file, envelope, { beforeRename } = {}) {
  validateEnvelope(envelope, envelope.period);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let renamed = false;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(envelope));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (beforeRename) beforeRename({ file, tmp });
    fs.renameSync(tmp, file);
    renamed = true;
    fs.chmodSync(file, 0o600);
    fsyncDirectory(dir);
  } finally {
    if (!renamed) {
      try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return file;
}

function retainedPeriods(periods, maxPeriods) {
  const limit = Math.max(1, Number(maxPeriods) || 1);
  return [...new Set((periods || []).map(assertPeriod))].sort().slice(-limit);
}

module.exports = {
  SCHEMA_VERSION, canonicalJson, sha256, assertPeriod, snapshotAt,
  projectPeriod, validateEnvelope, writeEnvelopeAtomic, retainedPeriods,
};
