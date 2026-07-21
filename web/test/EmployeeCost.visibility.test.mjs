import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeVisibilityPanel, updateVisibilitySetting, visibilityEffectiveLabel, visibilitySavePayload, visibilitySourceLabel,
} from '../src/employeeCostVisibilityModel.js';

const source = {
  department: { setting: 'on', effective: 'on', source: 'department' },
  groups: [
    { key: 'sale', label: 'NV chính thức', employeeCount: 15, setting: 'inherit', effective: 'on', source: 'department' },
    { key: 'ctv', label: 'CTV', employeeCount: 3, setting: 'off', effective: 'off', source: 'group' },
  ],
  employees: [
    { emp_code: 'DN001', name: 'NV 1', group_key: 'sale', group_label: 'NV chính thức', setting: 'inherit', effective: 'on', source: 'department' },
    { emp_code: 'DN002', name: 'NV 2', group_key: 'ctv', group_label: 'CTV', setting: 'on', effective: 'on', source: 'employee' },
  ],
};

test('admin panel model keeps backend roster, effective value and source metadata', () => {
  const panel = normalizeVisibilityPanel(source);
  assert.equal(panel.department.setting, 'on');
  assert.deepEqual(panel.groups.map((group) => group.key), ['sale', 'ctv']);
  assert.equal(panel.employees[1].source, 'employee');
  assert.equal(visibilitySourceLabel(panel.employees[0]), 'Toàn phòng');
  assert.equal(visibilitySourceLabel(panel.employees[1]), 'Cá nhân');
  assert.equal(visibilityEffectiveLabel(panel.groups[1].effective), 'Đang tắt');
});

test('save payload sends only backend settings, including inherit removal requests', () => {
  let panel = normalizeVisibilityPanel(source);
  panel = updateVisibilitySetting(panel, 'department', '', 'off');
  assert.equal(panel.employees[0].effective, 'off');
  panel = updateVisibilitySetting(panel, 'groups', 'ctv', 'inherit');
  assert.equal(panel.employees[1].effective, 'on'); // override cá nhân vẫn thắng
  panel = updateVisibilitySetting(panel, 'employees', 'DN001', 'off');
  assert.deepEqual(visibilitySavePayload(panel), {
    department: 'off',
    groups: { sale: 'inherit', ctv: 'inherit' },
    employees: { DN001: 'off', DN002: 'on' },
  });
});

test('App hides employee cost tab only from backend /me disabled flag and admin bypasses', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /employeeCostControlled: true/);
  assert.match(app, /!t\.employeeCostControlled \|\| me\.isAdmin \|\| !me\.employeeCostDisabled/);
  assert.match(app, /me\.employeeCostDisabled[\s\S]*?tab !== 'employeeCost'/);
  assert.doesNotMatch(app, /group_key\s*===\s*['"]ctv/);
});

test('EmployeeCost panel loads roster/groups from visibility API without frontend employee constants', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /api\.employeeCostVisibility\(\)/);
  assert.match(page, /panel\.groups\.map/);
  assert.match(page, /panel\.employees\.map/);
  assert.match(page, /api\.employeeCostVisibilitySave\(visibilitySavePayload/);
  assert.doesNotMatch(page, /DN00[1-9]|DN0[12][0-9]|VP004/);
});
