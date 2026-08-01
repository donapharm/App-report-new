'use strict';

function moneyOrNull(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function unavailableReason(afterPenaltyTotal, salaryAdvance) {
  if (moneyOrNull(afterPenaltyTotal) == null) return 'after_penalty_total_unavailable';
  if (!salaryAdvance || typeof salaryAdvance !== 'object') return 'salary_advance_unavailable';
  if (salaryAdvance.suspect === true) return 'salary_advance_exceeds_after_penalty_total';
  if (salaryAdvance.available !== true || salaryAdvance.applicable !== true) {
    return salaryAdvance.applicable === false ? 'salary_advance_not_applicable' : 'salary_advance_unavailable';
  }
  if (moneyOrNull(salaryAdvance.amount) == null) return 'salary_advance_unavailable';
  return null;
}

// Backend là SSOT cho phép trừ. Nếu một nguồn thiếu hoặc số ứng đáng ngờ thì
// amount=null; frontend không được tự tính, kẹp về 0 hoặc hiển thị số âm giả.
function buildRemainingAfterAdvance({ period, afterPenaltyTotal, salaryAdvance, periodClosed = false } = {}) {
  const baseAmount = moneyOrNull(afterPenaltyTotal);
  const advanceAmount = moneyOrNull(salaryAdvance?.amount);
  const reason = unavailableReason(baseAmount, salaryAdvance);
  const common = {
    period: String(period || '').trim(),
    currency: 'VND',
    afterPenaltyTotal: baseAmount,
    salaryAdvanceAmount: advanceAmount,
  };
  if (reason) return Object.freeze({
    ...common,
    available: false,
    amount: null,
    locked: false,
    status: 'provisional',
    suspect: reason === 'salary_advance_exceeds_after_penalty_total',
    reason,
    note: reason === 'salary_advance_exceeds_after_penalty_total'
      ? 'Số ứng nghi sai; chưa thể tính số còn lại.'
      : 'Chưa đủ dữ liệu để tính số còn lại sau ứng lần 1.',
  });

  const amount = baseAmount - advanceAmount;
  // Chốt chặn độc lập để không phụ thuộc duy nhất vào cờ guard của caller.
  if (amount < 0) return Object.freeze({
    ...common,
    available: false,
    amount: null,
    locked: false,
    status: 'provisional',
    suspect: true,
    reason: 'salary_advance_exceeds_after_penalty_total',
    note: 'Số ứng nghi sai; chưa thể tính số còn lại.',
  });

  const locked = periodClosed === true && salaryAdvance.locked === true;
  return Object.freeze({
    ...common,
    available: true,
    amount,
    locked,
    status: locked ? 'locked' : 'provisional',
    suspect: false,
    reason: null,
    note: locked ? 'Đã chốt.' : 'Dự kiến · chưa chốt.',
  });
}

module.exports = { moneyOrNull, buildRemainingAfterAdvance };
