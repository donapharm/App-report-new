'use strict';

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ALL/CEO view: only aggregate penalty results that were already calculated by
// the backend for each self-scoped employee report. Never rederive a team tier,
// target percentage or rate: those values have no valid aggregate meaning.
//
// `total` remains fail-closed when even one employee has no calculable penalty.
// `provisionalTotal` is exposed separately so the UI may state the known subtotal
// together with its coverage instead of silently converting an unknown value to 0.
function aggregatePenaltySummaries(reports = []) {
  const items = (Array.isArray(reports) ? reports : []).filter(Boolean).map((report) => ({
    empCode: String(report.empCode || '').trim().toUpperCase(),
    penalty: report.penalty && typeof report.penalty === 'object' ? report.penalty : null,
    baseTotal: finite(report.summary?.periodTotal),
    afterPenaltyTotal: finite(report.summary?.afterPenaltyTotal),
  }));
  if (!items.length) return null;

  const aggregateValues = (fieldValues) => {
    const known = fieldValues.filter((value) => value != null);
    return {
      value: known.length === items.length ? known.reduce((sum, value) => sum + value, 0) : null,
      provisional: known.reduce((sum, value) => sum + value, 0),
      contributors: known.length,
    };
  };
  const aggregateField = (key) => aggregateValues(items.map((item) => finite(item.penalty?.[key])));
  const target = aggregateField('targetAmount');
  const total = aggregateField('total');
  // Khi Xu chưa chốt, penalty.total phải null nhưng phần target/C45 đã biết vẫn
  // nằm ở penalty.provisionalTotal. Chỉ đưa phần này ra field provisional rõ
  // ràng; không nâng nó thành total/applied chính thức.
  const provisionalTotals = items.map((item) => finite(item.penalty?.total) ?? finite(item.penalty?.provisionalTotal));
  const provisionalKnown = provisionalTotals.filter((value) => value != null);
  // buildPenalty intentionally returns appliedAmount=0 in warn-only periods even
  // when a potential amount is unavailable: zero is final because nothing may be
  // deducted in that mode. In enforced mode, however, total=null means the applied
  // amount is also unknown and must not be silently aggregated as zero.
  const applied = aggregateValues(items.map((item) => {
    if (!item.penalty || (item.penalty.mode === 'enforced' && finite(item.penalty.total) == null)) return null;
    return finite(item.penalty.appliedAmount);
  }));
  const c45 = aggregateField('c45Amount');
  const baseValues = items.map((item) => item.baseTotal);
  const afterValues = items.map((item) => item.afterPenaltyTotal);
  const baseKnown = baseValues.filter((value) => value != null);
  const afterKnown = afterValues.filter((value) => value != null);
  const baseTotal = baseKnown.length === items.length ? baseKnown.reduce((sum, value) => sum + value, 0) : null;
  const afterPenaltyTotal = applied.contributors === items.length && afterKnown.length === items.length
    ? afterKnown.reduce((sum, value) => sum + value, 0)
    : null;

  // Xu may legitimately be null while disabled or while the quarter is still
  // open. Only numeric Xu values are summed; source failures remain explicit.
  const xuRows = items.filter((item) => item.penalty?.xuStatus !== 'disabled');
  const xuKnown = xuRows.map((item) => finite(item.penalty?.xuAmount)).filter((value) => value != null);
  const xuMissingValues = xuRows.map((item) => finite(item.penalty?.xuMissing));
  const validXuStatuses = new Set(['quarter_pending', 'provisional', 'final', 'xu_source_unavailable', 'finance_reconciliation_pending']);
  const xuUnavailable = xuRows.some((item) => !item.penalty
    || !validXuStatuses.has(item.penalty.xuStatus)
    || item.penalty.xuStatus === 'xu_source_unavailable'
    || item.penalty.xuStatus === 'finance_reconciliation_pending');
  const xuPending = xuRows.some((item) => item.penalty?.xuStatus === 'quarter_pending');
  const xuAmount = xuRows.length > 0 && !xuUnavailable && !xuPending && xuKnown.length === xuRows.length
    ? xuKnown.reduce((sum, value) => sum + value, 0)
    : null;
  const xuMissing = xuRows.length > 0 && xuMissingValues.every((value) => value != null)
    ? xuMissingValues.reduce((sum, value) => sum + value, 0)
    : null;
  const xuStatus = !xuRows.length ? 'disabled'
    : xuUnavailable ? 'partially_unavailable'
      : xuPending ? 'quarter_pending'
        : xuRows.some((item) => item.penalty?.xuStatus === 'provisional') ? 'provisional'
          : 'final';

  const unavailableEmployees = items
    .filter((item) => !item.penalty || finite(item.penalty.total) == null)
    .map((item) => item.empCode).filter(Boolean);
  const modes = new Set(items.map((item) => String(item.penalty?.mode || '')).filter(Boolean));
  const effectiveFroms = new Set(items.map((item) => String(item.penalty?.effectiveFrom || '')).filter(Boolean));
  const complete = total.contributors === items.length;
  const formulaText = complete
    ? `Cộng trực tiếp ${items.length}/${items.length} kết quả phạt từng nhân viên do backend tính; không tính lại target, bậc hoặc tỷ lệ ở frontend.`
    : `Tạm cộng ${total.contributors}/${items.length} kết quả phạt từng nhân viên do backend tính; còn thiếu ${unavailableEmployees.join(', ') || `${items.length - total.contributors} nhân viên`}.`;
  const disclaimer = 'Dự kiến/tham khảo — chưa trừ lương';

  return {
    aggregate: true,
    scope: 'team_full_range',
    mode: modes.size === 1 ? [...modes][0] : 'mixed',
    effectiveFrom: effectiveFroms.size === 1 ? [...effectiveFroms][0] : '',
    enabled: items.some((item) => item.penalty?.enabled === true),
    targetPct: null,
    tier: 'aggregate',
    ratePct: null,
    c45Amount: c45.value,
    provisionalC45Amount: c45.provisional,
    targetAmount: target.value,
    provisionalTargetAmount: target.provisional,
    targetStatus: complete ? 'aggregate' : 'partially_unavailable',
    penaltyStatus: complete ? 'aggregate' : 'partially_unavailable',
    c45Dropped: items.some((item) => item.penalty?.c45Dropped === true),
    c45WouldDrop: items.some((item) => item.penalty?.c45WouldDrop === true),
    xuAmount,
    provisionalXuAmount: xuKnown.reduce((sum, value) => sum + value, 0),
    xuStatus,
    xuMissing,
    xuEmployeeCount: xuRows.length,
    xuContributors: xuKnown.length,
    total: total.value,
    provisionalTotal: provisionalKnown.reduce((sum, value) => sum + value, 0),
    provisionalContributors: provisionalKnown.length,
    appliedAmount: applied.value,
    provisionalAppliedAmount: applied.provisional,
    appliedContributors: applied.contributors,
    cappedByC45: items.some((item) => item.penalty?.cappedByC45 === true),
    provisional: !complete || items.some((item) => item.penalty?.provisional === true),
    formulaText,
    label: complete
      ? `Tổng toàn đội từ backend · ${disclaimer}`
      : `Tạm tính ${total.contributors}/${items.length} NV · ${disclaimer}`,
    warning: null,
    baseTotal,
    afterPenaltyTotal,
    employeeCount: items.length,
    contributors: total.contributors,
    unavailableCount: items.length - total.contributors,
    unavailableEmployees,
    complete,
  };
}

module.exports = { aggregatePenaltySummaries };
