'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dq = require('../src/employeeCostDataQuality');

test('ĐVT "Gói/ống" ≡ "ống" — cùng nghĩa, KHÔNG báo sai lệch (ca CEO nêu)', () => {
  assert.equal(dq.uomEquivalent('Gói/ống', 'ống'), true);
  assert.equal(dq.uomEquivalent('Ống', 'Gói/ống'), true);
  assert.equal(dq.uomEquivalent('gói', 'ống'), true);      // gói = ống theo bảng khai báo
  assert.equal(dq.uomEquivalent('GÓI', 'Ống'), true);      // không phân biệt hoa/thường/dấu
});

test('FAIL-CLOSED: ĐVT khác nghĩa vẫn báo như cũ, không tự suy diễn', () => {
  assert.equal(dq.uomEquivalent('Viên', 'Hộp'), false);
  assert.equal(dq.uomEquivalent('Chai', 'ống'), false);
  assert.equal(dq.uomEquivalent('Lọ', 'Gói'), false);
  assert.equal(dq.uomEquivalent('', 'ống'), false);        // thiếu dữ liệu → không kết luận bằng nhau
  assert.equal(dq.uomEquivalent('ống', ''), false);
});

test('tách ĐVT ghép và chuẩn hoá dấu/hoa thường', () => {
  assert.deepEqual(dq.uomParts('Gói/ống'), ['goi', 'ong']);
  assert.deepEqual(dq.uomParts('Hộp - Vỉ'), ['hop', 'vi']);
  assert.equal(dq.uomKey('Ống'), 'ong');
  assert.equal(dq.uomKey('GÓI'), 'goi');
});
