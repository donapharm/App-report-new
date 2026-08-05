'use strict';

/**
 * Lịch NGÀY LÀM VIỆC riêng cho ô KPI dự báo Employee Cost.
 *
 * Quan trọng: dailySales vẫn coi Thứ 7 là ca làm việc 07:30–13:00. Không được
 * "đồng bộ" quy ước đó vào đây. Theo lệnh CEO 05/08/2026, ô dự báo này loại
 * T7, CN, ngày lễ và nghỉ bù.
 *
 * Nguồn lịch duy nhất là server/data/holidays.json và helper holidayFor() đang
 * dùng bởi dailySales. Cấm tạo lịch thứ hai.
 */
const holidayCalendar = require('../data/holidays.json');
const { holidayFor, vnParts } = require('./dailySales');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function pad2(value) { return String(value).padStart(2, '0'); }
function leapYear(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function daysInMonth(year, month) {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function parseDateISO(value) {
  const match = DATE_RE.exec(String(value || ''));
  if (!match) throw new TypeError(`Ngày phải có dạng YYYY-MM-DD: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError(`Ngày không hợp lệ: ${value}`);
  }
  return { year, month, day, iso: `${year}-${pad2(month)}-${pad2(day)}` };
}
function parseMonth(value) {
  const match = MONTH_RE.exec(String(value || ''));
  if (!match) throw new TypeError(`Kỳ phải có dạng YYYY-MM: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), ym: `${match[1]}-${match[2]}` };
}
function compareDate(left, right) { return String(left).localeCompare(String(right)); }
function nextDate(value) {
  const current = parseDateISO(value);
  let { year, month, day } = current;
  day += 1;
  if (day > daysInMonth(year, month)) { day = 1; month += 1; }
  if (month > 12) { month = 1; year += 1; }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
function previousDate(value) {
  const current = parseDateISO(value);
  let { year, month, day } = current;
  day -= 1;
  if (day < 1) { month -= 1; if (month < 1) { month = 12; year -= 1; } day = daysInMonth(year, month); }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function configuredDates(holidays = holidayCalendar?.dates) {
  return Array.isArray(holidays) ? holidays : [];
}
function calendarHasYear(year, holidays = holidayCalendar?.dates) {
  const prefix = `${year}-`;
  return configuredDates(holidays).some((entry) => String(entry?.date || entry || '').startsWith(prefix));
}
function calendarStatus(year, holidays = holidayCalendar?.dates) {
  return { year, calendarMissing: !calendarHasYear(year, holidays) };
}

function isWorkingDay(dateISO, { holidays = holidayCalendar?.dates } = {}) {
  const parsed = parseDateISO(dateISO);
  // 12:00 GMT+7 nằm chắc chắn trong đúng ngày cần xét. Thứ trong tuần bắt buộc
  // đi qua vnParts/Intl; không dùng getDay() theo múi giờ máy.
  const instant = new Date(`${parsed.iso}T12:00:00+07:00`);
  const parts = vnParts(instant);
  if (parts.date !== parsed.iso || !parts.dow) throw new TypeError(`Không dựng được ngày GMT+7: ${dateISO}`);
  return parts.dow <= 5 && !holidayFor(parsed.iso, configuredDates(holidays));
}

function isWorkingInstant(now = new Date(), options) {
  return isWorkingDay(vnParts(now).date, options);
}

function workingDaysBetween(fromISO, toISO, options) {
  const from = parseDateISO(fromISO).iso;
  const to = parseDateISO(toISO).iso;
  if (compareDate(from, to) > 0) return 0;
  let count = 0;
  for (let cursor = from; compareDate(cursor, to) <= 0; cursor = nextDate(cursor)) {
    if (isWorkingDay(cursor, options)) count += 1;
  }
  return count;
}

function monthBounds(value) {
  const { year, month, ym } = parseMonth(value);
  return { year, month, ym, from: `${ym}-01`, to: `${ym}-${pad2(daysInMonth(year, month))}` };
}
function workingDaysInMonth(value, options) {
  const bounds = monthBounds(value);
  return workingDaysBetween(bounds.from, bounds.to, options);
}

// "Đã qua" = tới hết hôm qua giờ VN. Kỳ quá khứ tính đủ tháng; kỳ tương lai = 0.
function workingDaysElapsed(value, todayISO, options) {
  const bounds = monthBounds(value);
  const today = parseDateISO(todayISO).iso;
  if (compareDate(today, bounds.from) <= 0) return 0;
  if (compareDate(today, bounds.to) > 0) return workingDaysInMonth(value, options);
  return workingDaysBetween(bounds.from, previousDate(today), options);
}

// "Còn lại" = từ hôm nay tới hết tháng, nhưng hôm nay nghỉ thì tự không được đếm.
function workingDaysRemaining(value, todayISO, options) {
  const bounds = monthBounds(value);
  const today = parseDateISO(todayISO).iso;
  if (compareDate(today, bounds.to) > 0) return 0;
  if (compareDate(today, bounds.from) <= 0) return workingDaysInMonth(value, options);
  return workingDaysBetween(today, bounds.to, options);
}

module.exports = {
  isWorkingDay,
  isWorkingInstant,
  workingDaysBetween,
  workingDaysInMonth,
  workingDaysElapsed,
  workingDaysRemaining,
  calendarHasYear,
  calendarStatus,
  monthBounds,
};
