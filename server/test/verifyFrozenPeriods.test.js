'use strict';
/**
 * CANH KỲ ĐÃ KHOÁ SỔ — dựng sau khi bot DataHub báo outbox còn **2.600 event chờ
 * replay** (04/08/2026). Replay là ghi lại lịch sử; chạm nhầm kỳ đã khoá sổ thì
 * T06/T07 đổi số mà không ai biết.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectPins, comparePins } = require('../scripts/verify_frozen_periods');

test('‼ đọc đúng số ghim T06/T07 từ revenueMaterializeGuard, không chép tay', () => {
  const { pins, conflicts } = collectPins();
  assert.deepEqual(conflicts, [], 'bản ghim tự mâu thuẫn thì phải lộ ra');
  const june = pins.find((pin) => pin.ky === '06.2026');
  const july = pins.find((pin) => pin.ky === '07.2026');
  assert.equal(june.totalRevenue, 28_403_136_096);
  assert.equal(june.totalRows, 2_001);
  assert.equal(july.totalRevenue, 30_917_892_673);
  assert.equal(july.totalRows, 2_016);
});

test('‼ lệch MỘT ĐỒNG cũng phải báo, không làm tròn cho qua', () => {
  const pins = [{ ky: '07.2026', totalRevenue: 30_917_892_673, totalRows: 2_016 }];
  const drifted = comparePins(pins, { '07.2026': { totalRevenue: 30_917_892_672, totalRows: 2_016 } });
  assert.equal(drifted[0].status, 'drifted');
  assert.equal(drifted[0].revenueDiff, -1);
});

test('‼ mất/thêm một DÒNG cũng phải báo, kể cả khi tổng tiền không đổi', () => {
  const pins = [{ ky: '07.2026', totalRevenue: 30_917_892_673, totalRows: 2_016 }];
  const drifted = comparePins(pins, { '07.2026': { totalRevenue: 30_917_892_673, totalRows: 2_015 } });
  assert.equal(drifted[0].status, 'drifted');
  assert.equal(drifted[0].rowDiff, -1);
});

test('khớp đúng thì mới được báo ok', () => {
  const pins = [{ ky: '06.2026', totalRevenue: 28_403_136_096, totalRows: 2_001 }];
  const ok = comparePins(pins, { '06.2026': { totalRevenue: 28_403_136_096, totalRows: 2_001 } });
  assert.equal(ok[0].status, 'ok');
  assert.equal(ok[0].revenueDiff, 0);
});

test('‼ KHÔNG đọc được số sống ≠ khớp — phải là "chưa biết"', () => {
  const pins = [{ ky: '07.2026', totalRevenue: 30_917_892_673, totalRows: 2_016 }];
  for (const actual of [{}, { '07.2026': null }, { '07.2026': { totalRevenue: null } }]) {
    const result = comparePins(pins, actual);
    assert.equal(result[0].status, 'unknown', 'im lặng cho qua là kiểu mất số lặng lẽ');
    assert.equal(result[0].revenueDiff, null);
  }
});

test('cùng một kỳ khai hai nơi lệch số ⇒ báo mâu thuẫn ngay', () => {
  const { conflicts } = collectPins({
    A: { id: 'A', frozenPeriods: { '07.2026': { totalRevenue: 1, totalRows: 1 } } },
    B: { id: 'B', frozenPeriods: { '07.2026': { totalRevenue: 2, totalRows: 1 } } },
  });
  assert.deepEqual(conflicts, [{ ky: '07.2026', a: 'A', b: 'B' }]);
});
