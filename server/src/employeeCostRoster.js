'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'employee_cost_groups.json');

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function loadConfig(filePath = process.env.EMPLOYEE_COST_GROUP_CONFIG || DEFAULT_CONFIG_PATH) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (error) {
    console.warn('[employee-cost] group config unavailable, dùng mặc định', {
      filePath,
      message: error.message,
    });
    return {};
  }
}

function buildRoster(users = [], config = loadConfig()) {
  const defaultGroup = {
    key: String(config?.defaultGroup?.key || 'sale'),
    label: String(config?.defaultGroup?.label || 'NV chính thức'),
  };
  const groupByEmployee = new Map();
  for (const rawGroup of Array.isArray(config?.groups) ? config.groups : []) {
    const group = { key: String(rawGroup?.key || '').trim(), label: String(rawGroup?.label || '').trim() };
    if (!group.key || !group.label) continue;
    for (const rawCode of Array.isArray(rawGroup?.employees) ? rawGroup.employees : []) {
      const empCode = normEmp(rawCode);
      if (!empCode) continue;
      if (groupByEmployee.has(empCode)) {
        const error = new Error(`Nhân viên ${empCode} bị khai báo trùng nhóm chi phí.`);
        error.code = 'EMPLOYEE_COST_GROUP_CONFLICT';
        throw error;
      }
      groupByEmployee.set(empCode, group);
    }
  }

  const seen = new Set();
  return (Array.isArray(users) ? users : [])
    .map((user) => {
      const empCode = normEmp(user?.emp_code);
      if (!empCode || seen.has(empCode)) return null;
      seen.add(empCode);
      const group = groupByEmployee.get(empCode) || defaultGroup;
      return {
        emp_code: empCode,
        name: String(user?.name || empCode),
        group_key: group.key,
        group_label: group.label,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.emp_code.localeCompare(b.emp_code, 'vi'));
}

module.exports = { DEFAULT_CONFIG_PATH, loadConfig, buildRoster };
