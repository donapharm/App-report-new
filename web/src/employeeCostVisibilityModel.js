const SETTINGS = new Set(['on', 'off', 'inherit']);
const BINARY = new Set(['on', 'off']);

const cleanSetting = (value, fallback = 'inherit') => SETTINGS.has(value) ? value : fallback;

function recalculate(panel) {
  const department = panel.department.setting;
  const groups = panel.groups.map((group) => ({
    ...group,
    effective: group.setting === 'inherit' ? department : group.setting,
    source: group.setting === 'inherit' ? 'department' : 'group',
  }));
  const groupsByKey = new Map(groups.map((group) => [group.key, group]));
  const employees = panel.employees.map((employee) => {
    if (employee.setting !== 'inherit') return { ...employee, effective: employee.setting, source: 'employee' };
    const group = groupsByKey.get(employee.group_key);
    return group
      ? { ...employee, effective: group.effective, source: group.source }
      : { ...employee, effective: department, source: 'department' };
  });
  return { ...panel, groups, employees };
}

export function normalizeVisibilityPanel(payload = {}) {
  const departmentSetting = BINARY.has(payload?.department?.setting) ? payload.department.setting : 'off';
  return recalculate({
    department: {
      setting: departmentSetting,
      effective: BINARY.has(payload?.department?.effective) ? payload.department.effective : departmentSetting,
      source: 'department',
    },
    groups: (Array.isArray(payload?.groups) ? payload.groups : []).map((group) => ({
      key: String(group?.key || ''),
      label: String(group?.label || group?.key || ''),
      employeeCount: Number(group?.employeeCount || 0),
      setting: cleanSetting(group?.setting),
      effective: BINARY.has(group?.effective) ? group.effective : departmentSetting,
      source: group?.source === 'group' ? 'group' : 'department',
    })).filter((group) => group.key),
    employees: (Array.isArray(payload?.employees) ? payload.employees : []).map((employee) => ({
      emp_code: String(employee?.emp_code || '').toUpperCase(),
      name: String(employee?.name || employee?.emp_code || ''),
      group_key: String(employee?.group_key || ''),
      group_label: String(employee?.group_label || employee?.group_key || ''),
      setting: cleanSetting(employee?.setting),
      effective: BINARY.has(employee?.effective) ? employee.effective : 'off',
      source: ['employee', 'group', 'department'].includes(employee?.source) ? employee.source : 'department',
    })).filter((employee) => employee.emp_code),
  });
}

export function updateVisibilitySetting(panel, layer, key, setting) {
  const normalized = normalizeVisibilityPanel(panel);
  if (layer === 'department') {
    if (!BINARY.has(setting)) return normalized;
    return recalculate({ ...normalized, department: { ...normalized.department, setting } });
  }
  if (!['groups', 'employees'].includes(layer) || !SETTINGS.has(setting)) return normalized;
  const id = layer === 'groups' ? 'key' : 'emp_code';
  return recalculate({
    ...normalized,
    [layer]: normalized[layer].map((item) => item[id] === key ? { ...item, setting } : item),
  });
}

export function visibilitySavePayload(panel) {
  const normalized = normalizeVisibilityPanel(panel);
  return {
    department: normalized.department.setting,
    groups: Object.fromEntries(normalized.groups.map((group) => [group.key, group.setting])),
    employees: Object.fromEntries(normalized.employees.map((employee) => [employee.emp_code, employee.setting])),
  };
}

export function visibilitySourceLabel(item = {}) {
  if (item.source === 'employee') return 'Cá nhân';
  if (item.source === 'group') return `Nhóm ${item.group_label || item.group_key || ''}`.trim();
  return 'Toàn phòng';
}

export function visibilityEffectiveLabel(value) {
  return value === 'on' ? 'Đang bật' : 'Đang tắt';
}
