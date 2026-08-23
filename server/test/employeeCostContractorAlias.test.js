'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const employeeCost = require('../src/employeeCost');

/* App Sale 23/08 20:0x: scope `AFP` và `DONA` trả 404 vì danh mục nhà thầu dùng mã
 * có số (`02.AFP`, `01.DONA`). analytics.js đã ghi từ trước rằng đây là CÙNG hai nhà
 * thầu, nhưng tầng dựng scope đối soát bê nguyên chuỗi thô đi hỏi. */

test('bí danh đã biết được ánh xạ sang đúng mã trong danh mục nhà thầu', () => {
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: 'DONA' }), '01.DONA');
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: 'AFP' }), '02.AFP');
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: 'dona' }), '01.DONA');
});

test('mã đã đúng dạng danh mục thì giữ nguyên, không ánh xạ vòng hai', () => {
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: '01.DONA' }), '01.DONA');
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: '02.AFP' }), '02.AFP');
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: '20.HĐS' }), '20.HĐS');
});

test('mã lạ KHÔNG bị đoán bằng cách thêm/cắt tiền tố số — để 404 lộ ra', () => {
  // Đây là đường đi của tiền: không biết thì phải kêu, không được đoán cho trôi việc.
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: 'TUE.N' }), 'TUE.N');
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: '03.TUE.N' }), '03.TUE.N');
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: 'BIN.B' }), 'BIN.B');
});

test('mã rỗng vẫn rỗng — không tự sinh nhà thầu', () => {
  assert.equal(employeeCost.contractorCodeOf({}), '');
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: '' }), '');
  assert.equal(employeeCost.contractorCodeOf({ contractor_code: '..' }), '');
});

test('bảng ánh xạ đọc được từ cấu hình và bỏ qua cặp hỏng', () => {
  const map = employeeCost.parseContractorAliases('DONA=01.DONA|AFP=02.AFP');
  assert.equal(map.get('DONA'), '01.DONA');
  assert.equal(map.get('AFP'), '02.AFP');
  assert.equal(map.size, 2);
  const messy = employeeCost.parseContractorAliases('X=|=Y|..=01.A|SAME=SAME|OK=01.OK');
  assert.equal(messy.size, 1);
  assert.equal(messy.get('OK'), '01.OK');
  assert.equal(employeeCost.parseContractorAliases(undefined).get('DONA'), '01.DONA');
});
