const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const accessPolicy = require('../src/accessPolicy');
const store = require('../src/store');
const routes = require('../src/routes');

test('routes tách reporting roster 21 khỏi actionable roster 19', (t) => {
  const codes = [
    'DN001', 'DN002', 'DN003', 'DN004', 'DN005', 'DN006', 'DN007', 'DN008', 'DN009', 'DN010',
    'DN011', 'DN012', 'DN016', 'DN017', 'DN018', 'DN019', 'DN021', 'DN022', 'DN023', 'DN024', 'VP004',
  ];
  const original = store.targetRoster;
  store.targetRoster = () => codes.map((emp_code) => ({ emp_code, name: emp_code }));
  t.after(() => { store.targetRoster = original; });
  const reporting = routes.ceoAggregateRosterRows();
  const actionable = routes.actionableRosterRows();
  assert.equal(reporting.length, 21);
  assert.equal(actionable.length, 19);
  assert.deepEqual(reporting.filter((row) => ['DN021', 'DN023'].includes(row.emp_code)).map((row) => row.emp_code), ['DN021', 'DN023']);
  assert.equal(actionable.some((row) => ['DN021', 'DN023'].includes(row.emp_code)), false);
  assert.equal(accessPolicy.isLoginBlocked('DN021'), true);
  assert.equal(accessPolicy.isLoginBlocked('DN023'), true);
  for (const code of ['DN016', 'DN018', 'DN024', 'VP004']) assert.equal(accessPolicy.isLoginBlocked(code), false, code);
});

test('routes chặn trực tiếp nhận tin và ghi sổ thanh toán cho DN021/DN023', () => {
  for (const code of ['DN021', 'DN023']) {
    assert.equal(routes.resolveFlowRecipient('employee', code), null);
    assert.equal(routes.flowNotifyReach('employee', code).reachable, false);
    assert.throws(() => routes.paymentTarget({
      body: { emp_code: code, period: '2026-07' }, session: { emp_code: 'CEO' },
    }), { code: 'PAYMENT_EMP_NOT_IN_ROSTER' });
  }
});

test('login block và các cổng gửi ngoài khác vẫn độc lập với roster CEO', () => {
  const delivery = fs.readFileSync(path.join(__dirname, '../src/filteredEmployeeDelivery.js'), 'utf8');
  const sourceAlert = fs.readFileSync(path.join(__dirname, '../src/employeeCostSourceAlert.js'), 'utf8');
  for (const code of ['DN021', 'DN023']) {
    assert.equal(accessPolicy.isLoginBlocked(code), true, `${code} vẫn bị khóa đăng nhập`);
    assert.match(delivery, new RegExp(`EXCLUDED_EMP_CODES[^\\n]*${code}`), `${code} vẫn bị chặn gửi báo cáo`);
  }
  assert.match(sourceAlert, /accessPolicy\.isLoginBlocked/, 'cảnh báo nguồn vẫn lọc người bị khóa đăng nhập');
});
