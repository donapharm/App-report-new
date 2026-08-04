const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAiApplyTarget } = require('../src/targetAdmin');

test('AI apply accepts only non-negative safe integer numbers', () => {
  for (const value of [0, 1, 1_000_000_000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validateAiApplyTarget(value), value);
  }
});

test('AI apply rejects malformed direct API targets instead of coercing to zero', () => {
  for (const value of [null, undefined, '', '0', '1000000000', 'abc', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateAiApplyTarget(value), /Target AI không hợp lệ/);
  }
});
