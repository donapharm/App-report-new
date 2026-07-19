'use strict';

/**
 * CEO deck V2 FACTS layer.
 * - CEO/company scope only.
 * - Weekly and monthly periods are intentionally independent.
 * - No invented weekly history: WoW is disabled when source granularity is not daily.
 * - Revenue, target, CST and score/xu remain traceable to App Report sources.
 */
const store = require('../store');
const analytics = require('../analytics');
const diemXu = require('../diemXu');
const salesReport = require('../salesReport');

const SCHEMA_VERSION = 2;
const ROUTES = ['CL', 'NCL', 'NT'];
const UNCLASSIFIED = 'Chưa phân loại';
const UNGROUPED = 'Chưa phân nhóm';
const UNKNOWN_GROUP = 'Chưa xác định';
const EXCLUDED = diemXu.EXCLUDE || new Set(['DN021', 'DN022', 'DN023', 'VP004', 'VP018']);

const n = (v) => Number(v || 0);
const txt = (v) => String(v == null ? '' : v).trim();
const upper = (v) => txt(v).toUpperCase();
const norm = (v) => txt(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
const sumRevenue = (rows) => analytics.sum(rows, (r) => n(r.revenue));
const pct = (v, total) => total ? v / total * 100 : 0;
const round = (v, digits = 2) => Number(n(v).toFixed(digits));

function parseDate(v) { const [y, m, d] = txt(v).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDays(v, amount) { const d = parseDate(v); d.setDate(d.getDate() + amount); return ymd(d); }
function startMonth(v) { const d = parseDate(v); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); }
function endMonth(v) { const d = parseDate(v); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function startQuarter(v) { const d = parseDate(v); return ymd(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)); }
function startYear(v) { const d = parseDate(v); return `${d.getFullYear()}-01-01`; }
function daysInMonth(v) { const d = parseDate(v); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function dayOfMonth(v) { return parseDate(v).getDate(); }
function daysInclusive(from, to) { const out = []; for (let d = parseDate(from), e = parseDate(to); d <= e; d.setDate(d.getDate() + 1)) out.push(ymd(d)); return out; }
function monthKy(v) { const d = parseDate(v); return `${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; }
function monthShort(v) { const d = parseDate(v); return `T${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
function previousMonth(v) { const d = parseDate(v); return ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
function quarterLabel(v) { const d = parseDate(v); return `Q${Math.floor(d.getMonth() / 3) + 1}/${d.getFullYear()}`; }
function kysSpanning(from, to) { const a = parseDate(from); const b = parseDate(to); const out = []; for (let d = new Date(a.getFullYear(), a.getMonth(), 1); d <= b; d.setMonth(d.getMonth() + 1)) out.push(`${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`); return out; }

function rowsRaw(range) { return store.getRowsRange({ kys: kysSpanning(range.from, range.to), scope: {} }); }
function rowsInRange(range) { return analytics.applyFilters(rowsRaw(range), { dateFrom: range.from, dateTo: range.to }); }
function granularityFor(range) {
  const raw = rowsRaw(range);
  const types = [...new Set(raw.map((r) => txt(r.date_granularity || 'unknown').toLowerCase()))];
  const exact = raw.length > 0 && types.every((x) => x === 'day');
  return { exact, types, label: exact ? 'day' : types.join(',') || 'unknown' };
}

function periods(kind, asOf) {
  const monthFrom = startMonth(asOf);
  const month = { from: monthFrom, to: asOf };
  const priorMonthFrom = previousMonth(asOf);
  const priorFullMonth = { from: priorMonthFrom, to: endMonth(priorMonthFrom) };
  const quarter = { from: startQuarter(asOf), to: asOf };
  if (kind === 'week') {
    // Lịch gửi 13:00 Thứ 7: dùng 7 ngày ĐÃ HOÀN TẤT gần nhất (Thứ 7 trước → Thứ 6),
    // không trộn phần ngày đang chạy vào báo cáo tuần.
    const completedTo = addDays(asOf, -1);
    const current = { from: addDays(completedTo, -6), to: completedTo };
    const previous = { from: addDays(completedTo, -13), to: addDays(completedTo, -7) };
    return { current, previous, monthContext: month, priorFullMonth, quarterContext: quarter };
  }
  return { current: month, previous: priorFullMonth, monthContext: month, priorFullMonth, quarterContext: quarter };
}

function canonicalRoute(row) {
  const value = upper(row.route);
  if (ROUTES.includes(value)) return value;
  return UNCLASSIFIED;
}

const PARTNER_PREFIXES = new Set(['03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '14', '15']);
const PARTNER_LEGAL_HINTS = [
  'tue nam', 'nguyen phat', 'nguyen khoi', 'song viet', 'trieu giang', 'bin bo', 'huy cuong',
  'dai truong son', 'tu duc', 'minh phat', 'thai nhan', 'dai phat', 'a&b', 'hiep bach nien',
  'global pharmaceutical', 'nam au', 'minh tri', 'neom', 'thanh long', 'nhat huy', 'ha duc son', 'son ha', 'nguyen duong',
];
function sourceGroup(row) {
  const raw = txt(row.contractor_code || row.contractor_name);
  const value = norm(raw);
  if (!value || value === '#n/a' || value === 'n/a') return UNKNOWN_GROUP;
  if (/(^|[^a-z0-9])(dona|donapharm|afp)([^a-z0-9]|$)/.test(value)) return 'Group-Dona';
  const prefix = raw.match(/^\s*(\d{2})[.\s]/)?.[1];
  if ((prefix && PARTNER_PREFIXES.has(prefix)) || PARTNER_LEGAL_HINTS.some((x) => value.includes(x))) return 'Group-Đối tác';
  return UNKNOWN_GROUP;
}

function customerType(row) {
  const value = norm(`${row.unit_code || ''} ${row.unit_name || ''}`);
  if (/(^|[ ._-])nt([ ._-]|$)|nha thuoc|quay thuoc/.test(value)) return 'Nhà thuốc';
  if (/(^|[ ._-])ttyt([ ._-]|$)|trung tam y te/.test(value)) return 'TTYT';
  if (/(^|[ ._-])pkdk([ ._-]|$)|phong kham da khoa/.test(value)) return 'PKĐK';
  if (/(^|[ ._-])pk([ ._-]|$)|phong kham/.test(value)) return 'Phòng khám';
  if (/(^|[ ._-])bvdk([ ._-]|$)|benh vien da khoa/.test(value)) return 'BVĐK';
  if (/(^|[ ._-])bv([ ._-]|$)|benh vien/.test(value)) return 'Bệnh viện';
  return UNCLASSIFIED;
}
function therapy(row) { return txt(row.c14) || UNGROUPED; }

function grouped(rows, keyFn, labelFn = keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = txt(keyFn(row)) || '—';
    const cur = map.get(key) || { key, label: txt(labelFn(row)) || key, revenue: 0, quantity: 0, rowCount: 0 };
    cur.revenue += n(row.revenue); cur.quantity += n(row.quantity); cur.rowCount += 1; map.set(key, cur);
  }
  const total = sumRevenue(rows);
  return [...map.values()].sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label, 'vi'))
    .map((x, i) => ({ ...x, rank: i + 1, share: pct(x.revenue, total) }));
}

function compared(currentRows, previousRows, keyFn, labelFn, scale, valid) {
  const cur = new Map(grouped(currentRows, keyFn, labelFn).map((x) => [x.key, x]));
  const prev = new Map(grouped(previousRows, keyFn, labelFn).map((x) => [x.key, x]));
  const all = [...new Set([...cur.keys(), ...prev.keys()])].map((key) => {
    const c = cur.get(key); const p = prev.get(key); const current = c?.revenue || 0; const previous = valid ? (p?.revenue || 0) * scale : null;
    return { key, label: c?.label || p?.label || key, current, previous, diff: valid ? current - previous : null, growth: valid && previous ? (current - previous) / previous * 100 : null, isNew: valid && current > 0 && previous === 0, isDormant: valid && current === 0 && previous > 0 };
  });
  const withDiff = all.filter((x) => x.diff != null);
  return {
    valid,
    all: valid ? withDiff.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)) : all.sort((a, b) => b.current - a.current),
    up: withDiff.filter((x) => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 12),
    down: withDiff.filter((x) => x.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 12),
    new: withDiff.filter((x) => x.isNew).sort((a, b) => b.current - a.current).slice(0, 12),
    dormant: withDiff.filter((x) => x.isDormant).sort((a, b) => b.previous - a.previous).slice(0, 12),
  };
}

function dailySeries(rows, range) {
  const map = new Map(daysInclusive(range.from, range.to).map((d) => [d, 0]));
  for (const r of rows) { const d = txt(r.date).slice(0, 10); if (map.has(d)) map.set(d, map.get(d) + n(r.revenue)); }
  return [...map].map(([date, revenue]) => ({ date, revenue }));
}

function monthlyTrend(asOf, count = 7) {
  const end = parseDate(asOf); const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1); const from = ymd(d); const to = i === 0 ? asOf : endMonth(from); const rows = rowsInRange({ from, to });
    out.push({ ky: monthKy(from), label: monthShort(from), from, to, revenue: sumRevenue(rows), isMtd: i === 0 && to !== endMonth(from), granularity: granularityFor({ from, to }).label });
  }
  return out;
}
function quarterlyTrend(months) {
  const map = new Map();
  for (const item of months) { const key = quarterLabel(item.from); const cur = map.get(key) || { key, label: key, revenue: 0, months: 0, isMtd: false }; cur.revenue += item.revenue; cur.months += 1; cur.isMtd ||= item.isMtd; map.set(key, cur); }
  return [...map.values()];
}
function dimensionMonthlyTrend(months, keyFn, labelFn = keyFn) {
  const keys = new Map();
  const buckets = months.map((m) => {
    const groups = grouped(rowsInRange({ from: m.from, to: m.to }), keyFn, labelFn);
    groups.forEach((g) => keys.set(g.key, g.label));
    return new Map(groups.map((g) => [g.key, g.revenue]));
  });
  return [...keys].map(([key, label]) => ({ key, label, values: months.map((m, i) => ({ label: m.label, revenue: buckets[i].get(key) || 0, isMtd: m.isMtd })) }))
    .sort((a, b) => (b.values.at(-1)?.revenue || 0) - (a.values.at(-1)?.revenue || 0));
}

