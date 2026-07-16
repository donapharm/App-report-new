const fs = require('fs');
const path = require('path');

const TZ = 'Asia/Bangkok';
const HOLIDAY_FILE = path.join(__dirname, '..', 'data', 'holidays.json');
const FIXED_PUBLIC_HOLIDAYS = {
  '01-01': 'Tết Dương lịch',
  '04-30': 'Ngày Giải phóng miền Nam',
  '05-01': 'Ngày Quốc tế Lao động',
  '09-02': 'Quốc khánh',
};

function vnParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hourCycle: 'h23',
  }).formatToParts(now).reduce((m, p) => (m[p.type] = p.value, m), {});
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    ky: `${parts.month}.${parts.year}`,
    dow: weekdayMap[parts.weekday] || 0,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    hour: Number(parts.hour),
    min: Number(parts.minute),
  };
}

function readHolidayDates() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HOLIDAY_FILE, 'utf8'));
    return Array.isArray(parsed?.dates) ? parsed.dates : [];
  } catch {
    return [];
  }
}

function holidayFor(date, dates = readHolidayDates()) {
  const configured = dates.find((x) => String(x?.date || x) === date);
  if (configured) return typeof configured === 'string' ? { date, name: 'Ngày lễ' } : configured;
  const fixed = FIXED_PUBLIC_HOLIDAYS[date.slice(5)];
  return fixed ? { date, name: fixed } : null;
}

function parseWindow(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text || ['off', 'none', 'false'].includes(text)) return null;
  const m = text.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return start <= end ? { start, end, text: raw } : null;
}

function scheduleFor(parts, refresh = {}) {
  const raw = parts.dow <= 5 ? refresh.weekday : (parts.dow === 6 ? refresh.sat : refresh.sun);
  const window = parseWindow(raw || (parts.dow <= 5 ? '07:30-18:00' : (parts.dow === 6 ? '07:30-13:00' : 'off')));
  const interval = Math.max(5, Number(refresh.minutes || 60) || 60);
  return { window, interval };
}

function sourceFreshness({ now = new Date(), sourceUpdatedAt, refresh = {} } = {}) {
  const parts = vnParts(now);
  const { window, interval } = scheduleFor(parts, refresh);
  if (!window) return { stale: false, beforeFirstRefresh: false, expectedAt: null, window: null };
  if (parts.minute < window.start) return { stale: false, beforeFirstRefresh: true, expectedAt: window.start, window: window.text };

  const capped = Math.min(parts.minute, window.end);
  const steps = Math.floor(Math.max(0, capped - window.start) / interval);
  const expectedAt = Math.min(window.start + steps * interval, window.end);
  const graceMin = 15;
  if (parts.minute < expectedAt + graceMin) return { stale: false, beforeFirstRefresh: false, expectedAt, window: window.text };

  const sourceDate = sourceUpdatedAt ? new Date(sourceUpdatedAt) : null;
  if (!sourceDate || Number.isNaN(sourceDate.getTime())) return { stale: true, beforeFirstRefresh: false, expectedAt, window: window.text };
  const src = vnParts(sourceDate);
  const stale = src.date < parts.date || (src.date === parts.date && src.minute < expectedAt);
  return { stale, beforeFirstRefresh: false, expectedAt, window: window.text };
}

function buildDailySales({ rows = [], now = new Date(), sourceUpdatedAt = null, isAdmin = false, isFiltered = false, refresh = {}, holidays } = {}) {
  const parts = vnParts(now);
  const todayRows = rows.filter((r) => String(r?.date || '').slice(0, 10) === parts.date);
  const revenue = Math.round(todayRows.reduce((sum, r) => sum + Number(r?.revenue || 0), 0));
  const sunday = parts.dow === 7;
  const holiday = holidayFor(parts.date, holidays);
  const dayOff = sunday || !!holiday;
  const freshness = sourceFreshness({ now, sourceUpdatedAt, refresh });

  let status = 'has_sales';
  let note = '';
  if (revenue > 0) {
    if (freshness.stale) {
      status = 'has_sales_stale';
      note = 'Đang chờ bản cập nhật mới; số hiện tại là dữ liệu gần nhất.';
    }
  } else if (dayOff) {
    status = 'day_off';
    note = 'Hiện tại đang là ngày nghỉ nên không có dữ liệu.';
  } else if (freshness.beforeFirstRefresh) {
    status = 'pending';
    note = 'Dữ liệu hôm nay sẽ bắt đầu cập nhật từ 07:30.';
  } else if (freshness.stale) {
    status = 'stale';
    note = 'Dữ liệu đang chờ cập nhật; chưa thể kết luận hôm nay chưa có doanh số.';
  } else {
    status = 'no_sales';
    note = isAdmin
      ? (isFiltered
        ? 'Đến thời điểm này hôm nay, phạm vi đang lọc chưa phát sinh doanh số.'
        : 'Đến thời điểm này hôm nay, toàn công ty chưa phát sinh doanh số.')
      : 'Đến thời điểm này hôm nay, Anh/Chị chưa có doanh số.';
  }

  return {
    date: parts.date,
    ky: parts.ky,
    revenue,
    rowCount: todayRows.length,
    sourceUpdatedAt,
    status,
    note,
    isDayOff: dayOff,
    dayOffName: sunday ? 'Chủ nhật' : (holiday?.name || null),
    stale: freshness.stale,
    refreshWindow: freshness.window,
  };
}

module.exports = { buildDailySales, holidayFor, sourceFreshness, vnParts, parseWindow };
