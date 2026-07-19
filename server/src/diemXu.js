/**
 * diemXu.js — tính ĐIỂM doanh thu (từ dữ liệu App Report-New) + XU (từ App VAT vat.db).
 * Công thức chốt từ T05/2026 — xem SPEC_DIEM_XU_TICH_LUY.md.
 *   Điểm dòng  = doanh thu × hệ số / 100.000.000  (CL/NT=2; NCL ngoại lệ 025-028=2; NCL thường=1)
 *   Xu         = số tiền tính xu / 500.000 × 1,3   (từ vat.db bảng vat_bills)
 * LOẠI trừ khỏi điểm/xu (CEO chốt 2026-07-09): DN021, DN022, DN023, VP004, VP018.
 *
 * KHÓA CỨNG CEO chốt 2026-07-19 — CEO_XU_TO_DN001_ONLY:
 * - Chỉ trong phép tính XU của báo cáo Điểm/Xu, DN001 được cộng các dòng VAT emp_code=CEO.
 * - Điểm của DN001 vẫn chỉ lấy doanh thu emp_code=DN001.
 * - Không được dùng alias này cho danh tính, quyền, tài khoản, người nhận, hóa đơn gốc, audit
 *   hoặc bất kỳ nghiệp vụ nào khác; CEO và DN001 luôn là hai mã tách biệt ngoài phép tính trên.
 */
const store = require('./store');

const POINT_EXCEPTION_UNITS = new Set(['025', '026', '027', '028']);
const XU_BASE = 500000, XU_PER = 1.3;
const VAT_DB = process.env.VAT_DB_PATH || '/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/vat.db';
const EXCLUDE = new Set(['DN021', 'DN022', 'DN023', 'VP004', 'VP018']);
const CEO_XU_TO_DN001_ONLY = 'CEO_XU_TO_DN001_ONLY';
const CEO_VAT_CODE = 'CEO';
const CEO_SALES_CODE = 'DN001';

const isExcluded = (emp) => EXCLUDE.has(String(emp || '').trim().toUpperCase());
function unitPrefix(v = '') { const m = String(v).trim().match(/^(\d{3})[.\-\s_]/); return m ? m[1] : ''; }
function pointMultiplier(row) {
  const route = String(row.route || '').toUpperCase();
  if (route === 'CL' || route === 'NT') return 2;
  if (route === 'NCL' && POINT_EXCEPTION_UNITS.has(unitPrefix(row.unit_code || row.unit_name))) return 2;
  return 1;
}
function revenuePoints(row) { return Number(row.revenue || 0) / 1e8 * pointMultiplier(row); }

