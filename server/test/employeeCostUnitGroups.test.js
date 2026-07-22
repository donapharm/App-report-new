'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const unitGroups = require('../src/employeeCostUnitGroups');

test('extracts unit-type prefix after ordinal code and resolves configurable aliases', () => {
  assert.equal(unitGroups.extractPrefix('002.BVĐK Thống Nhất ĐN'), 'BVĐK');
  assert.equal(unitGroups.extractPrefix('033.PKĐK AN LONG KHÁNH'), 'PKĐK');
  assert.deepEqual(unitGroups.resolve('002.BVĐK Thống Nhất ĐN'), {
    key: 'BV', label: 'BV · Bệnh viện', prefix: 'BVĐK', configured: true,
  });
  assert.equal(unitGroups.resolve('028.NT-NHÀ THUỐC ANH ANH').key, 'NT');
});

test('unmapped source prefix fails open only to its own exact prefix group, never a guessed business group', () => {
  assert.deepEqual(unitGroups.resolve('777.KHOCHUYÊNDỤNG Miền Đông'), {
    key: 'KHOCHUYÊNDỤNG', label: 'KHOCHUYÊNDỤNG', prefix: 'KHOCHUYÊNDỤNG', configured: false,
  });
  assert.deepEqual(unitGroups.resolve(''), { key: '', label: '', prefix: '', configured: false });
});
