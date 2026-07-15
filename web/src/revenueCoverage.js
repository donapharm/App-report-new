function isoDate(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function dayNo(iso) { return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000); }
function maxDate(...values) { return values.map(isoDate).filter(Boolean).sort().at(-1) || ''; }
function minDate(...values) { return values.map(isoDate).filter(Boolean).sort()[0] || ''; }
export function sellingDays(from, to) {
  const a = isoDate(from); const b = isoDate(to);
  if (!a || !b || a > b) return 0;
  let count = 0;
  for (let day = dayNo(a), end = dayNo(b); day <= end; day += 1) {
    // 0 = Chủ nhật theo UTC; chuỗi ISO ngày thuần nên không lệch múi giờ.
    if (new Date(day * 86400000).getUTCDay() !== 0) count += 1;
  }
  return count;
}

export function bangkokToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function monthCoverage(kys = [], filters = {}, periods = [], today = bangkokToday()) {
  const segments = [];
  for (const ky of kys || []) {
    const [mm, yyyy] = String(ky || '').split('.').map(Number);
    if (!mm || !yyyy) continue;
    const calendarDays = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
    const monthStart = `${yyyy}-${String(mm).padStart(2, '0')}-01`;
    const monthEnd = `${yyyy}-${String(mm).padStart(2, '0')}-${String(calendarDays).padStart(2, '0')}`;
    const total = sellingDays(monthStart, monthEnd);
    const period = periods.find((p) => p.ky === ky) || {};

    // Thanh chính là tiến độ NGÀY BÁN HÀNG (không tính Chủ nhật):
    // tháng hiện tại dừng ở hôm nay; bộ lọc ngày có thể thu hẹp thêm.
    const from = maxDate(monthStart, filters.dateFrom);
    const calendarTo = minDate(monthEnd, filters.dateTo || monthEnd, today < monthEnd ? today : monthEnd);
    if (!calendarTo || from > calendarTo) continue;
    const selected = sellingDays(from, calendarTo);

    // Số ngày dữ liệu dùng cho tốc độ bán: không vượt ngày dữ liệu nguồn thực có.
    // Kỳ đã chốt complete được coi là đủ tháng dù slot upload có dateTo kỹ thuật ngắn hơn.
    const sourceAsOf = period.complete
      ? monthEnd
      : isoDate(period.throughDate) || isoDate(period.dateTo) || calendarTo;
    const dataTo = minDate(calendarTo, sourceAsOf);
    const dataSelected = dataTo && dataTo >= from ? sellingDays(from, dataTo) : 0;

    segments.push({
      ky,
      label: `T${String(mm).padStart(2, '0')}`,
      from,
      to: calendarTo,
      selected,
      total,
      calendarDays,
      pct: +(selected / total * 100).toFixed(1),
      dataTo: dataSelected ? dataTo : null,
      dataSelected,
      dataCurrent: dataSelected >= selected,
    });
  }
  const selected = segments.reduce((s, x) => s + x.selected, 0);
  const total = segments.reduce((s, x) => s + x.total, 0);
  const dataSelected = segments.reduce((s, x) => s + x.dataSelected, 0);
  const dataAsOf = segments.map((x) => x.dataTo).filter(Boolean).sort().at(-1) || null;
  return {
    segments,
    selected,
    total,
    dataSelected,
    dataAsOf,
    pct: total ? +(selected / total * 100).toFixed(1) : 0,
  };
}

export function nclRunRate(quantity, coverage) {
  const sold = Number(quantity || 0);
  const dataDays = Number(coverage?.dataSelected || 0);
  const averagePerDataDay = dataDays > 0 ? sold / dataDays : null;
  const only = coverage?.segments?.length === 1 ? coverage.segments[0] : null;
  const projectedMonth = only && only.dataSelected > 0 && only.selected < only.total
    ? sold / only.dataSelected * only.total
    : null;
  return { averagePerDataDay, projectedMonth };
}
