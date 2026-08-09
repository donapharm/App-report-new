'use strict';

const crypto = require('node:crypto');
const { normalizeContractorCode } = require('./appSaleReconShadowV3');
const contract = require('./appSaleReconAllocationV4');

const cache = new Map();
const inFlight = new Map();
const waiters = [];
let active = 0;
const LABEL = 'Chênh lệch chưa phân bổ theo đơn';

function clean(value) { return String(value ?? '').trim(); }
function numberOrNull(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function bounded(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}
function configOf(options = {}) {
  return {
    baseUrl: clean(options.baseUrl ?? process.env.APP_SALE_RECON_ALLOCATION_V4_BASE_URL).replace(/\/$/, ''),
    key: clean(options.key ?? process.env.APP_SALE_RECON_ALLOCATION_V4_KEY),
    reconciliationVersion: bounded(options.reconciliationVersion ?? process.env.APP_SALE_RECON_ALLOCATION_V4_RECONCILIATION_VERSION, 0, 1, 1000000),
    allocationVersion: bounded(options.allocationVersion ?? process.env.APP_SALE_RECON_ALLOCATION_V4_VERSION, 0, 1, 1000000),
    timeoutMs: bounded(options.timeoutMs ?? process.env.APP_SALE_RECON_ALLOCATION_V4_TIMEOUT_MS, 1500, 250, 10000),
    cacheTtlMs: bounded(options.cacheTtlMs ?? process.env.APP_SALE_RECON_ALLOCATION_V4_CACHE_TTL_MS, 60000, 1000, 3600000),
    errorTtlMs: bounded(options.errorTtlMs, 5000, 100, 60000),
    cacheMax: bounded(options.cacheMax ?? process.env.APP_SALE_RECON_ALLOCATION_V4_CACHE_MAX, 256, 1, 2000),
    concurrency: bounded(options.concurrency ?? process.env.APP_SALE_RECON_ALLOCATION_V4_CONCURRENCY, 4, 1, 16),
    fetchImpl: options.fetchImpl,
    loadSnapshotImpl: options.loadSnapshotImpl || contract.loadSnapshot,
  };
}
function configured(config) {
  return Boolean(config.baseUrl) && config.key.length >= 16
    && config.reconciliationVersion > 0 && config.allocationVersion > 0;
}
async function acquire(limit) {
  if (active < limit) { active += 1; return; }
  await new Promise((resolve) => waiters.push(resolve));
  active += 1;
}
function release() { active = Math.max(0, active - 1); waiters.shift()?.(); }
function prune(maximum, now) {
  for (const [key, value] of cache) if (value.expiresAt <= now) cache.delete(key);
  while (cache.size > maximum) cache.delete(cache.keys().next().value);
}
function validSnapshot(snapshot, expected = {}) {
  try {
    if (snapshot?.contract !== contract.CONTRACT || snapshot.shadow_only !== true
      || snapshot.effective_values_changed !== false || !Array.isArray(snapshot.groups)
      || !Number.isSafeInteger(snapshot.reconciliation_version) || snapshot.reconciliation_version < 1
      || !Number.isSafeInteger(snapshot.allocation_version) || snapshot.allocation_version < 1
      || !/^[a-f0-9]{64}$/.test(snapshot.reconciliation_rows_checksum_v2)
      || !/^[a-f0-9]{64}$/.test(snapshot.allocation_checksum)
      || (expected.period && snapshot.period !== expected.period)
      || (expected.contractorCode && snapshot.contractor_code !== expected.contractorCode)
      || (expected.reconciliationVersion && snapshot.reconciliation_version !== expected.reconciliationVersion)
      || (expected.allocationVersion && snapshot.allocation_version !== expected.allocationVersion)
      || contract.checksum(snapshot.groups) !== snapshot.allocation_checksum) return false;
    const groupIds = new Set();
    const childIds = new Set();
    for (const group of snapshot.groups) {
      contract.canonicalGroup(group, { period: snapshot.period, contractorCode: snapshot.contractor_code });
      const groupId = `${group.confirmed_line_id}\x1f${group.partner_reconciliation_line_id}\x1f${group.row_ordinal}`;
      if (groupIds.has(groupId)) return false;
      groupIds.add(groupId);
      for (const child of group.children) {
        const childId = `${child.order_id}\x1f${child.order_item_id}\x1f${child.employee_id}`;
        if (childIds.has(childId)) return false;
        childIds.add(childId);
      }
    }
    return true;
  } catch { return false; }
}
async function loadScope(scope, options = {}) {
  const config = configOf(options);
  if (!configured(config)) return null;
  const period = clean(scope?.period);
  const contractorCode = normalizeContractorCode(scope?.contractorCode);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !contractorCode) return null;
  const keyHash = crypto.createHash('sha256').update(config.key).digest('hex').slice(0, 16);
  const cacheKey = [config.baseUrl, keyHash, config.reconciliationVersion, config.allocationVersion, period, contractorCode].join('\x1f');
  const now = Date.now();
  prune(config.cacheMax, now);
  if (cache.get(cacheKey)?.expiresAt > now) return cache.get(cacheKey).snapshot;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const promise = (async () => {
    await acquire(config.concurrency);
    try {
      const snapshot = await config.loadSnapshotImpl({
        period, contractorCode, baseUrl: config.baseUrl, key: config.key,
        reconciliationVersion: config.reconciliationVersion,
        allocationVersion: config.allocationVersion, timeoutMs: config.timeoutMs,
        ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      });
      if (!validSnapshot(snapshot, {
        period, contractorCode, reconciliationVersion: config.reconciliationVersion,
        allocationVersion: config.allocationVersion,
      })) throw new Error('invalid snapshot');
      cache.set(cacheKey, { snapshot, expiresAt: Date.now() + config.cacheTtlMs });
      return snapshot;
    } catch {
      cache.set(cacheKey, { snapshot: null, expiresAt: Date.now() + config.errorTtlMs });
      return null;
    } finally { release(); }
  })();
  inFlight.set(cacheKey, promise);
  try { return await promise; } finally { inFlight.delete(cacheKey); }
}
async function loadScopes(scopes = [], options = {}) {
  const unique = new Map();
  for (const scope of scopes) {
    const period = clean(scope.period);
    const contractorCode = normalizeContractorCode(scope.contractorCode);
    if (period && contractorCode) unique.set(`${period}\x1f${contractorCode}`, { period, contractorCode });
  }
  return new Map(await Promise.all([...unique].map(async ([key, scope]) => [key, await loadScope(scope, options)])));
}
function exactIdentity(row, employee = '') {
  const sourceLine = clean(row?.sourceLineId);
  const orderCode = clean(row?.orderCode);
  const employeeCode = clean(row?.employeeCode || employee).toUpperCase();
  return sourceLine && orderCode && employeeCode ? `${sourceLine}\x1f${orderCode}\x1f${employeeCode}` : '';
}
function childIdentity(child) {
  return `${clean(child?.order_item_id)}\x1f${clean(child?.order_code)}\x1f${clean(child?.employee_code).toUpperCase()}`;
}
function syntheticRow(group, employeeCode, template = {}) {
  return {
    stt: null,
    sourceLineId: `shadow-v4:${group.confirmed_line_id}:${employeeCode}`,
    employeeCode,
    employeeName: template.employeeName || '',
    date: null,
    orderCode: null,
    c5: group.qlnb_code,
    c7: group.unit_code,
    c10: template.c10 ?? null,
    c16: LABEL,
    c25: template.c25 ?? null,
    contractorName: template.contractorName ?? null,
    route: template.route ?? null,
    strength: null,
    bidPrice: null,
    quantity: null,
    shadowReconciledQuantity: numberOrNull(group.variance.quantity),
    shadowQuantityDelta: numberOrNull(group.variance.quantity_delta),
    shadowRowLabel: LABEL,
    reconciliationSynthetic: true,
    revenue: null,
    revenueBeforeVat: null,
    rowMonthlyTotal: null,
    rowAnnualTotal: null,
    amounts: {},
    dailyAmounts: null,
    revenueMatched: false,
    dayRevenueMatched: false,
    note: null,
  };
}
function projectEmployeeCostRows(rows = [], snapshot = {}, options = {}) {
  const original = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
  const employeeCode = clean(options.employeeCode).toUpperCase();
  if (!validSnapshot(snapshot)) return { rows: original, applied: false, changed: false, totals: null };
  const output = original.map((row) => ({ ...row }));
  const rowIndexes = new Map();
  const childCounts = new Map();
  for (let index = 0; index < output.length; index += 1) {
    const identity = exactIdentity(output[index], employeeCode);
    if (!identity) continue;
    const indexes = rowIndexes.get(identity) || [];
    indexes.push(index);
    rowIndexes.set(identity, indexes);
  }
  for (const group of snapshot.groups) for (const child of group.children) {
    const identity = childIdentity(child);
    childCounts.set(identity, (childCounts.get(identity) || 0) + 1);
  }
  let applied = false;
  const eligibleVariance = [];
  let mixedEmployeeVarianceCount = 0;
  for (const group of snapshot.groups) {
    const claims = group.children.map((child) => {
      const identity = childIdentity(child);
      const indexes = rowIndexes.get(identity) || [];
      return { child, identity, indexes };
    });
    const atomicMatch = claims.every((claim) => claim.indexes.length === 1 && childCounts.get(claim.identity) === 1)
      && new Set(claims.map((claim) => claim.indexes[0])).size === claims.length;
    if (!atomicMatch) continue;
    for (const claim of claims) {
      const index = claim.indexes[0];
      output[index] = {
        ...output[index],
        shadowReconciledQuantity: numberOrNull(claim.child.reconciled_quantity),
        shadowQuantityDelta: numberOrNull(claim.child.quantity_delta),
      };
    }
    applied = true;
    if (group.variance?.attribution_status === 'UNALLOCATED_MIXED_EMPLOYEE') {
      mixedEmployeeVarianceCount += 1;
    } else if (group.variance?.attribution_status === 'EMPLOYEE_GROUP'
      && group.variance.employee_code === employeeCode
      && numberOrNull(group.variance.quantity_delta) !== 0) eligibleVariance.push(group);
  }
  const extra = options.includeSynthetic === false
    ? [] : eligibleVariance.map((group) => syntheticRow(group, employeeCode, output.find((row) => row.employeeCode === employeeCode) || output[0]));
  const totals = applied ? {
    orderedQuantity: snapshot.groups.reduce((sum, group) => sum + numberOrNull(group.ordered_quantity), 0),
    reconciledQuantity: snapshot.groups.reduce((sum, group) => sum + numberOrNull(group.reconciled_quantity), 0),
    quantityDelta: snapshot.groups.reduce((sum, group) => sum + numberOrNull(group.quantity_delta), 0),
    employeeVarianceRows: extra.length,
    mixedEmployeeVarianceCount,
  } : null;
  return { rows: [...output, ...extra], applied, changed: applied || extra.length > 0, totals };
}
function resetCacheForTests() { cache.clear(); inFlight.clear(); waiters.splice(0); active = 0; }

module.exports = {
  configOf, validSnapshot, loadScope, loadScopes, exactIdentity, childIdentity,
  projectEmployeeCostRows, resetCacheForTests, SYNTHETIC_LABEL: LABEL,
};
