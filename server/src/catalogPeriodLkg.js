'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const counters = { sidecarHit: 0, fallback: 0, invalid: 0, periodFilesRead: 0 };

function enabled() {
  return TRUE_VALUES.has(String(process.env.CATALOG_PERIOD_LKG_READ_ENABLED || '').trim().toLowerCase());
}
function rootDir() {
  return path.resolve(process.env.CATALOG_PERIOD_LKG_ROOT || path.join(__dirname, '..', 'data', 'catalog_lkg', 'v1'));
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function validPeriod(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')); }
function safePeriod(value) {
  const period = String(value || '');
  if (!validPeriod(period)) throw Object.assign(new Error('Invalid sidecar period'), { code: 'CATALOG_PERIOD_INVALID' });
  return period;
}
function safeFile(root, name) {
  if (!/^\d{4}-(0[1-9]|1[0-2])\.json$/.test(String(name || ''))) throw Object.assign(new Error('Invalid sidecar file'), { code: 'CATALOG_PERIOD_FILE_INVALID' });
  const file = path.resolve(root, name);
  if (path.dirname(file) !== root) throw Object.assign(new Error('Sidecar path escaped root'), { code: 'CATALOG_PERIOD_FILE_INVALID' });
  return file;
}
function validateIndex(index) {
  if (!index || index.schemaVersion !== SCHEMA_VERSION || index.kind !== 'catalog-period-lkg-index' || !index.periods || typeof index.periods !== 'object') {
    throw Object.assign(new Error('Invalid sidecar index'), { code: 'CATALOG_PERIOD_INDEX_INVALID' });
  }
  return index;
}
function readPeriod(periodInput, { readFile = fs.readFileSync } = {}) {
  const period = safePeriod(periodInput);
  const root = rootDir();
  const index = validateIndex(JSON.parse(readFile(path.join(root, 'index.json'), 'utf8')));
  const entry = index.periods[period];
  if (!entry || typeof entry.checksum !== 'string') throw Object.assign(new Error('Sidecar period absent'), { code: 'CATALOG_PERIOD_MISSING' });
  const file = safeFile(root, entry.file);
  const raw = readFile(file, 'utf8');
  counters.periodFilesRead += 1;
  if (hash(raw) !== entry.checksum) throw Object.assign(new Error('Sidecar checksum mismatch'), { code: 'CATALOG_PERIOD_CHECKSUM_INVALID' });
  const envelope = JSON.parse(raw);
  if (envelope.schemaVersion !== SCHEMA_VERSION || envelope.kind !== 'catalog-period-lkg' || envelope.period !== period
    || envelope.payload?.period !== period || !envelope.payload?.snapshot || !envelope.payload?.dqSnapshot) {
    throw Object.assign(new Error('Sidecar envelope invalid'), { code: 'CATALOG_PERIOD_ENVELOPE_INVALID' });
  }
  return envelope.payload;
}
function tryReadPeriod(period, options) {
  if (!enabled()) return { used: false, reason: 'disabled', payload: null };
  try {
    const payload = readPeriod(period, options);
    if (typeof options?.validate === 'function') options.validate(payload);
    counters.sidecarHit += 1;
    return { used: true, reason: 'ok', payload };
  } catch (error) {
    counters.invalid += 1;
    counters.fallback += 1;
    return { used: false, reason: error.code || 'invalid', payload: null };
  }
}
async function readRangeSequential(periods, consume, { maxPeriods = 6, readFile } = {}) {
  const unique = [...new Set(periods.map(safePeriod))];
  if (unique.length > maxPeriods) throw Object.assign(new Error('Sidecar range exceeds limit'), { code: 'CATALOG_PERIOD_RANGE_LIMIT' });
  for (const period of unique) {
    const payload = readPeriod(period, { readFile });
    await consume(payload, period);
  }
  return { periodsRead: unique.length };
}
function diagnostics() { return { enabled: enabled(), root: rootDir(), ...counters }; }
function resetDiagnosticsForTests() { for (const key of Object.keys(counters)) counters[key] = 0; }

module.exports = { SCHEMA_VERSION, enabled, rootDir, hash, readPeriod, tryReadPeriod, readRangeSequential, diagnostics, resetDiagnosticsForTests };
