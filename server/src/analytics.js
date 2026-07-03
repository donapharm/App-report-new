/**
 * analytics.js — Tổng hợp doanh thu / cơ số thầu / target.
 * Mọi số liệu tính ở đây (không để LLM/frontend tự tính).
 */
const store = require('./store');

const VAT_DIVISOR = 1.05; // doanh thu trước VAT = sau VAT / 1.05

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
function kyParts(ky) {
  const [mm, yyyy] = String(ky || '').split('.').map(Number);
  return { mm, yyyy };
}
function isCurrentKy(ky, d = new Date()) {
  const { mm, yyyy } = kyParts(ky);
  return mm === d.getMonth() + 1 && yyyy === d.getFullYear();
}
function targetPacingMeta(ky, d = new Date()) {
  const { mm, yyyy } = kyParts(ky);
  const daysInMonth = mm && yyyy ? new Date(yyyy, mm, 0).getDate() : 30;
  const current = isCurrentKy(ky, d);
  const daysElapsed = current ? Math.min(d.getDate(), daysInMonth) : daysInMonth;
  return { isCurrent: current, daysElapsed, daysInMonth, factor: daysInMonth ? daysElapsed / daysInMonth : 1 };
}
function targetCompareValue(targetFull, ky, d = new Date()) {
  const meta = targetPacingMeta(ky, d);
  return Math.round(Number(targetFull || 0) * (meta.isCurrent ? meta.factor : 1));
}