function scoreXu(monthRows, p) {
  const codes = [...new Set(monthRows.map((r) => upper(r.emp_code)).filter((x) => x && !EXCLUDED.has(x)))].sort();
  const names = new Map(monthRows.map((r) => [upper(r.emp_code), txt(r.emp_name) || upper(r.emp_code)]));
  const rows = codes.map((empCode) => {
    const s = diemXu.scoreForEmp({ empCode, weekRange: p.current, monthRange: p.monthContext, quarterRange: p.quarterContext });
    const diemThang = n(s.diem_thang); const xuThang = n(s.xu_thang); const monthlyGap = xuThang - diemThang; const monthlyRate = diemThang ? xuThang / diemThang * 100 : null;
    return { empCode, empName: names.get(empCode) || empCode, ...s, monthlyGap, monthlyMissing: Math.max(0, -monthlyGap), monthlySurplus: Math.max(0, monthlyGap), monthlyRate, monthlyWarning: monthlyRate != null && monthlyRate < 90 };
  }).sort((a, b) => b.diem_thang - a.diem_thang || b.diem_quy - a.diem_quy);
  const totals = rows.reduce((a, x) => { a.diemThang += n(x.diem_thang); a.xuThang += n(x.xu_thang); a.diemQuy += n(x.diem_quy); a.xuQuy += n(x.xu_quy); return a; }, { diemThang: 0, xuThang: 0, diemQuy: 0, xuQuy: 0 });
  totals.monthlyRate = totals.diemThang ? totals.xuThang / totals.diemThang * 100 : null;
  totals.quarterlyRate = totals.diemQuy ? totals.xuQuy / totals.diemQuy * 100 : null;
  return { rows, totals, monthlyWarnings: rows.filter((x) => x.monthlyWarning).sort((a, b) => (a.monthlyRate || 0) - (b.monthlyRate || 0)), quarterlyWarnings: rows.filter((x) => x.canh_bao).sort((a, b) => (a.ty_le_quy || 0) - (b.ty_le_quy || 0)), policy: { monthlyPrimary: true, quarterContext: true, carryForward: false, excludedCodes: [...EXCLUDED] } };
}

