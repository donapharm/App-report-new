'use strict';
const employeeIncentivePolicy = require('./employeeIncentivePolicy');
/**
 * TIN NHẮN PHẠT CHO NHÂN VIÊN (CEO duyệt 2026-07-30, việc 4)
 *
 * CEO: "Việc số 4 đồng ý duyệt tin nhắn phạt để nv nhận được."
 * Bối cảnh: T08.2026 là tháng TRỪ TIỀN THẬT. DN018 chỉ còn cách mốc mất trắng C45
 * 3.550.175đ. Không nhắc thì NV không biết mà cố gắng — mất tiền vì không biết là
 * điều CEO nói "đau lắm".
 *
 * BỐN QUY TẮC:
 *  1. KHÔNG BỊA SỐ. Mọi con số lấy nguyên từ `employeePenalty.buildPenalty` (đã tính
 *     ở backend theo target + C45 thật của chính NV đó). Module này chỉ dựng chữ.
 *  2. KHÔNG CÓ VIỆC GÌ THÌ KHÔNG GỬI. Đạt ≥ mốc không phạt, chưa áp dụng, hoặc chưa
 *     đủ dữ liệu ⇒ trả null. (CEO chốt 28/07: "không có tin gì thì không gửi".)
 *  3. NÓI RÕ CHƯA TRỪ TIỀN khi kỳ đang chạy thử — tuyệt đối không để NV tưởng đã bị
 *     trừ. Và nói rõ số còn DỰ KIẾN khi kỳ chưa khoá sổ.
 *  4. LUÔN CÓ ĐƯỜNG THOÁT. Mỗi tin phải nêu **cần thêm bao nhiêu doanh thu trước
 *     VAT** để thoát bậc. Tin chỉ báo mất tiền mà không nói cách thoát là tin vô ích.
 */

function money(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('vi-VN')}đ`;
}

function pct(value) {
  return value == null || Number.isNaN(Number(value))
    ? '—' : `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
}

function monthNo(ky) {
  return String(ky || '').split('.')[0];
}

/**
 * penalty: object do employeePenalty.buildPenalty trả về (đã kèm c45Label/tiers).
 * Trả null khi KHÔNG có gì để nhắc.
 */
function messageFor({ row = {}, penalty = null, ky = '' } = {}) {
  if (employeeIncentivePolicy.isMonetaryNotifyBlocked(row.emp_code)) return null;
  if (!penalty || typeof penalty !== 'object') return null;
  // Chưa áp dụng cho kỳ này, hoặc đạt mốc không phạt ⇒ không có việc gì để nhắc.
  if (penalty.mode === 'off') return null;
  if (!penalty.tier || penalty.tier === 'none') return null;
  // Chưa đủ dữ liệu (chưa giao target / C45 chưa về) ⇒ KHÔNG nhắc tiền, vì nhắc là
  // hứa một con số mình không có. Màn app đã nói rõ trạng thái này.
  if (penalty.targetAmount == null && penalty.c45Dropped !== true && penalty.c45WouldDrop !== true) return null;

  const c45 = penalty.c45Label || 'C45 (Lương tăng thêm)';
  const who = row.name || row.emp_code || '';
  const month = monthNo(ky || row.ky);
  const warnOnly = penalty.mode === 'warn_only';
  const dropping = penalty.c45Dropped === true || penalty.c45WouldDrop === true;

  // Hậu quả: mất trắng cả cột, hay bị trừ một phần.
  const consequence = dropping
    ? (penalty.c45Amount == null
      ? `MẤT TRẮNG toàn bộ ${c45} (số tiền chưa đủ dữ liệu)`
      : `MẤT TRẮNG ${money(penalty.c45Amount)} ở ${c45}`)
    : `bị trừ ${money(penalty.targetAmount)} ở ${c45}`;

  // Đường thoát: số doanh thu cần thêm, lấy từ cảnh báo sớm backend đã tính.
  const gap = penalty.warning?.revenueGap;
  const threshold = penalty.warning?.nextThresholdPct;
  const escape = gap == null
    ? ''
    : `Cách thoát: tăng thêm ${money(gap)} giá trị đơn hàng (trước VAT) là ${penalty.warning?.mustExceed ? 'vượt' : 'đạt'} mốc ${pct(threshold)}.`;

  return [
    warnOnly
      ? `⚠ [Tháng ${month}] ${who} — CẢNH BÁO PHẠT (chưa trừ tiền)`
      : `⚠ [Tháng ${month}] ${who} — PHẠT tại ${c45}`,
    `Đang đạt ${pct(penalty.targetPct)} target.`,
    warnOnly ? `Nếu áp dụng, bạn sẽ ${consequence}.` : `Bạn ${consequence}.`,
    escape,
    // Câu chốt: chạy thử hay trừ thật, và số đã chốt hay còn dự kiến.
    warnOnly
      ? `ℹ ${penalty.modeText || 'Kỳ này CHỈ CẢNH BÁO, chưa trừ một đồng nào.'}`
      : `ℹ ${penalty.label || ''}`,
    'Xem chi tiết cách tính ở màn "Chi phí của tôi" → ô "Phạt dự kiến".',
  ].filter(Boolean).join('\n');
}

function subjectFor(row = {}, ky = '') {
  return `DONAPHARM — Cảnh báo phạt tháng ${monthNo(ky || row.ky)} (${row.emp_code || ''})`;
}

// Khoá chống gửi trùng: theo kỳ + BẬC. Đổi bậc (xấu đi hoặc tốt lên) là tin MỚI,
// vì lúc đó số tiền và đường thoát đều khác. Cùng bậc thì không nhắc lại.
function notifyKey({ ky = '', penalty = null } = {}) {
  return `penalty|${ky}|${penalty?.tier || 'none'}|${penalty?.mode || 'off'}`;
}

module.exports = { messageFor, subjectFor, notifyKey };
