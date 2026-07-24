'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json');
const BASE = 'revenue_before_vat';
const SCHEMA_VERSION = 3;
const PRIORITY_GROUPS = Object.freeze(['H.A*', 'H.A', 'H.B', 'H.C', 'H.D']);
const PRIORITY_GROUP_SET = new Set(PRIORITY_GROUPS);
const MAX_BASE_RATE_PCT = 0.25;
const BONUS_V3_EFFECTIVE_MONTH = '2026-07';
const UNCONFIGURED_MESSAGE = 'Chưa cấu hình mức thưởng';

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function configMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(0[1-9]|1[0-2])/);
  return match ? `${match[1]}-${match[2]}` : BONUS_V3_EFFECTIVE_MONTH;
}

function unconfigured(reason = 'empty_tiers') {
  return {
    configured: false, reason, schemaVersion: SCHEMA_VERSION, version: '', effectiveFrom: '', base: BASE,
    currency: 'VND', totalCapPct: null, capPct: null, baseTiers: [], tiers: [],
    priorityThresholdPct: null, priorityRates: {}, priorityTargets: {}, message: UNCONFIGURED_MESSAGE,
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
  if (!raw.priorityTargets || typeof raw.priorityTargets !== 'object' || Array.isArray(raw.priorityTargets)) return unconfigured('invalid_priority_targets');
  const priorityRates = {};
  const priorityTargets = {};
  for (const group of PRIORITY_GROUPS) {
    const rate = configNumber(raw.priorityRates[group]);
    if (rate == null || rate < 0) return unconfigured('invalid_priority_rate');
    priorityRates[group] = rate;
    if (!Object.prototype.hasOwnProperty.call(raw.priorityTargets, group)) return unconfigured('invalid_priority_target');
    const rawTarget = raw.priorityTargets[group];
    const target = rawTarget == null ? null : configNumber(rawTarget);
    if (rawTarget != null && (target == null || target < 0)) return unconfigured('invalid_priority_target');
    priorityTargets[group] = target;
  }
  const totalCapPct = raw.totalCapPct == null ? null : configNumber(raw.totalCapPct);
  if (raw.totalCapPct != null && (totalCapPct == null || totalCapPct < 0)) return unconfigured('invalid_total_cap');
  return {
    configured: true, reason: null, schemaVersion: SCHEMA_VERSION, version: String(raw.version || ''),
    effectiveFrom: String(raw.effectiveFrom || ''), base: BASE, currency: String(raw.currency || 'VND'),
    totalCapPct, capPct: totalCapPct, baseTiers: base.tiers, tiers: base.tiers,
    priorityThresholdPct: threshold, priorityRates, priorityTargets, message: '',
  };
}

function loadConfig(file = CONFIG_FILE) {
  try { return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { return unconfigured('unreadable_config'); }
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

function c10Of(row = {}) { return row.c10 ?? row.C10; }
function routeOf(row = {}) { return String(row.route ?? row.tuyen ?? row.ROUTE ?? row.TUYEN ?? '').trim().toUpperCase(); }
function unitOf(row = {}) {
  const direct = String(row.unit_code ?? row.unitCode ?? row.UNIT_CODE ?? '').trim();
  if (direct) return direct;
  const raw = String(row.DONVI ?? row.donvi ?? row.c7 ?? row.C7 ?? '').trim();
  return raw.includes('.') ? raw.split('.', 1)[0] : raw;
}

/** Build a C10-only revenue projection. Never reads App Sale's `priority`/`tech_rank`. */
function buildPriorityRevenue(revenueRows = [], catalogRows = [], { vatDivisor = 1, period = '' } = {}) {
  const catalog = Array.isArray(catalogRows) ? catalogRows : [];
  const periodKey = String(period || '').trim();
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
  let totalRevenue = 0; let classifiedRevenue = 0; let unclassifiedRevenue = 0;
  let invalidRevenue = 0; let conflictRevenue = 0; let classifiedRows = 0; let unclassifiedRows = 0;
  const segments = new Map();
  for (const row of Array.isArray(revenueRows) ? revenueRows : []) {
    const amount = revenueBeforeVat(row, vatDivisor);
    if (!Number.isFinite(amount)) continue;
    totalRevenue += amount;
    const code = revenueCode(row);
    const groups = groupsByCode.get(code);
    let group = '';
    if (!sourceAvailable || !code || !groups || groups.size !== 1 || conflictCodes.has(code)) {
      unclassifiedRevenue += amount; unclassifiedRows += 1;
      if (invalidCodes.has(code)) invalidRevenue += amount;
      if (conflictCodes.has(code)) conflictRevenue += amount;
    } else {
      group = [...groups][0]; groupRevenue[group] += amount; classifiedRevenue += amount; classifiedRows += 1;
    }
    const route = routeOf(row); const unit = unitOf(row);
    const key = `${periodKey}\u001f${group}\u001f${route}\u001f${unit}`;
    const segment = segments.get(key) || { period: periodKey, productGroup: group, group, route, unit, revenue: 0, rows: 0 };
    segment.revenue += amount; segment.rows += 1; segments.set(key, segment);
  }
  const roundMoney = (value) => Math.round(value);
  return {
    source: 'datahub_catalog_c10', sourceAvailable, periods: periodKey ? [periodKey] : [],
    groupRevenue: Object.fromEntries(PRIORITY_GROUPS.map((group) => [group, roundMoney(groupRevenue[group])])),
    totalRevenue: roundMoney(totalRevenue), classifiedRevenue: roundMoney(classifiedRevenue),
    unclassifiedRevenue: roundMoney(unclassifiedRevenue), invalidRevenue: roundMoney(invalidRevenue),
    conflictRevenue: roundMoney(conflictRevenue), classifiedRows, unclassifiedRows, catalogRows: catalog.length,
    c10ConflictCodes: conflictCodes.size, c10InvalidCodes: invalidCodes.size,
    coveragePct: totalRevenue > 0 ? +(classifiedRevenue / totalRevenue * 100).toFixed(1) : null,
    revenueSegments: [...segments.values()].map((segment) => ({ ...segment, revenue: roundMoney(segment.revenue) })),
  };
}

function mergePriorityRevenue(items = []) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const merged = {
    source: 'datahub_catalog_c10', sourceAvailable: list.length > 0 && list.every((item) => item.sourceAvailable === true),
    periods: [], groupRevenue: Object.fromEntries(PRIORITY_GROUPS.map((group) => [group, 0])),
    totalRevenue: 0, classifiedRevenue: 0, unclassifiedRevenue: 0, invalidRevenue: 0, conflictRevenue: 0,
    classifiedRows: 0, unclassifiedRows: 0, catalogRows: 0, c10ConflictCodes: 0, c10InvalidCodes: 0,
    revenueSegments: [],
  };
  const periods = new Set();
  for (const item of list) {
    for (const period of item.periods || []) if (period) periods.add(String(period));
    for (const group of PRIORITY_GROUPS) merged.groupRevenue[group] += finite(item.groupRevenue?.[group]) || 0;
    for (const key of ['totalRevenue', 'classifiedRevenue', 'unclassifiedRevenue', 'invalidRevenue', 'conflictRevenue', 'classifiedRows', 'unclassifiedRows', 'catalogRows', 'c10ConflictCodes', 'c10InvalidCodes']) merged[key] += finite(item[key]) || 0;
    merged.revenueSegments.push(...(Array.isArray(item.revenueSegments) ? item.revenueSegments : []));
  }
  merged.periods = [...periods].sort();
  merged.coveragePct = merged.totalRevenue > 0 ? +(merged.classifiedRevenue / merged.totalRevenue * 100).toFixed(1) : null;
  return merged;
}

function emptyPriority() { return mergePriorityRevenue([]); }

function resolvedConfig(value, fallback) {
  const candidate = value?.config?.configured != null ? value.config : value;
  return candidate?.configured ? candidate : fallback;
}

function sourceKey(source) {
  if (!source) return 'missing';
  return `${source.scope?.type || 'seed'}:${source.scope?.value || '*'}:${source.id || 'seed'}`;
}

function resolveTargetForGroup(group, coverage, config, targetResolver) {
  const periods = Array.isArray(coverage.periods) && coverage.periods.length ? coverage.periods : [''];
  const details = [];
  let total = 0;
  for (const period of periods) {
    if (!targetResolver) {
      const value = config.priorityTargets?.[group];
      if (value == null) return { assigned: false, target: null, status: 'missing', periods: details };
      total += Number(value);
      details.push({ period, target: Number(value), source: { id: 'seed', scope: { type: 'default', value: '*' } } });
      continue;
    }
    // Group target is per employee/period. Route/unit must come from unique organizational
    // metadata supplied by the caller; customer units in revenue rows are deliberately not used.
    const result = targetResolver({ period, productGroup: group, group });
    if (result?.priorityTargetStatuses?.[group] === 'ambiguous_scope') {
      return { assigned: false, target: null, status: 'ambiguous_scope', periods: details };
    }
    const active = resolvedConfig(result, config);
    const value = active?.priorityTargets?.[group];
    const source = result?.priorityTargetSources?.[group] || null;
    if (value == null) return { assigned: false, target: null, status: 'missing', periods: details };
    if (!Number.isFinite(Number(value)) || Number(value) < 0) return { assigned: false, target: null, status: 'invalid', periods: details };
    total += Number(value);
    details.push({ period, target: Number(value), source, sourceKey: sourceKey(source) });
  }
  return { assigned: true, target: Math.round(total), status: 'assigned', periods: details };
}

function legacyPriorityActive(coverage, config) {
  const periods = Array.isArray(coverage.periods) ? coverage.periods.filter(Boolean) : [];
  const effective = configMonth(config.effectiveFrom);
  return periods.length > 0 && periods.every((period) => String(period) < effective);
}

function periodBonus(period = {}, config = unconfigured(), priority = emptyPriority()) {
  const target = finite(period.target) ?? 0;
  const achieved = finite(period.achieved) ?? 0;
  const pct = finite(period.pct);
  const coverage = priority && typeof priority === 'object' ? priority : emptyPriority();
  const emptyResult = (status, pctValue = pct) => ({
    target, achieved, pct: pctValue, bonusPct: null, baseBonusPct: null, baseAmount: null,
    priorityAmount: null, amount: null, tier: null, priorityGroups: [], priorityStatus: status,
    priorityCoverage: coverage, capped: false, status,
  });
  if (!config.configured) return emptyResult('unconfigured');
  if (pct == null || target <= 0) return emptyResult('missing_target', null);

  const configResolver = typeof coverage.configResolver === 'function' ? coverage.configResolver : null;
  const targetResolver = typeof coverage.targetResolver === 'function' ? coverage.targetResolver : null;
  const segments = Array.isArray(coverage.revenueSegments) ? coverage.revenueSegments : [];
  const baseRates = new Set();
  const thresholds = new Set();
  const caps = new Set();
  const groupRates = new Map(PRIORITY_GROUPS.map((group) => [group, new Set()]));
  let baseAmount = 0;

  if (configResolver && segments.length) {
    for (const segment of segments) {
      const active = resolvedConfig(configResolver(segment), config);
      const tier = active.baseTiers.find((item) => pct >= item.fromPct && (item.toPct == null || pct < item.toPct)) || null;
      const baseRate = tier?.bonusPct || 0;
      const revenue = finite(segment.revenue) || 0;
      baseAmount += Math.round(revenue * baseRate / 100);
      baseRates.add(baseRate);
      thresholds.add(active.priorityThresholdPct);
      caps.add(active.totalCapPct == null ? 'none' : Number(active.totalCapPct));
      const group = normalizePriorityGroup(segment.productGroup);
      if (group) groupRates.get(group).add(Number(active.priorityRates[group]));
    }
  } else {
    const tier = config.baseTiers.find((item) => pct >= item.fromPct && (item.toPct == null || pct < item.toPct)) || null;
    const baseRate = tier?.bonusPct || 0;
    baseAmount = Math.round(achieved * baseRate / 100);
    baseRates.add(baseRate);
    thresholds.add(config.priorityThresholdPct);
    caps.add(config.totalCapPct == null ? 'none' : Number(config.totalCapPct));
    for (const group of PRIORITY_GROUPS) groupRates.get(group).add(Number(config.priorityRates[group]));
  }

  const threshold = thresholds.size === 1 ? [...thresholds][0] : Math.max(...thresholds);
  const eligible = pct >= threshold;
  const preV3 = legacyPriorityActive(coverage, config);
  const priorityGroups = PRIORITY_GROUPS.map((group) => {
    const revenue = Math.round(finite(coverage.groupRevenue?.[group]) || 0);
    const rates = groupRates.get(group);
    if (!rates.size) rates.add(Number(config.priorityRates[group]));
    const ratePct = rates.size === 1 ? [...rates][0] : null;
    const resolvedTarget = resolveTargetForGroup(group, coverage, config, targetResolver);
    let excess = resolvedTarget.assigned ? Math.max(0, revenue - resolvedTarget.target) : null;
    let amount = 0;
    let reason = 'matched';
    if (!coverage.sourceAvailable) reason = 'source_unavailable';
    else if (!eligible) reason = 'below_threshold';
    else if (preV3) {
      // Historical v2 path exists only for periods before T07.2026 so closed figures remain unchanged.
      excess = null;
      amount = ratePct == null ? 0 : Math.round(revenue * ratePct / 100);
      reason = ratePct == null ? 'rate_ambiguous' : 'legacy_pre_v3';
    } else if (!resolvedTarget.assigned) {
      reason = resolvedTarget.status === 'invalid' ? 'target_invalid'
        : resolvedTarget.status === 'ambiguous_scope' ? 'ambiguous_scope'
          : 'target_missing';
    }
    else if (ratePct == null) reason = 'rate_ambiguous';
    else if (excess <= 0) reason = 'at_or_below_target';
    else amount = Math.round(excess * ratePct / 100);
    return {
      group, revenue, target: resolvedTarget.assigned ? resolvedTarget.target : null,
      targetStatus: resolvedTarget.status, targetPeriods: resolvedTarget.periods,
      excess, ratePct, amount, reason,
    };
  });
  const priorityAmount = priorityGroups.reduce((sum, item) => sum + item.amount, 0);
  const uncappedAmount = baseAmount + priorityAmount;
  const capPct = caps.size === 1 && !caps.has('none') ? [...caps][0] : null;
  const capAmount = capPct == null ? null : Math.round(achieved * capPct / 100);
  const amount = capAmount == null ? uncappedAmount : Math.min(uncappedAmount, capAmount);
  const baseBonusPct = baseRates.size === 1 ? [...baseRates][0] : null;
  const priorityStatus = !coverage.sourceAvailable ? 'source_unavailable'
    : !eligible ? 'below_threshold'
      : preV3 ? 'legacy_pre_v3'
          : priorityGroups.every((item) => item.targetStatus === 'missing') ? 'targets_missing'
          : priorityGroups.some((item) => ['target_missing', 'target_invalid', 'ambiguous_scope'].includes(item.reason)) ? 'partially_missing_targets'
            : 'matched';
  const configuredTargetTotal = priorityGroups.reduce((sum, item) => sum + (item.target == null ? 0 : item.target), 0);
  const assignedTargetCount = priorityGroups.filter((item) => item.targetStatus === 'assigned').length;
  return {
    target, achieved, pct, bonusPct: baseBonusPct, baseBonusPct, baseAmount,
    priorityThresholdPct: threshold, priorityEligible: eligible, priorityAmount, priorityGroups, priorityStatus,
    priorityTargetTotal: configuredTargetTotal, priorityTargetAssignedCount: assignedTargetCount,
    priorityTargetWarning: configuredTargetTotal > target ? 'group_targets_exceed_total_target' : null,
    priorityCoverage: coverage, uncappedAmount, capAmount, capped: capAmount != null && amount < uncappedAmount,
    amount,
    tier: baseRates.size === 1 ? config.baseTiers.find((item) => item.bonusPct === baseBonusPct && pct >= item.fromPct && (item.toPct == null || pct < item.toPct)) || null : null,
    status: 'matched', overrideApplied: !!configResolver,
  };
}

function buildBonusSummary(kpi = {}, config = loadConfig(), priority = {}) {
  const normalized = config?.configured == null ? validateConfig(config) : config;
  return {
    configured: !!normalized.configured, reason: normalized.reason || null,
    message: normalized.configured ? '' : UNCONFIGURED_MESSAGE,
    schemaVersion: SCHEMA_VERSION, version: normalized.version || '', effectiveFrom: normalized.effectiveFrom || '',
    base: BASE, currency: normalized.currency || 'VND', totalCapPct: finite(normalized.totalCapPct),
    capPct: finite(normalized.totalCapPct), priorityThresholdPct: finite(normalized.priorityThresholdPct),
    priorityRates: normalized.priorityRates || {}, priorityTargets: normalized.priorityTargets || {},
    ky: String(kpi.ky || ''), quarterLabel: String(kpi.quarter_label || ''),
    month: periodBonus(kpi.month, normalized, priority.month || emptyPriority()),
    quarter: periodBonus(kpi.quarter, normalized, priority.quarter || emptyPriority()), employeeSubtotals: [],
    disclaimer: 'Dự kiến/tham khảo, không phải payroll và không gửi thưởng.',
  };
}

function aggregateBonusSummaries(reports = [], roster = []) {
  const names = new Map(roster.map((employee) => [String(employee.emp_code || '').toUpperCase(), String(employee.name || employee.emp_code || '')]));
  const items = reports.filter((report) => report?.bonus).map((report) => ({
    empCode: String(report.empCode || '').toUpperCase(),
    employeeName: names.get(String(report.empCode || '').toUpperCase()) || String(report.empCode || '').toUpperCase(),
    month: report.bonus.month, quarter: report.bonus.quarter,
  }));
  const first = reports.find((report) => report?.bonus)?.bonus;
  if (!first?.configured) return { ...(first || buildBonusSummary()), employeeSubtotals: items, aggregate: true };
  const aggregatePeriod = (key) => {
    const periods = items.map((item) => item[key] || {});
    const target = periods.reduce((sum, item) => sum + (finite(item.target) || 0), 0);
    const achieved = periods.reduce((sum, item) => sum + (finite(item.achieved) || 0), 0);
    const amounts = periods.filter((item) => item.amount != null && finite(item.amount) != null);
    const priorityGroups = PRIORITY_GROUPS.map((group) => {
      const rows = periods.map((item) => (item.priorityGroups || []).find((row) => row.group === group)).filter(Boolean);
      const assigned = rows.filter((row) => row.target != null);
      const fullyAssigned = rows.length > 0 && assigned.length === rows.length;
      return {
        group, revenue: rows.reduce((sum, row) => sum + (finite(row.revenue) || 0), 0),
        target: fullyAssigned ? assigned.reduce((sum, row) => sum + finite(row.target), 0) : null,
        targetStatus: fullyAssigned ? 'aggregate' : 'partially_missing',
        excess: fullyAssigned ? rows.reduce((sum, row) => sum + (finite(row.excess) || 0), 0) : null,
        ratePct: null, amount: rows.reduce((sum, row) => sum + (finite(row.amount) || 0), 0), reason: 'aggregate',
      };
    });
    return {
      target, achieved, pct: target > 0 ? +(achieved / target * 100).toFixed(1) : null,
      bonusPct: null, baseBonusPct: null,
      baseAmount: periods.reduce((sum, item) => sum + (finite(item.baseAmount) || 0), 0),
      priorityAmount: periods.reduce((sum, item) => sum + (finite(item.priorityAmount) || 0), 0),
      amount: amounts.length ? amounts.reduce((sum, item) => sum + finite(item.amount), 0) : null,
      tier: null, priorityGroups, priorityStatus: 'aggregate', priorityCoverage: emptyPriority(),
      capped: periods.some((item) => item.capped), status: 'aggregate', contributors: amounts.length,
    };
  };
  return { ...first, aggregate: true, month: aggregatePeriod('month'), quarter: aggregatePeriod('quarter'), employeeSubtotals: items };
}

module.exports = {
  CONFIG_FILE, BASE, SCHEMA_VERSION, PRIORITY_GROUPS, MAX_BASE_RATE_PCT, BONUS_V3_EFFECTIVE_MONTH, UNCONFIGURED_MESSAGE,
  validateConfig, loadConfig, normalizePriorityGroup, buildPriorityRevenue, mergePriorityRevenue,
  periodBonus, buildBonusSummary, aggregateBonusSummaries,
};
