'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../src/employeeIncentivePolicy');

test('DN022 chờ công thức thưởng/phạt riêng', () => {
  assert.equal(policy.requiresSeparateFormula('dn022'), true);
  for (const code of ['DN002', 'DN004', 'DN021', 'DN023', 'VP004', 'VP018']) {
    assert.equal(policy.requiresSeparateFormula(code), false, `${code} không được tự động nhập vào chính sách riêng DN022`);
  }
});

test('DN021 và DN023 chỉ tính target/doanh thu, không vào thưởng phạt', () => {
  assert.deepEqual([...policy.TARGET_ONLY_EMP_CODES].sort(), ['DN021', 'DN023']);
  for (const code of ['DN021', 'DN023']) {
    assert.equal(policy.isTargetOnlyEmployee(code.toLowerCase()), true);
    assert.equal(policy.requiresSeparateFormula(code), false);
    assert.equal(policy.isXuPenaltyEmployee(code), false);
  }
  for (const code of ['DN001', 'DN022', 'VP018']) assert.equal(policy.isTargetOnlyEmployee(code), false);
  assert.equal(policy.TARGET_ONLY_REASON, 'target_only_no_incentive');
});

test('phạt thiếu Xu chỉ áp dụng đúng DN002, DN004, DN022', () => {
  assert.deepEqual([...policy.XU_PENALTY_EMP_CODES].sort(), ['DN002', 'DN004', 'DN022']);
  for (const code of ['DN002', 'DN004', 'DN022']) assert.equal(policy.isXuPenaltyEmployee(code), true);
  for (const code of ['DN001', 'DN021', 'DN023', 'VP004', 'VP018']) assert.equal(policy.isXuPenaltyEmployee(code), false);
});

test('chặn tin thưởng/phạt tiền đúng 7 mã mà không dùng notify_optout chung', () => {
  const blocked = ['DN002', 'DN004', 'DN021', 'DN022', 'DN023', 'VP004', 'VP018'];
  assert.deepEqual([...policy.MONETARY_NOTIFY_BLOCKED_EMP_CODES].sort(), blocked);
  for (const code of blocked) assert.equal(policy.isMonetaryNotifyBlocked(code.toLowerCase()), true);
  for (const code of ['DN001', 'DN003', 'DN005']) assert.equal(policy.isMonetaryNotifyBlocked(code), false);
});
