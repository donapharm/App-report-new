'use strict';

const crypto = require('node:crypto');
const { normalizeContractorCode } = require('./appSaleReconShadowV3');
const contract = require('./appSaleReconAllocationV4');

const cache = new Map();
const inFlight = new Map();
const waiters = [];
let active = 0;
const LABEL = 'Chênh lệch chưa phân bổ theo đơn';
const MAX_SCALED_QUANTITY = BigInt(Number.MAX_SAFE_INTEGER);

function clean(value) { return String(value ?? '').trim(); }
function scaledQuantityOrNull(value) {
  const raw = clean(value);
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(raw)) return null;
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  const unsigned = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (unsigned > MAX_SCALED_QUANTITY) return null;
  return negative ? -unsigned : unsigned;
}
function numberOrNull(value) {
  const scaled = scaledQuantityOrNull(value);
  return scaled === null ? null : Number(scaled) / 1000;
}
function sumQuantities(values) {
  let total = 0n;
  for (const value of values) {
    const scaled = scaledQuantityOrNull(value);
    if (scaled === null) return null;
    total += scaled;
    if (total > MAX_SCALED_QUANTITY || total < -MAX_SCALED_QUANTITY) return null;
  }
  return Number(total) / 1000;
}
function bounded(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}
function versionPin(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return bounded(value, 0, 1, 1000000);
}
function configOf(options = {}) {
  return {
    baseUrl: clean(options.baseUrl ?? process.env.APP_SALE_RECON_ALLOCATION_V4_BASE_URL ?? process.env.APP_SALE_RECON_BASE_URL).replace(/\/$/, ''),
    key: clean(options.key ?? process.env.APP_SALE_RECON_ALLOCATION_V4_KEY ?? process.env.APP_SALE_RECON_KEY),
    reconciliationVersion: versionPin(options.reconciliationVersion ?? process.env.APP_SALE_RECON_ALLOCATION_V4_RECONCILIATION_VERSION, 0),
    allocationVersion: versionPin(options.allocationVersion ?? process.env.APP_SALE_RECON_ALLOCATION_V4_VERSION, 4),
    timeoutMs: bounded(options.timeoutMs ?? process.env.APP_SALE_RECON_ALLOCATION_V4_TIMEOUT_MS ?? process.env.APP_SALE_RECON_TIMEOUT_MS, 1500, 250, 10000),
    cacheTtlMs: bounded(options.cacheTtlMs ?? process.env.APP_SALE_RECON_ALLOCATION_V4_CACHE_TTL_MS ?? process.env.APP_SALE_RECON_CACHE_TTL_MS, 60000, 1000, 3600000),
    errorTtlMs: bounded(options.errorTtlMs, 5000, 100, 60000),
    cacheMax: bounded(options.cacheMax ?? process.env.APP_SALE_RECON_ALLOCATION_V4_CACHE_MAX ?? process.env.APP_SALE_RECON_CACHE_MAX, 256, 1, 2000),
    concurrency: bounded(options.concurrency ?? process.env.APP_SALE_RECON_ALLOCATION_V4_CONCURRENCY ?? process.env.APP_SALE_RECON_CONCURRENCY, 4, 1, 16),
    fetchImpl: options.fetchImpl,
    loadSnapshotImpl: options.loadSnapshotImpl || contract.loadSnapshot,
  };
}
function configured(config) {
  return Boolean(config.baseUrl) && config.key.length >= 16 && config.allocationVersion > 0;
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
      || snapshot.confirmed_by !== contract.REQUIRED_CONFIRMER
      || typeof snapshot.confirmed_at !== 'string'
      || new Date(snapshot.confirmed_at).toISOString() !== snapshot.confirmed_at
      || (expected.period && snapshot.period !== expected.period)
      || (expected.contractorCode && snapshot.contractor_code !== expected.contractorCode)
      || (expected.reconciliationVersion && snapshot.reconciliation_version !== expected.reconciliationVersion)
      || (expected.reconciliationRowsChecksumV2
        && snapshot.reconciliation_rows_checksum_v2 !== expected.reconciliationRowsChecksumV2)
      || (expected.reconciliationConfirmedAt && snapshot.confirmed_at !== expected.reconciliationConfirmedAt)
      || (expected.allocationVersion && snapshot.allocation_version !== expected.allocationVersion)
      || contract.checksum(snapshot.groups) !== snapshot.allocation_checksum) return false;
    const confirmedLineIds = new Set();
    const partnerLineIds = new Set();
    const rowOrdinals = new Set();
    const orderItemIds = new Set();
    for (const group of snapshot.groups) {
      contract.canonicalGroup(group, { period: snapshot.period, contractorCode: snapshot.contractor_code });
      if (confirmedLineIds.has(group.confirmed_line_id)
        || partnerLineIds.has(group.partner_reconciliation_line_id)
        || rowOrdinals.has(group.row_ordinal)) return false;
      confirmedLineIds.add(group.confirmed_line_id);
      partnerLineIds.add(group.partner_reconciliation_line_id);
      rowOrdinals.add(group.row_ordinal);
      for (const child of group.children) {
        if (orderItemIds.has(child.order_item_id)) return false;
        orderItemIds.add(child.order_item_id);
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
  const reconciliationVersion = versionPin(scope?.reconciliationVersion ?? config.reconciliationVersion, 0);
  const reconciliationRowsChecksumV2 = clean(scope?.reconciliationRowsChecksumV2);
  const reconciliationConfirmedAt = clean(scope?.reconciliationConfirmedAt);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !contractorCode || reconciliationVersion < 1
    || !/^[a-f0-9]{64}$/.test(reconciliationRowsChecksumV2)
    || !reconciliationConfirmedAt || !Number.isFinite(Date.parse(reconciliationConfirmedAt))
    || new Date(reconciliationConfirmedAt).toISOString() !== reconciliationConfirmedAt) return null;
  const keyHash = crypto.createHash('sha256').update(config.key).digest('hex');
  const cacheKey = [config.baseUrl, keyHash, reconciliationVersion, reconciliationRowsChecksumV2,
    reconciliationConfirmedAt, config.allocationVersion, period, contractorCode].join('\x1f');
  const now = Date.now();
  prune(config.cacheMax, now);
  if (cache.get(cacheKey)?.expiresAt > now) return cache.get(cacheKey).snapshot;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const promise = (async () => {
    await acquire(config.concurrency);
    try {
      const snapshot = await config.loadSnapshotImpl({
        period, contractorCode, baseUrl: config.baseUrl, key: config.key,
        reconciliationVersion,
        allocationVersion: config.allocationVersion, timeoutMs: config.timeoutMs,
        ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      });
      if (!validSnapshot(snapshot, {
        period, contractorCode, reconciliationVersion, reconciliationRowsChecksumV2,
        reconciliationConfirmedAt, allocationVersion: config.allocationVersion,
      })) throw new Error('invalid snapshot');
      cache.set(cacheKey, { snapshot, expiresAt: Date.now() + config.cacheTtlMs });
      prune(config.cacheMax, Date.now());
      return snapshot;
    } catch {
      cache.set(cacheKey, { snapshot: null, expiresAt: Date.now() + config.errorTtlMs });
      prune(config.cacheMax, Date.now());
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
    if (!period || !contractorCode) continue;
    const key = `${period}\x1f${contractorCode}`;
    const normalized = {
      period,
      contractorCode,
      reconciliationVersion: versionPin(scope.reconciliationVersion, 0),
      reconciliationRowsChecksumV2: clean(scope.reconciliationRowsChecksumV2),
      reconciliationConfirmedAt: clean(scope.reconciliationConfirmedAt),
    };
    if (!unique.has(key)) {
      unique.set(key, normalized);
      continue;
    }
    const previous = unique.get(key);
    if (previous === null || previous.reconciliationVersion !== normalized.reconciliationVersion
      || previous.reconciliationRowsChecksumV2 !== normalized.reconciliationRowsChecksumV2
      || previous.reconciliationConfirmedAt !== normalized.reconciliationConfirmedAt) unique.set(key, null);
  }
  return new Map(await Promise.all([...unique].map(async ([key, scope]) => [key, scope ? await loadScope(scope, options) : null])));
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
    sourceLineId: `shadow-v4:${group.confirmed_line_id}:${group.partner_reconciliation_line_id}:${group.row_ordinal}:${employeeCode}`,
    employeeCode,
    employeeName: template.employeeName || '',
    date: null,
    orderId: null,
    orderCode: null,
    orderItemId: null,
    sourceOrderItem: null,
    c5: group.qlnb_code,
    c7: group.unit_code,
    c10: null,
    c16: LABEL,
    c25: null,
    contractorName: template.contractorName ?? null,
    route: null,
    strength: null,
    bidPrice: null,
    quantity: numberOrNull(group.variance.quantity),
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
  if (!employeeCode || !validSnapshot(snapshot, options.expected || {})) {
    return { rows: original, applied: false, changed: false, totals: null };
  }
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
  const appliedGroups = [];
  const eligibleVariance = [];
  let mixedEmployeeVarianceCount = 0;
  for (const group of snapshot.groups) {
    const numericGroup = [group.ordered_quantity, group.reconciled_quantity, group.quantity_delta]
      .every((value) => numberOrNull(value) !== null)
      && (!group.variance || [group.variance.quantity, group.variance.quantity_delta]
        .every((value) => numberOrNull(value) !== null));
    const claims = group.children.map((child) => {
      const identity = childIdentity(child);
      const indexes = rowIndexes.get(identity) || [];
      return { child, identity, indexes };
    });
    const atomicMatch = numericGroup && claims.every((claim) => claim.child.employee_code === employeeCode
        && numberOrNull(claim.child.reconciled_quantity) !== null
        && numberOrNull(claim.child.quantity_delta) !== null
        && claim.indexes.length === 1 && childCounts.get(claim.identity) === 1)
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
    appliedGroups.push(group);
    if (group.variance?.attribution_status === 'UNALLOCATED_MIXED_EMPLOYEE') {
      mixedEmployeeVarianceCount += 1;
    } else if (group.variance?.attribution_status === 'EMPLOYEE_GROUP'
      && group.variance.employee_code === employeeCode
      && numberOrNull(group.variance.quantity_delta) !== 0) eligibleVariance.push(group);
  }
  const extra = options.includeSynthetic === false
    ? [] : eligibleVariance.map((group) => syntheticRow(group, employeeCode, output.find((row) => row.employeeCode === employeeCode) || output[0]));
  const safeTotals = applied ? {
    orderedQuantity: sumQuantities(appliedGroups.map((group) => group.ordered_quantity)),
    reconciledQuantity: sumQuantities(appliedGroups.map((group) => group.reconciled_quantity)),
    quantityDelta: sumQuantities(appliedGroups.map((group) => group.quantity_delta)),
  } : null;
  if (safeTotals && Object.values(safeTotals).some((value) => value === null)) {
    return { rows: original, applied: false, changed: false, totals: null };
  }
  const totals = applied ? {
    ...safeTotals,
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
