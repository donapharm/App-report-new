'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json');
const BASE = 'revenue_before_vat';
const SCHEMA_VERSION = 2;
const PRIORITY_GROUPS = Object.freeze(['H.A*', 'H.A', 'H.B', 'H.C', 'H.D']);
const PRIORITY_GROUP_SET = new Set(PRIORITY_GROUPS);
const MAX_BASE_RATE_PCT = 0.25;
const UNCONFIGURED_MESSAGE = 'Chưa cấu hình mức thưởng';

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unconfigured(reason = 'empty_tiers') {
  return {
    configured: false,
    reason,
    schemaVersion: SCHEMA_VERSION,
    version: '',
    effectiveFrom: '',
    base: BASE,
    currency: 'VND',
    totalCapPct: null,
    capPct: null,
    baseTiers: [],
    tiers: [],
    priorityThresholdPct: null,
    priorityRates: {},
    message: UNCONFIGURED_MESSAGE,
  };
}

function normalizePriorityGroup(value) {
  const group = String(value || '').trim().toUpperCase();
  return PRIORITY_GROUP_SET.has(group) ? group : '';
}

function validateBaseTiers(rawTiers) {
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) return { error: 'empty_tiers' };
  const tiers = [];
  for (const rawTier of rawTiers) {
    const fromPct = configNumber(rawTier?.fromPct);
    const toPct = rawTier?.toPct == null ? null : configNumber(rawTier.toPct);
    const bonusPct = configNumber(rawTier?.bonusPct);
    if (fromPct == null || bonusPct == null || fromPct < 0 || bonusPct < 0 || bonusPct > MAX_BASE_RATE_PCT
      || (toPct != null && toPct <= fromPct)) return { error: 'invalid_tier' };
    tiers.push({ fromPct, toPct, bonusPct });
  }
  tiers.sort((left, right) => left.fromPct - right.fromPct || (left.toPct ?? Infinity) - (right.toPct ?? Infinity));
  if (tiers[0].fromPct !== 0) return { error: 'tier_coverage_gap' };
  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index - 1].toPct == null) return { error: 'tier_after_open_end' };
    if (tiers[index].fromPct !== tiers[index - 1].toPct) return { error: 'tier_coverage_gap' };
  }
  if (tiers.at(-1).toPct != null) return { error: 'tier_open_end_missing' };
  return { tiers };
}

function validateConfig(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unconfigured('invalid_config');
  if (raw.schemaVersion !== SCHEMA_VERSION) return unconfigured('invalid_schema_version');
  if (raw.base !== BASE) return unconfigured('invalid_base');
  const base = validateBaseTiers(raw.baseTiers);
  if (base.error) return unconfigured(base.error);
  const threshold = configNumber(raw.priorityThresholdPct);
  if (threshold == null || threshold < 0) return unconfigured('invalid_priority_threshold');
  if (!raw.priorityRates || typeof raw.priorityRates !== 'object' || Array.isArray(raw.priorityRates)) return unconfigured('invalid_priority_rates');
  const priorityRates = {};
  for (const group of PRIORITY_GROUPS) {
    const rate = configNumber(raw.priorityRates[group]);
    if (rate == null || rate < 0) return unconfigured('invalid_priority_rate');
    priorityRates[group] = rate;
  }
  const totalCapPct = raw.totalCapPct == null ? null : configNumber(raw.totalCapPct);
  if (raw.totalCapPct != null && (totalCapPct == null || totalCapPct < 0)) return unconfigured('invalid_total_cap');
  return {
    configured: true,
    reason: null,
    schemaVersion: SCHEMA_VERSION,
    version: String(raw.version || ''),
    effectiveFrom: String(raw.effectiveFrom || ''),
    base: BASE,
    currency: String(raw.currency || 'VND'),
    totalCapPct,
    capPct: totalCapPct,
    baseTiers: base.tiers,
    tiers: base.tiers,
    priorityThresholdPct: threshold,
    priorityRates,
    message: '',
  };
}

