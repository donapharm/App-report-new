'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json');
const BASE = 'revenue_before_vat';
const MAX_CAP_PCT = 0.5;
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
    base: BASE,
    currency: 'VND',
    capPct: MAX_CAP_PCT,
    tiers: [],
    message: UNCONFIGURED_MESSAGE,
  };
}

function validateConfig(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unconfigured('invalid_config');
  if (raw.base != null && raw.base !== BASE) return unconfigured('invalid_base');
  if (!Array.isArray(raw.tiers) || raw.tiers.length === 0) return unconfigured('empty_tiers');

  const configuredCap = raw.capPct == null ? MAX_CAP_PCT : configNumber(raw.capPct);
  if (configuredCap == null || configuredCap < 0) return unconfigured('invalid_cap');
  const capPct = Math.min(configuredCap, MAX_CAP_PCT);
  const tiers = [];
  for (const rawTier of raw.tiers) {
    const fromPct = configNumber(rawTier?.fromPct);
    const toPct = configNumber(rawTier?.toPct);
    const bonusPct = configNumber(rawTier?.bonusPct);
    // Placeholder [0, 0) and the deprecated flat `bonus` shape both fail closed.
    if (fromPct == null || toPct == null || bonusPct == null || fromPct < 0 || toPct <= fromPct || bonusPct < 0) {
      return unconfigured('invalid_tier');
    }
    tiers.push({ fromPct, toPct, bonusPct: Math.min(bonusPct, capPct, MAX_CAP_PCT) });
  }
  tiers.sort((left, right) => left.fromPct - right.fromPct || left.toPct - right.toPct);
  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index].fromPct < tiers[index - 1].toPct) return unconfigured('overlapping_tiers');
  }
  return {
    configured: true,
    reason: null,
    base: BASE,
    currency: String(raw.currency || 'VND'),
    capPct,
    tiers,
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

function periodBonus(period = {}, config = unconfigured()) {
  const target = finite(period.target) ?? 0;
  const achieved = finite(period.achieved) ?? 0;
  const pct = finite(period.pct);
  if (!config.configured) {
    return { target, achieved, pct, bonusPct: null, amount: null, tier: null, status: 'unconfigured' };
  }
  if (pct == null || target <= 0) {
    return { target, achieved, pct: null, bonusPct: null, amount: null, tier: null, status: 'missing_target' };
  }
  const tier = config.tiers.find((item) => pct >= item.fromPct && pct < item.toPct) || null;
  const bonusPct = tier?.bonusPct || 0;
  return {
    target,
    achieved,
    pct,
    bonusPct,
    amount: Math.round(achieved * bonusPct / 100),
    tier,
    status: tier ? 'matched' : 'below_tier',
  };
}

function buildBonusSummary(kpi = {}, config = loadConfig()) {
  const normalized = config?.configured == null ? validateConfig(config) : config;
  return {
    configured: !!normalized.configured,
    reason: normalized.reason || null,
    message: normalized.configured ? '' : UNCONFIGURED_MESSAGE,
    base: BASE,
    currency: normalized.currency || 'VND',
    capPct: finite(normalized.capPct) ?? MAX_CAP_PCT,
    ky: String(kpi.ky || ''),
    quarterLabel: String(kpi.quarter_label || ''),
    month: periodBonus(kpi.month, normalized),
    quarter: periodBonus(kpi.quarter, normalized),
    employeeSubtotals: [],
  };
}

function aggregateBonusSummaries(reports = [], roster = []) {
  const names = new Map(roster.map((employee) => [
    String(employee.emp_code || '').toUpperCase(),
    String(employee.name || employee.emp_code || ''),
  ]));
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
      target,
      achieved,
      pct: target > 0 ? +(achieved / target * 100).toFixed(1) : null,
      bonusPct: null,
      amount: amounts.length ? amounts.reduce((sum, item) => sum + finite(item.amount), 0) : null,
      tier: null,
      status: 'aggregate',
      contributors: amounts.length,
    };
  };
  return {
    ...first,
    aggregate: true,
    month: aggregatePeriod('month'),
    quarter: aggregatePeriod('quarter'),
    employeeSubtotals: items,
  };
}

module.exports = {
  CONFIG_FILE,
  BASE,
  MAX_CAP_PCT,
  UNCONFIGURED_MESSAGE,
  validateConfig,
  loadConfig,
  periodBonus,
  buildBonusSummary,
  aggregateBonusSummaries,
};