function groupSum(rows, keyField, labelField) {
  const map = new Map();
  for (const r of rows) {
    const key = r[keyField];
    if (key == null) continue;
    const cur = map.get(key) || { key, label: r[labelField] || key, revenue: 0, quantity: 0, rows: 0 };
    cur.revenue += r.revenue || 0;
    cur.quantity += r.quantity || 0;
    cur.rows += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
// Gộp mã đơn vị để đếm ĐÚNG số đơn vị: bỏ tiền tố "NT-" (nhà thuốc của cùng bệnh viện)
// → "001.BVĐK Thống Nhất" và "001.NT-BVĐK Thống Nhất" tính LÀ 1 đơn vị.
// KHÔNG gộp theo số đầu: "033.PKĐK An Long Khánh" vs "033.PKĐK An Long Thành" là 2 PK khác nhau.
function baseUnitKey(u) {
  const s = String(u || '').trim();
  const stripped = s.replace(/^(\s*\d+[.\-]?\s*)NT[\s.\-]+/i, '$1');
  return norm(stripped).replace(/\s+/g, ' ').trim() || norm(s);
}
function applyFilters(rows, f = {}) {
  const q = norm(f.q || '');
  const from = f.dateFrom ? String(f.dateFrom).slice(0, 10) : '';
  const to = f.dateTo ? String(f.dateTo).slice(0, 10) : '';
  return rows.filter((r) => {
    if (f.emp && r.emp_code !== f.emp) return false;
    if (f.unit && r.unit_code !== f.unit) return false;
    if (f.product && r.iit_code !== f.product) return false;
    if (f.route && r.route !== f.route) return false;
    if (f.priority && r.priority !== f.priority) return false;
    if (f.contractor && r.contractor_code !== f.contractor) return false;
    if (f.bid && !String(r.bid_package || '').includes(f.bid)) return false;
    if (from || to) {
      const granular = r.date_granularity === 'day';
      if (granular) {
        const d = String(r.date || '').slice(0, 10);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      } else {
        // Legacy 01–06 imports only have period-level totals. Do not fake day allocation:
        // include them only when the requested date range covers the whole source period.
        const a = String(r.source_date_from || r.date || '').slice(0, 10);
        const b = String(r.source_date_to || r.date || '').slice(0, 10);
        if ((from && a && from > a) || (to && b && to < b)) return false;
      }
    }
    if (q) {
      const hay = norm([r.emp_code, r.emp_name, r.unit_code, r.unit_name, r.iit_code, r.product_name, r.contractor_code, r.contractor_name, r.bid_package, r.priority].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const normKys = ({ ky, kys }) => (Array.isArray(kys) && kys.length ? kys : [ky || store.latestKy()]);
const overviewCache = new Map();
const OVERVIEW_CACHE_MS = 60 * 1000;
function clearOverviewCache() { overviewCache.clear(); }

/** KPI tổng quan cho 1 kỳ hoặc nhiều kỳ trong phạm vi quyền. */
function overviewKpis({ ky, kys, scope, label }) {
  const list = normKys({ ky, kys });
  const cacheKey = JSON.stringify({ list, empCode: scope?.empCode || null, label: label || '' });
  const cached = overviewCache.get(cacheKey);
  if (cached && Date.now() - cached.at < OVERVIEW_CACHE_MS) return cached.value;
  const rows = store.getRowsRange({ kys: list, scope });
  const revenue = sum(rows, (r) => r.revenue);
  const targets = store.getTargetsRange({ kys: list, scope });
  const targetTotal = sum(targets, (t) => t.target);
  const revenueBeforeVat = revenue / VAT_DIVISOR;
  // DIRECTIVE_TARGET_KPI: KPI chính so với target CẢ THÁNG, không dùng pacing làm mẫu số.
  const pctTarget = targetTotal > 0 ? +(revenueBeforeVat / targetTotal * 100).toFixed(1) : null;
  const targetByEmp = {};
  for (const t of targets) targetByEmp[t.emp_code] = (targetByEmp[t.emp_code] || 0) + Number(t.target || 0);
  const revenueBeforeVatByEmp = {};
  for (const r of rows) revenueBeforeVatByEmp[r.emp_code] = (revenueBeforeVatByEmp[r.emp_code] || 0) + Number(r.revenue || 0) / VAT_DIVISOR;
  const empTarget = { achieved: 0, total: 0 };
  for (const u of store.targetRoster({ scope })) {
    const empCode = u.emp_code;
    const target = Number(targetByEmp[empCode] || 0);
    if (target <= 0) continue;
    const empRevBeforeVat = revenueBeforeVatByEmp[empCode] || 0;
    empTarget.total += 1;
    if (empRevBeforeVat >= target) empTarget.achieved += 1;
  }
  const cstLowCount = store.getCst({ scope }).filter((r) => Number(r.remain_pct || 0) < 10).length;

  // so với kỳ liền trước cùng độ dài (MoM/range-over-range)
  let momPct = null;
  const prevKys = store.previousKys(list);
  if (prevKys.length === list.length) {
    const prevRev = sum(store.getRowsRange({ kys: prevKys, scope }), (r) => r.revenue);
    if (prevRev > 0) momPct = +(((revenue - prevRev) / prevRev) * 100).toFixed(1);
  }
  const value = {
    ky: list[list.length - 1],
    kys: list,
    label,
    revenue,
    revenueBeforeVat: Math.round(revenueBeforeVat),
    targetTotal,
    targetCompareTotal: targetTotal,
    pctTarget,
    empTarget,
    cstLowCount,
    momPct,
    empCount: new Set(rows.map((r) => r.emp_code)).size,
    unitCount: new Set(rows.map((r) => baseUnitKey(r.unit_code || r.unit_name))).size,
    productCount: new Set(rows.map((r) => r.iit_code)).size,
    rowCount: rows.length,
  };
  overviewCache.set(cacheKey, { at: Date.now(), value });
  if (overviewCache.size > 200) overviewCache.clear();
  return value;
}

/** Doanh thu drill-down: 'emp' | 'unit' | 'product'. */
function revenueBreakdown({ ky, kys, scope, dimension, filterEmp, filterUnit, filters }) {
  let rows = store.getRowsRange({ kys: normKys({ ky, kys }), scope });
  if (filterEmp) rows = rows.filter((r) => r.emp_code === filterEmp);
  if (filterUnit) rows = rows.filter((r) => r.unit_code === filterUnit);
  rows = applyFilters(rows, filters);
  if (dimension === 'unit') return groupSum(rows, 'unit_code', 'unit_name');
  if (dimension === 'product') return groupSum(rows, 'iit_code', 'product_name');
  return groupSum(rows, 'emp_code', 'emp_name'); // mặc định theo NV
}

/** Bảng cơ số thầu + cảnh báo ngưỡng. */
function cstTable({ scope, remainPctMax, remainPctMin, bidPackage, filters }) {
  let rows = store.getCst({ scope });
  if (bidPackage) rows = rows.filter((r) => String(r.bid_package || '').includes(bidPackage));
  if (filters?.emp) {
    const emp = String(filters.emp).trim().toUpperCase();
    rows = rows.filter((r) => String(r.emp_code || '').split(',').map((x) => x.trim().toUpperCase()).includes(emp));
  }
  if (filters?.unit) rows = rows.filter((r) => r.unit_code === filters.unit || r.unit_name === filters.unit);
  if (filters?.product) rows = rows.filter((r) => r.iit_code === filters.product);
  if (filters?.priority) rows = rows.filter((r) => r.priority === filters.priority);
  if (filters?.status === 'empty') rows = rows.filter((r) => Number(r.sold_qty || 0) === 0 && Number(r.remain_qty || 0) > 0);
  if (filters?.q) {
    const q = norm(filters.q);
    rows = rows.filter((r) => norm([r.emp_code, r.sales_emps, r.unit_name, r.iit_code, r.product_name, r.active_ingredient, r.contractor_code, r.contractor_name, r.bid_package, r.priority].join(' ')).includes(q));
  }
  if (remainPctMax != null) rows = rows.filter((r) => r.remain_pct <= remainPctMax);
  if (remainPctMin != null) rows = rows.filter((r) => r.remain_pct >= remainPctMin);
  return rows.sort((a, b) => a.remain_pct - b.remain_pct);
}

module.exports = { VAT_DIVISOR, sum, overviewKpis, revenueBreakdown, cstTable, groupSum, applyFilters, baseUnitKey, isCurrentKy, targetPacingMeta, targetCompareValue, clearOverviewCache };