function loadConfig(file = CONFIG_FILE) {
  try {
    return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return unconfigured('unreadable_config');
  }
}

function revenueCode(row = {}) {
  return String(row.iit_code ?? row.qlnb_code ?? row.product_code ?? row.c5
    ?? row.IIT_CODE ?? row.QLNB_CODE ?? row.PRODUCT_CODE ?? '').trim().toUpperCase();
}

function revenueBeforeVat(row = {}, vatDivisor = 1) {
  const explicit = finite(row.revenue_before_vat ?? row.REVENUE_BEFORE_VAT);
  if (explicit != null) return explicit;
  const gross = finite(row.revenue ?? row.tong_tien ?? row.REVENUE ?? row.TONG_TIEN) ?? 0;
  return gross / (finite(vatDivisor) > 0 ? Number(vatDivisor) : 1);
}

function c10Of(row = {}) {
  return row.c10 ?? row.C10;
}

function routeOf(row = {}) {
  return String(row.route ?? row.tuyen ?? row.ROUTE ?? row.TUYEN ?? '').trim().toUpperCase();
}

function unitOf(row = {}) {
  const direct = String(row.unit_code ?? row.unitCode ?? row.UNIT_CODE ?? '').trim();
  if (direct) return direct;
  const raw = String(row.DONVI ?? row.donvi ?? row.c7 ?? row.C7 ?? '').trim();
  return raw.includes('.') ? raw.split('.', 1)[0] : raw;
}

/** Build a C10-only revenue projection. Never reads App Sale's `priority`/`tech_rank`. */
function buildPriorityRevenue(revenueRows = [], catalogRows = [], { vatDivisor = 1 } = {}) {
  const catalog = Array.isArray(catalogRows) ? catalogRows : [];
  const sourceAvailable = catalog.some((row) => Object.prototype.hasOwnProperty.call(row || {}, 'c10')
    || Object.prototype.hasOwnProperty.call(row || {}, 'C10'));
  const groupsByCode = new Map();
  const invalidCodes = new Set();
  for (const row of catalog) {
    const code = revenueCode(row);
    if (!code) continue;
    const raw = c10Of(row);
    const group = normalizePriorityGroup(raw);
    if (!group) {
      if (raw != null && String(raw).trim()) invalidCodes.add(code);
      continue;
    }
    const groups = groupsByCode.get(code) || new Set();
    groups.add(group);
    groupsByCode.set(code, groups);
  }
  const conflictCodes = new Set([...groupsByCode].filter(([, groups]) => groups.size > 1).map(([code]) => code));
  const groupRevenue = Object.fromEntries(PRIORITY_GROUPS.map((group) => [group, 0]));
  let totalRevenue = 0;
  let classifiedRevenue = 0;
  let unclassifiedRevenue = 0;
  let invalidRevenue = 0;
  let conflictRevenue = 0;
  let classifiedRows = 0;
  let unclassifiedRows = 0;
  const segments = new Map();
  for (const row of Array.isArray(revenueRows) ? revenueRows : []) {
    const amount = revenueBeforeVat(row, vatDivisor);
    if (!Number.isFinite(amount)) continue;
    totalRevenue += amount;
    const code = revenueCode(row);
    const groups = groupsByCode.get(code);
    let group = '';
    if (!sourceAvailable || !code || !groups || groups.size !== 1 || conflictCodes.has(code)) {
      unclassifiedRevenue += amount;
      unclassifiedRows += 1;
      if (invalidCodes.has(code)) invalidRevenue += amount;
      if (conflictCodes.has(code)) conflictRevenue += amount;
    } else {
      group = [...groups][0];
      groupRevenue[group] += amount;
      classifiedRevenue += amount;
      classifiedRows += 1;
    }
    const route = routeOf(row);
    const unit = unitOf(row);
    const key = `${group}\u001f${route}\u001f${unit}`;
    const segment = segments.get(key) || { productGroup: group, group, route, unit, revenue: 0, rows: 0 };
    segment.revenue += amount;
    segment.rows += 1;
    segments.set(key, segment);
  }
  const roundMoney = (value) => Math.round(value);
  return {
    source: 'datahub_catalog_c10',
    sourceAvailable,
    groupRevenue: Object.fromEntries(PRIORITY_GROUPS.map((group) => [group, roundMoney(groupRevenue[group])])),
    totalRevenue: roundMoney(totalRevenue),
    classifiedRevenue: roundMoney(classifiedRevenue),
    unclassifiedRevenue: roundMoney(unclassifiedRevenue),
    invalidRevenue: roundMoney(invalidRevenue),
    conflictRevenue: roundMoney(conflictRevenue),
    classifiedRows,
    unclassifiedRows,
    catalogRows: catalog.length,
    c10ConflictCodes: conflictCodes.size,
    c10InvalidCodes: invalidCodes.size,
    coveragePct: totalRevenue > 0 ? +(classifiedRevenue / totalRevenue * 100).toFixed(1) : null,
    revenueSegments: [...segments.values()].map((segment) => ({ ...segment, revenue: roundMoney(segment.revenue) })),
  };
}

