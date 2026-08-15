'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 2;
const counters = { sidecarHit: 0, fallback: 0, invalid: 0, periodFilesRead: 0, cacheHit: 0 };
const fallbackReasons = Object.create(null);
const fragmentCache = new Map();
const shadow = {
  considered: 0, sampled: 0, matched: 0, mismatched: 0, errors: 0,
  skippedSample: 0, skippedRate: 0, consecutiveErrors: 0, mismatchCount: 0,
  minute: 0, minuteCount: 0, autoDisabled: false, disabledReason: null,
  lastMismatch: null, lastError: null,
};

function enabled() {
  return TRUE_VALUES.has(String(process.env.CATALOG_PERIOD_LKG_READ_ENABLED || '').trim().toLowerCase());
}
function shadowConfigured() {
  return TRUE_VALUES.has(String(process.env.CATALOG_PERIOD_LKG_SHADOW_ENABLED || '').trim().toLowerCase());
}
function shadowEnabled() { return shadowConfigured() && !shadow.autoDisabled; }
function positiveInt(name, fallback, maximum = 10_000) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}
function rootDir() {
  return path.resolve(process.env.CATALOG_PERIOD_LKG_ROOT || path.join(__dirname, '..', 'data', 'catalog_lkg', 'v1'));
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function semanticHash(value) {
  const digest = crypto.createHash('sha256');
  const visit = (item) => {
    if (item === null || item === undefined) { digest.update('null;'); return; }
    if (Array.isArray(item)) {
      digest.update(`array:${item.length}[`);
      for (const child of item) visit(child);
      digest.update(']');
      return;
    }
    if (typeof item === 'object') {
      const keys = Object.keys(item).sort();
      digest.update(`object:${keys.length}{`);
      for (const key of keys) { digest.update(`${JSON.stringify(key)}:`); visit(item[key]); }
      digest.update('}');
      return;
    }
    digest.update(`${typeof item}:${JSON.stringify(item)};`);
  };
  visit(value);
  return digest.digest('hex');
}
function semanticFields(snapshot, dqSnapshot) {
  return {
    rows: semanticHash(snapshot?.rows || []),
    catalog: semanticHash(snapshot?.catalog || []),
    history: semanticHash(snapshot?.history || []),
    version: String(snapshot?.meta?.version || ''),
    sourceVersion: String(snapshot?.meta?.sourceVersion || ''),
    checksum: String(snapshot?.meta?.checksum || ''),
    dq: semanticHash({ rows: dqSnapshot?.rows || [], catalog: dqSnapshot?.catalog || [], meta: dqSnapshot?.meta || {} }),
  };
}
function disableShadow(reason, detail) {
  shadow.autoDisabled = true;
  shadow.disabledReason = reason;
  console.error('[CATALOG_PERIOD_LKG_SHADOW_DISABLED]', JSON.stringify({ reason, detail }));
}
function shouldSample() {
  shadow.considered += 1;
  const every = positiveInt('CATALOG_PERIOD_LKG_SHADOW_SAMPLE_EVERY', 20);
  if ((shadow.considered - 1) % every !== 0) { shadow.skippedSample += 1; return false; }
  const minute = Math.floor(Date.now() / 60_000);
  if (shadow.minute !== minute) { shadow.minute = minute; shadow.minuteCount = 0; }
  const cap = positiveInt('CATALOG_PERIOD_LKG_SHADOW_MAX_PER_MINUTE', 4, 60);
  if (shadow.minuteCount >= cap) { shadow.skippedRate += 1; return false; }
  shadow.minuteCount += 1;
  shadow.sampled += 1;
  return true;
}
function compareShadow(period, monolithSnapshot, dqSnapshot, options = {}) {
  if (!shadowEnabled() || !shouldSample()) return { scheduled: false };
  try {
    const payload = readPeriod(period, options);
    const primary = semanticFields(monolithSnapshot, dqSnapshot);
    const candidate = semanticFields(payload.snapshot, payload.dqSnapshot);
    const fields = Object.keys(primary).filter((field) => primary[field] !== candidate[field]);
    if (fields.length) {
      shadow.mismatched += 1;
      shadow.mismatchCount += 1;
      shadow.consecutiveErrors = 0;
      shadow.lastMismatch = { at: new Date().toISOString(), period, fields };
      console.error('[CATALOG_PERIOD_LKG_SHADOW_MISMATCH]', JSON.stringify(shadow.lastMismatch));
      if (shadow.mismatchCount >= positiveInt('CATALOG_PERIOD_LKG_SHADOW_MISMATCH_LIMIT', 1)) disableShadow('mismatch_limit', shadow.lastMismatch);
      return { scheduled: true, matched: false, fields };
    }
    shadow.matched += 1;
    shadow.consecutiveErrors = 0;
    return { scheduled: true, matched: true, fields: [] };
  } catch (error) {
    shadow.errors += 1;
    shadow.consecutiveErrors += 1;
    shadow.lastError = { at: new Date().toISOString(), period, code: error.code || 'CATALOG_PERIOD_LKG_SHADOW_ERROR' };
    console.error('[CATALOG_PERIOD_LKG_SHADOW_ERROR]', JSON.stringify(shadow.lastError));
    if (shadow.consecutiveErrors >= positiveInt('CATALOG_PERIOD_LKG_SHADOW_ERROR_LIMIT', 3)) disableShadow('consecutive_errors', shadow.lastError);
    return { scheduled: true, matched: false, error: shadow.lastError.code };
  }
}
function scheduleShadowAfterResponse(response, period, monolithSnapshot, dqSnapshot, options = {}) {
  if (!shadowEnabled() || !response || typeof response.once !== 'function') return false;
  response.once('finish', () => setImmediate(() => compareShadow(period, monolithSnapshot, dqSnapshot, options)));
  return true;
}
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
function readIndex(readFile = fs.readFileSync) {
  return validateIndex(JSON.parse(readFile(path.join(rootDir(), 'index.json'), 'utf8')));
}
function fileIdentity(file, stat = fs.statSync) {
  try {
    const value = stat(file, { bigint: true });
    if (!value.isFile() || value.size <= 2n) return null;
    return `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;
  } catch { return null; }
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
function releaseCachedFile(file) {
  const cached = fragmentCache.get(file);
  if (!cached) return;
  if (cached.timer) clearTimeout(cached.timer);
  fragmentCache.delete(file);
}
function remember(file, identity, payload) {
  releaseCachedFile(file);
  while (fragmentCache.size >= CACHE_MAX_ENTRIES) releaseCachedFile(fragmentCache.keys().next().value);
  const cached = { identity, payload, expiresAt: Date.now() + CACHE_TTL_MS, timer: null };
  cached.timer = setTimeout(() => releaseCachedFile(file), CACHE_TTL_MS);
  if (typeof cached.timer.unref === 'function') cached.timer.unref();
  fragmentCache.set(file, cached);
}
function assertFresh(index, entry, period, currentSource) {
  const expected = typeof currentSource === 'function' ? currentSource(period) : null;
  const sourceVersion = String(entry?.sourceVersion || '');
  const sourceChecksum = String(entry?.sourceChecksum || '');
  const sourceFileIdentity = String(index?.sourceFileIdentity || '');
  if (!expected || !sourceVersion || !sourceChecksum || !sourceFileIdentity
    || sourceVersion !== String(expected.sourceVersion || '')
    || sourceChecksum !== String(expected.sourceChecksum || '')
    || sourceFileIdentity !== String(expected.sourceFileIdentity || '')) {
    throw Object.assign(new Error('Sidecar is stale against current monolith'), { code: 'CATALOG_PERIOD_STALE' });
  }
}
function readPeriodFromIndex(periodInput, index, { readFile = fs.readFileSync, stat = fs.statSync, currentSource } = {}) {
  const period = safePeriod(periodInput);
  const root = rootDir();
  const entry = index.periods[period];
  if (!entry || typeof entry.checksum !== 'string') throw Object.assign(new Error('Sidecar period absent'), { code: 'CATALOG_PERIOD_MISSING' });
  assertFresh(index, entry, period, currentSource);
  const file = safeFile(root, entry.file);
  const before = fileIdentity(file, stat);
  if (!before) throw Object.assign(new Error('Sidecar period absent'), { code: 'CATALOG_PERIOD_MISSING' });
  const cached = fragmentCache.get(file);
  if (cached && cached.identity === before && cached.expiresAt > Date.now() && fileIdentity(file, stat) === before) {
    counters.cacheHit += 1;
    return cached.payload;
  }
  releaseCachedFile(file);
  const raw = readFile(file, 'utf8');
  counters.periodFilesRead += 1;
  const after = fileIdentity(file, stat);
  if (before !== after) throw Object.assign(new Error('Sidecar changed while reading'), { code: 'CATALOG_PERIOD_FILE_DRIFT' });
  if (hash(raw) !== entry.checksum) throw Object.assign(new Error('Sidecar checksum mismatch'), { code: 'CATALOG_PERIOD_CHECKSUM_INVALID' });
  const envelope = JSON.parse(raw);
  if (envelope.schemaVersion !== SCHEMA_VERSION || envelope.kind !== 'catalog-period-lkg' || envelope.period !== period
    || envelope.payload?.period !== period || !envelope.payload?.snapshot || !envelope.payload?.dqSnapshot) {
    throw Object.assign(new Error('Sidecar envelope invalid'), { code: 'CATALOG_PERIOD_ENVELOPE_INVALID' });
  }
  if (fileIdentity(file, stat) !== before) throw Object.assign(new Error('Sidecar changed after parsing'), { code: 'CATALOG_PERIOD_FILE_DRIFT' });
  const payload = deepFreeze(envelope.payload);
  remember(file, before, payload);
  return payload;
}
function readPeriod(periodInput, options = {}) {
  const index = options.index || readIndex(options.readFile);
  return readPeriodFromIndex(periodInput, index, options);
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
    const reason = error.code || 'invalid';
    fallbackReasons[reason] = (fallbackReasons[reason] || 0) + 1;
    return { used: false, reason, payload: null };
  }
}
async function readRangeSequential(periods, consume, { maxPeriods = 6, readFile = fs.readFileSync, stat = fs.statSync, currentSource } = {}) {
  const unique = [...new Set(periods.map(safePeriod))];
  if (unique.length > maxPeriods) throw Object.assign(new Error('Sidecar range exceeds limit'), { code: 'CATALOG_PERIOD_RANGE_LIMIT' });
  const index = readIndex(readFile);
  for (const period of unique) {
    const entry = index.periods[period];
    const file = entry ? safeFile(rootDir(), entry.file) : null;
    try {
      const payload = readPeriodFromIndex(period, index, { readFile, stat, currentSource });
      await consume(payload, period);
    } finally {
      // A range must never retain all fragments. Release each one immediately
      // after its consumer completes so only the current period is resident.
      if (file) releaseCachedFile(file);
    }
  }
  return { periodsRead: unique.length };
}
function diagnostics() { return { enabled: enabled(), shadow: { configured: shadowConfigured(), enabled: shadowEnabled(), sampleEvery: positiveInt('CATALOG_PERIOD_LKG_SHADOW_SAMPLE_EVERY', 20), maxPerMinute: positiveInt('CATALOG_PERIOD_LKG_SHADOW_MAX_PER_MINUTE', 4, 60), ...shadow }, root: rootDir(), cachedFragments: fragmentCache.size, fallbackReasons: { ...fallbackReasons }, ...counters }; }
function resetDiagnosticsForTests() {
  for (const file of [...fragmentCache.keys()]) releaseCachedFile(file);
  for (const key of Object.keys(counters)) counters[key] = 0;
  for (const key of Object.keys(fallbackReasons)) delete fallbackReasons[key];
  Object.assign(shadow, { considered: 0, sampled: 0, matched: 0, mismatched: 0, errors: 0, skippedSample: 0, skippedRate: 0, consecutiveErrors: 0, mismatchCount: 0, minute: 0, minuteCount: 0, autoDisabled: false, disabledReason: null, lastMismatch: null, lastError: null });
}

module.exports = { SCHEMA_VERSION, enabled, shadowEnabled, rootDir, hash, readPeriod, tryReadPeriod, readRangeSequential, compareShadow, scheduleShadowAfterResponse, diagnostics, resetDiagnosticsForTests };
