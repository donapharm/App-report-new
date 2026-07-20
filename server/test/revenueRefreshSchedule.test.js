const test = require('node:test');
const assert = require('node:assert/strict');

const envKeys = [
  'REVENUE_REFRESH_ENABLED',
  'REVENUE_REFRESH_MINUTES',
  'REVENUE_REFRESH_WEEKDAY',
  'REVENUE_REFRESH_SAT',
  'REVENUE_REFRESH_SUN',
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  REVENUE_REFRESH_ENABLED: '1',
  REVENUE_REFRESH_MINUTES: '30',
  REVENUE_REFRESH_WEEKDAY: '08:00-17:30',
  REVENUE_REFRESH_SAT: '08:00-13:00',
  REVENUE_REFRESH_SUN: 'off',
});

const refresh = require('../src/revenueRefresh');

test.after(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const at = (iso) => new Date(iso);

test('thứ 2-thứ 6 chỉ chạy mỗi 30 phút từ 08:00 đến 17:30', () => {
  for (const time of ['08:00', '08:30', '12:00', '17:00', '17:30']) {
    assert.equal(refresh.isDue(at(`2026-07-20T${time}:00+07:00`)).due, true, time);
  }
  for (const time of ['07:59', '08:15', '17:31', '23:00']) {
    assert.equal(refresh.isDue(at(`2026-07-20T${time}:00+07:00`)).due, false, time);
  }
});

test('thứ 7 chỉ chạy mỗi 30 phút từ 08:00 đến 13:00', () => {
  for (const time of ['08:00', '08:30', '12:30', '13:00']) {
    assert.equal(refresh.isDue(at(`2026-07-25T${time}:00+07:00`)).due, true, time);
  }
  for (const time of ['07:59', '08:15', '13:01', '17:00']) {
    assert.equal(refresh.isDue(at(`2026-07-25T${time}:00+07:00`)).due, false, time);
  }
});

test('chủ nhật không chạy', () => {
  const result = refresh.isDue(at('2026-07-26T08:00:00+07:00'));
  assert.equal(result.due, false);
  assert.equal(result.reason, 'outside_window');
});

test('ngày lễ và nghỉ bù trong holidays.json không chạy dù đúng giờ', () => {
  for (const iso of [
    '2026-02-17T08:00:00+07:00',
    '2026-04-27T08:30:00+07:00',
    '2026-09-01T10:00:00+07:00',
    '2026-09-02T10:00:00+07:00',
  ]) {
    const result = refresh.isDue(at(iso));
    assert.equal(result.due, false, iso);
    assert.equal(result.reason, 'holiday', iso);
    assert.ok(result.holiday, iso);
  }
});

test('ngày lễ cố định vẫn bị chặn bởi fallback pháp định', () => {
  const result = refresh.isDue(at('2027-04-30T08:00:00+07:00'));
  assert.equal(result.due, false);
  assert.equal(result.reason, 'holiday');
});

test('config phản ánh đúng lịch đã duyệt', () => {
  const status = refresh.status();
  assert.equal(status.minutes, 30);
  assert.equal(status.weekday, '08:00-17:30');
  assert.equal(status.sat, '08:00-13:00');
  assert.equal(status.sun, 'off');
});

test('defaults trong code vẫn đúng lịch đã duyệt khi không có biến môi trường', () => {
  const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  try {
    const status = refresh.status();
    assert.equal(status.enabled, true);
    assert.equal(status.minutes, 30);
    assert.equal(status.weekday, '08:00-17:30');
    assert.equal(status.sat, '08:00-13:00');
    assert.equal(status.sun, 'off');
  } finally {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('quét đủ 1.440 phút không lọt slot ngoài lịch', () => {
  const expected = (dow, hh, mm) => {
    if (mm % 30 !== 0) return false;
    const minute = hh * 60 + mm;
    if (dow >= 1 && dow <= 5) return minute >= 8 * 60 && minute <= 17 * 60 + 30;
    if (dow === 6) return minute >= 8 * 60 && minute <= 13 * 60;
    return false;
  };
  const dates = [
    ['2026-07-20', 1],
    ['2026-07-25', 6],
    ['2026-07-26', 7],
  ];
  for (const [date, dow] of dates) {
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const hh = String(Math.floor(minute / 60)).padStart(2, '0');
      const mm = String(minute % 60).padStart(2, '0');
      assert.equal(
        refresh.isDue(at(`${date}T${hh}:${mm}:00+07:00`)).due,
        expected(dow, Number(hh), Number(mm)),
        `${date} ${hh}:${mm}`,
      );
    }
  }
});