function mergePriorityRevenue(items = []) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const merged = {
    source: 'datahub_catalog_c10',
    sourceAvailable: list.length > 0 && list.every((item) => item.sourceAvailable === true),
    groupRevenue: Object.fromEntries(PRIORITY_GROUPS.map((group) => [group, 0])),
    totalRevenue: 0, classifiedRevenue: 0, unclassifiedRevenue: 0, invalidRevenue: 0, conflictRevenue: 0,
    classifiedRows: 0, unclassifiedRows: 0, catalogRows: 0, c10ConflictCodes: 0, c10InvalidCodes: 0,
    revenueSegments: [],
  };
  for (const item of list) {
    for (const group of PRIORITY_GROUPS) merged.groupRevenue[group] += finite(item.groupRevenue?.[group]) || 0;
    for (const key of ['totalRevenue', 'classifiedRevenue', 'unclassifiedRevenue', 'invalidRevenue', 'conflictRevenue', 'classifiedRows', 'unclassifiedRows', 'catalogRows', 'c10ConflictCodes', 'c10InvalidCodes']) merged[key] += finite(item[key]) || 0;
    merged.revenueSegments.push(...(Array.isArray(item.revenueSegments) ? item.revenueSegments : []));
  }
  merged.coveragePct = merged.totalRevenue > 0 ? +(merged.classifiedRevenue / merged.totalRevenue * 100).toFixed(1) : null;
  return merged;
}

function emptyPriority() {
  return mergePriorityRevenue([]);
}