function targets(monthRows, asOf) {
  const targetRows = store.getTargets({ ky: monthKy(asOf), scope: {} });
  const revenue = new Map(grouped(monthRows.filter((r) => !EXCLUDED.has(upper(r.emp_code))), (r) => upper(r.emp_code), (r) => txt(r.emp_name) || upper(r.emp_code)).map((x) => [x.key, x]));
  return targetRows.map((t) => { const r = revenue.get(upper(t.emp_code)); const value = n(t.target); const actual = r?.revenue || 0; return { empCode: upper(t.emp_code), empName: r?.label || store.findUserByCode(upper(t.emp_code))?.name || upper(t.emp_code), target: value, revenue: actual, rate: value ? actual / value * 100 : null, gap: value - actual }; }).sort((a, b) => (a.rate ?? 999) - (b.rate ?? 999));
}

function cstOpportunity(monthRows) {
  const cstRows = store.getCst({ scope: {} }).filter((r) => n(r.remain_pct) > 0 && n(r.remain_amount) > 0);
  const revenuePair = new Map(); const routeByUnit = new Map();
  for (const r of monthRows) { const pair = `${txt(r.unit_code)}|${txt(r.iit_code)}`; revenuePair.set(pair, (revenuePair.get(pair) || 0) + n(r.revenue)); if (!routeByUnit.has(txt(r.unit_code)) && ROUTES.includes(upper(r.route))) routeByUnit.set(txt(r.unit_code), upper(r.route)); }
  const owners = (r) => [...new Set(`${r.emp_code || ''},${r.sales_emps || ''}`.split(',').map(upper).filter(Boolean))];
  const detail = cstRows.map((r) => ({ unitCode: txt(r.unit_code), unitName: txt(r.unit_name) || txt(r.unit_code), iitCode: txt(r.iit_code), productName: txt(r.product_name) || txt(r.iit_code), route: routeByUnit.get(txt(r.unit_code)) || UNCLASSIFIED, remainPct: n(r.remain_pct), remainAmount: n(r.remain_amount), remainQty: n(r.remain_qty), uom: txt(r.uom) || 'Chưa có dữ liệu', priority: txt(r.priority) || 'Chưa có dữ liệu', revenue: revenuePair.get(`${txt(r.unit_code)}|${txt(r.iit_code)}`) || 0, owners: owners(r) }));
  const aggregate = (keyFn, labelFn) => {
    const map = new Map();
    for (const r of detail) { const key = keyFn(r); const cur = map.get(key) || { key, label: labelFn(r), remainAmount: 0, revenue: 0, untouchedCount: 0, itemCount: 0, owners: new Set(), routes: new Set() }; cur.remainAmount += r.remainAmount; cur.revenue += r.revenue; cur.itemCount += 1; if (r.remainPct >= 99.95) cur.untouchedCount += 1; r.owners.forEach((x) => cur.owners.add(x)); cur.routes.add(r.route); map.set(key, cur); }
    return [...map.values()].map((x) => ({ ...x, owners: [...x.owners], routes: [...x.routes], opportunityRatio: x.revenue + x.remainAmount ? x.remainAmount / (x.revenue + x.remainAmount) * 100 : 0 })).sort((a, b) => b.remainAmount - a.remainAmount);
  };
  const units = aggregate((r) => r.unitCode, (r) => r.unitName);
  const products = aggregate((r) => r.iitCode, (r) => r.productName);
  const routes = aggregate((r) => r.route, (r) => r.route);
  return { source: 'App Report CST snapshot (cst_real + slot upload)', rowCount: detail.length, detail, units, products, routes, hotOpportunities: detail.slice().sort((a, b) => b.remainAmount - a.remainAmount).slice(0, 20), dormantOpportunities: detail.filter((x) => x.revenue === 0).sort((a, b) => b.remainAmount - a.remainAmount).slice(0, 20), untouched: detail.filter((x) => x.remainPct >= 99.95).sort((a, b) => b.remainAmount - a.remainAmount).slice(0, 20), warnings: ['Không cộng tổng số lượng CST giữa các sản phẩm/ĐVT khác nhau.', 'Giá trị dư địa dùng remain_amount từ snapshot CST đang hiển thị trong App Report.'] };
}

