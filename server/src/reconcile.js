/**
 * reconcile.js — ĐỐI SOÁT TÍNH TOÀN VẸN dữ liệu doanh thu Report-New (theo NV/kỳ).
 *
 * Mục tiêu (CEO yêu cầu sau vụ DN009 mất 3 đơn vị): TỰ phát hiện lệch, đừng đợi NV báo.
 * Kiểm 4 lớp trên slot đang active của 1 kỳ — ĐỌC FILE GỐC (trước khi store kéo biên) để
 * bắt đúng "dấu vân tay" của lỗi ngày:
 *   1) dateOutOfBand  — dòng có NGÀY ngoài [dateFrom,dateTo] của kỳ (gốc lỗi 01/07→30/06).
 *   2) metaMismatch   — số dòng / doanh thu trong metadata slot ≠ thực tế file (rớt/đếm sai).
 *   3) duplicateLines — trùng source_line_id (đếm trùng doanh thu).
 *   4) unitDrop       — theo từng NV, đơn vị CÓ doanh thu kỳ trước nhưng BIẾN MẤT kỳ này.
 *
 * KHÔNG cần DB Sale-New: chạy hoàn toàn trên dữ liệu Report-New nên bật được qua API admin.
 * Phần đối soát sâu với DB nguồn nằm ở scripts/reconcile_revenue.js (chỉ chạy trên server bot).
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const readJson = (name, def) => {
  const p = path.join(DATA_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def;
};
const num = (v) => Number(v || 0);
const d10 = (v) => String(v == null ? '' : v).slice(0, 10);
// Ngày GỐC của 1 dòng, đúng thứ tự field như store.slotRows (trước khi kéo biên).
function rawDate(r) {
  return d10(r.date || r.ngay || r.order_date || r.invoice_date || r.created_at || '');
}
function activeSlotsForKy(ky) {
  return readJson('upload_slots.json', []).filter((s) => s.active && (!ky || s.ky === ky));
}
function rawSlotRows(slot) {
  const p = path.join(UP_DIR, slot.id + '.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

/** Đối soát 1 kỳ. Trả JSON gọn để hiển thị/đẩy cảnh báo. */
function reconcileKy(ky) {
  const targetKy = ky || store.latestKy();
  const slots = activeSlotsForKy(targetKy);
  const checkedAt = new Date().toISOString();
  if (!slots.length) {
    return { ky: targetKy, checkedAt, ok: false, hasSlot: false, note: `Không có slot active cho kỳ ${targetKy}` };
  }

  const dateOutOfBand = [];
  const duplicateLines = [];
  const metaMismatch = [];
  const seenLineId = new Map();

  for (const slot of slots) {
    const from = d10(slot.dateFrom);
    const to = d10(slot.dateTo);
    const raw = rawSlotRows(slot);
    let sumRev = 0;
    const oob = [];
    for (const r of raw) {
      sumRev += num(r.revenue);
      const dt = rawDate(r);
      if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(dt) && (dt < from || dt > to)) {
        oob.push({
          date: dt, side: dt < from ? 'before' : 'after',
          emp_code: r.emp_code || '', emp_name: r.emp_name || '',
          unit_code: r.unit_code || '', unit_name: r.unit_name || '',
          source: r.source || '', source_line_id: r.source_line_id || '', revenue: num(r.revenue),
        });
      }
      const lid = r.source_line_id;
      if (lid) {
        if (seenLineId.has(lid)) duplicateLines.push({ source_line_id: lid, unit_code: r.unit_code || '', revenue: num(r.revenue) });
        else seenLineId.set(lid, true);
      }
    }
    // Gom dateOutOfBand theo đơn vị để dễ đọc (đây là ca DN009).
    const byUnit = new Map();
    for (const x of oob) {
      const k = x.unit_code || x.unit_name || '?';
      const g = byUnit.get(k) || { unit_code: x.unit_code, unit_name: x.unit_name, rows: 0, revenue: 0, dates: new Set(), emps: new Set(), side: x.side };
      g.rows += 1; g.revenue += x.revenue; g.dates.add(x.date); if (x.emp_code) g.emps.add(x.emp_code);
      byUnit.set(k, g);
    }
    for (const g of byUnit.values()) {
      dateOutOfBand.push({ slot: slot.id, ...g, unit_name: g.unit_name || g.unit_code, dates: [...g.dates].sort(), emps: [...g.emps], side: g.side });
    }
    // Metadata vs thực tế.
    const metaRows = num(slot.totalRows), metaRev = num(slot.totalRevenue);
    if (metaRows && metaRows !== raw.length) metaMismatch.push({ slot: slot.id, field: 'totalRows', meta: metaRows, actual: raw.length });
    if (metaRev && Math.abs(metaRev - sumRev) > 1) metaMismatch.push({ slot: slot.id, field: 'totalRevenue', meta: metaRev, actual: Math.round(sumRev) });
  }

  // Lớp 4: đơn vị của từng NV biến mất so với kỳ trước (cảnh báo sớm kiểu DN009).
  const prevKy = (store.previousKys([targetKy]) || [])[0] || null;
  const unitDrop = prevKy ? nvUnitDrop(prevKy, targetKy) : [];

  const issues = dateOutOfBand.length + duplicateLines.length + metaMismatch.length + unitDrop.length;
  return {
    ky: targetKy, prevKy, checkedAt, ok: issues === 0, hasSlot: true,
    slots: slots.map((s) => ({ id: s.id, dateFrom: s.dateFrom, dateTo: s.dateTo, totalRows: s.totalRows, totalRevenue: s.totalRevenue })),
    summary: {
      issues,
      dateOutOfBand: dateOutOfBand.length,
      duplicateLines: duplicateLines.length,
      metaMismatch: metaMismatch.length,
      unitDrop: unitDrop.length,
    },
    dateOutOfBand, duplicateLines, metaMismatch, unitDrop,
  };
}

/** Theo từng NV: đơn vị có doanh thu>0 kỳ trước nhưng không còn kỳ này. */
function nvUnitDrop(prevKy, ky) {
  const key = (emp, unit) => `${emp}|${unit}`;
  const rollup = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (num(r.revenue) <= 0) continue;
      const emp = r.emp_code || '', unit = r.unit_code || '';
      if (!emp || !unit) continue;
      m.set(key(emp, unit), { emp_code: emp, emp_name: r.emp_name || '', unit_code: unit, unit_name: r.unit_name || unit, revenue: num(r.revenue) });
    }
    return m;
  };
  const prev = rollup(store.getRows({ ky: prevKy, scope: {} }));
  const curKeys = new Set([...rollup(store.getRows({ ky, scope: {} })).keys()]);
  const byNv = new Map();
  for (const [k, v] of prev) {
    if (curKeys.has(k)) continue;
    const g = byNv.get(v.emp_code) || { emp_code: v.emp_code, emp_name: v.emp_name, prevKy, units: [] };
    g.units.push({ unit_code: v.unit_code, unit_name: v.unit_name, prevRevenue: Math.round(v.revenue) });
    byNv.set(v.emp_code, g);
  }
  return [...byNv.values()].sort((a, b) => b.units.length - a.units.length);
}

module.exports = { reconcileKy, nvUnitDrop };
