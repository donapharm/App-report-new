'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reportContractorLabel } = require('../src/report/contractorIdentity');

test('report contractor label normalizes historical DONAPHARM aliases without rewriting inputs', () => {
  const historical = [
    'Công ty TNHH Dược phẩm Donapharm',
    'CÔNG TY TNHH DƯỢC PHẨM DONAPHARM',
    'Công ty Cổ phần Donapharm',
  ];

  for (const sourceValue of historical) {
    assert.equal(reportContractorLabel(sourceValue), 'DONAPHARM');
  }

  assert.equal(reportContractorLabel('CÔNG TY CỔ PHẦN DONAPHARM'), 'DONAPHARM');
  assert.equal(reportContractorLabel('CÔNG TY TNHH AFP PHARMA'), 'AFP PHARMA');
  assert.equal(reportContractorLabel('NHÀ THẦU ĐỐI TÁC A'), 'NHÀ THẦU ĐỐI TÁC A');
});
