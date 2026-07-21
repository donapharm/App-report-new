'use strict';

const defaultPersist = require('./persist');

const STORE_FILE = 'employee_cost_visibility';
const AUDIT_LIMIT = 1000;
const VALUES = new Set(['on', 'off']);
const OVERRIDE_VALUES = new Set(['on', 'off', 'inherit']);
const DISABLED_NOTE = 'Chức năng chi phí đang tắt cho bạn.';

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOverrides(value, normalizeKey = (key) => String(key || '').trim()) {
  const result = {};
  if (!plainObject(value)) return result;
  for (const [rawKey, rawSetting] of Object.entries(value)) {
    const key = normalizeKey(rawKey);
    if (key && VALUES.has(rawSetting)) result[key] = rawSetting;
  }
  return result;
}

function normalizeRecord(raw) {
  const source = plainObject(raw) ? raw : {};
  return {
    version: 1,
    department: VALUES.has(source.department) ? source.department : 'off',
    groups: normalizeOverrides(source.groups),
    employees: normalizeOverrides(source.employees, normEmp),
    audit: Array.isArray(source.audit) ? source.audit.slice(-AUDIT_LIMIT) : [],
  };
}

function publicConfig(record) {
  return {
    department: record.department,
    groups: { ...record.groups },
    employees: { ...record.employees },
  };
}

function uniqueGroups(roster = []) {
  const groups = new Map();
  for (const employee of Array.isArray(roster) ? roster : []) {
    const key = String(employee?.group_key || '').trim();
    if (!key) continue;
    const current = groups.get(key) || {
      key,
      label: String(employee?.group_label || key).trim() || key,
      employeeCount: 0,
    };
    current.employeeCount += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

function employeeDecision(empCode, roster = [], config = {}) {
  const code = normEmp(empCode);
  const record = normalizeRecord(config);
  const employee = (Array.isArray(roster) ? roster : []).find((item) => normEmp(item?.emp_code) === code);
  // Chỉ roster Sale đã duyệt mới được hưởng công tắc. Mã lạ/stale phải fail
  // closed kể cả khi toàn phòng đang bật hoặc file cũ còn override cá nhân.
  if (!employee) return { enabled: false, effective: 'off', source: 'not_roster' };
  if (code && Object.prototype.hasOwnProperty.call(record.employees, code)) {
    return { enabled: record.employees[code] === 'on', effective: record.employees[code], source: 'employee' };
  }
  const groupKey = String(employee?.group_key || '').trim();
  if (groupKey && Object.prototype.hasOwnProperty.call(record.groups, groupKey)) {
    return { enabled: record.groups[groupKey] === 'on', effective: record.groups[groupKey], source: 'group', groupKey };
  }
  return { enabled: record.department === 'on', effective: record.department, source: 'department' };
}

function disabledPayload() {
  return { disabled: true, note: DISABLED_NOTE, columns: [], rows: [] };
}

function invalid(message, code = 'EMPLOYEE_COST_VISIBILITY_INVALID') {
  return Object.assign(new Error(message), { status: 400, code });
}

function validatePatch(patch, roster = []) {
  if (!plainObject(patch)) throw invalid('Cấu hình hiển thị không hợp lệ.');
  const allowedTopLevel = new Set(['department', 'groups', 'employees']);
  const unknownTopLevel = Object.keys(patch).find((key) => !allowedTopLevel.has(key));
  if (unknownTopLevel) throw invalid(`Trường cấu hình không hợp lệ: ${unknownTopLevel}`);

  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'department')) {
    if (!VALUES.has(patch.department)) throw invalid('Toàn phòng chỉ nhận on hoặc off.');
    normalized.department = patch.department;
  }

  const groups = uniqueGroups(roster);
  const allowedGroups = new Set(groups.map((group) => group.key));
  if (Object.prototype.hasOwnProperty.call(patch, 'groups')) {
    if (!plainObject(patch.groups)) throw invalid('Cấu hình nhóm không hợp lệ.');
    normalized.groups = {};
    for (const [key, setting] of Object.entries(patch.groups)) {
      if (!allowedGroups.has(key)) throw invalid(`Nhóm không thuộc roster: ${key}`, 'EMPLOYEE_COST_VISIBILITY_UNKNOWN_GROUP');
      if (!OVERRIDE_VALUES.has(setting)) throw invalid(`Giá trị nhóm ${key} phải là on, off hoặc inherit.`);
      normalized.groups[key] = setting;
    }
  }

  const allowedEmployees = new Set((Array.isArray(roster) ? roster : []).map((employee) => normEmp(employee?.emp_code)).filter(Boolean));
  if (Object.prototype.hasOwnProperty.call(patch, 'employees')) {
    if (!plainObject(patch.employees)) throw invalid('Cấu hình nhân viên không hợp lệ.');
    normalized.employees = {};
    const seen = new Set();
    for (const [rawCode, setting] of Object.entries(patch.employees)) {
      const code = normEmp(rawCode);
      if (!code || !allowedEmployees.has(code)) throw invalid(`Nhân viên không thuộc roster: ${rawCode}`, 'EMPLOYEE_COST_VISIBILITY_UNKNOWN_EMPLOYEE');
      if (seen.has(code)) throw invalid(`Mã nhân viên bị lặp: ${code}`);
      if (!OVERRIDE_VALUES.has(setting)) throw invalid(`Giá trị nhân viên ${code} phải là on, off hoặc inherit.`);
      seen.add(code);
      normalized.employees[code] = setting;
    }
  }
  return normalized;
}

