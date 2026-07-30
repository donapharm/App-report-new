'use strict';

// DIỄN GIẢI PHẠT CHO NGƯỜI XEM (CEO chốt 2026-07-30).
//
// CEO: "nhân viên không biết cột C45 là cột gì" + "phần giải thích khi bấm ra phải
// rõ hơn để NV hình dung được các ngữ cảnh có thể bị phạt".
//
// File này CHỈ sinh CHỮ và BẢNG NGỮ CẢNH từ cấu hình phạt đang áp dụng. Nó:
//   - KHÔNG tính tiền phạt (việc đó chỉ có employeePenalty.buildPenalty làm),
//   - KHÔNG nằm trong FORMULA_SOURCES nên sửa lời giải thích KHÔNG bắt nâng version,
//   - đọc mốc %/tỷ lệ TỪ CONFIG nên CEO sửa bậc phạt là bảng ngữ cảnh tự đổi theo,
//     không phải sửa chữ ở JSX (chống lệch như vụ nhãn v3.1/v3.2).
const employeePenalty = require('./employeePenalty');

// Tên cột phải hiện ở mọi nơi nhắc tới C45. Một nguồn duy nhất.
const C45_LABEL = 'C45 (Lương tăng thêm)';
const C45_SHORT = 'Lương tăng thêm';

function pctText(value) {
  return value == null ? '—' : `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
}

// "Từ 70% đến dưới 90%" / "Trên 50% đến dưới 70%" / "Bằng hoặc dưới 50%" — chữ sinh
// từ chính 3 kiểu mốc mà employeePenalty.tierForPct dùng để so sánh, nên chữ và số
// không thể nói khác nhau.
function rangeText(tier = {}) {
  const from = tier.fromPct == null ? null : Number(tier.fromPct);
  const fromExclusive = tier.fromExclusivePct == null ? null : Number(tier.fromExclusivePct);
  const to = tier.toPct == null ? null : Number(tier.toPct);
  // Bậc mất trắng lấy cả mốc trên (pct <= toPct), khác các bậc còn lại (pct < toPct).
  if (tier.dropC45 === true && from == null && fromExclusive == null && to != null) return `Bằng hoặc dưới ${pctText(to)}`;
  const head = fromExclusive != null ? `Trên ${pctText(fromExclusive)}` : from != null ? `Từ ${pctText(from)}` : 'Dưới mốc đầu tiên';
  if (to == null) return `${head} trở lên`;
  return `${head} đến dưới ${pctText(to)}`;
}

function effectText(tier = {}) {
  if (tier.dropC45 === true) return `MẤT TRẮNG toàn bộ ${C45_LABEL} — cả cột này không được cộng vào tổng chi phí tháng.`;
  const rate = tier.ratePct == null ? null : Number(tier.ratePct);
  if (!rate) return 'Không bị phạt — chuyển sang công thức tính thưởng.';
  return `Trừ ${pctText(rate)} × doanh thu thực (trước VAT) tại ${C45_LABEL}; trừ tối đa bằng chính số tiền C45, không âm sang cột khác.`;
}

// Ví dụ tiền cho ĐÚNG người đang xem: dùng doanh thu + C45 THẬT của họ do backend
// đã tính, không dựng số minh hoạ. Không có đủ số thì để trống, không bịa.
function exampleText(tier = {}, { achieved = null, c45Amount = null } = {}) {
  const money = (value) => `${Math.round(Number(value) || 0).toLocaleString('vi-VN')}đ`;
  if (tier.dropC45 === true) return c45Amount == null ? '' : `Với số của bạn: mất ${money(c45Amount)}.`;
  const rate = tier.ratePct == null ? null : Number(tier.ratePct);
  if (!rate) return '';
  if (achieved == null) return '';
  const raw = Math.round(achieved * rate / 100);
  const capped = c45Amount == null ? raw : Math.min(Math.round(c45Amount), raw);
  return `Với số của bạn: ${pctText(rate)} × ${money(achieved)} = ${money(raw)}${capped !== raw ? ` → kẹp còn ${money(capped)} (bằng C45)` : ''}.`;
}

// Bảng ngữ cảnh 4 bậc, xếp từ cao xuống thấp để người xem thấy "phải lên bậc nào".
function tierTable(config = {}, { activeTier = null, achieved = null, c45Amount = null } = {}) {
  const normalized = employeePenalty.normalizeConfig(config);
  if (!normalized.configured) return [];
  const order = ['none', 't70_90', 't50_70', 'drop_c45'];
  return order
    .map((key) => normalized.penaltyTiers.find((tier) => tier.tier === key))
    .filter(Boolean)
    .map((tier) => ({
      tier: tier.tier,
      range: rangeText(tier),
      effect: effectText(tier),
      example: tier.tier === activeTier ? exampleText(tier, { achieved, c45Amount }) : '',
      ratePct: tier.ratePct == null ? null : Number(tier.ratePct),
      dropC45: tier.dropC45 === true,
      active: tier.tier === activeTier,
    }));
}

// Nói thẳng kỳ này có trừ tiền thật hay chỉ chạy thử, kèm ngày bắt đầu trừ thật.
function modeText(penalty = {}) {
  const from = String(penalty.effectiveFrom || '').trim();
  const fromText = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from.split('-').reverse().join('/') : '';
  if (penalty.mode === 'enforced') return `Kỳ này TRỪ THẬT tại ${C45_LABEL}${fromText ? ` (áp dụng từ ${fromText})` : ''}.`;
  if (penalty.mode === 'warn_only') return `Kỳ này CHỈ CẢNH BÁO, chưa trừ một đồng nào${fromText ? `; từ ${fromText} mới trừ thật` : ''}.`;
  return 'Kỳ này chưa áp dụng chính sách phạt.';
}

module.exports = { C45_LABEL, C45_SHORT, rangeText, effectText, exampleText, tierTable, modeText };
