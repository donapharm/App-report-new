'use strict';

const crypto = require('node:crypto');
const { CONTRACT, COST_AMOUNT_KEYS, normalizeContractorCode, checksum, loadSnapshot } = require('./appSaleReconShadowV3');

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_ERROR_TTL_MS = 5_000;
const DEFAULT_CACHE_MAX = 256;
const DEFAULT_CONCURRENCY = 4;
const snapshotCache = new Map();
const inFlight = new Map();
let activeLoads = 0;
const loadWaiters = [];

const clean = (value) => value == null ? '' : String(value).trim();
const HASH = /^[a-f0-9]{64}$/;
function decimal(value, scale = 2) {
  const text = clean(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const [, fraction = ''] = text.split('.');
  if (fraction.length > scale) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function cents(value) {
  const text = clean(value);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -amount : amount;
}
function exactIdentity(row, fallbackEmployeeCode = '') {
  const sourceLine = clean(row?.sourceLineId);
  const orderCode = clean(row?.orderCode);
  const employeeCode = clean(row?.employeeCode || row?.empCode || fallbackEmployeeCode).toUpperCase();
  return sourceLine && orderCode && employeeCode ? `${sourceLine}\u001f${orderCode}\u001f${employeeCode}` : '';
}
function reconIdentity(row) {
  const sourceLine = clean(row?.immutable_source_line_id);
  const orderCode = clean(row?.immutable_order_code);
  const employeeCode = clean(row?.canonical_employee_code).toUpperCase();
  return sourceLine && orderCode && employeeCode ? `${sourceLine}\u001f${orderCode}\u001f${employeeCode}` : '';
}
function eligible(row) {
  return row?.match_status === 'MATCHED'
    && row?.confirmation_provenance === 'ACCOUNTING_RECON_IMMUTABLE_CONFIRMATION'
    && Number(row?.identity_candidate_count) === 1
    && Number(row?.reverse_candidate_count) === 1
    && reconIdentity(row);
}
function validEnvelope(snapshot, expected = {}) {
  if ((expected.period && snapshot?.period !== expected.period)
    || (expected.contractorCode && normalizeContractorCode(snapshot?.contractor_code) !== expected.contractorCode)) return false;
  if (!(snapshot?.contract === CONTRACT
    && snapshot?.shadow_only === true
    && snapshot?.effective_values_changed === false
    && Number.isSafeInteger(snapshot?.reconciliation_version) && snapshot.reconciliation_version > 0
    && Number.isSafeInteger(snapshot?.shadow_snapshot_version) && snapshot.shadow_snapshot_version > 0
    && snapshot?.immutable_version === snapshot.shadow_snapshot_version
    && snapshot?.immutable_checksum === snapshot.shadow_snapshot_checksum
    && HASH.test(clean(snapshot?.reconciliation_rows_checksum_v2))
    && HASH.test(clean(snapshot?.shadow_snapshot_checksum))
    && Array.isArray(snapshot?.rows))) return false;
  try { return checksum(snapshot.rows) === snapshot.shadow_snapshot_checksum; }
  catch { return false; }
}
// This validator remains private to the server-side boundary for a later phase.
// Its C33-C46 values are deliberately never attached to an employee-cost row.
function hiddenCostCandidate(row) {
  const fields = ['c32_base_amount', ...COST_AMOUNT_KEYS, 'c47_total_candidate_amount'];
  if (row.cost_candidate_status === 'BLOCKED') {
    if (row.cost_policy_version !== null || row.cost_policy_checksum !== null || fields.some((key) => row[key] !== null)) return null;
    return Object.freeze({ status: 'BLOCKED', reason: clean(row.cost_candidate_reason) || 'BLOCKED' });
  }
  if (row.cost_candidate_status !== 'READY'
    || !Number.isSafeInteger(row.cost_policy_version) || row.cost_policy_version < 1
    || !HASH.test(clean(row.cost_policy_checksum))
    || !['BEFORE_VAT', 'INCLUDING_VAT'].includes(row.vat_basis)
    || !clean(row.vat_source) || decimal(row.vat_rate, 6) == null || decimal(row.vat_divisor, 6) == null) return null;
  const base = cents(row.c32_base_amount);
  const excludingVat = cents(row.amount_excluding_vat);
  const candidates = COST_AMOUNT_KEYS.map((key) => cents(row[key]));
  const total = cents(row.c47_total_candidate_amount);
  if (base === null || excludingVat === null || base !== excludingVat || total === null || candidates.some((value) => value === null)
    || candidates.reduce((sum, value) => sum + value, 0n) !== total) return null;
  return Object.freeze({ status: 'READY', policyVersion: row.cost_policy_version, policyChecksum: clean(row.cost_policy_checksum) });
}
function projectEmployeeCostRows(rows = [], snapshot = {}, { employeeCode = '' } = {}) {
  const output = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row, shadowReconciledQuantity: null, shadowQuantityDelta: null,
  }));
  if (!validEnvelope(snapshot)) return output;
  const reportCounts = new Map();
  for (const row of output) {
    const key = exactIdentity(row, employeeCode);
    if (key) reportCounts.set(key, (reportCounts.get(key) || 0) + 1);
  }
  const shadowCounts = new Map();
  for (const row of snapshot.rows) {
    const key = eligible(row);
    if (key) shadowCounts.set(key, (shadowCounts.get(key) || 0) + 1);
  }
  const index = new Map(snapshot.rows
    .filter((row) => { const key = eligible(row); return key && shadowCounts.get(key) === 1; })
    .map((row) => [reconIdentity(row), row]));
  return output.map((row) => {
    const key = exactIdentity(row, employeeCode);
    const match = key && reportCounts.get(key) === 1 ? index.get(key) : null;
    if (!match) return row;
    const quantity = decimal(match.quantity, 3);
    const delta = decimal(match.quantity_delta, 3);
    return quantity == null || delta == null
      ? row
      : { ...row, shadowReconciledQuantity: quantity, shadowQuantityDelta: delta };
  });
}
function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}
async function acquire(limit) {
  if (activeLoads < limit) { activeLoads += 1; return; }
  await new Promise((resolve) => loadWaiters.push(resolve));
  activeLoads += 1;
}
function release() {
  activeLoads = Math.max(0, activeLoads - 1);
  loadWaiters.shift()?.();
}
function pruneCache(maxEntries, now) {
  for (const [key, entry] of snapshotCache) if (entry.expiresAt <= now) snapshotCache.delete(key);
  while (snapshotCache.size > maxEntries) snapshotCache.delete(snapshotCache.keys().next().value);
}
function configOf(options = {}) {
  return {
    baseUrl: clean(options.baseUrl ?? process.env.APP_SALE_RECON_BASE_URL).replace(/\/$/, ''),
    key: clean(options.key ?? process.env.APP_SALE_RECON_KEY),
    timeoutMs: boundedInteger(options.timeoutMs ?? process.env.APP_SALE_RECON_TIMEOUT_MS, 1500, 250, 10000),
    cacheTtlMs: boundedInteger(options.cacheTtlMs ?? process.env.APP_SALE_RECON_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS, 1000, 3600000),
    errorTtlMs: boundedInteger(options.errorTtlMs, DEFAULT_ERROR_TTL_MS, 100, 60000),
    cacheMax: boundedInteger(options.cacheMax ?? process.env.APP_SALE_RECON_CACHE_MAX, DEFAULT_CACHE_MAX, 1, 2000),
    concurrency: boundedInteger(options.concurrency ?? process.env.APP_SALE_RECON_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 16),
    fetchImpl: options.fetchImpl,
    loadSnapshotImpl: options.loadSnapshotImpl || loadSnapshot,
  };
}
function configured(config) {
  return !!config.baseUrl && config.key.length >= 16 && typeof config.loadSnapshotImpl === 'function';
}
async function loadScope(scope, options = {}) {
  const config = configOf(options);
  if (!configured(config)) return null;
  const contractorCode = normalizeContractorCode(scope?.contractorCode);
  const period = clean(scope?.period);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !contractorCode) return null;
  const credentialPin = crypto.createHash('sha256').update(config.key).digest('hex').slice(0, 16);
  const cacheKey = `${config.baseUrl}\u001f${credentialPin}\u001f${period}\u001f${contractorCode}`;
  const now = Date.now();
  pruneCache(config.cacheMax, now);
  const cached = snapshotCache.get(cacheKey);
  if (cached?.expiresAt > now) return cached.snapshot;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const pending = (async () => {
    await acquire(config.concurrency);
    try {
      const snapshot = await config.loadSnapshotImpl({
        period, contractorCode, baseUrl: config.baseUrl, key: config.key,
        timeoutMs: config.timeoutMs, ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      });
      if (!validEnvelope(snapshot, { period, contractorCode })) throw new Error('invalid reconciliation snapshot');
      snapshotCache.set(cacheKey, { snapshot, expiresAt: Date.now() + config.cacheTtlMs });
      pruneCache(config.cacheMax, Date.now());
      return snapshot;
    } catch {
      snapshotCache.set(cacheKey, { snapshot: null, expiresAt: Date.now() + config.errorTtlMs });
      return null;
    } finally { release(); }
  })();
  inFlight.set(cacheKey, pending);
  try { return await pending; }
  finally { inFlight.delete(cacheKey); }
}
async function loadScopes(scopes = [], options = {}) {
  const unique = new Map();
  for (const scope of scopes) {
    const period = clean(scope?.period);
    const contractorCode = normalizeContractorCode(scope?.contractorCode);
    if (period && contractorCode) unique.set(`${period}\u001f${contractorCode}`, { period, contractorCode });
  }
  return new Map(await Promise.all([...unique].map(async ([key, scope]) => [key, await loadScope(scope, options)])));
}
function resetCacheForTests() {
  snapshotCache.clear();
  inFlight.clear();
  activeLoads = 0;
  loadWaiters.splice(0);
}

module.exports = {
  normalizeContractorCode, exactIdentity, reconIdentity, eligible, hiddenCostCandidate, validEnvelope, projectEmployeeCostRows,
  loadScope, loadScopes, resetCacheForTests,
};
