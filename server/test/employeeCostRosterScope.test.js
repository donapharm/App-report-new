const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const accessPolicy = require('../src/accessPolicy');

test('roster báo cáo CEO giữ đủ 21 người và không dùng denylist đăng nhập làm reporting scope', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
  const start = source.indexOf('function employeeCostRosterRows()');
  const end = source.indexOf('\n}\n', start) + 2;
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /accessPolicy\.isLoginBlocked/);
  assert.match(block, /employeeCostRoster\.buildRoster\(store\.targetRoster\(\{ scope: \{\} \}\)\)/);
  assert.equal(accessPolicy.isLoginBlocked('DN021'), true);
  assert.equal(accessPolicy.isLoginBlocked('DN023'), true);
  for (const code of ['DN016', 'DN018', 'DN024', 'VP004']) assert.equal(accessPolicy.isLoginBlocked(code), false, code);
});

test('login block và external-send block của DN021/DN023 độc lập với roster CEO', () => {
  const delivery = fs.readFileSync(path.join(__dirname, '../src/filteredEmployeeDelivery.js'), 'utf8');
  const sourceAlert = fs.readFileSync(path.join(__dirname, '../src/employeeCostSourceAlert.js'), 'utf8');
  for (const code of ['DN021', 'DN023']) {
    assert.equal(accessPolicy.isLoginBlocked(code), true, `${code} vẫn bị khóa đăng nhập`);
    assert.match(delivery, new RegExp(`EXCLUDED_EMP_CODES[^\\n]*${code}`), `${code} vẫn bị chặn gửi báo cáo`);
  }
  assert.match(sourceAlert, /accessPolicy\.isLoginBlocked/, 'cảnh báo nguồn vẫn lọc người bị khóa đăng nhập');
});
