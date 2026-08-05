'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isWorkingDay,
  isWorkingInstant,
  workingDaysInMonth,
  workingDaysElapsed,
  workingDaysRemaining,
  calendarStatus,
} = require('../src/vnWorkingDays');

test('khóa lịch CEO: T08=21, T09=20, T02=15 ngày làm việc', () => {
  assert.equal(workingDaysInMonth('2026-08'), 21);
  assert.equal(workingDaysInMonth('2026-09'), 20);
  assert.equal(workingDaysInMonth('2026-02'), 15);
});

test('27/04/2026 là nghỉ bù Giỗ Tổ dù rơi vào thứ Hai', () => {
  assert.equal(isWorkingDay('2026-04-27'), false);
  assert.equal(isWorkingDay('2026-04-28'), true);
});

test('ranh giới GMT+7: 00:30 ngày 01/09 vẫn là ngày lễ 01/09', () => {
  assert.equal(isWorkingInstant(new Date('2026-08-31T17:30:00.000Z')), false);
});

test('năm chưa nạp lịch vẫn trừ T7/CN, giữ lễ cố định và trả calendarMissing', () => {
  assert.deepEqual(calendarStatus(2027), { year: 2027, calendarMissing: true });
  // T01/2027 có 21 ngày T2–T6; holidayFor() hiện hữu vẫn loại Tết Dương lịch 01/01.
  assert.equal(workingDaysInMonth('2027-01'), 20);
});

test('đã qua tính tới hết hôm qua; còn lại tính từ hôm nay và tự bỏ ngày nghỉ', () => {
  // 05/08/2026 là thứ Tư: đã qua 2 ngày làm việc (03–04), còn 19 gồm ngày 05.
  assert.equal(workingDaysElapsed('2026-08', '2026-08-05'), 2);
  assert.equal(workingDaysRemaining('2026-08', '2026-08-05'), 19);
  // 08/08 là T7 nên khoảng còn lại bắt đầu từ ngày nghỉ, không tính chính ngày đó.
  assert.equal(workingDaysRemaining('2026-08', '2026-08-08'), 16);
});

test('dailySales giữ quy ước riêng: T7 không bị module mới sửa thành ngày nghỉ', () => {
  const dailySales = require('../src/dailySales');
  const saturday = dailySales.buildDailySales({ rows: [], now: new Date('2026-08-01T03:00:00.000Z'), sourceUpdatedAt: '2026-08-01T02:30:00.000Z' });
  assert.equal(saturday.isDayOff, false);
  assert.equal(isWorkingDay('2026-08-01'), false);
});
