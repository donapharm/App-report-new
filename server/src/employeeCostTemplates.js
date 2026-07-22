'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'employee_cost_templates.json');
const BLOCKED_COST_COLUMNS = new Set(['c32', 'c47']);
const DEFAULT_DERIVED_BASES = Object.freeze({ c44: 'c43' });
const LAYOUT_FIELDS = new Set([
  'date', 'orderCode', 'route', 'c7', 'contractorName', 'c5', 'c16', 'strength', 'c25',
  'bidPrice', 'quantity', 'revenueBeforeVat', 'rowMonthlyTotal', 'note',
]);

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function isCostColumn(value) {
  const key = String(value || '').trim().toLowerCase();
  const match = /^c(\d+)$/.exec(key);
  if (!match || BLOCKED_COST_COLUMNS.has(key)) return false;
  const position = Number(match[1]);
  return position >= 33 && position <= 46;
}

function loadConfig(filePath = process.env.EMPLOYEE_COST_TEMPLATE_CONFIG || DEFAULT_CONFIG_PATH) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return raw && typeof raw === 'object' ? raw : {};
}

function invalidConfig(message, code = 'EMPLOYEE_COST_TEMPLATE_CONFIG_INVALID') {
  return Object.assign(new Error(message), { code });
}

function normalizeDerivedBases(value = DEFAULT_DERIVED_BASES) {
  let entries;
  if (value instanceof Map) entries = [...value.entries()];
  else if (typeof value === 'string') {
    entries = value.trim() === '' ? [] : value.split(',').map((entry) => {
      const parts = entry.split(':').map((part) => part.trim().toLowerCase());
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw invalidConfig('Cấu hình cột phái sinh không hợp lệ.', 'EMPLOYEE_COST_DERIVED_BASE_INVALID');
      }
      return parts;
    });
  } else if (value && typeof value === 'object' && !Array.isArray(value)) entries = Object.entries(value);
  else throw invalidConfig('Cấu hình cột phái sinh không hợp lệ.', 'EMPLOYEE_COST_DERIVED_BASE_INVALID');

  const derivedBases = new Map();
  for (const [rawTarget, rawBase] of entries) {
    const target = String(rawTarget || '').trim().toLowerCase();
    const base = String(rawBase || '').trim().toLowerCase();
    if (!isCostColumn(target) || !isCostColumn(base) || target === base || derivedBases.has(target)) {
      throw invalidConfig('Cấu hình cột phái sinh không hợp lệ.', 'EMPLOYEE_COST_DERIVED_BASE_INVALID');
    }
    derivedBases.set(target, base);
  }

  // Reject cycles globally, including mappings not selected by the current
  // employee group. A malformed override must never fall back to revenue.
  for (const target of derivedBases.keys()) {
    const seen = new Set([target]);
    let cursor = derivedBases.get(target);
    while (cursor && derivedBases.has(cursor)) {
      if (seen.has(cursor)) {
        throw invalidConfig('Cấu hình cột phái sinh tạo vòng lặp.', 'EMPLOYEE_COST_DERIVED_BASE_CYCLE');
      }
      seen.add(cursor);
      cursor = derivedBases.get(cursor);
    }
  }
  return derivedBases;
}

function configuredDerivedBases(config = {}, value = process.env.EMPLOYEE_COST_DERIVED_BASE) {
  return normalizeDerivedBases(value == null ? (config.derivedBases ?? DEFAULT_DERIVED_BASES) : value);
}

