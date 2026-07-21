const test = require('node:test');
const assert = require('node:assert/strict');
const rosterService = require('../src/employeeCostRoster');

const SALES_ROSTER = [
  'DN001', 'DN002', 'DN003', 'DN004', 'DN005', 'DN006', 'DN007', 'DN008', 'DN009', 'DN010', 'DN011', 'DN012',
  'DN016', 'DN017', 'DN018', 'DN019', 'DN021', 'DN022', 'DN023', 'DN024', 'VP004',
];

test('approved Sale roster has exactly 21 individual employees split 15 + 3 + 3', () => {
  const users = SALES_ROSTER.map((emp_code) => ({ emp_code, name: `NV ${emp_code}` }));
  const rows = rosterService.buildRoster(users);
  assert.equal(rows.length, 21);
  assert.equal(rows.some((row) => row.emp_code === 'ALL' || row.emp_code === '__ALL__'), false);

  const byGroup = Object.groupBy(rows, (row) => row.group_key);
  assert.equal(byGroup.sale.length, 15);
  assert.deepEqual(byGroup.ctv.map((row) => row.emp_code), ['DN002', 'DN004', 'DN022']);
  assert.deepEqual(byGroup.ctv_special.map((row) => row.emp_code), ['DN021', 'DN023', 'VP004']);
  assert.equal(byGroup.ctv.every((row) => row.group_label === 'CTV'), true);
  assert.equal(byGroup.ctv_special.every((row) => row.group_label === 'CTV đặc biệt'), true);
});

test('group config rejects one employee assigned to multiple groups', () => {
  assert.throws(() => rosterService.buildRoster([{ emp_code: 'DN002', name: 'NV' }], {
    defaultGroup: { key: 'sale', label: 'NV chính thức' },
    groups: [
      { key: 'ctv', label: 'CTV', employees: ['DN002'] },
      { key: 'ctv_special', label: 'CTV đặc biệt', employees: ['DN002'] },
    ],
  }), { code: 'EMPLOYEE_COST_GROUP_CONFLICT' });
});
