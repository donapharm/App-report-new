'use strict';
/**
 * ĐỐI SOÁT DOANH THU MÀN "TẤT CẢ NHÂN VIÊN" (CEO yêu cầu 10/08/2026)
 *
 * CEO: *"Doanh thu thực tế của T07.2026 đâu phải số này… giờ nó đang nằm ở đâu?
 * Mất mẹ nó doanh thu chạy đi đâu mất không còn đủ."*
 *
 * ‼ VÌ SAO SỐ TRÊN MÀN CÓ THỂ NHỎ HƠN DOANH THU THẬT — và vì sao nó NHẢY:
 * màn ALL dựng bảng bằng cách ghép sổ chi phí của TỪNG nhân viên. Bản cũ có thể
 * làm mất dòng khi nguồn % của một NV lỗi; Allocation V4 mới vẫn giữ dòng doanh
 * thu nhưng để chi phí fail-closed. Vì vậy tuyệt đối không được mặc định
 * “NV thiếu nguồn = tiền chưa hiện”: phải trừ đúng phần của NV đó đã có trên bảng.
 * Bằng chứng CEO đưa: cùng kỳ T07, 23:05 hiện 359 dòng, 00:20 hiện 1.332 dòng.
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
const shownRowsOf = (periods = []) => (Array.isArray(periods) ? periods : [])
  .flatMap((period) => (Array.isArray(period?.rows) ? period.rows : []));
const revenueByEmployee = (rows = []) => (Array.isArray(rows) ? rows : []).reduce((totals, row) => {
  const emp = empOf(row);
  totals.set(emp, (totals.get(emp) || 0) + revenueOf(row));
  return totals;
}, new Map());

/** Tổng doanh thu thực sự đang nằm trong các dòng bảng ALL trước phân trang/lọc. */
function sumShownRevenue(periods = []) {
  return shownRowsOf(periods).reduce((sum, row) => sum + revenueOf(row), 0);
}

/**
 * @param periods        danh sách kỳ (YYYY-MM) đang xem
 * @param revenueRowsOf  (period) → mọi dòng doanh thu của kỳ, KHÔNG lọc quyền
 * @param unavailable    mã NV chưa lấy được nguồn % (từ `match.unavailableEmployees`)
 * @param shownRevenue   tổng doanh thu ĐANG HIỆN trên bảng (có VAT), null nếu chưa biết
 * @param shownRows      toàn bộ dòng bảng trước phân trang; dùng để không cộng lại
 *                       doanh thu fail-closed của NV thiếu nguồn nhưng V4 vẫn giữ dòng
 */
function buildRevenueRecon({ periods = [], revenueRowsOf, unavailable = [], shownRevenue = null, shownRows } = {}) {
  const missingEmps = new Set((Array.isArray(unavailable) ? unavailable : []).map(upper).filter(Boolean));
  const shownKnown = Array.isArray(shownRows);
  const shownByEmp = revenueByEmployee(shownRows);
  let total = 0;
  let sourceUnassigned = 0;
  let rowCount = 0;
  const sourceUnavailableByEmp = new Map();

  for (const period of periods) {
    for (const row of revenueRowsOf(period) || []) {
      const amount = revenueOf(row);
      total += amount;
      rowCount += 1;
      const emp = empOf(row);
      // Dòng không gán được NV: nó KHÔNG thuộc sổ của ai nên không bao giờ lên bảng
      // ALL — phải tách riêng, không được trộn vào phần "NV chưa lấy được %".
      if (!emp) { sourceUnassigned += amount; continue; }
      if (missingEmps.has(emp)) {
        sourceUnavailableByEmp.set(emp, (sourceUnavailableByEmp.get(emp) || 0) + amount);
      }
    }
  }

  // V4 giữ doanh thu trên bảng ngay cả khi chi phí của NV fail-closed. Chỉ phần
  // nguồn lớn hơn phần đã hiện của chính NV đó mới là “thiếu”, không cộng cả NV lần hai.
  const unavailableByEmp = new Map([...sourceUnavailableByEmp.entries()].map(([emp, sourceAmount]) => (
    [emp, Math.max(0, sourceAmount - (shownKnown ? (shownByEmp.get(emp) || 0) : 0))]
  )).filter(([, amount]) => amount > 0));
  const byUnavailable = [...unavailableByEmp.values()].reduce((sum, amount) => sum + amount, 0);
  const unassigned = Math.max(0, sourceUnassigned - (shownKnown ? (shownByEmp.get('') || 0) : 0));
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

module.exports = { buildRevenueRecon, sumShownRevenue, shownRowsOf };