function periodBonus(period = {}, config = unconfigured(), priority = emptyPriority()) {
  const target = finite(period.target) ?? 0;
  const achieved = finite(period.achieved) ?? 0;
  const pct = finite(period.pct);
  const coverage = priority && typeof priority === 'object' ? priority : emptyPriority();
  if (!config.configured) {
    return { target, achieved, pct, bonusPct: null, baseBonusPct: null, baseAmount: null, priorityAmount: null, amount: null, tier: null, priorityGroups: [], priorityStatus: 'unconfigured', priorityCoverage: coverage, capped: false, status: 'unconfigured' };
  }
  if (pct == null || target <= 0) {
    return { target, achieved, pct: null, bonusPct: null, baseBonusPct: null, baseAmount: null, priorityAmount: null, amount: null, tier: null, priorityGroups: [], priorityStatus: 'missing_target', priorityCoverage: coverage, capped: false, status: 'missing_target' };
  }
  const configResolver = typeof coverage.configResolver === 'function' ? coverage.configResolver : null;
  const segments = Array.isArray(coverage.revenueSegments) ? coverage.revenueSegments : [];
  if (configResolver && segments.length) {
    const groupTotals = new Map(PRIORITY_GROUPS.map((group) => [group, { revenue: 0, amount: 0, rates: new Set() }]));
    const baseRates = new Set();
    const thresholds = new Set();
    let baseAmount = 0;
    let priorityAmount = 0;
    let uncappedAmount = 0;
    let amount = 0;
    let anyEligible = false;
    let capped = false;
    for (const segment of segments) {
      const resolved = configResolver({ productGroup: segment.productGroup || '', route: segment.route || '', unit: segment.unit || '' });
      const segmentConfig = resolved?.config?.configured != null ? resolved.config : resolved;
      const active = segmentConfig?.configured ? segmentConfig : config;
      const segmentTier = active.baseTiers.find((item) => pct >= item.fromPct && (item.toPct == null || pct < item.toPct)) || null;
      const baseRate = segmentTier?.bonusPct || 0;
      const revenue = finite(segment.revenue) || 0;
      const segmentBase = Math.round(revenue * baseRate / 100);
      const threshold = active.priorityThresholdPct;
      const eligible = pct >= threshold;
      const group = normalizePriorityGroup(segment.productGroup);
      const groupRate = group ? active.priorityRates[group] : 0;
      const segmentPriority = coverage.sourceAvailable && eligible && group ? Math.round(revenue * groupRate / 100) : 0;
      const segmentUncapped = segmentBase + segmentPriority;
      const segmentCap = active.totalCapPct == null ? null : Math.round(revenue * active.totalCapPct / 100);
      const segmentAmount = segmentCap == null ? segmentUncapped : Math.min(segmentUncapped, segmentCap);
      baseAmount += segmentBase;
      priorityAmount += segmentPriority;
      uncappedAmount += segmentUncapped;
      amount += segmentAmount;
      capped ||= segmentAmount < segmentUncapped;
      baseRates.add(baseRate);
      thresholds.add(threshold);
      anyEligible ||= eligible;
      if (group) {
        const total = groupTotals.get(group);
        total.revenue += revenue;
        total.amount += segmentPriority;
        total.rates.add(groupRate);
      }
    }
    const priorityGroups = PRIORITY_GROUPS.map((group) => {
      const total = groupTotals.get(group);
      return { group, revenue: Math.round(total.revenue), ratePct: total.rates.size === 1 ? [...total.rates][0] : null, amount: total.amount };
    });
    const baseBonusPct = baseRates.size === 1 ? [...baseRates][0] : null;
    const priorityThresholdPct = thresholds.size === 1 ? [...thresholds][0] : null;
    return {
      target, achieved, pct, bonusPct: baseBonusPct, baseBonusPct, baseAmount,
      priorityThresholdPct, priorityEligible: anyEligible, priorityAmount, priorityGroups,
      priorityStatus: !coverage.sourceAvailable ? 'source_unavailable' : !anyEligible ? 'below_threshold' : 'matched',
      priorityCoverage: coverage, uncappedAmount, capAmount: null, capped, amount,
      tier: baseRates.size === 1 ? config.baseTiers.find((item) => item.bonusPct === baseBonusPct && pct >= item.fromPct && (item.toPct == null || pct < item.toPct)) || null : null,
      status: 'matched', overrideApplied: true,
    };
  }
  const tier = config.baseTiers.find((item) => pct >= item.fromPct && (item.toPct == null || pct < item.toPct)) || null;
  const baseBonusPct = tier?.bonusPct || 0;
  const baseAmount = Math.round(achieved * baseBonusPct / 100);
  const eligible = pct >= config.priorityThresholdPct;
  const priorityGroups = PRIORITY_GROUPS.map((group) => {
    const revenue = finite(coverage.groupRevenue?.[group]) || 0;
    const ratePct = config.priorityRates[group];
    return { group, revenue, ratePct, amount: coverage.sourceAvailable && eligible ? Math.round(revenue * ratePct / 100) : 0 };
  });
  const priorityAmount = priorityGroups.reduce((sum, item) => sum + item.amount, 0);
  const uncappedAmount = baseAmount + priorityAmount;
  const capAmount = config.totalCapPct == null ? null : Math.round(achieved * config.totalCapPct / 100);
  const amount = capAmount == null ? uncappedAmount : Math.min(uncappedAmount, capAmount);
  const priorityStatus = !coverage.sourceAvailable ? 'source_unavailable' : !eligible ? 'below_threshold' : 'matched';
  return {
    target, achieved, pct,
    bonusPct: baseBonusPct,
    baseBonusPct,
    baseAmount,
    priorityThresholdPct: config.priorityThresholdPct,
    priorityEligible: eligible,
    priorityAmount,
    priorityGroups,
    priorityStatus,
    priorityCoverage: coverage,
    uncappedAmount,
    capAmount,
    capped: capAmount != null && amount < uncappedAmount,
    amount,
    tier,
    status: tier ? 'matched' : 'below_tier',
  };
}

