'use strict';

const xuPolicy = require('./xuPolicy');
const employeeIncentivePolicy = require('./employeeIncentivePolicy');

const WARN_ONLY_LABEL = 'T07.2026 CHỈ CẢNH BÁO — chưa trừ tiền. Seed mặc định áp dụng trừ thật từ 01/08/2026.';
const DISCLAIMER = 'Dự kiến/tham khảo — chưa trừ lương';
const DEFAULT_TIERS = Object.freeze([
  { tier: 'drop_c45', toPct: 50, dropC45: true },
  { tier: 't50_70', fromExclusivePct: 50, toPct: 70, ratePct: 0.3 },
  { tier: 't70_90', fromPct: 70, toPct: 90, ratePct: 0.2 },
  { tier: 'none', fromPct: 90, toPct: null, ratePct: 0 },
]);

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function monthKey(value) {
  const text = String(value || '').trim();
  let match = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(text);
  if (match) return `${match[1]}-${match[2]}`;
  match = /^(0[1-9]|1[0-2])\.(\d{4})$/.exec(text);
  return match ? `${match[2]}-${match[1]}` : '';
}

function periodStart(value) {
  const month = monthKey(value);
  return month ? `${month}-01` : '';
}

function uiPeriod(value) {
  const month = monthKey(value);
  return month ? `T${month.slice(5, 7)}.${month.slice(0, 4)}` : 'Kỳ này';
}

function normalizeConfig(raw = {}) {
  const tiers = Array.isArray(raw.penaltyTiers) ? raw.penaltyTiers : [];
  const normalizedTiers = tiers.map((tier) => ({
    tier: String(tier?.tier || ''),
    fromPct: finite(tier?.fromPct),
    fromExclusivePct: finite(tier?.fromExclusivePct),
    toPct: finite(tier?.toPct),
    ratePct: finite(tier?.ratePct),
    dropC45: tier?.dropC45 === true,
  }));
  const byTier = Object.fromEntries(normalizedTiers.map((tier) => [tier.tier, tier]));
  const requiredTiers = ['drop_c45', 't50_70', 't70_90', 'none'];
  const configured = normalizedTiers.length === 4
    && new Set(normalizedTiers.map((tier) => tier.tier)).size === 4
    && normalizedTiers.every((tier) => requiredTiers.includes(tier.tier))
    && byTier.drop_c45?.toPct != null && byTier.drop_c45.toPct >= 0
    && byTier.t50_70?.fromExclusivePct === byTier.drop_c45?.toPct
    && byTier.t50_70?.toPct != null && byTier.t50_70.toPct > byTier.t50_70.fromExclusivePct
    && byTier.t70_90?.fromPct === byTier.t50_70?.toPct
    && byTier.t70_90?.toPct != null && byTier.t70_90.toPct > byTier.t70_90.fromPct
    && byTier.none?.fromPct === byTier.t70_90?.toPct
    && [byTier.t50_70?.ratePct, byTier.t70_90?.ratePct].every((rate) => rate != null && rate >= 0)
    && (byTier.drop_c45?.dropC45 === true || (byTier.drop_c45?.ratePct != null && byTier.drop_c45.ratePct >= 0))
    && byTier.none?.ratePct === 0;
  return {
    penaltyEnabled: raw.penaltyEnabled === true,
    penaltyWarnFrom: String(raw.penaltyWarnFrom || ''),
    penaltyEffectiveFrom: String(raw.penaltyEffectiveFrom || ''),
    penaltyTiers: configured ? normalizedTiers : [],
    configured,
    xuPenalty: {
      enabled: raw.xuPenalty?.enabled === true,
      perMissingXu: finite(raw.xuPenalty?.perMissingXu),
    },
  };
}

function resolveMode(period, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const date = periodStart(period);
  if (!config.penaltyEnabled) return 'off';
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(config.penaltyWarnFrom)
    || !/^\d{4}-\d{2}-\d{2}$/.test(config.penaltyEffectiveFrom)) return 'off';
  if (date >= config.penaltyEffectiveFrom) return 'enforced';
  if (date >= config.penaltyWarnFrom) return 'warn_only';
  return 'off';
}

