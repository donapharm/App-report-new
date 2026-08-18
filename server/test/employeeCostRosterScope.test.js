const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const accessPolicy = require('../src/accessPolicy');

test('roster Employee Cost loại mọi mã bị chặn đăng nhập nhưng không xóa danh bạ', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
  const start = source.indexOf('function employeeCostRosterRows()');
  const end = source.indexOf('\n}\n', start) + 2;
  const block = source.slice(start, end);
  assert.match(block, /accessPolicy\.isLoginBlocked\(employee\.emp_code\)/);
  assert.equal(accessPolicy.isLoginBlocked('DN021'), true);
  assert.equal(accessPolicy.isLoginBlocked('DN023'), true);
  for (const code of ['DN016', 'DN018', 'DN024', 'VP004']) assert.equal(accessPolicy.isLoginBlocked(code), false, code);
});
