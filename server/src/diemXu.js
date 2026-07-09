/**
 * diemXu.js — tính ĐIỂM doanh thu (từ dữ liệu App Report-New) + XU (từ App VAT vat.db).
 * Công thức chốt từ T05/2026 — xem SPEC_DIEM_XU_TICH_LUY.md.
 *   Điểm dòng  = doanh thu × hệ số / 100.000.000  (CL/NT=2; NCL ngoại lệ 025-028=2; NCL thường=1)
 *   Xu         = số tiền tính xu / 500.000 × 1,3   (từ vat.db bảng vat_bills)
 * LOẠI trừ khỏi điểm/xu (CEO chốt 2026-07-09): DN021, DN022, DN023, VP004, VP018.
 */
const store = require('./store');

const POINT_EXCEPTION_UNITS = new Set(['025', '026', '027', '028']);
const XU_BASE = 500000, XU_PER = 1.3;
const VAT_DB = process.env.VAT_DB_PATH || '/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/vat.db';
const EXCLUDE = new Set(['DN021', 'DN022', 'DN023', 'VP004', 'VP018']);

const isExcluded = (emp) => EXCLUDE.has(String(emp || '').trim().toUpperCase());
function unitPrefix(v = '') { const m = String(v).trim().match(/^(\d{3})[.\-\s_]/); return m ? m[1] : ''; }
function pointMultiplier(row) {
  const route = String(row.route || '').toUpperCase();
  if (route === 'CL' || route === 'NT') return 2;
  if (route === 'NCL' && POINT_EXCEPTION_UNITS.has(unitPrefix(row.unit_code || row.unit_name))) return 2;
  return 1;
}
function revenuePoints(row) { return Number(row.revenue || 0) / 1e8 * pointMultiplier(row); }

// Tổng ĐIỂM theo NV cho 1 khoảng kỳ (kys) — dùng slot App Report-New. Trả map empCode -> điểm.
function pointsByEmp({ kys, empCode } = {}) {
  const rows = store.getRowsRange({ kys, scope: {} });
  const out = {};
  for (const r of rows) {
    const ec = String(r.emp_code || '').trim().toUpperCase();
    if (!ec || isExcluded(ec)) continue;
    if (empCode && ec !== String(empCode).toUpperCase()) continue;
    out[ec] = (out[ec] || 0) + revenuePoints(r);
  }
  return out;
}

// XU từ vat.db (node:sqlite built-in Node 22). Trả map empCode -> {bill_count, amount, xu, emp_name}.
// Lọc: hidden_at rỗng + date(ngay) trong [from,to]. (Chưa khoá trang_thai_hd cho tới khi Finance xác nhận.)
function readVatXu({ from, to, empCode } = {}) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch (e) { console.warn('[diemXu] node:sqlite không dùng được:', e.message); return {}; }
  let db;
  try { db = new DatabaseSync(VAT_DB, { readOnly: true }); }
  catch (e) { console.warn('[diemXu] không mở được vat.db:', e.message); return {}; }
  try {
    const where = ["IFNULL(hidden_at,'')=''", 'date(ngay) BETWEEN date(?) AND date(?)'];
    const params = [from, to];
    if (empCode) { where.push('emp_code=?'); params.push(String(empCode).toUpperCase()); }
    const sql = `SELECT emp_code, emp_name, COUNT(*) bill_count,
        SUM(COALESCE(NULLIF(tong_tien,0), so_tien, 0)) amount,
        SUM(COALESCE(NULLIF(tong_tien,0), so_tien, 0))/${XU_BASE}.0*${XU_PER} xu
      FROM vat_bills WHERE ${where.join(' AND ')} GROUP BY emp_code, emp_name`;
    const out = {};
    for (const r of db.prepare(sql).all(...params)) {
      const ec = String(r.emp_code || '').trim().toUpperCase();
      if (!ec || isExcluded(ec)) continue;
      out[ec] = { bill_count: Number(r.bill_count || 0), amount: Number(r.amount || 0), xu: Number(r.xu || 0), emp_name: r.emp_name || '' };
    }
    return out;
  } catch (e) { console.warn('[diemXu] query vat_bills lỗi:', e.message); return {}; }
  finally { try { db.close(); } catch { /* ignore */ } }
}

// Bảng điểm+xu 1 NV: tháng + quý (+ tuần nếu truyền weekKys). carry = xu dư quý trước (chưa có nguồn -> 0).
function scoreForEmp({ empCode, monthKys, quarterKys, weekRange, monthRange, quarterRange, carryXu = 0 }) {
  const emp = String(empCode).toUpperCase();
  const diemThang = (pointsByEmp({ kys: monthKys, empCode: emp })[emp] || 0);
  const diemQuy = (pointsByEmp({ kys: quarterKys, empCode: emp })[emp] || 0);
  const xuThang = (readVatXu({ ...monthRange, empCode: emp })[emp]?.xu || 0);
  const xuQuyPS = (readVatXu({ ...quarterRange, empCode: emp })[emp]?.xu || 0);
  const xuTuan = weekRange ? (readVatXu({ ...weekRange, empCode: emp })[emp]?.xu || 0) : null;
  const xuTongQuy = xuQuyPS + Number(carryXu || 0);
  const thieuDu = xuTongQuy - diemQuy;
  return {
    emp_code: emp,
    diem_thang: +diemThang.toFixed(4), diem_quy: +diemQuy.toFixed(4),
    xu_tuan: xuTuan == null ? null : +xuTuan.toFixed(4),
    xu_thang: +xuThang.toFixed(4), xu_quy_phat_sinh: +xuQuyPS.toFixed(4),
    xu_du_quy_truoc: +Number(carryXu || 0).toFixed(4), xu_tong_quy: +xuTongQuy.toFixed(4),
    thieu_xu: +Math.max(0, -thieuDu).toFixed(4), du_xu: +Math.max(0, thieuDu).toFixed(4),
    ty_le_quy: diemQuy > 0 ? +(xuTongQuy / diemQuy * 100).toFixed(1) : null,
  };
}

module.exports = { revenuePoints, pointMultiplier, pointsByEmp, readVatXu, scoreForEmp, isExcluded, EXCLUDE, VAT_DB, XU_BASE, XU_PER };
