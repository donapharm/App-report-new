/**
 * analytics.js — Tổng hợp doanh thu / cơ số thầu / target.
 * Mọi số liệu tính ở đây (không để LLM/frontend tự tính).
 */
const store = require('./store');

const VAT_DIVISOR = 1.05; // doanh thu trước VAT = sau VAT / 1.05

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

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
function applyFilters(rows, f = {}) {
  const q = norm(f.q || '');
  return rows.filter((r) => {
    if (f.emp && r.emp_code !== f.emp) return false;
    if (f.unit && r.unit_code !== f.unit) return false;
    if (f.product && r.iit_code !== f.product) return false;
    if (f.route && r.route !== f.route) return false;
    if (f.priority && r.priority !== f.priority) return false;
    if (f.contractor && r.contractor_code !== f.contractor) return false;
    if (f.bid && !String(r.bid_package || '').includes(f.bid)) return false;
    if (q) {
      const hay = norm([r.emp_code, r.emp_name, r.unit_code, r.unit_name, r.iit_code, r.product_name, r.contractor_code, r.bid_package].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** KPI tổng quan cho 1 kỳ trong phạm vi quyền. */
function overviewKpis({ ky, scope }) {
  const rows = store.getRows({ ky, scope });
  const revenue = sum(rows, (r) => r.revenue);
  const targets = store.getTargets({ ky, scope });
  const targetTotal = sum(targets, (t) => t.target);
  const revenueBeforeVat = revenue / VAT_DIVISOR;
  const pctTarget = targetTotal > 0 ? +(revenueBeforeVat / targetTotal * 100).toFixed(1) : null;

  // so với kỳ liền trước (MoM)
  const periods = store.listPeriods().map((p) => p.ky);
  const idx = periods.indexOf(ky);
  let momPct = null;
  if (idx > 0) {
    const prevRev = sum(store.getRows({ ky: periods[idx - 1], scope }), (r) => r.revenue);
    if (prevRev > 0) momPct = +(((revenue - prevRev) / prevRev) * 100).toFixed(1);
  }
  return {
    ky,
    revenue,
    revenueBeforeVat: Math.round(revenueBeforeVat),
    targetTotal,
    pctTarget,
    momPct,
    empCount: new Set(rows.map((r) => r.emp_code)).size,
    unitCount: new Set(rows.map((r) => r.unit_code)).size,
    productCount: new Set(rows.map((r) => r.iit_code)).size,
    rowCount: rows.length,
  };
}

/** Doanh thu drill-down: 'emp' | 'unit' | 'product'. */
function revenueBreakdown({ ky, scope, dimension, filterEmp, filterUnit, filters }) {
  let rows = store.getRows({ ky, scope });
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
    rows = rows.filter((r) => norm([r.emp_code, r.sales_emps, r.unit_name, r.iit_code, r.product_name, r.active_ingredient, r.bid_package, r.priority].join(' ')).includes(q));
  }
  if (remainPctMax != null) rows = rows.filter((r) => r.remain_pct <= remainPctMax);
  if (remainPctMin != null) rows = rows.filter((r) => r.remain_pct >= remainPctMin);
  return rows.sort((a, b) => a.remain_pct - b.remain_pct);
}

module.exports = { VAT_DIVISOR, sum, overviewKpis, revenueBreakdown, cstTable, groupSum, applyFilters };