function normalizedConfig(config = loadConfig(), derivedBaseValue = process.env.EMPLOYEE_COST_DERIVED_BASE) {
  const groups = new Map();
  const employeeGroups = new Map();
  for (const raw of Array.isArray(config.calculationGroups) ? config.calculationGroups : []) {
    const key = String(raw?.key || '').trim().toLowerCase();
    const templateKey = String(raw?.templateKey || key).trim().toLowerCase();
    const rawCostColumns = Array.isArray(raw?.costColumns) ? raw.costColumns : [];
    const costColumns = rawCostColumns.map((column) => String(column || '').trim().toLowerCase());
    if (!key || !templateKey || !costColumns.length || costColumns.some((column) => !isCostColumn(column))
      || new Set(costColumns).size !== costColumns.length || groups.has(key)) {
      throw invalidConfig('Cấu hình nhóm tính chi phí không hợp lệ.');
    }
    const group = { key, templateKey, costColumns };
    groups.set(key, group);
    for (const value of Array.isArray(raw?.employees) ? raw.employees : []) {
      const employee = normEmp(value);
      if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(employee)) throw invalidConfig(`Mã nhân viên ${employee || '(trống)'} không hợp lệ.`);
      if (employeeGroups.has(employee)) {
        throw invalidConfig(`Nhân viên ${employee} bị khai báo trùng nhóm tính chi phí.`, 'EMPLOYEE_COST_TEMPLATE_EMPLOYEE_CONFLICT');
      }
      employeeGroups.set(employee, key);
    }
  }

  const templates = new Map();
  for (const raw of Array.isArray(config.displayTemplates) ? config.displayTemplates : []) {
    const key = String(raw?.key || '').trim().toLowerCase();
    const columns = (Array.isArray(raw?.columns) ? raw.columns : []).map((column) => String(column || '').trim());
    const costLabels = {};
    for (const [rawKey, rawLabel] of Object.entries(raw?.costLabels || {})) {
      const costKey = String(rawKey || '').trim().toLowerCase();
      if (!isCostColumn(costKey)) throw invalidConfig(`Nhãn cột ${costKey || '(trống)'} không hợp lệ.`);
      costLabels[costKey] = String(rawLabel || costKey).trim().slice(0, 160) || costKey;
    }
    if (!key || templates.has(key) || !columns.length
      || columns.some((column) => !LAYOUT_FIELDS.has(column) && !isCostColumn(column))
      || new Set(columns).size !== columns.length) {
      throw invalidConfig('Cấu hình mẫu hiển thị chi phí không hợp lệ.');
    }
    templates.set(key, {
      key,
      label: String(raw?.label || key).trim().slice(0, 80) || key,
      columns,
      costLabels,
    });
  }

  const defaultGroup = String(config.defaultCalculationGroup || '').trim().toLowerCase();
  if (!defaultGroup || !groups.has(defaultGroup)) {
    throw invalidConfig('Thiếu nhóm tính chi phí mặc định.', 'EMPLOYEE_COST_TEMPLATE_DEFAULT_MISSING');
  }
  for (const group of groups.values()) {
    const template = templates.get(group.templateKey);
    const displayedCosts = template?.columns.filter(isCostColumn) || [];
    if (!template || displayedCosts.length !== group.costColumns.length
      || displayedCosts.some((column, index) => column !== group.costColumns[index])) {
      throw invalidConfig(`Nhóm ${group.key} không khớp mẫu hiển thị ${group.templateKey}.`, 'EMPLOYEE_COST_TEMPLATE_LAYOUT_MISMATCH');
    }
  }
  const derivedBases = configuredDerivedBases(config, derivedBaseValue);
  const configuredCostColumns = new Set([...groups.values()].flatMap((group) => group.costColumns));
  for (const [target, base] of derivedBases) {
    if (!configuredCostColumns.has(target)) {
      throw invalidConfig(`Cột phái sinh ${target} không thuộc nhóm tính chi phí.`, 'EMPLOYEE_COST_DERIVED_BASE_UNUSED');
    }
    for (const group of groups.values()) {
      const targetIndex = group.costColumns.indexOf(target);
      if (targetIndex < 0) continue;
      const baseIndex = group.costColumns.indexOf(base);
      if (baseIndex < 0 || baseIndex >= targetIndex) {
        throw invalidConfig(`Cột gốc ${base} phải đứng trước cột phái sinh ${target}.`, 'EMPLOYEE_COST_DERIVED_BASE_ORDER');
      }
    }
  }
  return { defaultGroup, groups, employeeGroups, templates, derivedBases };
}

function resolveTemplate(empCode, config = loadConfig(), derivedBaseValue = process.env.EMPLOYEE_COST_DERIVED_BASE) {
  const normalized = normalizedConfig(config, derivedBaseValue);
  const calculationGroup = normalized.employeeGroups.get(normEmp(empCode)) || normalized.defaultGroup;
  const group = normalized.groups.get(calculationGroup);
  const template = normalized.templates.get(group.templateKey);
  return {
    key: template.key,
    label: template.label,
    calculationGroup: group.key,
    costColumns: [...group.costColumns],
    columns: [...template.columns],
    costLabels: { ...template.costLabels },
    derivedBases: Object.fromEntries([...normalized.derivedBases].filter(([target]) => group.costColumns.includes(target))),
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_DERIVED_BASES,
  LAYOUT_FIELDS,
  isCostColumn,
  loadConfig,
  normalizeDerivedBases,
  configuredDerivedBases,
  normalizedConfig,
  resolveTemplate,
};
