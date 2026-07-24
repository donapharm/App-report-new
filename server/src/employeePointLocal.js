'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./store');
const persist = require('./persist');
const { isExcluded } = require('./diemXu');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'employee_point_coeff.json');
const PARITY_GATE_FILE = 'employee_point_parity_gate';
const DQ_AUDIT_FILE = 'employee_point_local_dq';
const DQ_AUDIT_LIMIT = 5000;
const SOURCE = 'App Report';
const DEFAULT_RULE_VERSION = 'point-local-2026-05-r1';
const DEFAULT_EFFECTIVE_FROM = '2026-05';
const DEFAULT_CONFIG = Object.freeze({
  version: DEFAULT_RULE_VERSION,
  effective_from: DEFAULT_EFFECTIVE_FROM,
  default: 1,
  by_route: { CL: 2, NT: 2 },
  ncl_units_2x: ['025', '026', '027', '028'],
});

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function safeText(value, max = 200) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeMonth(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (match) return `${match[1]}-${match[2]}`;
  match = text.match(/^(0[1-9]|1[0-2])\.(\d{4})$/);
  return match ? `${match[2]}-${match[1]}` : '';
}

function toUiMonth(value) {
  const month = normalizeMonth(value);
  return month ? `${month.slice(5, 7)}.${month.slice(0, 4)}` : '';
}

function monthRangeInclusive(from, to) {
  const start = normalizeMonth(from);
  const end = normalizeMonth(to);
  if (!start || !end || start > end) return [];
  const out = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endSerial = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
  for (let serial = year * 12 + month; serial <= endSerial; serial += 1) {
    year = Math.floor((serial - 1) / 12);
    month = ((serial - 1) % 12) + 1;
    out.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return out;
}

function quarterMonths(period) {
  const normalized = normalizeMonth(period);
  if (!normalized) return [];
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(5, 7));
  const start = Math.floor((month - 1) / 3) * 3 + 1;
  return [start, start + 1, start + 2].map((item) => `${year}-${String(item).padStart(2, '0')}`);
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      version: safeText(raw.version || DEFAULT_CONFIG.version, 120) || DEFAULT_CONFIG.version,
      effective_from: normalizeMonth(raw.effective_from) || DEFAULT_CONFIG.effective_from,
      default: Number.isFinite(Number(raw.default)) ? Number(raw.default) : DEFAULT_CONFIG.default,
      by_route: Object.fromEntries(Object.entries(raw.by_route || {}).map(([key, value]) => [String(key || '').trim().toUpperCase(), Number(value)]).filter(([, value]) => Number.isFinite(value))),
      ncl_units_2x: Array.isArray(raw.ncl_units_2x) ? raw.ncl_units_2x.map((value) => String(value || '').trim()).filter((value) => /^\d{3}$/.test(value)) : DEFAULT_CONFIG.ncl_units_2x,
    };
  } catch {
    return { ...DEFAULT_CONFIG, by_route: { ...DEFAULT_CONFIG.by_route }, ncl_units_2x: [...DEFAULT_CONFIG.ncl_units_2x] };
  }
}

function unitPrefix(value) {
  const match = String(value || '').trim().match(/^(\d{3})[.\-_\s]/);
  return match ? match[1] : '';
}

function pointMultiplier(row, config = loadConfig()) {
  const route = String(row.route || '').trim().toUpperCase();
  const prefix = unitPrefix(row.unit_code || row.unit_name || row.c7 || row.DONVI);
  if (route && Object.prototype.hasOwnProperty.call(config.by_route, route)) return Number(config.by_route[route]);
  if (route === 'NCL' && config.ncl_units_2x.includes(prefix)) return 2;
  return Number(config.default || 1) || 1;
}

function dqSignature(row = {}) {
  return JSON.stringify([
    safeText(row.emp_code || row.empCode, 32),
    safeText(row.unit_code || row.unit_name || row.c7, 64),
    safeText(row.iit_code || row.c5, 64),
    safeText(row.date || row.period || row.ky, 32),
  ]);
}

function appendDq(entries = []) {
  if (!entries.length) return;
  const rows = persist.load(DQ_AUDIT_FILE, []);
  const seen = new Set(rows.map((item) => item.signature));
  for (const entry of entries) {
    if (seen.has(entry.signature)) continue;
    seen.add(entry.signature);
    rows.push(entry);
  }
  persist.save(DQ_AUDIT_FILE, rows.slice(-DQ_AUDIT_LIMIT));
}

function collectRevenueRows(periods, empCode) {
  const kys = periods.map(toUiMonth).filter(Boolean);
  return store.getRowsRange({ kys, scope: {} }).filter((row) => !empCode || normEmp(row.emp_code) === normEmp(empCode));
}