function applyPatch(config, patch) {
  const next = normalizeRecord(config);
  if (patch.department) next.department = patch.department;
  for (const layer of ['groups', 'employees']) {
    for (const [key, setting] of Object.entries(patch[layer] || {})) {
      if (setting === 'inherit') delete next[layer][key];
      else next[layer][key] = setting;
    }
  }
  return next;
}

function diffConfigs(before, after) {
  const changes = [];
  if (before.department !== after.department) changes.push({ path: 'department', before: before.department, after: after.department });
  for (const layer of ['groups', 'employees']) {
    const keys = new Set([...Object.keys(before[layer] || {}), ...Object.keys(after[layer] || {})]);
    for (const key of [...keys].sort()) {
      const oldValue = before[layer]?.[key] || 'inherit';
      const newValue = after[layer]?.[key] || 'inherit';
      if (oldValue !== newValue) changes.push({ path: `${layer}.${key}`, before: oldValue, after: newValue });
    }
  }
  return changes;
}

function panelData(roster = [], config = {}) {
  const record = normalizeRecord(config);
  const groups = uniqueGroups(roster).map((group) => {
    const setting = record.groups[group.key] || 'inherit';
    const effective = setting === 'inherit' ? record.department : setting;
    return { ...group, setting, effective, source: setting === 'inherit' ? 'department' : 'group' };
  });
  const employees = (Array.isArray(roster) ? roster : []).map((employee) => {
    const empCode = normEmp(employee?.emp_code);
    const setting = record.employees[empCode] || 'inherit';
    const decision = employeeDecision(empCode, roster, record);
    return {
      emp_code: empCode,
      name: String(employee?.name || empCode),
      group_key: String(employee?.group_key || ''),
      group_label: String(employee?.group_label || employee?.group_key || ''),
      setting,
      effective: decision.effective,
      source: decision.source,
    };
  }).sort((a, b) => a.emp_code.localeCompare(b.emp_code, 'vi'));
  return {
    department: { setting: record.department, effective: record.department, source: 'department' },
    groups,
    employees,
  };
}

function createService({ persistence = defaultPersist, now = () => new Date(), logger = console } = {}) {
  const load = () => normalizeRecord(persistence.load(STORE_FILE, null));
  const appendAudit = (record, entry) => {
    const next = normalizeRecord(record);
    next.audit = [...next.audit, { at: now().toISOString(), ...entry }].slice(-AUDIT_LIMIT);
    persistence.save(STORE_FILE, next);
    return next;
  };

  return {
    load,
    decision(empCode, roster) {
      return employeeDecision(empCode, roster, load());
    },
    panel(roster) {
      return panelData(roster, load());
    },
    async run({ admin = false, actor, role, empCode, roster } = {}, loadPayload) {
      if (typeof loadPayload !== 'function') throw new TypeError('loadPayload phải là hàm.');
      const record = load();
      const accessDecision = employeeDecision(empCode, roster, record);
      if (!admin && !accessDecision.enabled) {
        // Ghi nhận quyết định chặn nhưng audit không được phép làm hỏng ranh giới
        // fail-closed hoặc chứa token/header/body/số liệu chi phí.
        try {
          appendAudit(record, {
            event: 'access_denied',
            actor: normEmp(actor || empCode) || 'UNKNOWN',
            role: String(role || '').trim().toLowerCase() || null,
            empCode: normEmp(empCode) || null,
            outcome: 'disabled',
            source: accessDecision.source,
            effective: accessDecision.effective,
          });
        } catch (error) {
          logger.warn('[employee-cost-visibility] audit write failed', { event: 'access_denied', empCode: normEmp(empCode), message: error.message });
        }
        return disabledPayload();
      }
      return loadPayload();
    },
    save(patch, { actor, roster } = {}) {
      const validated = validatePatch(patch, roster);
      const beforeRecord = load();
      const afterRecord = applyPatch(beforeRecord, validated);
      const before = publicConfig(beforeRecord);
      const after = publicConfig(afterRecord);
      const changes = diffConfigs(before, after);
      if (changes.length) {
        appendAudit(afterRecord, {
          event: 'visibility_change',
          actor: normEmp(actor) || 'UNKNOWN',
          before,
          after,
          changes,
        });
      }
      return { ...panelData(roster, afterRecord), changed: changes.length > 0 };
    },
  };
}

const service = createService();

module.exports = {
  STORE_FILE,
  AUDIT_LIMIT,
  DISABLED_NOTE,
  normalizeRecord,
  uniqueGroups,
  employeeDecision,
  disabledPayload,
  validatePatch,
  applyPatch,
  diffConfigs,
  panelData,
  createService,
  decision: service.decision,
  panel: service.panel,
  run: service.run,
  save: service.save,
};
