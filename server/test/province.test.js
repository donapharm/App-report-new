'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { provinceOf, provinceResolution } = require('../src/province');

test('province resolution exposes authoritative row/config provenance separately from name inference', () => {
  assert.deepEqual(provinceResolution('UNKNOWN', 'Tên bất kỳ', 'CÀ MAU'), { value: 'CÀ MAU', source: 'source' });
  assert.deepEqual(provinceResolution('BV001', 'Tên không có tỉnh', ''), { value: 'Đồng Nai', source: 'config' });
  assert.deepEqual(provinceResolution('UNKNOWN', 'BVĐK Long Khánh', ''), { value: 'Đồng Nai', source: 'inferred' });
  assert.equal(provinceOf('UNKNOWN', 'BVĐK Long Khánh', ''), 'Đồng Nai');
});