function summarizePoints(rows, config, empCode) {
  const dqWarnings = [];
  let total = 0;
  for (const row of rows) {
    const rowEmp = normEmp(row.emp_code);
    if (!rowEmp || isExcluded(rowEmp)) continue;
    if (empCode && rowEmp !== normEmp(empCode)) continue;
    const revenue = Number(row.revenue || 0);
    if (!Number.isFinite(revenue) || revenue <= 0) continue;
    const route = String(row.route || '').trim().toUpperCase();
    const prefix = unitPrefix(row.unit_code || row.unit_name || row.c7 || row.DONVI);
    let dq = null;
    if (!route) dq = 'missing_route_default_1';
    else if (route === 'NCL' && !prefix) dq = 'missing_unit_prefix_default_1';
    const multiplier = pointMultiplier(row, config);
    total += revenue * multiplier / 100000000;
    if (dq) dqWarnings.push({
      at: new Date().toISOString(),
      empCode: rowEmp,
      period: safeText(row.ky || row.period || row.date, 32),
      ruleVersion: config.version,
      outcome: dq,
      signature: dqSignature(row),
    });
  }
  appendDq(dqWarnings);
  return { total: round2(total), dqWarningCount: dqWarnings.length };
}

function quarterLabel(period) {
  const normalized = normalizeMonth(period);
  if (!normalized) return '';
  const year = normalized.slice(0, 4);
  const month = Number(normalized.slice(5, 7));
  return `Q${Math.floor((month - 1) / 3) + 1}/${year}`;
}

function readParityGate() {
  return persist.load(PARITY_GATE_FILE, {});
}

function parityStatus({ empCode, period, pointRuleVersion }) {
  const gate = readParityGate();
  const quarterEnd = ['03', '06', '09', '12'].includes(String(normalizeMonth(period).slice(5, 7)));
  const matchingRule = safeText(gate.point_rule_version, 120) === safeText(pointRuleVersion, 120);
  const employees = Array.isArray(gate.required_employees) ? gate.required_employees.map(normEmp) : [];
  const hasEmp = empCode ? employees.includes(normEmp(empCode)) : true;
  const gatePeriod = normalizeMonth(gate.period);
  const requestedPeriod = normalizeMonth(period);
  const matchingPeriod = !!gatePeriod && gatePeriod === requestedPeriod;
  const exactZero = gate.exact_zero_parity === true;
  const passed = exactZero && matchingRule && matchingPeriod && hasEmp;
  return {
    available: passed,
    exactZeroParity: exactZero,
    pointRuleVersionMatch: matchingRule,
    periodMatch: matchingPeriod,
    quarterEnd,
    status: passed ? (quarterEnd ? 'chốt quý — cấn trừ' : 'dự kiến — chưa trừ') : 'đang đối soát',
    note: passed ? '' : 'đang đối soát',
    artifact: safeText(gate.artifact, 240),
    checkedAt: safeText(gate.checked_at, 80),
  };
}

function buildLocalPointPayload({ empCode, period }) {
  const normalizedPeriod = normalizeMonth(period);
  const config = loadConfig();
  if (!normalizedPeriod) {
    return {
      available: false,
      source: SOURCE,
      note: 'kỳ điểm không hợp lệ',
      point_rule_version: config.version,
      point_rule_effective_from: config.effective_from,
      selected_period: '',
      quarter_label: '',
      emp_code: normEmp(empCode),
      point_month: 0,
      point_quarter: 0,
      dq_warning_count: 0,
      parity: parityStatus({ empCode, period: '', pointRuleVersion: config.version }),
    };
  }
  const monthRows = collectRevenueRows([normalizedPeriod], empCode);
  const quarterPeriods = quarterMonths(normalizedPeriod);
  const quarterRows = collectRevenueRows(quarterPeriods, empCode);
  const monthSummary = summarizePoints(monthRows, config, empCode);
  const quarterSummary = summarizePoints(quarterRows, config, empCode);
  const parity = parityStatus({ empCode, period: normalizedPeriod, pointRuleVersion: config.version });
  return {
    available: true,
    source: SOURCE,
    note: '',
    point_rule_version: config.version,
    point_rule_effective_from: config.effective_from,
    selected_period: normalizedPeriod,
    quarter_label: quarterLabel(normalizedPeriod),
    emp_code: normEmp(empCode),
    point_month: monthSummary.total,
    point_quarter: quarterSummary.total,
    dq_warning_count: monthSummary.dqWarningCount + quarterSummary.dqWarningCount,
    parity,
  };
}

module.exports = {
  SOURCE,
  CONFIG_PATH,
  DEFAULT_RULE_VERSION,
  DEFAULT_EFFECTIVE_FROM,
  loadConfig,
  pointMultiplier,
  buildLocalPointPayload,
  parityStatus,
  quarterMonths,
  monthRangeInclusive,
  round2,
};
