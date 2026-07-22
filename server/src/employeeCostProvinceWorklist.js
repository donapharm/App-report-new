'use strict';

const { provinceResolution } = require('./province');
const persist = require('./persist');

const REJECTED_PROVINCE_SOURCES = new Set(['catalog', 'inferred', 'guessed_from_name']);
const AUDIT_FILE = 'employee_cost_province_audit';
const AUDIT_LIMIT = 2000;

function safeText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeCode(value) {
  return safeText(value, 120).toUpperCase();
}

function unitCodeOf(row = {}) {
  const direct = row.unit_code ?? row.c7 ?? row.UNIT_CODE ?? row.C7;
  if (direct != null && String(direct).trim()) return normalizeCode(direct);
  const raw = safeText(row.DONVI ?? row.donvi, 300);
  return normalizeCode(raw.includes('.') ? raw.split('.', 1)[0] : raw);
}

function unitNameOf(row = {}, unitCode = '') {
  return safeText(row.unit_name ?? row.TEN_DV ?? row.DONVI ?? row.donvi ?? row.c7 ?? row.C7 ?? unitCode, 300) || unitCode;
}

function employeeCodeOf(row = {}) {
  return normalizeCode(row.emp_code ?? row.empCode ?? row.EMP_NUMBER ?? row.MA_NV);
}

function routeOf(row = {}) {
  return safeText(row.route ?? row.tuyen ?? row.ROUTE ?? row.TUYEN, 120);
}

function revenueOf(row = {}) {
  const raw = row.revenue ?? row.tong_tien ?? row.REVENUE ?? row.TONG_TIEN;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function officialRowProvince(row = {}) {
  const source = safeText(row.province_source, 80).toLowerCase();
  if (REJECTED_PROVINCE_SOURCES.has(source)) return '';
  return safeText(row.province ?? row.PROVINCE ?? row.tinh ?? row.TINH, 120);
}

function chooseUnitName(candidates = new Map(), fallback = '') {
  return [...candidates.values()].sort((left, right) => right.revenue - left.revenue
    || right.count - left.count
    || left.name.localeCompare(right.name, 'vi', { numeric: true, sensitivity: 'base' }))[0]?.name || fallback;
}

/**
 * Build one row per authorized unit that has neither a unique official revenue
 * province nor a configured unit_province.json value. Catalog/name guesses are
 * deliberately ignored. Revenue stays at the source line grain and is summed
 * only after the backend roster scope has been applied.
 */
function buildProvinceWorklist(revenueRows = [], options = {}) {
  const roster = Array.isArray(options.roster) ? options.roster : [];
  const rosterCodes = new Set(roster.map((employee) => normalizeCode(employee.emp_code ?? employee.empCode)).filter(Boolean));
  const enforceRoster = rosterCodes.size > 0;
  const resolveProvince = options.provinceResolver || provinceResolution;
  const groups = new Map();

  for (const source of Array.isArray(revenueRows) ? revenueRows : []) {
    const employeeCode = employeeCodeOf(source);
    if (!employeeCode || (enforceRoster && !rosterCodes.has(employeeCode))) continue;
    const unitCode = unitCodeOf(source);
    if (!unitCode) continue;
    const revenue = revenueOf(source);
    const unitName = unitNameOf(source, unitCode);
    const route = routeOf(source);
    const province = officialRowProvince(source);
    const key = unitCode;
    const group = groups.get(key) || {
      unitCode,
      names: new Map(),
      routes: new Set(),
      employeeCodes: new Set(),
      officialProvinces: new Map(),
      revenueAffected: 0,
    };
    const normalizedName = unitName.toLocaleLowerCase('vi');
    const name = group.names.get(normalizedName) || { name: unitName, revenue: 0, count: 0 };
    name.revenue += revenue;
    name.count += 1;
    group.names.set(normalizedName, name);
    if (route) group.routes.add(route);
    group.employeeCodes.add(employeeCode);
    if (province) group.officialProvinces.set(province.toLocaleLowerCase('vi'), province);
    group.revenueAffected += revenue;
    groups.set(key, group);
  }

  const rows = [];
  for (const group of groups.values()) {
    const unitName = chooseUnitName(group.names, group.unitCode);
    // A conflicting official row province fails closed in the App Report. Keep
    // it on the worklist so an admin can investigate instead of guessing.
    const directProvince = group.officialProvinces.size === 1 ? [...group.officialProvinces.values()][0] : '';
    const configured = safeText(resolveProvince(group.unitCode, unitName, '').value, 120);
    if (directProvince || (group.officialProvinces.size === 0 && configured)) continue;
    rows.push({
      unitCode: group.unitCode,
      unitName,
      routes: [...group.routes].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' })),
      employeeCount: group.employeeCodes.size,
      revenueAffected: group.revenueAffected,
      provinceToFill: '',
    });
  }

  rows.sort((left, right) => right.revenueAffected - left.revenueAffected
    || left.unitCode.localeCompare(right.unitCode, 'vi', { numeric: true }));
  return {
    from: safeText(options.from, 7),
    to: safeText(options.to, 7),
    rowCount: rows.length,
    revenueAffected: rows.reduce((sum, row) => sum + row.revenueAffected, 0),
    rows,
  };
}

function writeAudit(entry = {}, storage = persist) {
  const rows = storage.load(AUDIT_FILE, []);
  rows.push({
    at: new Date().toISOString(),
    event: safeText(entry.event || 'province_worklist_export_xlsx', 80),
    actor: normalizeCode(entry.actor) || 'UNKNOWN',
    role: safeText(entry.role, 40).toLowerCase() || 'unknown',
    scope: 'ALL',
    from: safeText(entry.from, 7),
    to: safeText(entry.to, 7),
    unitCount: Math.max(0, Number(entry.unitCount || 0)),
    revenueAffected: Number(entry.revenueAffected || 0),
    outcome: safeText(entry.outcome || 'unknown', 80),
  });
  storage.save(AUDIT_FILE, rows.slice(-AUDIT_LIMIT));
}

module.exports = {
  REJECTED_PROVINCE_SOURCES,
  AUDIT_FILE,
  AUDIT_LIMIT,
  unitCodeOf,
  unitNameOf,
  employeeCodeOf,
  routeOf,
  revenueOf,
  officialRowProvince,
  buildProvinceWorklist,
  writeAudit,
};