function recommendations(facts) {
  const cmp = facts.comparisons; const cst = facts.cstOpportunity; const targetSlow = facts.target.rows.find((x) => x.rate != null && x.rate < 80); const xuSlow = facts.scoreXu.monthlyWarnings[0];
  const issues = [];
  if (!facts.quality.canCompareExactly && facts.kind === 'week') issues.push({ severity: 'medium', title: 'Chưa đủ lịch sử dữ liệu ngày để so tuần chính xác', evidence: facts.quality.comparisonLabel, owner: 'Data/App Report', action: 'Tiếp tục tích lũy dữ liệu ngày; không nội suy số tuần.' });
  if (cmp.unit.valid && cmp.unit.down[0]) issues.push({ severity: 'high', title: `Đơn vị giảm: ${cmp.unit.down[0].label}`, evidence: cmp.unit.down[0].diff, owner: 'Sale phụ trách', action: 'Xác minh mất đơn, tồn kho và kế hoạch phục hồi.' });
  if (targetSlow) issues.push({ severity: 'high', title: `${targetSlow.empCode} chậm target tháng`, evidence: targetSlow.rate, owner: targetSlow.empCode, action: 'Chốt danh sách đơn vị/sản phẩm kéo target trong kỳ còn lại.' });
  if (xuSlow) issues.push({ severity: 'high', title: `${xuSlow.empCode} thiếu nhịp Xu tháng`, evidence: xuSlow.monthlyRate, owner: xuSlow.empCode, action: 'Rà soát hóa đơn đủ điều kiện và kế hoạch bổ sung Xu.' });
  if (facts.concentration.top5Share > 60) issues.push({ severity: 'medium', title: 'Doanh thu tập trung cao vào Top 5 đơn vị', evidence: facts.concentration.top5Share, owner: 'Trưởng Sale', action: 'Mở rộng độ phủ nhóm đơn vị hạng giữa.' });
  const opportunities = [];
  if (cst.routes[0]) opportunities.push({ priority: 'P1', title: `Khai thác dư địa tuyến ${cst.routes[0].label}`, evidence: cst.routes[0].remainAmount, owner: cst.routes[0].owners.slice(0, 4).join(', ') || 'Trưởng Sale', deadline: facts.kind === 'week' ? '7 ngày' : '30 ngày', action: 'Chọn đơn vị và sản phẩm CST lớn để lập kế hoạch bán cụ thể.' });
  if (cst.units[0]) opportunities.push({ priority: 'P1', title: cst.units[0].label, evidence: cst.units[0].remainAmount, owner: cst.units[0].owners.slice(0, 4).join(', ') || 'Sale phụ trách', deadline: facts.kind === 'week' ? '7 ngày' : '30 ngày', action: 'Làm việc lại nhu cầu, lịch dự trù và khả năng gọi hàng.' });
  if (cst.products[0]) opportunities.push({ priority: 'P1', title: cst.products[0].label, evidence: cst.products[0].remainAmount, owner: cst.products[0].owners.slice(0, 4).join(', ') || 'Sale phụ trách', deadline: facts.kind === 'week' ? '7 ngày' : '30 ngày', action: 'Mở rộng độ phủ sang các đơn vị có CST nhưng doanh số thấp.' });
  const actions = [...opportunities.slice(0, 3), ...issues.slice(0, 2).map((x, i) => ({ priority: `R${i + 1}`, title: x.title, evidence: x.evidence, owner: x.owner, deadline: facts.kind === 'week' ? '7 ngày' : '30 ngày', action: x.action }))];
  return { issues, opportunities, actions };
}

