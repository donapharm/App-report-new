'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'employee_cost_templates.json');
const BLOCKED_COST_COLUMNS = new Set(['c32', 'c47']);
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

function normalizedConfig(config = loadConfig()) {
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
  return { defaultGroup, groups, employeeGroups, templates };
}

function resolveTemplate(empCode, config = loadConfig()) {
  const normalized = normalizedConfig(config);
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
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  LAYOUT_FIELDS,
  isCostColumn,
  loadConfig,
  normalizedConfig,
  resolveTemplate,
};