function buildBonusSummary(kpi = {}, config = loadConfig(), priority = {}) {
  const normalized = config?.configured == null ? validateConfig(config) : config;
  return {
    configured: !!normalized.configured,
    reason: normalized.reason || null,
    message: normalized.configured ? '' : UNCONFIGURED_MESSAGE,
    schemaVersion: SCHEMA_VERSION,
    version: normalized.version || '',
    effectiveFrom: normalized.effectiveFrom || '',
    base: BASE,
    currency: normalized.currency || 'VND',
    totalCapPct: finite(normalized.totalCapPct),
    capPct: finite(normalized.totalCapPct),
    priorityThresholdPct: finite(normalized.priorityThresholdPct),
    priorityRates: normalized.priorityRates || {},
    ky: String(kpi.ky || ''),
    quarterLabel: String(kpi.quarter_label || ''),
    month: periodBonus(kpi.month, normalized, priority.month || emptyPriority()),
    quarter: periodBonus(kpi.quarter, normalized, priority.quarter || emptyPriority()),
    employeeSubtotals: [],
  };
}

function aggregateBonusSummaries(reports = [], roster = []) {
  const names = new Map(roster.map((employee) => [String(employee.emp_code || '').toUpperCase(), String(employee.name || employee.emp_code || '')]));
  const items = reports.filter((report) => report?.bonus).map((report) => ({
    empCode: String(report.empCode || '').toUpperCase(),
    employeeName: names.get(String(report.empCode || '').toUpperCase()) || String(report.empCode || '').toUpperCase(),
    month: report.bonus.month,
    quarter: report.bonus.quarter,
  }));
  const first = reports.find((report) => report?.bonus)?.bonus;
  if (!first?.configured) return { ...(first || buildBonusSummary()), employeeSubtotals: items, aggregate: true };
  const aggregatePeriod = (key) => {
    const periods = items.map((item) => item[key] || {});
    const target = periods.reduce((sum, item) => sum + (finite(item.target) || 0), 0);
    const achieved = periods.reduce((sum, item) => sum + (finite(item.achieved) || 0), 0);
    const amounts = periods.filter((item) => item.amount != null && finite(item.amount) != null);
    return {
      target, achieved,
      pct: target > 0 ? +(achieved / target * 100).toFixed(1) : null,
      bonusPct: null, baseBonusPct: null,
      baseAmount: periods.reduce((sum, item) => sum + (finite(item.baseAmount) || 0), 0),
      priorityAmount: periods.reduce((sum, item) => sum + (finite(item.priorityAmount) || 0), 0),
      amount: amounts.length ? amounts.reduce((sum, item) => sum + finite(item.amount), 0) : null,
      tier: null, priorityGroups: [], priorityStatus: 'aggregate', priorityCoverage: emptyPriority(),
      capped: periods.some((item) => item.capped), status: 'aggregate', contributors: amounts.length,
    };
  };
  return { ...first, aggregate: true, month: aggregatePeriod('month'), quarter: aggregatePeriod('quarter'), employeeSubtotals: items };
}

module.exports = {
  CONFIG_FILE, BASE, SCHEMA_VERSION, PRIORITY_GROUPS, MAX_BASE_RATE_PCT, UNCONFIGURED_MESSAGE,
  validateConfig, loadConfig, normalizePriorityGroup, buildPriorityRevenue, mergePriorityRevenue,
  periodBonus, buildBonusSummary, aggregateBonusSummaries,
};
