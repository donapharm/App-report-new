'use strict';

const { holidayFor } = require('./dailySales');
const TZ = 'Asia/Bangkok';
const WEEKDAY_MINUTE = 18 * 60;
const SATURDAY_MINUTE = 13 * 60;
const RETRY_OFFSETS = Object.freeze([0, 5, 15, 30]);
const WATCHDOG_OFFSET = 120;

function enabled(env = process.env) { return String(env.APP_REPORT_DEBTS_REVENUE_SCHEDULE_ENABLED || '') === '1'; }
function vnParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now)
    .reduce((out, part) => (out[part.type] = part.value, out), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, period: `${parts.year}-${parts.month}`,
    dow: ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[parts.weekday],
    minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
function isDue(now = new Date(), env = process.env) {
  if (!enabled(env)) return { due: false, reason: 'disabled' };
  const parts = vnParts(now);
  const holiday = holidayFor(parts.date);
  if (holiday) return { due: false, reason: 'holiday', date: parts.date };
  const expected = parts.dow >= 1 && parts.dow <= 5 ? WEEKDAY_MINUTE : parts.dow === 6 ? SATURDAY_MINUTE : null;
  if (expected === null || parts.minute !== expected) return { due: false, reason: 'outside_slot', parts };
  return { due: true, slot: `${parts.date}-${String(Math.floor(expected / 60)).padStart(2, '0')}00`, parts };
}
function runWindow(now = new Date(), env = process.env) {
  if (!enabled(env)) return { due: false, reason: 'disabled' };
  const parts = vnParts(now);
  if (holidayFor(parts.date)) return { due: false, reason: 'holiday', parts };
  const base = parts.dow >= 1 && parts.dow <= 5 ? WEEKDAY_MINUTE : parts.dow === 6 ? SATURDAY_MINUTE : null;
  if (base === null) return { due: false, reason: 'off_day', parts };
  const offset = parts.minute - base;
  if (RETRY_OFFSETS.includes(offset)) return { due: true, kind: offset === 0 ? 'scheduled' : 'retry', attempt: RETRY_OFFSETS.indexOf(offset), offset, base, parts,
    slot: `${parts.date}-${String(Math.floor(base / 60)).padStart(2, '0')}00` };
  if (offset === WATCHDOG_OFFSET) return { due: true, kind: 'watchdog', attempt: RETRY_OFFSETS.length, offset, base, parts,
    slot: `${parts.date}-${String(Math.floor(base / 60)).padStart(2, '0')}00` };
  return { due: false, reason: 'outside_window', parts };
}
function config(env = process.env) {
  return Object.freeze({ enabled: enabled(env), timezone: TZ, weekday: '18:00', saturday: '13:00', retriesMinutes: RETRY_OFFSETS.slice(1),
    watchdogMinutes: WATCHDOG_OFFSET, sunday: 'off', holidays: 'off' });
}

module.exports = { TZ, WEEKDAY_MINUTE, SATURDAY_MINUTE, RETRY_OFFSETS, WATCHDOG_OFFSET, enabled, vnParts, isDue, runWindow, config };
