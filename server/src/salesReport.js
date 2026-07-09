/**
 * salesReport.js — sinh báo cáo tuần/tháng Điểm doanh thu & Xu tích lũy cho NV KD + CEO digest.
 * Chưa bật lịch tự động; file này cung cấp hàm render/gửi mẫu để CEO duyệt.
 */
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    const p = path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ignore */ }
})();

const store = require('./store');
const analytics = require('./analytics');
const diemXu = require('./diemXu');
const notify = require('./notifyChannels');
const appSaleCst = require('./appSaleCst');

const OUT_DIR = path.join(__dirname, '..', '..', 'artifacts', 'sales-report');
const CEO_CODE = 'CEO';
const CEO_NAME = 'Đặng Xuân Trung';
const EXCLUDED = diemXu.EXCLUDE;
const fmtMoney = (n) => `${Math.round(Number(n || 0)).toLocaleString('vi-VN')}đ`;
const fmtNum = (n, d = 2) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtQty = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const pct = (n) => n == null ? '—' : `${Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
function parseDate(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function kyOf(dateStr) { const d = parseDate(dateStr); return `${pad2(d.getMonth() + 1)}.${d.getFullYear()}`; }
function startOfMonth(dateStr) { return `${dateStr.slice(0, 8)}01`; }
function endOfMonth(dateStr) { const d = parseDate(dateStr); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function startOfQuarter(dateStr) { const d = parseDate(dateStr); const m = Math.floor(d.getMonth() / 3) * 3; return ymd(new Date(d.getFullYear(), m, 1)); }
function sameDayPrevMonth(dateStr) { const d = parseDate(dateStr); const day = d.getDate(); const p = new Date(d.getFullYear(), d.getMonth() - 1, 1); const last = new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate(); p.setDate(Math.min(day, last)); return ymd(p); }
function monthLabel(dateStr) { const d = parseDate(dateStr); return `T${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
function dayOfMonth(dateStr) { return parseDate(dateStr).getDate(); }
function daysInMonth(dateStr) { const d = parseDate(dateStr); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function isMonthEnd(dateStr) { return dayOfMonth(dateStr) >= daysInMonth(dateStr); }
function comparisonMeta(kind, ranges) {
  const fullVsFull = kind === 'month' && isMonthEnd(ranges.monthRange.to);
  const factor = fullVsFull ? 1 : dayOfMonth(ranges.monthRange.to) / daysInMonth(ranges.monthRange.to);
  const prevMonth = monthLabel(ranges.prevRange.to);
  return {
    factor,
    fullVsFull,
    label: fullVsFull ? `So với ${prevMonth}` : `So với nhịp cùng kỳ ${prevMonth}`,
    shortLabel: fullVsFull ? prevMonth : `nhịp ${prevMonth}`,
  };
}
function periodKysBetween(from, to) { return diemXu.kysSpanning(from, to); }
function latestDataDate() {
  let latest = '';
  for (const ky of store.periodKys()) for (const r of store.getRows({ ky, scope: {} })) {
    const d = String(r.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > latest) latest = d;
  }
  return latest || ymd(new Date());
}
function defaultRanges(today = latestDataDate()) {
  const to = today;
  const monthFrom = startOfMonth(to);
  const quarterFrom = startOfQuarter(to);
  const prevTo = sameDayPrevMonth(to);
  return {
    asOf: to,
    weekRange: { from: monthFrom, to }, // CEO chốt: báo cáo tuần là lũy kế từ đầu tháng đến mốc chạy.
    monthRange: { from: monthFrom, to },
    quarterRange: { from: quarterFrom, to },
    // Dữ liệu kỳ cũ 01–06 có thể là tổng kỳ (không tách ngày). Lấy trọn tháng trước để không ra 0 giả.
    prevRange: { from: startOfMonth(prevTo), to: endOfMonth(prevTo) },
    monthKy: kyOf(to),
    prevKy: kyOf(prevTo),
  };
}
function rowsInRange({ empCode, from, to }) {
  return analytics.applyFilters(store.getRowsRange({ kys: periodKysBetween(from, to), scope: empCode ? { empCode } : {} }), { dateFrom: from, dateTo: to });
}
function groupRows(rows, key, label) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || '—';
    const cur = m.get(k) || { key: k, label: r[label] || k, revenue: 0, quantity: 0, rows: 0 };
    cur.revenue += Number(r.revenue || 0); cur.quantity += Number(r.quantity || 0); cur.rows += 1; m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}
function routeBreakdown(rows, prevRows, prevScale = 1) {
  const prev = new Map(groupRows(prevRows, 'route', 'route').map((x) => [x.key, x.revenue * prevScale]));
  const total = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
  return groupRows(rows, 'route', 'route').map((x) => ({ ...x, pct: total ? x.revenue / total * 100 : 0, prev: prev.get(x.key) || 0 }));
}
function dailyBars(rows) {
  const m = new Map();
  for (const r of rows) { const d = String(r.date || '').slice(0, 10); if (d) m.set(d, (m.get(d) || 0) + Number(r.revenue || 0)); }
  const max = Math.max(1, ...m.values());
  return [...m.entries()].sort().map(([date, revenue]) => ({ date, revenue, h: Math.max(4, Math.round(revenue / max * 96)) }));
}
function diffTop(curRows, prevRows, key, label, limit = 5, prevScale = 1) {
  const cur = new Map(groupRows(curRows, key, label).map((x) => [x.key, x]));
  const prev = new Map(groupRows(prevRows, key, label).map((x) => [x.key, x]));
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  const arr = [...keys].map((k) => ({ key: k, label: cur.get(k)?.label || prev.get(k)?.label || k, cur: cur.get(k)?.revenue || 0, prev: (prev.get(k)?.revenue || 0) * prevScale }));
  arr.forEach((x) => { x.diff = x.cur - x.prev; });
  return { up: arr.filter((x) => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, limit), down: arr.filter((x) => x.diff < 0 || x.cur === 0).sort((a, b) => a.diff - b.diff).slice(0, limit) };
}
function userByCode(code) { return store.findUserByCode(code) || { emp_code: code, name: code }; }
function salesRecipients() {
  return store.targetRosterCodes({ scope: {} }).filter((c) => !EXCLUDED.has(String(c).toUpperCase())).map((code) => ({ code, user: userByCode(code), email: notify.emailFor(code, userByCode(code)?.email) }));
}
function unitCodesForRows(rows) { return [...new Set(rows.map((r) => r.unit_code).filter(Boolean))]; }
function isClPriority(unitCode, route) { return String(route || '').toUpperCase() === 'CL' || ['025', '026', '027', '028'].includes(appSaleCst.normUnitPrefix(unitCode)); }

async function computeReport({ empCode = 'DN001', kind = 'week', ranges = defaultRanges() } = {}) {
  const user = userByCode(empCode);
  const range = kind === 'month' ? ranges.monthRange : ranges.weekRange;
  const rows = rowsInRange({ empCode, ...range });
  const prevRows = rowsInRange({ empCode, ...ranges.prevRange });
  const revenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const prevFullRevenue = prevRows.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const cmp = comparisonMeta(kind, ranges);
  const prevRevenue = prevFullRevenue * cmp.factor;
  const score = diemXu.scoreForEmp({ empCode, weekRange: ranges.weekRange, monthRange: ranges.monthRange, quarterRange: ranges.quarterRange });
  const topUnits = groupRows(rows, 'unit_code', 'unit_name').slice(0, 8);
  const topProducts = groupRows(rows, 'iit_code', 'product_name').slice(0, 8);
  const route = routeBreakdown(rows, prevRows, cmp.factor);
  const diffsUnit = diffTop(rows, prevRows, 'unit_code', 'unit_name', 5, cmp.factor);
  const diffsProduct = diffTop(rows, prevRows, 'iit_code', 'product_name', 5, cmp.factor);
  const cstPayload = await appSaleCst.fetchTenderQuota();
  const empUnits = unitCodesForRows(rows.length ? rows : store.getRowsRange({ kys: store.periodKys(), scope: { empCode } }));
  const cstRows = appSaleCst.cstForEmployeeUnits(cstPayload.rows, empUnits).slice(0, 10);
  const targets = store.getTargetsRange({ kys: [ranges.monthKy], scope: { empCode } });
  const target = targets.reduce((s, t) => s + Number(t.target || 0), 0);
  const pacing = analytics.targetPacingMeta(ranges.monthKy, parseDate(ranges.asOf));
  const forecast = pacing.factor ? revenue / pacing.factor : revenue;
  return { kind, empCode, user, range, ranges, rows, prevRows, revenue, prevRevenue, prevFullRevenue, comparison: cmp, score, topUnits, topProducts, route, diffsUnit, diffsProduct, cstRows, cstSource: cstPayload.source, target, forecast, days: dailyBars(rows) };
}
function htmlRows(arr, cols) {
  if (!arr.length) return `<tr><td colspan='${cols.length}'>Chưa có dữ liệu trong kỳ.</td></tr>`;
  return arr.map((x, i) => `<tr>${cols.map((c) => `<td class='${c.cls || ''}'>${c.html ? c.html(x, i) : esc(x[c.key])}</td>`).join('')}</tr>`).join('');
}
function renderHtml(data) {
  const titleKind = data.kind === 'month' ? 'Tháng' : 'Tuần';
  const delta = data.prevRevenue ? (data.revenue - data.prevRevenue) / data.prevRevenue * 100 : null;
  const unitCount = new Set(data.rows.map((r) => analytics.baseUnitKey(r.unit_code || r.unit_name))).size;
  const productCount = new Set(data.rows.map((r) => r.iit_code)).size;
  const routeHtml = data.route.map((r) => `<div class='bar-row'><div class='bar-label'>${esc(r.key)}</div><div class='bar-wrap'><div class='bar' style='width:${Math.min(100, r.pct).toFixed(1)}%;background:${r.key === 'CL' ? '#087565' : r.key === 'NT' ? '#f59e0b' : '#0d9488'}'></div></div><div class='bar-val'>${fmtMoney(r.revenue)}<br><span>${pct(r.pct)}</span></div><div class='bar-sub'>${fmtMoney(r.prev)}</div></div>`).join('');
  const cstText = data.cstRows.length ? data.cstRows.slice(0, 6).map((c) => `${c.productCode} @ ${c.unitCode}: còn ${fmtQty(c.slConLai)}`).join('; ') : 'Chưa có mã CL còn cơ số khớp đơn vị NV trong cache/API hiện tại.';
  const css = `body{margin:0;background:#f6fbfb;font-family:Arial,Helvetica,sans-serif;color:#163235}.wrap{max-width:960px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #d8eeee;box-shadow:0 8px 28px rgba(0,80,90,.08)}.banner{background:linear-gradient(135deg,#e8fbf8 0%,#c9f2ec 48%,#74d0c4 100%);padding:16px 24px 18px}.brand{font-size:28px;font-weight:900;letter-spacing:.6px;color:#087565}.title{font-size:23px;font-weight:900;color:#005f52;margin-top:5px}.period{font-size:13px;color:#245f5a;margin-top:4px}.content{padding:28px 32px 30px;line-height:1.62;font-size:15.2px}.note{background:#fff8e8;border-left:4px solid #d99a00;border-radius:10px;padding:12px 16px}.section{margin-top:25px}.section h3{font-size:18px;color:#087565;margin:0 0 12px;padding-bottom:7px;border-bottom:2px solid #d8eeee}.overview-table{width:100%;border-collapse:separate;border-spacing:10px;table-layout:fixed;margin-left:-10px;margin-right:-10px}.overview-table td{border:0;padding:0;width:50%;vertical-align:top}.kpi-card{background:linear-gradient(180deg,#eefbf8 0%,#f9fffe 100%);border:1px solid #cceee8;border-radius:14px;padding:15px 12px;text-align:center;min-height:86px;box-shadow:0 2px 8px rgba(0,95,82,.05)}.kpi-card.primary{background:linear-gradient(180deg,#e3f8f4 0%,#f7fffd 100%);border-color:#9fe1d8}.kpi-card .label{font-size:12px;color:#456;text-transform:uppercase;letter-spacing:.25px}.kpi-card .value{font-size:20px;font-weight:900;color:#005f52;margin-top:6px;line-height:1.2}.kpi-card .delta{font-size:12.5px;margin-top:5px}.pos{color:#087565;font-weight:800}.neg{color:#b42318;font-weight:800}table{border-collapse:collapse;width:100%;font-size:13.5px}th{background:#e7f7f4;color:#005f52;text-align:left}td,th{border:1px solid #d8eeee;padding:8px 9px;vertical-align:top}.r{text-align:right}.highlight{background:#eefbf8;border-left:4px solid #087565;border-radius:10px;padding:12px 16px}.warn{background:#fff5f0;border-left:4px solid #ef7b45;border-radius:10px;padding:12px 16px}.small{font-size:12.3px;color:#667}.bar-row{display:grid;grid-template-columns:145px 1fr 145px 120px;gap:10px;align-items:center;margin:9px 0}.bar-label{font-weight:700}.bar-wrap{height:18px;background:#e8f4f2;border-radius:9px;overflow:hidden}.bar{height:18px;border-radius:9px}.bar-val{text-align:right;font-weight:800;color:#005f52}.bar-val span,.bar-sub{font-size:12px;color:#667}.day-chart{display:flex;align-items:flex-end;gap:8px;height:132px;padding:12px 8px 2px;border:1px solid #d8eeee;border-radius:12px;background:#fbfffe;overflow-x:auto}.day{text-align:center;min-width:54px}.col{width:28px;background:#0d9488;border-radius:6px 6px 0 0;margin:0 auto}.day-val{font-size:10px;color:#245f5a;margin-top:4px;white-space:nowrap}.day-lab{font-size:11px;color:#667}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.todo li{margin:6px 0}`;
  return `<!doctype html><html><head><meta charset='utf-8'><style>${css}</style></head><body><div style='padding:24px 0'><div class='wrap'><div class='banner'><table style='border:0;width:100%'><tr><td style='border:0;width:82px;vertical-align:top'><img src='cid:logo_dona' alt='DONAPHARM' style='width:64px;max-width:64px;height:auto;display:block;border:0;background:transparent'></td><td style='border:0;vertical-align:middle'><div class='brand'>DONAPHARM</div><div class='title'>Báo cáo doanh thu ${titleKind} — ${esc(data.user.name || data.empCode)}</div><div class='period'>${esc(data.user.name || data.empCode)} – ${esc(data.empCode)} | Kỳ ${data.range.from}–${data.range.to} | ${esc(data.comparison.label)}</div></td><td style='border:0;width:58px;text-align:right;vertical-align:top'><img src='cid:qr_zalo' alt='QR Zalo' style='width:46px;height:46px;display:block;margin:0 auto;border:0;background:transparent'></td></tr></table></div><div class='content'><p>Kính gửi <b>Anh/Chị ${esc(data.user.name || data.empCode)} (${esc(data.empCode)})</b>,</p><p>Văn phòng CEO gửi báo cáo doanh thu ${titleKind}, lọc riêng theo mã nhân viên <b>${esc(data.empCode)}</b>. Báo cáo được tổng hợp tự động theo phạm vi phụ trách của Anh/Chị.</p><p class='note'><b>Nguồn dữ liệu:</b> Số liệu doanh thu, điểm thưởng, xu tích lũy và cơ số thầu được tổng hợp tự động từ hệ thống nội bộ DONAPHARM. Báo cáo không chứa chi phí, giá vốn, lợi nhuận. <b>Xu chỉ tính theo QUÝ</b> — sang quý mới tự động về 0, không chuyển tiếp.</p>
<div class='section'><h3>1. Tổng quan kết quả</h3><table class='overview-table'><tr><td><div class='kpi-card primary'><div class='label'>Doanh thu</div><div class='value'>${fmtMoney(data.revenue)}</div><div class='delta ${delta == null || delta >= 0 ? 'pos' : 'neg'}'>${delta == null ? 'Chưa có kỳ so sánh' : `${pct(delta)} · ${data.comparison.label}`}</div></div></td><td><div class='kpi-card'><div class='label'>Chênh lệch</div><div class='value ${data.revenue - data.prevRevenue >= 0 ? 'pos' : 'neg'}'>${fmtMoney(data.revenue - data.prevRevenue)}</div><div class='delta'>${data.comparison.shortLabel}: ${fmtMoney(data.prevRevenue)}</div></div></td></tr><tr><td><div class='kpi-card'><div class='label'>Số dòng</div><div class='value'>${data.rows.length}</div></div></td><td><div class='kpi-card'><div class='label'>Đơn vị</div><div class='value'>${unitCount}</div></div></td></tr><tr><td><div class='kpi-card'><div class='label'>Mặt hàng</div><div class='value'>${productCount}</div></div></td><td><div class='kpi-card'><div class='label'>Dự báo tháng</div><div class='value'>${fmtMoney(data.forecast)}</div></div></td></tr></table></div>
<div class='section'><h3>2. Điểm doanh thu &amp; xu chi tiêu</h3><table><tr><th>Kỳ</th><th class='r'>Doanh thu</th><th class='r'>Điểm DT tháng</th><th class='r'>Xu tháng</th><th class='r'>Xu quý</th><th class='r'>Thiếu xu</th><th class='r'>Dư xu</th><th class='r'>Hoàn thành quý</th></tr><tr><td>${monthLabel(data.ranges.asOf)} đến ${data.ranges.asOf}</td><td class='r'>${fmtMoney(data.revenue)}</td><td class='r'><b>${fmtNum(data.score.diem_thang)}</b></td><td class='r'>${fmtNum(data.score.xu_thang)}</td><td class='r'>${fmtNum(data.score.xu_quy)}</td><td class='r neg'>${fmtNum(data.score.thieu_xu)}</td><td class='r pos'>${fmtNum(data.score.du_xu)}</td><td class='r'>${pct(data.score.ty_le_quy)}</td></tr></table></div>
<div class='section'><h3>3. Phân tích tuyến CL / NCL / NT</h3>${routeHtml || '<p>Chưa có dữ liệu tuyến.</p>'}<table><tr><th>Tuyến</th><th class='r'>Kỳ này</th><th class='r'>Tỷ trọng</th><th class='r'>${esc(data.comparison.shortLabel)}</th><th class='r'>Chênh lệch</th></tr>${htmlRows(data.route, [{ html: x => esc(x.key) }, { cls: 'r', html: x => fmtMoney(x.revenue) }, { cls: 'r', html: x => pct(x.pct) }, { cls: 'r', html: x => fmtMoney(x.prev) }, { cls: 'r', html: x => `<span class='${x.revenue - x.prev >= 0 ? 'pos' : 'neg'}'>${fmtMoney(x.revenue - x.prev)}</span>` }])}</table></div>
<div class='section'><h3>4. Biểu đồ doanh thu theo ngày</h3><div class='day-chart'>${data.days.map((d) => `<div class='day'><div class='col' style='height:${d.h}px'></div><div class='day-val'>${fmtMoney(d.revenue)}</div><div class='day-lab'>${d.date.slice(8)}/${d.date.slice(5,7)}</div></div>`).join('')}</div></div>
<div class='section'><h3>5. Top đơn vị và top mặt hàng</h3><div class='grid2'><div><h4>Top đơn vị</h4><table><tr><th>#</th><th>Đơn vị</th><th class='r'>DT</th><th class='r'>Tỷ trọng</th></tr>${htmlRows(data.topUnits, [{ html: (_, i) => i + 1 }, { html: x => esc(x.label) }, { cls: 'r', html: x => fmtMoney(x.revenue) }, { cls: 'r', html: x => pct(data.revenue ? x.revenue / data.revenue * 100 : 0) }])}</table></div><div><h4>Top mặt hàng</h4><table><tr><th>#</th><th>Mặt hàng</th><th class='r'>DT</th><th class='r'>Tỷ trọng</th></tr>${htmlRows(data.topProducts, [{ html: (_, i) => i + 1 }, { html: x => esc(x.label) }, { cls: 'r', html: x => fmtMoney(x.revenue) }, { cls: 'r', html: x => pct(data.revenue ? x.revenue / data.revenue * 100 : 0) }])}</table></div></div></div>
<div class='section'><h3>6. So sánh tăng/giảm theo nhịp cùng kỳ</h3><div class='grid2'><div><h4>Đơn vị tăng mạnh</h4><table><tr><th>Đơn vị</th><th class='r'>Kỳ này</th><th class='r'>${esc(data.comparison.shortLabel)}</th><th class='r'>Chênh</th></tr>${htmlRows(data.diffsUnit.up, [{ html: x => esc(x.label) }, { cls: 'r', html: x => fmtMoney(x.cur) }, { cls: 'r', html: x => fmtMoney(x.prev) }, { cls: 'r pos', html: x => fmtMoney(x.diff) }])}</table></div><div><h4>Đơn vị giảm/chưa phát sinh</h4><table><tr><th>Đơn vị</th><th class='r'>Kỳ này</th><th class='r'>${esc(data.comparison.shortLabel)}</th><th class='r'>Chênh</th></tr>${htmlRows(data.diffsUnit.down, [{ html: x => esc(x.label) }, { cls: 'r', html: x => fmtMoney(x.cur) }, { cls: 'r', html: x => fmtMoney(x.prev) }, { cls: 'r neg', html: x => fmtMoney(x.diff) }])}</table></div></div></div>
<div class='section'><h3>7. Tồn tại cần xử lý</h3><ul class='todo'><li>${data.score.canh_bao ? `Tỷ lệ xu quý mới ${pct(data.score.ty_le_quy)}, cần bổ sung hóa đơn/xu hợp lệ.` : `Tỷ lệ xu quý ${pct(data.score.ty_le_quy)}; tiếp tục giữ nhịp hóa đơn để không hụt xu.`}</li><li>Đơn vị giảm/chưa phát sinh: ${data.diffsUnit.down.slice(0, 4).map((x) => `${x.label} (${fmtMoney(x.diff)})`).join('; ') || 'chưa có cảnh báo lớn'}.</li><li>Mã hàng giảm/chưa phát sinh: ${data.diffsProduct.down.slice(0, 4).map((x) => `${x.label} (${fmtMoney(x.diff)})`).join('; ') || 'chưa có cảnh báo lớn'}.</li></ul></div>
<div class='section'><h3>8. Kiến nghị hành động tuần tới</h3><table><tr><th>Nhóm việc</th><th>Khuyến nghị cụ thể</th><th>Thời hạn</th></tr><tr><td>Giữ điểm lớn</td><td>${data.topUnits.slice(0, 3).map((x) => esc(x.label)).join(', ') || '—'}</td><td>48 giờ</td></tr><tr><td>Kéo lại điểm giảm</td><td>${data.diffsUnit.down.slice(0, 4).map((x) => esc(x.label)).join(', ') || '—'}</td><td>Trước giữa tuần</td></tr><tr><td>Đẩy mã có sức kéo</td><td>${data.topProducts.slice(0, 5).map((x) => esc(x.label)).join(', ') || '—'}</td><td>3 ngày đầu tuần</td></tr></table></div>
<div class='section'><h3>9. 🧠 Phân tích thông minh &amp; Định hướng bán hàng</h3><p class='highlight'>Phân tích tự động theo số liệu nội bộ: xu hướng so kỳ trước, dự báo cả tháng theo nhịp hiện tại, và hướng khai thác để cán target.</p><div class='grid2'><div class='kpi-card primary'><div class='label'>A. Xu hướng kỳ</div><div class='value ${delta == null || delta >= 0 ? 'pos' : 'neg'}'>${delta == null ? '—' : pct(delta)}</div><div class='delta'>${esc(data.comparison.label)}.</div></div><div class='kpi-card' style='background:linear-gradient(180deg,#fff8eb,#fffdf7);border-color:#f0d9a0'><div class='label'>H. Dự báo cuối tháng theo nhịp</div><div class='value'>${fmtMoney(data.forecast)}</div><div class='delta'>Theo ${data.ranges.monthRange.from}–${data.ranges.monthRange.to}; target tháng: ${data.target ? fmtMoney(data.target) : 'chưa nhập'}. Dự báo sơ bộ, còn biến động.</div></div></div><div class='section' style='margin-top:14px'><h4>C. Cơ cấu tuyến &amp; cơ hội điểm</h4><p>NCL là dư địa mở rộng riêng, không phụ thuộc cơ số thầu. CL/NT và các đơn vị 025–028 giúp tăng điểm nhanh hơn do hệ số điểm ×2.</p></div><div class='section' style='margin-top:10px'><h4>D. Đánh thức đơn vị “ngủ”</h4><p>${data.diffsUnit.down.filter((x) => x.cur === 0 && x.prev > 0).slice(0, 5).map((x) => `${esc(x.label)} (${fmtMoney(x.prev)} ${data.comparison.shortLabel})`).join('; ') || 'Chưa phát hiện đơn vị có doanh thu kỳ trước nhưng kỳ này 0đ.'}</p></div><div class='section' style='margin-top:10px'><h4>E. Sản phẩm giảm &amp; gợi ý bán chéo</h4><p>Sản phẩm cần kéo lại: ${data.diffsProduct.down.slice(0, 5).map((x) => `${esc(x.label)} (${fmtMoney(x.diff)})`).join('; ') || 'chưa có mã giảm rõ'}. Gợi ý bán chéo tại các đơn vị đang tăng: ${data.diffsUnit.up.slice(0, 3).map((x) => esc(x.label)).join(', ') || 'ưu tiên đơn vị có doanh thu tốt'}.</p></div><div class='section' style='margin-top:10px'><h4>G. 3–5 việc ưu tiên cụ thể</h4><ol><li>Gọi lại các đơn vị giảm/chưa phát sinh trong bảng mục 6.</li><li>Đẩy 3 mặt hàng doanh thu cao nhất vào nhóm đơn vị đang tăng.</li><li>Ưu tiên mã còn cơ số tại đơn vị CL để giữ điểm tốt.</li><li>Mở thêm đơn vị NCL vì dư địa không bị giới hạn bởi cơ số thầu.</li><li>Kiểm tra hóa đơn/xu tích lũy nếu tỷ lệ quý dưới 90%.</li></ol></div><div class='section' style='margin-top:10px'><h4>I. Khuyến nghị khai thác để cán target</h4><table><tr><th>Hướng</th><th>Khuyến nghị cụ thể</th><th>Vì sao</th></tr><tr><td><b>⭐ NCL — dư địa vô hạn</b></td><td>Mở rộng đơn vị/nhà thuốc khối NCL — <b>không bị cơ số thầu chặn</b>.</td><td>Tăng doanh thu tự do để cán target</td></tr><tr><td>Khối CL (điểm ×2)</td><td>Ưu tiên đơn vị CL/025–028 đang có phát sinh và còn mã thầu dư.</td><td>Vừa doanh thu vừa điểm cao</td></tr><tr><td>Mã QLNB còn cơ số</td><td>${esc(cstText)}</td><td>Đã có cơ số thầu — bán chắc, ưu tiên khai thác.</td></tr></table></div></div><p style='margin-top:28px'>Trân trọng,<br><b>ĐẶNG XUÂN TRUNG</b><br>CEO — Công ty TNHH Dược phẩm DONAPHARM<br>Hotline: 0886.396.668</p><p class='small'><em>E-mail này được gửi từ văn phòng CEO DONAPHARM với sự hỗ trợ AI agent Donapharm. Đây là bản test để CEO duyệt trước khi gửi chính thức cho nhân viên.</em></p></div></div></div></body></html>`;
}
function renderText(data) {
  const titleKind = data.kind === 'month' ? 'THÁNG' : 'TUẦN';
  const cst = data.cstRows.slice(0, 3).map((x) => `${x.productCode}@${x.unitCode}: ${fmtQty(x.slConLai)}`).join('; ') || 'chưa có mã CST khớp';
  return `DONAPHARM — ${titleKind} ${data.empCode}\nKỳ ${data.range.from}–${data.range.to}\nDoanh thu: ${fmtMoney(data.revenue)} | Điểm tháng: ${fmtNum(data.score.diem_thang)} | Xu quý: ${fmtNum(data.score.xu_quy)} | Tỷ lệ: ${pct(data.score.ty_le_quy)}\nƯu tiên: giữ ${data.topUnits.slice(0, 2).map((x) => x.label).join(', ') || 'đơn vị chính'}; kéo lại ${data.diffsUnit.down.slice(0, 2).map((x) => x.label).join(', ') || 'đơn vị giảm'}; CST: ${cst}.`;
}
async function renderEmployeeReport(opts) {
  const data = await computeReport(opts);
  return { data, html: renderHtml(data), text: renderText(data), subject: `DONAPHARM — Báo cáo ${data.kind === 'month' ? 'tháng' : 'tuần'} ${data.empCode} (${data.range.from}–${data.range.to})` };
}
async function renderCeoDigest({ kind = 'week', ranges = defaultRanges() } = {}) {
  const rows = [];
  for (const r of salesRecipients()) {
    const d = await computeReport({ empCode: r.code, kind, ranges });
    rows.push({ code: r.code, name: r.user.name || r.code, revenue: d.revenue, score: d.score, warn: d.score.canh_bao });
  }
  rows.sort((a, b) => (a.score.ty_le_quy ?? -1) - (b.score.ty_le_quy ?? -1));
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const html = `<!doctype html><html><head><meta charset='utf-8'><style>body{font-family:Arial;background:#f6fbfb;color:#163235}.wrap{max-width:980px;margin:auto;background:white;border:1px solid #d8eeee;border-radius:16px;padding:24px}h2{color:#087565}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #d8eeee;padding:8px}th{background:#e7f7f4;color:#005f52}.r{text-align:right}.neg{color:#b42318;font-weight:bold}.pos{color:#087565;font-weight:bold}</style></head><body><div class='wrap'><h2>DONAPHARM — CEO Digest báo cáo ${kind === 'month' ? 'tháng' : 'tuần'}</h2><p>Kỳ ${ranges.monthRange.from}–${ranges.monthRange.to}. Người nhận chính thức: ${rows.length} NV KD (đã loại DN021, DN022, DN023, VP004, VP018).</p><p><b>Tổng doanh thu:</b> ${fmtMoney(totalRevenue)} · <b>NV cảnh báo xu &lt;90%:</b> ${rows.filter((r) => r.warn).length}</p><table><tr><th>NV</th><th>Tên</th><th class='r'>Doanh thu</th><th class='r'>Điểm tháng</th><th class='r'>Xu quý</th><th class='r'>Thiếu xu</th><th class='r'>Tỷ lệ quý</th></tr>${rows.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class='r'>${fmtMoney(r.revenue)}</td><td class='r'>${fmtNum(r.score.diem_thang)}</td><td class='r'>${fmtNum(r.score.xu_quy)}</td><td class='r ${r.score.thieu_xu ? 'neg' : ''}'>${fmtNum(r.score.thieu_xu)}</td><td class='r ${r.warn ? 'neg' : 'pos'}'>${pct(r.score.ty_le_quy)}</td></tr>`).join('')}</table><p style='font-size:12px;color:#667'>Nguồn: Số liệu được tổng hợp tự động từ hệ thống nội bộ DONAPHARM. Không chứa chi phí/giá vốn/lợi nhuận.</p></div></body></html>`;
  const text = `DONAPHARM CEO Digest ${kind}: ${rows.length} NV KD, tổng DT ${fmtMoney(totalRevenue)}, cảnh báo xu <90%: ${rows.filter((r) => r.warn).length}.`;
  return { html, text, subject: `DONAPHARM — CEO Digest ${kind === 'month' ? 'tháng' : 'tuần'} (${ranges.monthRange.from}–${ranges.monthRange.to})`, rows };
}
function ensureOut() { fs.mkdirSync(OUT_DIR, { recursive: true }); }
async function writeSample(empCode = 'DN001') {
  ensureOut();
  const ranges = defaultRanges();
  const week = await renderEmployeeReport({ empCode, kind: 'week', ranges });
  const month = await renderEmployeeReport({ empCode, kind: 'month', ranges });
  const ceo = await renderCeoDigest({ kind: 'week', ranges });
  const files = {
    week: path.join(OUT_DIR, `${empCode}_week_${ranges.asOf}.html`),
    month: path.join(OUT_DIR, `${empCode}_month_${ranges.asOf}.html`),
    ceo: path.join(OUT_DIR, `CEO_digest_week_${ranges.asOf}.html`),
  };
  fs.writeFileSync(files.week, week.html); fs.writeFileSync(files.month, month.html); fs.writeFileSync(files.ceo, ceo.html);
  return { ranges, week, month, ceo, files };
}
async function sendCeoApprovalSample(empCode = 'DN001') {
  const sample = await writeSample(empCode);
  const ceoEmail = notify.emailFor(CEO_CODE) || notify.emailFor('DN001') || process.env.CEO_EMAIL || '';
  const out = [];
  out.push(await notify.sendEmail(ceoEmail, `[CEO DUYỆT] ${sample.week.subject}`, sample.week.text, sample.week.html));
  out.push(await notify.sendEmail(ceoEmail, `[CEO DUYỆT] ${sample.month.subject}`, sample.month.text, sample.month.html));
  return { ...sample, ceoEmail, sendResults: out };
}
async function main() {
  const [cmd = 'sample', emp = 'DN001', flag] = process.argv.slice(2);
  if (cmd === 'recipients') { console.log(JSON.stringify(salesRecipients(), null, 2)); return; }
  if (cmd === 'ceo-digest') { const d = await renderCeoDigest({ kind: emp || 'week' }); console.log(d.text); return; }
  if (cmd === 'sample') {
    const r = flag === '--send-ceo' ? await sendCeoApprovalSample(emp) : await writeSample(emp);
    console.log(JSON.stringify({ files: r.files, ceoEmail: r.ceoEmail, sendResults: r.sendResults, ranges: r.ranges, comparison: r.week.data.comparison, cstRows: r.week.data.cstRows.length }, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${cmd}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { defaultRanges, salesRecipients, computeReport, renderEmployeeReport, renderCeoDigest, writeSample, sendCeoApprovalSample };
