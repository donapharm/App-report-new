'use strict';

// TỔNG HỢP PHẠT CHO MÀN "TẤT CẢ NHÂN VIÊN" (CEO chốt 2026-07-30).
//
// CEO: "Ở trạng thái hiển thị tất cả nhân viên thì màn hình CEO chưa thấy được 4 ô
// KPI, yêu cầu CEO phải thấy được toàn cảnh các ô này phải hiện tổng hợp."
//
// Nguyên tắc:
//   1. CỘNG, KHÔNG TÍNH LẠI. Mỗi số phạt đã do employeePenalty.buildPenalty tính
//      riêng cho từng NV (self-scoped, có target + C45 của chính NV đó). Ở đây chỉ
//      cộng lại. Không suy phạt từ target tổng / doanh thu tổng — làm vậy ra số khác
//      và sai bậc.
//   2. KHÔNG CỘNG Ở FRONTEND. Vì thế file này ở backend.
//   3. FAIL-CLOSED CÓ NÓI RÕ: NV nào chưa đủ dữ liệu (chưa giao target, C45 chưa về)
//      thì KHÔNG coi là 0đ; đếm riêng và báo "tổng của N/M NV" để CEO biết còn thiếu.
//   4. File này KHÔNG nằm trong FORMULA_SOURCES vì không quyết định số tiền của ai.
const employeePenalty = require('./employeePenalty');

const TIERS = Object.freeze(['drop_c45', 't50_70', 't70_90', 'none']);

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Tổng hợp từ danh sách phạt của TỪNG NV (đã lọc theo bộ lọc đang xem).
function aggregate({ penalties = [], periodTotal = null } = {}) {
  const items = (Array.isArray(penalties) ? penalties : []).filter((item) => item && typeof item === 'object');
  if (!items.length) {
    return {
      aggregate: true, available: false, c45Label: '', tiers: [],
      employees: 0, counted: 0, missing: 0, incomplete: false,
      mode: 'off', modes: [], label: 'Chưa có dữ liệu phạt của nhân viên nào trong bộ lọc này',
      targetAmount: null, xuAmount: null, total: null, appliedAmount: 0, afterPenaltyTotal: null,
      tierCounts: Object.fromEntries(TIERS.map((tier) => [tier, 0])),
      tierAmounts: Object.fromEntries(TIERS.map((tier) => [tier, 0])),
      c45DroppedCount: 0, c45WouldDropCount: 0, warnedCount: 0, atRisk: [],
      formulaText: 'Chưa có số phạt nào để cộng.', penaltyStatus: 'no_data', xuStatus: 'no_data',
    };
  }
  const known = items.filter((item) => finite(item.total) != null);
  const missing = items.length - known.length;
  const modes = [...new Set(items.map((item) => String(item.mode || 'off')))];
  const sum = (list, key) => list.reduce((total, item) => total + (finite(item[key]) || 0), 0);
  // Không NV nào có số ⇒ tổng là "chưa có số" (null), KHÔNG phải 0đ. Hiện 0đ ở đây
  // là nói dối: 0đ có nghĩa "đã tính xong và không ai bị phạt".
  const targetAmount = known.length ? sum(known, 'targetAmount') : null;
  const xuKnown = items.filter((item) => finite(item.xuAmount) != null);
  const appliedAmount = sum(items, 'appliedAmount');
  const tierCounts = Object.fromEntries(TIERS.map((tier) => [tier, items.filter((item) => item.tier === tier).length]));
  const tierAmounts = Object.fromEntries(TIERS.map((tier) => [
    tier, items.filter((item) => item.tier === tier).reduce((total, item) => total + (finite(item.targetAmount) || 0), 0),
  ]));
  const c45DroppedCount = items.filter((item) => item.c45Dropped === true).length;
  const c45WouldDropCount = items.filter((item) => item.c45WouldDrop === true).length;
  const warned = items.filter((item) => item.warning?.text);
  const mode = modes.length === 1 ? modes[0] : 'mixed';
  const label = mode === 'warn_only' ? employeePenalty.WARN_ONLY_LABEL
    : mode === 'mixed' ? `Nhiều chế độ trong kỳ (${modes.join(', ')}) — ${employeePenalty.DISCLAIMER}`
      : mode === 'off' ? 'Chính sách phạt chưa áp dụng cho kỳ này'
        : `TỔNG HỢP TOÀN ĐỘI — ${employeePenalty.DISCLAIMER}`;
  // Bảng bậc phạt dùng chung cho cả đội: lấy lại bảng backend đã sinh cho từng NV,
  // bỏ phần "ví dụ theo số của bạn" và bỏ đánh dấu bậc đang đứng (toàn đội không có
  // một bậc duy nhất).
  const tiers = (items.find((item) => Array.isArray(item.tiers) && item.tiers.length)?.tiers || [])
    .map((tier) => ({ ...tier, example: '', active: false, employees: tierCounts[tier.tier] ?? 0, amount: tierAmounts[tier.tier] ?? 0 }));
  return {
    aggregate: true,
    available: true,
    c45Label: items.find((item) => item.c45Label)?.c45Label || '',
    tiers,
    employees: items.length,
    counted: known.length,
    missing,
    incomplete: missing > 0,
    mode, modes, label,
    targetAmount,
    xuAmount: xuKnown.length ? sum(xuKnown, 'xuAmount') : null,
    xuMissing: null,
    total: known.length ? sum(known, 'total') : null,
    appliedAmount,
    // Tổng gốc null (coverage chưa đạt) thì KHÔNG suy ra tổng sau phạt.
    afterPenaltyTotal: finite(periodTotal) == null ? null : Math.max(0, Math.round(finite(periodTotal)) - appliedAmount),
    tierCounts, tierAmounts,
    c45DroppedCount, c45WouldDropCount,
    warnedCount: warned.length,
    // Danh sách NV đang ở bậc bị phạt, để CEO bấm vào là biết nhắc ai.
    atRisk: items
      .filter((item) => item.tier && item.tier !== 'none')
      .map((item) => ({
        empCode: String(item.empCode || '').toUpperCase(),
        employeeName: String(item.employeeName || item.empCode || ''),
        tier: item.tier,
        targetPct: finite(item.targetPct),
        targetAmount: finite(item.targetAmount),
        c45Amount: finite(item.c45Amount),
        revenueGap: finite(item.warning?.revenueGap),
      }))
      .sort((left, right) => (left.targetPct ?? 999) - (right.targetPct ?? 999)),
    penaltyStatus: known.length ? (missing ? 'aggregate_partial' : 'aggregate') : 'aggregate_unavailable',
    xuStatus: xuKnown.length ? 'aggregate' : (items[0]?.xuStatus || 'disabled'),
    formulaText: [
      `Tổng hợp phạt của ${known.length}/${items.length} nhân viên trong bộ lọc hiện tại (cộng số đã tính riêng cho từng người, không tính lại theo target tổng).`,
      missing ? `${missing} nhân viên chưa đủ dữ liệu (chưa giao target hoặc C45 chưa về) — KHÔNG tính là 0đ.` : '',
      c45DroppedCount ? `${c45DroppedCount} nhân viên mất trắng C45.` : '',
      c45WouldDropCount ? `${c45WouldDropCount} nhân viên sẽ mất trắng C45 nếu áp dụng (tháng này chỉ cảnh báo).` : '',
    ].filter(Boolean).join(' '),
  };
}

module.exports = { TIERS, aggregate };