// Danh sách ky "MM.YYYY" phủ khoảng [from,to] (YYYY-MM-DD).
function kysSpanning(from, to) {
  const [fy, fm] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
  const out = []; let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) { out.push(`${String(m).padStart(2, '0')}.${y}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
// Tổng ĐIỂM theo NV cho 1 khoảng kỳ (kys). Trả map empCode -> điểm.
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
// ĐIỂM theo NV, lũy kế theo KHOẢNG NGÀY [from,to] (lọc từng dòng theo ngày). Trả map empCode -> điểm.
function pointsByEmpRange({ from, to, empCode } = {}) {
  const rows = store.getRowsRange({ kys: kysSpanning(from, to), scope: {} });
  const out = {};
  for (const r of rows) {
    const d = String(r.date || '').slice(0, 10);
    if (!d || d < from || d > to) continue;
    const ec = String(r.emp_code || '').trim().toUpperCase();
    if (!ec || isExcluded(ec)) continue;
    if (empCode && ec !== String(empCode).toUpperCase()) continue;
    out[ec] = (out[ec] || 0) + revenuePoints(r);
  }
  return out;
}

// XU từ vat.db (node:sqlite built-in Node 22). Trả map đúng mã gốc
// empCode -> {bill_count, amount, xu, emp_name}; tuyệt đối không alias trong hàm đọc chung.
// Lọc: hidden_at rỗng + date(ngay) trong [from,to]. (Chưa khoá trang_thai_hd cho tới khi Finance xác nhận.)
function queryVatXuExact({ from, to, exactEmpCodes } = {}) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch (e) { console.warn('[diemXu] node:sqlite không dùng được:', e.message); return {}; }
  let db;
  try { db = new DatabaseSync(VAT_DB, { readOnly: true }); }
  catch (e) { console.warn('[diemXu] không mở được vat.db:', e.message); return {}; }
  try {
    const where = ["IFNULL(hidden_at,'')=''", 'date(ngay) BETWEEN date(?) AND date(?)'];
    const params = [from, to];
    const codes = [...new Set((exactEmpCodes || []).map((v) => String(v || '').trim().toUpperCase()).filter(Boolean))];
    if (codes.length) {
      where.push(`UPPER(TRIM(emp_code)) IN (${codes.map(() => '?').join(',')})`);
      params.push(...codes);
    }
    const sql = `SELECT UPPER(TRIM(emp_code)) emp_code, MAX(emp_name) emp_name, COUNT(*) bill_count,
        SUM(COALESCE(NULLIF(tong_tien,0), so_tien, 0)) amount,
        SUM(COALESCE(NULLIF(tong_tien,0), so_tien, 0))/${XU_BASE}.0*${XU_PER} xu
      FROM vat_bills WHERE ${where.join(' AND ')} GROUP BY UPPER(TRIM(emp_code))`;
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
function readVatXu({ from, to, empCode } = {}) {
  const exactEmpCodes = empCode ? [empCode] : [];
  return queryVatXuExact({ from, to, exactEmpCodes });
}

// Điểm ghép duy nhất được CEO cho phép: DN001 nhận thêm XU từ mã VAT CEO.
// Hàm này chỉ trả số tổng hợp cho scoreForEmp, không đổi key/danh tính trong dữ liệu VAT gốc.
function readScoreXuForEmp({ from, to, empCode } = {}) {
  const emp = String(empCode || '').trim().toUpperCase();
  if (!emp) return { bill_count: 0, amount: 0, xu: 0, emp_name: '' };
  const exactEmpCodes = emp === CEO_SALES_CODE ? [CEO_SALES_CODE, CEO_VAT_CODE] : [emp];
  const rows = queryVatXuExact({ from, to, exactEmpCodes });
  const values = exactEmpCodes.map((code) => rows[code]).filter(Boolean);
  return values.reduce((sum, row) => ({
    bill_count: sum.bill_count + Number(row.bill_count || 0),
    amount: sum.amount + Number(row.amount || 0),
    xu: sum.xu + Number(row.xu || 0),
    emp_name: sum.emp_name || row.emp_name || emp,
  }), { bill_count: 0, amount: 0, xu: 0, emp_name: emp });
}

// Bảng điểm+xu 1 NV, lũy kế theo KHOẢNG NGÀY. XU tính theo QUÝ (sang quý mới tự reset -> KHÔNG carry).
// monthRange/quarterRange/weekRange = {from,to} YYYY-MM-DD.
function scoreForEmp({ empCode, weekRange, monthRange, quarterRange }) {
  const emp = String(empCode).toUpperCase();
  const diemThang = pointsByEmpRange({ ...monthRange, empCode: emp })[emp] || 0;
  const diemQuy = pointsByEmpRange({ ...quarterRange, empCode: emp })[emp] || 0;
  const xuThang = readScoreXuForEmp({ ...monthRange, empCode: emp }).xu;
  const xuQuy = readScoreXuForEmp({ ...quarterRange, empCode: emp }).xu; // = xu tổng quý (không carry)
  const xuTuan = weekRange ? readScoreXuForEmp({ ...weekRange, empCode: emp }).xu : null;
  const thieuDu = xuQuy - diemQuy;
  const tyLeQuy = diemQuy > 0 ? +(xuQuy / diemQuy * 100).toFixed(1) : null;
  return {
    emp_code: emp,
    diem_thang: +diemThang.toFixed(4), diem_quy: +diemQuy.toFixed(4),
    xu_tuan: xuTuan == null ? null : +xuTuan.toFixed(4),
    xu_thang: +xuThang.toFixed(4), xu_quy: +xuQuy.toFixed(4), xu_du_quy_truoc: 0,
    thieu_xu: +Math.max(0, -thieuDu).toFixed(4), du_xu: +Math.max(0, thieuDu).toFixed(4),
    ty_le_quy: tyLeQuy,
    canh_bao: tyLeQuy != null && tyLeQuy < 90,
  };
}

module.exports = {
  revenuePoints, pointMultiplier, pointsByEmp, pointsByEmpRange, kysSpanning,
  readVatXu, readScoreXuForEmp, scoreForEmp, isExcluded, EXCLUDE,
  VAT_DB, XU_BASE, XU_PER, CEO_XU_TO_DN001_ONLY,
};
