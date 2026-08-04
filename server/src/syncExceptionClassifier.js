'use strict';
/**
 * PHÂN LOẠI DÒNG BỊ LOẠI (SPEC_REVENUE_SYNC_EXCEPTIONS.md §1–2)
 *
 * Hàm THUẦN: đưa vào toàn bộ dòng nguồn của kỳ + danh sách dòng đã đưa vào doanh
 * thu ⇒ trả về danh sách dòng bị loại KÈM MÃ LÝ DO. Không truy vấn, không ghi.
 *
 * Nhờ vậy phần **quyết định** (khó, dễ sai, cần bàn với CEO) tách hẳn khỏi phần
 * **lấy dữ liệu** (cần DB thật). Bot chỉ việc:
 *     const exceptions = classifySyncExceptions({ period, sourceRows, includedLineIds });
 *     syncExceptionStore.write(period, { source, included, exceptions });
 *
 * ‼ Nguyên tắc: KHÔNG dòng nào được biến mất lặng lẽ. Dòng bị loại mà không rơi vào
 * bất kỳ luật nào vẫn được xuất ra với mã `KHONG_RO` để lộ ra chỗ chưa khai báo —
 * thà thừa một dòng lạ còn hơn thiếu một dòng không ai biết.
 */

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const num = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const monthOf = (value) => (/^\d{4}-\d{2}/.test(text(value)) ? text(value).slice(0, 7) : '');

function lineIdOf(row) {
  return text(row.source_line_id || row.lineId || row.id || `${text(row.source_order || row.orderCode)}|${text(row.qlnb_code || row.iit_code)}`);
}

function baseRecord(row, period) {
  return {
    source: upper(row.source || row.source_system) || (row.qlnb_code || row.sale_order_no ? 'CRM_MISA' : 'APP_WEB'),
    orderCode: text(row.source_order || row.sale_order_no || row.order_code || row.orderCode),
    lineId: lineIdOf(row),
    productCode: upper(row.iit_code || row.qlnb_code || row.product_code),
    unitCode: upper(row.unit_code),
    empCode: upper(row.emp_code || row.employee_code),
    date: text(row.date || row.revenue_date || row.sale_order_date || row.created_at).slice(0, 10),
    amount: Math.round(num(row.revenue ?? row.amount ?? row.invoice_export_amount)),
    period,
  };
}

// ── Luật cho CRM MISA ────────────────────────────────────────────────────────
function classifyMisa(row, period) {
  const bucket = String(row.revenue_bucket ?? '').toLowerCase();
  if (bucket && !['official', 'pending'].includes(bucket)) return 'MISA_CHUA_GHI_DOANH_SO';
  if (row.is_test_suspected === true) return 'MISA_NGHI_DON_TEST';
  const day = text(row.revenue_date || row.sale_order_date);
  // Có tiền, đã ghi doanh số, nhưng THIẾU NGÀY ⇒ đúng vụ 2.399.520đ, đơn DH479815711.
  if (!day) return num(row.revenue ?? row.invoice_export_amount) > 0 ? 'MISA_THIEU_NGAY_DOANH_THU' : 'MISA_TIEN_BANG_0';
  if (monthOf(day) && period && monthOf(day) !== period) return 'MISA_NGAY_NGOAI_KY';
  if (num(row.revenue ?? row.invoice_export_amount) === 0) return 'MISA_TIEN_BANG_0';
  return '';
}

// ── Luật cho APP WEB đối tác ─────────────────────────────────────────────────
function classifyWeb(row, period) {
  if (upper(row.entity_group) && upper(row.entity_group) !== 'PARTNER') return 'WEB_SAI_NHOM';
  const hasResponse = row.has_response === true || row.delivered_qty != null || row.qty_delivered != null;
  if (row.is_test === true && !hasResponse) return 'WEB_DON_TEST';
  if (!hasResponse) return 'WEB_CHUA_CO_PHAN_HOI';
  if (num(row.delivered_qty ?? row.qty_delivered) === 0) return 'WEB_GIAO_BANG_0';
  const day = text(row.date || row.created_at);
  if (monthOf(day) && period && monthOf(day) !== period) return 'WEB_NGAY_NGOAI_KY';
  return '';
}

// ── Vào đủ tiền nhưng THIẾU THÔNG TIN — cảnh báo riêng, KHÔNG loại ───────────
// Nhóm nguy hiểm nhất: nhìn tổng thì đúng, lọc ra thì mất (vụ 175.BVĐK Vũng Tàu).
function classifyIncomplete(row, { knownUnits, knownProducts, roster } = {}) {
  const codes = [];
  const unit = upper(row.unit_code);
  const product = upper(row.iit_code || row.qlnb_code);
  const emp = upper(row.emp_code || row.employee_code);
  if (knownUnits && unit && !knownUnits.has(unit)) codes.push('DON_VI_THIEU_DANH_MUC');
  if (knownProducts && product && !knownProducts.has(product)) codes.push('MA_HANG_THIEU_DANH_MUC');
  if (emp === 'UNALLOCATED' || upper(row.attribution_status).includes('QUARANTINED')
    || (roster && emp && !roster.has(emp))) codes.push('NV_XUNG_DOT_ROSTER');
  return codes;
}

/**
 * @param {string} period            'YYYY-MM'
 * @param {Array}  sourceRows        TOÀN BỘ dòng của kỳ, chưa lọc
 * @param {Set|Array} includedLineIds dòng đã được đưa vào doanh thu
 * @param {Set} knownUnits/knownProducts/roster  danh mục để bắt nhóm "thiếu thông tin"
 */
function classifySyncExceptions({ period, sourceRows = [], includedLineIds = [], knownUnits, knownProducts, roster } = {}) {
  const included = includedLineIds instanceof Set ? includedLineIds : new Set((includedLineIds || []).map(text));
  const out = [];
  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    const record = baseRecord(row, period);
    const isIncluded = included.has(record.lineId);

    if (isIncluded) {
      // Đã tính tiền ⇒ chỉ soi xem có thiếu thông tin không. Không đụng vào tiền.
      for (const code of classifyIncomplete(row, { knownUnits, knownProducts, roster })) out.push({ ...record, code });
      continue;
    }

    const isMisa = record.source === 'CRM_MISA';
    const code = isMisa ? classifyMisa(row, period) : classifyWeb(row, period);
    // HOLD_GOLIVE đã giao thì VẪN TÍNH (CEO chốt 29/07) — nếu vẫn bị loại thì đó là
    // bất thường, phải lộ ra chứ không im.
    if (!code && upper(row.status) === 'HOLD_GOLIVE') { out.push({ ...record, code: 'WEB_HOLD_GOLIVE_DA_GIAO' }); continue; }
    // Bị loại mà không khớp luật nào ⇒ vẫn xuất ra, để lộ chỗ chưa khai báo.
    out.push({ ...record, code: code || 'KHONG_RO' });
  }
  return out;
}

module.exports = { classifySyncExceptions, classifyMisa, classifyWeb, classifyIncomplete };
