'use strict';

function moneyOrNull(value) {
  // Inputs are validated backend monetary fields. Reject coercion so an empty
  // or string upstream value can never silently become a monetary zero.
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function unavailableReason(afterPenaltyTotal, salaryAdvance) {
  if (moneyOrNull(afterPenaltyTotal) == null) return 'after_penalty_unavailable';
  if (!salaryAdvance || typeof salaryAdvance !== 'object') return 'salary_advance_unavailable';
  if (salaryAdvance.available !== true || salaryAdvance.applicable !== true) {
    return salaryAdvance.applicable === false ? 'salary_advance_not_applicable' : 'salary_advance_unavailable';
  }
  if (moneyOrNull(salaryAdvance.amount) == null) return 'salary_advance_unavailable';
  return null;
}

function assessSalaryAdvance({ afterPenaltyTotal, salaryAdvance } = {}) {
  if (!salaryAdvance || typeof salaryAdvance !== 'object') return salaryAdvance ?? null;
  const baseAmount = moneyOrNull(afterPenaltyTotal);
  const advanceAmount = moneyOrNull(salaryAdvance.amount);
  const comparable = baseAmount != null && advanceAmount != null
    && salaryAdvance.available === true && salaryAdvance.applicable === true;
  const suspect = comparable && advanceAmount > baseAmount;
  return Object.freeze({
    ...salaryAdvance,
    suspect,
    suspectReason: suspect ? 'amount_exceeds_after_penalty_total' : null,
    suspectMessage: suspect ? 'Số ứng App Salary lớn hơn tổng nhận — nghi sai, đang đối chiếu' : null,
    comparisonAfterPenaltyTotal: comparable ? baseAmount : null,
  });
}

function buildRemainingAfterAdvance({ period, afterPenaltyTotal, salaryAdvance, periodClosed = false } = {}) {
  const normalizedPeriod = String(period || '').trim();
  const baseAmount = moneyOrNull(afterPenaltyTotal);
  const advanceAmount = moneyOrNull(salaryAdvance?.amount);
  const reason = unavailableReason(baseAmount, salaryAdvance);
  if (reason) return Object.freeze({
    available: false,
    aggregate: false,
    period: normalizedPeriod,
    currency: 'VND',
    amount: null,
    afterPenaltyTotal: baseAmount,
    salaryAdvanceAmount: advanceAmount,
    locked: false,
    status: 'provisional',
    overAdvance: false,
    note: 'Chưa đủ dữ liệu để tính tổng còn lại sau ứng lần 1.',
    reason,
  });

  if (salaryAdvance.suspect === true || advanceAmount > baseAmount) return Object.freeze({
    available: false,
    aggregate: false,
    period: normalizedPeriod,
    currency: 'VND',
    amount: null,
    afterPenaltyTotal: baseAmount,
    salaryAdvanceAmount: advanceAmount,
    locked: false,
    status: 'anomaly',
    overAdvance: false,
    suspect: true,
    note: 'Số ứng App Salary lớn hơn tổng nhận — nghi sai, đang đối chiếu',
    reason: 'salary_advance_exceeds_after_penalty_total',
  });

  const amount = baseAmount - advanceAmount;
  const locked = periodClosed === true && salaryAdvance.locked === true;
  return Object.freeze({
    available: true,
    aggregate: false,
    period: normalizedPeriod,
    currency: 'VND',
    amount,
    afterPenaltyTotal: baseAmount,
    salaryAdvanceAmount: advanceAmount,
    locked,
    status: locked ? 'locked' : 'provisional',
    overAdvance: false,
    suspect: false,
    note: locked ? 'Đã chốt.' : 'Dự kiến · chưa chốt.',
    reason: null,
  });
}

function aggregateRemainingAfterAdvance(reports = []) {
  const items = (Array.isArray(reports) ? reports : []).map((report) => ({
    empCode: String(report?.empCode || '').trim().toUpperCase(),
    value: report?.remainingAfterAdvance && typeof report.remainingAfterAdvance === 'object'
      ? report.remainingAfterAdvance
      : null,
  }));
  const known = items.filter((item) => moneyOrNull(item.value?.amount) != null);
  const missing = items.filter((item) => moneyOrNull(item.value?.amount) == null);
  const suspect = items.filter((item) => item.value?.suspect === true
    || item.value?.reason === 'salary_advance_exceeds_after_penalty_total');
  const subtotal = known.length
    ? known.reduce((sum, item) => sum + moneyOrNull(item.value.amount), 0)
    : null;
  const complete = items.length > 0 && missing.length === 0;
  const locked = complete && known.every((item) => item.value.locked === true && item.value.status === 'locked');
  return Object.freeze({
    available: complete,
    aggregate: true,
    scope: 'team_backend_employee_values',
    period: String(items.find((item) => item.value?.period)?.value.period || ''),
    currency: 'VND',
    amount: complete ? subtotal : null,
    subtotal,
    employeeCount: items.length,
    contributors: known.length,
    missingCount: missing.length,
    missingEmployees: missing.map((item) => item.empCode).filter(Boolean),
    complete,
    locked,
    status: locked ? 'locked' : 'provisional',
    overAdvance: false,
    overAdvanceCount: 0,
    suspect: suspect.length > 0,
    suspectCount: suspect.length,
    suspectEmployees: suspect.map((item) => item.empCode).filter(Boolean),
    note: suspect.length > 0 ? 'Có số ứng App Salary lớn hơn tổng nhận — nghi sai, đang đối chiếu.'
      : complete ? (locked ? 'Đã chốt toàn đội.' : 'Dự kiến · chưa chốt toàn đội.')
        : 'Tạm tính trên nhân viên đủ dữ liệu; nhân viên thiếu nguồn không được coi là 0.',
    reason: complete ? null : 'partially_unavailable',
  });
}

module.exports = {
  moneyOrNull,
  assessSalaryAdvance,
  buildRemainingAfterAdvance,
  aggregateRemainingAfterAdvance,
};