function tierForPct(pct, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  if (!config.configured || !Number.isFinite(pct)) return null;
  return config.penaltyTiers.find((tier) => {
    if (tier.fromExclusivePct != null && !(pct > tier.fromExclusivePct)) return false;
    if (tier.fromPct != null && !(pct >= tier.fromPct)) return false;
    if (tier.toPct != null && !(pct < tier.toPct) && !(tier.tier === 'drop_c45' && pct <= tier.toPct)) return false;
    return true;
  }) || null;
}

function ceil1k(value) {
  return Math.ceil(Math.max(0, Number(value) || 0) / 1000) * 1000;
}

function formatMoney(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('vi-VN')}đ`;
}

function formatPct(value) {
  return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
}

function tierRangeText(tier = {}) {
  if (tier.tier === 'drop_c45') return `bằng hoặc dưới ${formatPct(tier.toPct)}%`;
  if (tier.tier === 'none') return `từ ${formatPct(tier.fromPct)}% trở lên`;
  if (tier.fromExclusivePct != null) return `trên ${formatPct(tier.fromExclusivePct)}% đến dưới ${formatPct(tier.toPct)}%`;
  return `${formatPct(tier.fromPct)}% đến dưới ${formatPct(tier.toPct)}%`;
}

function nextThreshold(tier, rawConfig = { penaltyTiers: DEFAULT_TIERS }) {
  const selected = normalizeConfig(rawConfig).penaltyTiers.find((item) => item.tier === tier);
  if (!selected || selected.toPct == null) return null;
  return { pct: selected.toPct, mustExceed: selected.tier === 'drop_c45' };
}

function warningFor({ period, mode, closed = false, target, achieved, pct, tier, c45Amount, targetAmount, rawConfig }) {
  if (mode === 'off' || !tier || tier === 'none' || !(target > 0) || !Number.isFinite(achieved)) return null;
  const normalized = normalizeConfig(rawConfig);
  const selectedTier = normalized.penaltyTiers.find((item) => item.tier === tier);
  const threshold = nextThreshold(tier, rawConfig);
  if (!threshold) return null;
  const rawGap = target * threshold.pct / 100 - achieved;
  const revenueGap = ceil1k(rawGap) + (threshold.mustExceed ? 1000 : 0);
  const moneyAtRisk = c45Amount == null ? null : Math.max(0, Math.round(c45Amount));
  const displayedPct = formatPct(pct);
  const dropsC45 = selectedTier?.dropC45 === true;
  const rateLabel = selectedTier?.ratePct == null ? '—' : `${formatPct(selectedTier.ratePct)}%`;
  let text;
  // Warn-only luôn phải nói rõ chưa trừ, kể cả khi xem lại một kỳ đã đóng.
  // Không để nhánh "closed" biến cảnh báo lịch sử thành câu khẳng định đã phạt.
  if (mode === 'warn_only') {
    const consequence = dropsC45
      ? (moneyAtRisk == null ? 'thuộc bậc mất trắng C45 (số tiền C45 chưa đủ dữ liệu)' : `sẽ MẤT TRẮNG ${formatMoney(moneyAtRisk)} ở cột C45`)
      : (moneyAtRisk == null ? `bị trừ ${rateLabel} tại C45 (số tiền chưa đủ dữ liệu)` : `bị trừ ${formatMoney(targetAmount)} tại C45`);
    const action = closed
      ? `Kỳ đã đóng ở mức ${displayedPct}%; mốc thoát bậc là ${threshold.mustExceed ? 'vượt' : 'đạt'} ${formatPct(threshold.pct)}%.`
      : `Muốn thoát bậc này: tăng thêm ${formatMoney(revenueGap)} giá trị đơn hàng (trước VAT). Hiện đạt ${displayedPct}% — cần ${threshold.mustExceed ? 'vượt' : 'đạt'} mốc ${formatPct(threshold.pct)}%.`;
    text = `${uiPeriod(period)} — THÁNG CHẠY THỬ, CHƯA TRỪ TIỀN. Nếu áp dụng, bạn ${consequence}. Từ ${formatDate(normalized.penaltyEffectiveFrom)} mới trừ thật. ${action}`;
  } else if (closed) {
    if (dropsC45 && moneyAtRisk != null) {
      text = `Tháng này đạt ${displayedPct}% target — C45 ${formatMoney(moneyAtRisk)} không được tính vào chi phí tháng.`;
    } else if (moneyAtRisk != null) {
      text = `Tháng này đạt ${displayedPct}% target — phạt tại C45 là ${formatMoney(targetAmount)} theo bậc ${rateLabel}.`;
    } else {
      text = `Tháng này đạt ${displayedPct}% target — thuộc bậc phạt tại C45; số tiền chưa xác định do C45 chưa đủ dữ liệu.`;
    }
  } else if (dropsC45) {
    const risk = moneyAtRisk == null ? 'MẤT TRẮNG cột C45 (Lương tăng thêm; số tiền chưa đủ dữ liệu)' : `MẤT TRẮNG ${formatMoney(moneyAtRisk)} ở cột C45 (Lương tăng thêm)`;
    text = `Bạn có thể ${risk} nếu không tăng thêm ${formatMoney(revenueGap)} giá trị đơn hàng (trước VAT) trong tháng này. Hiện đạt ${displayedPct}% target — cần vượt mốc ${formatPct(threshold.pct)}%.`;
  } else {
    const amount = moneyAtRisk == null ? `Đang ở bậc trừ ${rateLabel} tại C45 (số tiền chưa đủ dữ liệu).` : `Đang bị trừ ${rateLabel} (${formatMoney(targetAmount)}) ở cột C45.`;
    const nextTier = normalized.penaltyTiers.find((item) => item.fromPct === threshold.pct);
    const outcome = nextTier?.tier === 'none' ? 'HẾT PHẠT và bắt đầu được thưởng' : `chuyển sang mức ${formatPct(nextTier?.ratePct)}%`;
    text = `${amount} Thêm ${formatMoney(revenueGap)} giá trị đơn hàng (trước VAT) là ${outcome}. Hiện đạt ${displayedPct}% target — cần đạt mốc ${formatPct(threshold.pct)}%.`;
  }
  return {
    kind: tier,
    nextThresholdPct: threshold.pct,
    mustExceed: threshold.mustExceed,
    revenueGap,
    moneyAtRisk,
    text,
  };
}

function buildXuPenalty({ config, empCode, asOf, scoreFn, priorBookedAdjustment = null } = {}) {
  const normalized = normalizeConfig(config);
  if (!employeeIncentivePolicy.isXuPenaltyEmployee(empCode)) {
    return { amount: null, status: 'disabled', missing: null, checkpoint: null };
  }
  if (!normalized.xuPenalty.enabled) return { amount: null, status: 'disabled', missing: null, checkpoint: null };
  if (typeof scoreFn !== 'function' || !asOf || normalized.xuPenalty.perMissingXu == null
    || normalized.xuPenalty.perMissingXu < 0) {
    return { amount: null, status: 'xu_source_unavailable', missing: null, checkpoint: null };
  }
  try {
    // Reuse the established policy calculator. Do not duplicate the 300k/Xu or prior_booked logic here.
    const checkpoint = xuPolicy.buildCheckpoint({
      empCode, asOf, scoreFn, priorBookedAdjustment,
      perMissingXu: normalized.xuPenalty.perMissingXu,
    });
    if (!checkpoint.ranges.quarter.closing) return {
      amount: null, status: 'quarter_pending', missing: checkpoint.score.thieu_xu_quy, checkpoint,
    };
    const amount = checkpoint.adjustment.quarter_additional_estimated;
    return {
      amount,
      status: amount == null ? 'finance_reconciliation_pending' : (checkpoint.adjustment.final ? 'final' : 'provisional'),
      missing: checkpoint.score.thieu_xu_quy,
      checkpoint,
    };
  } catch {
    return { amount: null, status: 'xu_source_unavailable', missing: null, checkpoint: null };
  }
}

function buildPenalty({ empCode = '', period, target, achieved, c45Amount, costTotal, closed = false, closeLabel = '', config = {}, xu = null } = {}) {
  const normalized = normalizeConfig(config);
  if (employeeIncentivePolicy.requiresSeparateFormula(empCode)) {
    const xuAmount = finite(xu?.amount);
    const xuFinal = xu?.status === 'final' && xuAmount != null;
    const appliedAmount = xuFinal ? Math.max(0, xuAmount) : 0;
    const numericCostTotal = finite(costTotal);
    return {
      mode: 'xu_only',
      closed: closed === true,
      closeLabel: String(closeLabel || ''),
      finalized: xuFinal,
      effectiveFrom: '',
      enabled: true,
      targetPct: null,
      tier: null,
      ratePct: null,
      c45Amount: null,
      targetAmount: null,
      targetStatus: employeeIncentivePolicy.SEPARATE_FORMULA_REASON,
      penaltyStatus: employeeIncentivePolicy.SEPARATE_FORMULA_REASON,
      c45Dropped: false,
      c45WouldDrop: false,
      xuAmount,
      xuStatus: xu?.status || 'xu_source_unavailable',
      xuMissing: finite(xu?.missing),
      total: xuFinal ? appliedAmount : null,
      provisionalTotal: xuAmount,
      appliedAmount,
      cappedByC45: false,
      provisional: !xuFinal,
      formulaText: employeeIncentivePolicy.SEPARATE_FORMULA_MESSAGE,
      label: 'DN022: chỉ áp dụng phạt thiếu Xu; chờ công thức thưởng/phạt riêng của CEO.',
      warning: null,
      afterPenaltyTotal: numericCostTotal == null ? null : Math.max(0, Math.round(numericCostTotal) - appliedAmount),
    };
  }
  const mode = resolveMode(period, config);
  const numericTarget = finite(target);
  const numericAchieved = finite(achieved);
  const numericC45 = finite(c45Amount);
  const pct = numericTarget > 0 && numericAchieved != null ? numericAchieved / numericTarget * 100 : null;
  const tier = pct == null ? null : tierForPct(pct, config);
  let status;
  let targetAmount = null;
  let cappedByC45 = false;
  let c45Dropped = false;
  let c45WouldDrop = false;
  if (mode === 'off') status = 'disabled';
  else if (!(numericTarget > 0) || pct == null) status = 'missing_target';
  else if (!normalized.configured || !tier) status = 'unconfigured';
  else if (tier.tier === 'none') {
    targetAmount = 0;
    status = mode === 'warn_only' ? 'warn_only' : (closed ? 'final' : 'provisional');
  } else if (numericC45 == null) status = 'c45_unavailable';
  else {
    const tierDropsC45 = tier.dropC45 === true;
    c45Dropped = mode === 'enforced' && tierDropsC45;
    c45WouldDrop = mode === 'warn_only' && tierDropsC45;
    const uncapped = tierDropsC45 ? numericC45 : Math.round(numericAchieved * (tier.ratePct || 0) / 100);
    targetAmount = Math.max(0, Math.min(Math.round(numericC45), uncapped));
    cappedByC45 = !tierDropsC45 && uncapped > numericC45;
    status = mode === 'warn_only' ? 'warn_only' : (closed ? 'final' : 'provisional');
  }
  const xuAmount = finite(xu?.amount);
  const xuComplete = !normalized.xuPenalty.enabled || xuAmount != null;
  // Khi bật Xu nhưng nguồn/chốt quý chưa đủ, tổng phạt vẫn là unknown. Không
  // được ngầm coi Xu=0; phần target đã biết chỉ xuất qua provisionalTotal.
  const total = targetAmount == null || !xuComplete ? null : Math.max(0, targetAmount + (xuAmount || 0));
  const provisionalTotal = targetAmount == null ? null : Math.max(0, targetAmount + (xuAmount || 0));
  // Warn/off có số trừ chính xác bằng 0. Kỳ enforced mà tổng chưa biết phải
  // giữ null xuyên suốt để không tạo số sau-phạt giả.
  const appliedAmount = mode === 'enforced' ? total : 0;
  const numericCostTotal = finite(costTotal);
  const afterPenaltyTotal = numericCostTotal == null || appliedAmount == null
    ? null
    : Math.max(0, Math.round(numericCostTotal) - appliedAmount);
  const ratePct = tier?.ratePct ?? null;
  let formulaText = '';
  if (status === 'missing_target') formulaText = 'Chưa giao target — không có căn cứ phạt.';
  else if (status === 'c45_unavailable') formulaText = 'C45 chưa đủ dữ liệu — fail-closed, không phạt.';
  else if (status === 'unconfigured') formulaText = 'Chưa cấu hình đủ bậc phạt — không phạt.';
  else if (mode === 'off') formulaText = 'Chính sách phạt chưa áp dụng cho kỳ này.';
  else if (tier?.tier === 'none') formulaText = `Đạt ${formatPct(pct)}% (${tierRangeText(tier)}) — không phạt, tiếp tục công thức thưởng.`;
  else if (c45WouldDrop) formulaText = `Chạy thử: đạt ${formatPct(pct)}% (${tierRangeText(tier)}) → nếu áp dụng từ ${formatDate(normalized.penaltyEffectiveFrom)} sẽ mất trắng C45 ${formatMoney(numericC45)}; tháng này chưa trừ tiền.`;
  else if (c45Dropped) formulaText = `Đạt ${formatPct(pct)}% (${tierRangeText(tier)}) → mất trắng C45 ${formatMoney(numericC45)}.`;
  else formulaText = `Đạt ${formatPct(pct)}% → bậc ${tierRangeText(tier)} → trừ ${formatPct(ratePct)}% × doanh thu ${formatMoney(numericAchieved)} = ${formatMoney(targetAmount)} (tối đa bằng C45 ${formatMoney(numericC45)})`;
  const warning = warningFor({
    period, mode, closed, target: numericTarget, achieved: numericAchieved, pct,
    tier: tier?.tier, c45Amount: numericC45, targetAmount, rawConfig: config,
  });
  const label = mode === 'warn_only'
    ? `${uiPeriod(period)} CHỈ CẢNH BÁO — chưa trừ tiền. Từ ${formatDate(normalized.penaltyEffectiveFrom)} mới áp dụng trừ thật.`
    // NHÃN THEO KHOÁ SỔ (CEO chốt 30/07): trước khi khoá sổ mọi số là DỰ KIẾN vì
    // doanh thu còn cập nhật; sau ngày khoá sổ mới là SỐ CHÍNH THỨC của kỳ.
    // Ngày khoá sổ do tầng gọi truyền vào qua `closeLabel`
    // (employeeCost.periodCloseLabel) để chỉ có MỘT nguồn biết ngày — module này
    // không tự đoán ngày.
    : closed
      ? `ĐÃ CHỐT KỲ — số chính thức của kỳ${closeLabel ? ` · ${closeLabel}` : ''}. Kế toán chi trả theo bảng lương.`
      : `DỰ KIẾN — ${closeLabel || 'doanh thu còn cập nhật, chưa khoá sổ'} · ${DISCLAIMER}`;
  return {
    mode,
    // Kỳ đã khoá sổ chưa, và số phạt đã là số cuối chưa. `finalized` chỉ đúng khi
    // vừa TRỪ THẬT vừa ĐÃ KHOÁ SỔ — đây là điều kiện để chuyển số cho kế toán.
    closed: closed === true,
    closeLabel: String(closeLabel || ''),
    finalized: mode === 'enforced' && closed === true,
    effectiveFrom: normalized.penaltyEffectiveFrom,
    enabled: normalized.penaltyEnabled,
    targetPct: pct == null ? null : +pct.toFixed(2),
    tier: tier?.tier || null,
    ratePct,
    c45Amount: numericC45 == null ? null : Math.round(numericC45),
    targetAmount,
    targetStatus: status,
    penaltyStatus: status,
    c45Dropped,
    c45WouldDrop,
    xuAmount,
    xuStatus: xu?.status || (normalized.xuPenalty.enabled ? 'xu_source_unavailable' : 'disabled'),
    xuMissing: finite(xu?.missing),
    total,
    provisionalTotal,
    appliedAmount,
    cappedByC45,
    provisional: status === 'provisional' || status === 'warn_only',
    formulaText,
    label,
    warning,
    afterPenaltyTotal,
  };
}

function distributeAdjustment(dailyTotals, amount) {
  const rows = Array.isArray(dailyTotals) ? dailyTotals.map((row) => ({ ...row })) : [];
  if (!rows.length || !(amount > 0)) return rows.map((row) => ({ ...row, penaltyAmount: 0, afterPenaltyTotal: row.monthlyTotal }));
  const total = rows.reduce((sum, row) => sum + Math.max(0, finite(row.monthlyTotal) || 0), 0);
  let allocated = 0;
  return rows.map((row, index) => {
    const penaltyAmount = index === rows.length - 1
      ? Math.round(amount) - allocated
      : Math.round(amount * Math.max(0, finite(row.monthlyTotal) || 0) / (total || rows.length));
    allocated += penaltyAmount;
    return { ...row, penaltyAmount, afterPenaltyTotal: Math.max(0, Math.round(row.monthlyTotal) - penaltyAmount) };
  });
}

function applyToCostPeriod(periodPayload, penalty) {
  if (!periodPayload || typeof periodPayload !== 'object') return periodPayload;
  const applied = finite(penalty?.appliedAmount);
  if (applied == null) {
    return {
      ...periodPayload,
      summary: {
        ...periodPayload.summary,
        penaltyAppliedAmount: null,
        afterPenaltyTotal: null,
      },
      daily: {
        ...periodPayload.daily,
        totals: periodPayload.daily?.reliable
          ? (periodPayload.daily.totals || []).map((day) => ({ ...day, penaltyAmount: null, afterPenaltyTotal: null }))
          : [],
      },
    };
  }
  let dailyTotals = periodPayload.daily?.reliable ? distributeAdjustment(periodPayload.daily.totals, applied) : [];
  if (periodPayload.daily?.reliable && penalty?.c45Dropped && penalty?.mode === 'enforced') {
    const c45ByDate = new Map();
    for (const row of periodPayload.rows || []) {
      for (const [date, amounts] of Object.entries(row.dailyAmounts || {})) {
        c45ByDate.set(date, (c45ByDate.get(date) || 0) + (finite(amounts?.c45) || 0));
      }
    }
    dailyTotals = (periodPayload.daily.totals || []).map((day) => {
      const penaltyAmount = Math.round(c45ByDate.get(day.date) || 0);
      return { ...day, penaltyAmount, afterPenaltyTotal: Math.max(0, Math.round(day.monthlyTotal) - penaltyAmount) };
    });
  }
  return {
    ...periodPayload,
    summary: {
      ...periodPayload.summary,
      penaltyAppliedAmount: applied,
      afterPenaltyTotal: periodPayload.summary?.monthlyTotal == null
        ? null : Math.max(0, periodPayload.summary.monthlyTotal - applied),
    },
    daily: {
      ...periodPayload.daily,
      totals: dailyTotals,
    },
  };
}

module.exports = {
  WARN_ONLY_LABEL,
  DISCLAIMER,
  DEFAULT_TIERS,
  normalizeConfig,
  resolveMode,
  tierForPct,
  ceil1k,
  nextThreshold,
  warningFor,
  buildXuPenalty,
  buildPenalty,
  distributeAdjustment,
  applyToCostPeriod,
};
