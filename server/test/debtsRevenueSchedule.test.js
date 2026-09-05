'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const schedule = require('../src/debtsRevenueSchedule');
const env = { APP_REPORT_DEBTS_REVENUE_SCHEDULE_ENABLED: '1' };
const at = (s) => new Date(s);

test('schedule is OFF by default', () => assert.equal(schedule.isDue(at('2026-09-03T18:00:00+07:00'), {}).reason, 'disabled'));
test('runtime config exports the exact approved schedule', () => assert.deepEqual(schedule.config(env), {
  enabled: true, timezone: 'Asia/Bangkok', weekday: '18:00', saturday: '13:00', retriesMinutes: [5, 15, 30], watchdogMinutes: 120, sunday: 'off', holidays: 'off',
}));
test('Monday-Friday runs once at 18:00 GMT+7 and Saturday at 13:00', () => {
  assert.equal(schedule.isDue(at('2026-09-03T18:00:00+07:00'), env).due, true);
  assert.equal(schedule.isDue(at('2026-09-03T17:59:00+07:00'), env).due, false);
  assert.equal(schedule.isDue(at('2026-09-05T13:00:00+07:00'), env).due, true);
  assert.equal(schedule.isDue(at('2026-09-05T13:01:00+07:00'), env).due, false);
  assert.equal(schedule.isDue(at('2026-09-06T13:00:00+07:00'), env).due, false);
});
test('Vietnam holiday is fail-closed', () => assert.equal(schedule.isDue(at('2026-09-02T18:00:00+07:00'), env).reason, 'holiday'));