async function build({ kind = 'week', asOf } = {}) {
  if (!['week', 'month'].includes(kind)) throw new Error(`Unsupported V2 deck kind: ${kind}`);
  const dataAsOf = asOf || salesReport.defaultRanges().asOf;
  const p = periods(kind, dataAsOf);
  const currentRows = rowsInRange(p.current); const previousRows = rowsInRange(p.previous); const monthRows = rowsInRange(p.monthContext); const quarterRows = rowsInRange(p.quarterContext);
  const currentQuality = granularityFor(p.current); const previousQuality = granularityFor(p.previous);
  const canCompareExactly = kind === 'week' ? currentQuality.exact && previousQuality.exact : false;
  const scale = kind === 'month' ? dayOfMonth(dataAsOf) / daysInMonth(p.previous.from) : 1;
  const comparisonValid = kind === 'month' || canCompareExactly;
  const previousRevenueRaw = sumRevenue(previousRows); const comparisonRevenue = comparisonValid ? previousRevenueRaw * scale : null; const totalRevenue = sumRevenue(currentRows); const deltaRevenue = comparisonValid ? totalRevenue - comparisonRevenue : null; const deltaPct = comparisonValid && comparisonRevenue ? deltaRevenue / comparisonRevenue * 100 : null;
  const keyFns = { route: canonicalRoute, sourceGroup, customerType, therapy, employee: (r) => upper(r.emp_code), unit: (r) => txt(r.unit_code), product: (r) => txt(r.iit_code), contractor: (r) => txt(r.contractor_code) || '—' };
  const labelFns = { route: canonicalRoute, sourceGroup, customerType, therapy, employee: (r) => txt(r.emp_name) || upper(r.emp_code), unit: (r) => txt(r.unit_name) || txt(r.unit_code), product: (r) => txt(r.product_name) || txt(r.iit_code), contractor: (r) => txt(r.contractor_code) || '—' };
  const eligibleCurrent = currentRows.filter((r) => !EXCLUDED.has(upper(r.emp_code))); const eligiblePrevious = previousRows.filter((r) => !EXCLUDED.has(upper(r.emp_code)));
  const dimensions = {};
  for (const k of ['route', 'sourceGroup', 'customerType', 'therapy', 'employee', 'unit', 'product', 'contractor']) dimensions[k] = grouped(k === 'employee' ? eligibleCurrent : currentRows, keyFns[k], labelFns[k]);
  const comparisons = {};
  for (const k of ['route', 'sourceGroup', 'employee', 'unit', 'product']) comparisons[k] = compared(k === 'employee' ? eligibleCurrent : currentRows, k === 'employee' ? eligiblePrevious : previousRows, keyFns[k], labelFns[k], scale, comparisonValid);
  const trends = monthlyTrend(dataAsOf, 7);
  const score = scoreXu(monthRows, p);
  const targetRows = targets(monthRows, dataAsOf);
  const cst = cstOpportunity(monthRows);
  const top5Share = dimensions.unit.slice(0, 5).reduce((s, x) => s + x.revenue, 0) / (totalRevenue || 1) * 100;
  const groupMappedRevenue = dimensions.sourceGroup.filter((x) => x.key !== UNKNOWN_GROUP).reduce((s, x) => s + x.revenue, 0);
  const facts = {
    schemaVersion: SCHEMA_VERSION, kind, scope: 'CEO', generatedAt: new Date().toISOString(), dataAsOf, period: { ...p, currentLabel: kind === 'week' ? `${p.current.from} → ${p.current.to}` : `${p.current.from} → ${p.current.to}`, comparisonMethod: kind === 'week' ? (canCompareExactly ? 'exact-week' : 'insufficient-daily-history') : 'calendar-paced', comparisonLabel: kind === 'week' ? (canCompareExactly ? `${p.current.from}–${p.current.to} so với ${p.previous.from}–${p.previous.to}` : 'Không đủ dữ liệu ngày để so sánh tuần chính xác') : `${monthShort(p.current.from)} MTD so với nhịp lịch ${dayOfMonth(dataAsOf)}/${daysInMonth(p.previous.from)} của ${monthShort(p.previous.from)}` },
    quality: { currentGranularity: currentQuality.label, previousGranularity: previousQuality.label, canCompareExactly, comparisonValid, comparisonLabel: kind === 'week' && !canCompareExactly ? 'Kỳ trước giao tháng, không đủ dữ liệu ngày để so sánh tuần chính xác.' : (kind === 'month' ? 'Kỳ đối chiếu là nhịp ước theo ngày lịch, không phải doanh thu thực ngày 1→D.' : 'So sánh tuần chính xác.'), dataAsOf, mappingCoverage: totalRevenue ? groupMappedRevenue / totalRevenue * 100 : 0, warnings: [] },
    totals: { companyRevenue: totalRevenue, comparisonRevenue, previousRevenueRaw, deltaRevenue, deltaPct, rowCount: currentRows.length, unitCount: dimensions.unit.length, productCount: dimensions.product.length, eligibleEmployeeRevenue: sumRevenue(eligibleCurrent), excludedEmployeeRevenue: totalRevenue - sumRevenue(eligibleCurrent) },
    timeline: { daily: dailySeries(currentRows, p.current), monthly: trends, quarterly: quarterlyTrend(trends), routeMonthly: dimensionMonthlyTrend(trends, canonicalRoute), groupMonthly: dimensionMonthlyTrend(trends, sourceGroup) },
    dimensions, comparisons, scoreXu: score, target: { rows: targetRows, slow: targetRows.filter((x) => x.rate != null && x.rate < 80), near: targetRows.filter((x) => x.rate != null && x.rate >= 80 && x.rate < 100) }, cstOpportunity: cst,
    concentration: { top5Share, top10Share: dimensions.unit.slice(0, 10).reduce((s, x) => s + x.revenue, 0) / (totalRevenue || 1) * 100 },
    context: { monthRevenue: sumRevenue(monthRows), quarterRevenue: sumRevenue(quarterRows), monthLabel: monthShort(dataAsOf), quarterLabel: quarterLabel(dataAsOf) },
    company: { coverName: 'GROUP DONAPHARM', legalName: 'CÔNG TY CỔ PHẦN DONAPHARM', address: 'C1A, khu phố 35, phường Tam Hiệp, Thành phố Đồng Nai, Việt Nam', taxCode: '3603611886', hotline: '0886.396.668', ceo: 'Đặng Xuân Trung', website: 'www.donapharm.vn', emails: ['info@donapharm.vn', 'cskh@donapharm.vn', 'hoadon@donapharm.vn'], tagline: 'Chất lượng cuộc sống' },
    assets: { logo: 'artifacts/private/company/dnpharma-logo-transparent.png', qr: 'artifacts/private/company/dnpharma-qr.png', signatureWhite: 'artifacts/private/company/ceo-dang-xuan-trung-signature-white.png', signatureNavy: 'artifacts/private/company/ceo-dang-xuan-trung-signature-navy.png' },
  };
  const rec = recommendations(facts); facts.issues = rec.issues; facts.opportunities = rec.opportunities; facts.recommendations = rec.actions;
  facts.quality.warnings = [facts.quality.comparisonLabel, ...cst.warnings];
  return facts;
}

module.exports = { build, periods, sourceGroup, canonicalRoute, customerType, grouped, compared, rowsInRange, granularityFor, SCHEMA_VERSION, UNKNOWN_GROUP };
