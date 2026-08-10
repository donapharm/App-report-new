'use strict';
/**
 * ĐỐI SOÁT DOANH THU MÀN "TẤT CẢ NHÂN VIÊN" (CEO yêu cầu 10/08/2026)
 *
 * CEO: *"Doanh thu thực tế của T07.2026 đâu phải số này… giờ nó đang nằm ở đâu?
 * Mất mẹ nó doanh thu chạy đi đâu mất không còn đủ."*
 *
 * ‼ VÌ SAO SỐ TRÊN MÀN NHỎ HƠN DOANH THU THẬT — và vì sao nó NHẢY:
 * màn ALL dựng bảng bằng cách ghép sổ chi phí của TỪNG nhân viên. Nhân viên nào
 * chưa lấy được % thì **toàn bộ dòng doanh thu của họ không lên bảng**. Doanh thu
 * là dữ liệu CỦA App Report và luôn đủ, nhưng con số hiển thị lại phụ thuộc nguồn
 * % — nguồn chập chờn vài người là tổng tụt theo. Bằng chứng CEO đưa: cùng kỳ T07,
 * 23:05 hiện 359 dòng, 00:20 hiện 1.332 dòng.
 *
 * Module này KHÔNG sửa con số nào. Nó trả lời đúng một câu: **phần chênh đang nằm
 * ở đâu** — cùng tinh thần "không dòng nào biến mất lặng lẽ" của SPEC_REVENUE_SYNC_
 * EXCEPTIONS, nhưng áp cho TIỀN:
 *
 *     Doanh thu kỳ (kho App Report)
 *       = đang hiện trên bảng
 *       + của NV chưa lấy được %
 *       + dòng chưa gán được nhân viên
 *
 * Lệch ⇒ `balanced: false` và nêu số lệch. Một phép cân không cân được thì phải nói
 * ra, chứ không được làm tròn cho đẹp.
 */

const num = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};
const upper = (value) => String(value ?? '').trim().toUpperCase();
const empOf = (row = {}) => upper(row.emp_code ?? row.empCode ?? row.EMP_NUMBER ?? row.MA_NV);
const revenueOf = (row = {}) => num(row.revenue ?? row.tong_tien ?? row.REVENUE ?? row.TONG_TIEN);

/** Tổng doanh thu thực sự đang nằm trong các dòng bảng ALL trước phân trang/lọc. */
function sumShownRevenue(periods = []) {
  return (Array.isArray(periods) ? periods : []).reduce((periodSum, period) => (
    periodSum + (Array.isArray(period?.rows) ? period.rows : []).reduce((rowSum, row) => rowSum + revenueOf(row), 0)
  ), 0);
}

/**
 * @param periods        danh sách kỳ (YYYY-MM) đang xem
 * @param revenueRowsOf  (period) → mọi dòng doanh thu của kỳ, KHÔNG lọc quyền
 * @param unavailable    mã NV chưa lấy được nguồn % (từ `match.unavailableEmployees`)
 * @param shownRevenue   tổng doanh thu ĐANG HIỆN trên bảng (có VAT), null nếu chưa biết
 */
function buildRevenueRecon({ periods = [], revenueRowsOf, unavailable = [], shownRevenue = null } = {}) {
  const missingEmps = new Set((Array.isArray(unavailable) ? unavailable : []).map(upper).filter(Boolean));
  let total = 0;
  let unassigned = 0;
  let byUnavailable = 0;
  let rowCount = 0;
  const unavailableByEmp = new Map();

  for (const period of periods) {
    for (const row of revenueRowsOf(period) || []) {
      const amount = revenueOf(row);
      total += amount;
      rowCount += 1;
      const emp = empOf(row);
      // Dòng không gán được NV: nó KHÔNG thuộc sổ của ai nên không bao giờ lên bảng
      // ALL — phải tách riêng, không được trộn vào phần "NV chưa lấy được %".
      if (!emp) { unassigned += amount; continue; }
      if (missingEmps.has(emp)) {
        byUnavailable += amount;
        unavailableByEmp.set(emp, (unavailableByEmp.get(emp) || 0) + amount);
      }
    }
  }

  const accounted = num(shownRevenue) + byUnavailable + unassigned;
  // Sai số cho phép đúng 1 đồng/kỳ — chỉ để nuốt làm tròn, không phải để giấu lệch.
  const tolerance = Math.max(1, periods.length);
  const gap = shownRevenue == null ? null : Math.round(total - accounted);
  return {
    periods: [...periods],
    rowCount,
    total: Math.round(total),
    shown: shownRevenue == null ? null : Math.round(num(shownRevenue)),
    missingByUnavailable: Math.round(byUnavailable),
    missingUnassigned: Math.round(unassigned),
    unavailableEmployees: [...unavailableByEmp.entries()]
      .map(([empCode, amount]) => ({ empCode, revenue: Math.round(amount) }))
      .sort((a, b) => b.revenue - a.revenue),
    gap,
    balanced: gap == null ? null : Math.abs(gap) <= tolerance,
  };
}

module.exports = { buildRevenueRecon, sumShownRevenue };
