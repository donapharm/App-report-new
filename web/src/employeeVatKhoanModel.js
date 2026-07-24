const NOTE = 'chưa lấy được xu kỳ này';

function numberOrNull(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function employeeVatKhoanViewModel(raw = {}) {
  const available = raw.available === true;
  return {
    available,
    aggregate: raw.aggregate === true,
    source: String(raw.source || 'App Report'),
    sourceLabel: String(raw.source_label || raw.source || 'App Report (điểm) + App VAT (xu)'),
    note: String(raw.note || (available ? '' : NOTE)),
    empCode: String(raw.emp_code || ''),
    empName: String(raw.emp_name || raw.emp_code || ''),
    selected: {
      month: numberOrNull(raw.selected?.month),
      year: numberOrNull(raw.selected?.year),
      quarter: numberOrNull(raw.selected?.quarter),
    },
    quarterLabel: String(raw.quarter_label || ''),
    diemThang: numberOrNull(raw.point_month ?? raw.diem_thang),
    diemQuy: numberOrNull(raw.point_quarter ?? raw.diem_quy),
    xuThang: numberOrNull(raw.xu_month ?? raw.xu_thang),
    xuQuy: numberOrNull(raw.xu_quarter ?? raw.xu_quy),
    xuQuyTong: numberOrNull(raw.xu_quarter_total ?? raw.xu_quy_tong),
    carry: numberOrNull(raw.carry),
    pctThang: numberOrNull(raw.pct_month ?? raw.pct_thang),
    pctQuy: numberOrNull(raw.pct_quarter ?? raw.pct_quy),
    thieuDu: numberOrNull(raw.thieu_du),
    thieuXu: numberOrNull(raw.missing_quarter ?? raw.thieu_xu),
    duXu: numberOrNull(raw.excess_quarter ?? raw.du_xu),
    phatDuKien: numberOrNull(raw.penalty_display ?? raw.phat_du_kien),
    penaltyApplied: numberOrNull(raw.penalty_applied),
    pointRuleVersion: String(raw.point_rule_version || raw.rule_version || ''),
    pointRuleEffectiveFrom: String(raw.point_rule_effective_from || ''),
    xuRuleVersion: String(raw.xu_rule_version || ''),
    ruleVersion: String(raw.point_rule_version || raw.rule_version || ''),
    upstreamWarning: String(raw.upstream_warning || ''),
    warningCount: numberOrNull(raw.warning_count) || 0,
    dqWarningCount: numberOrNull(raw.dq_warning_count) || 0,
    quarterStatus: String(raw.quarter_status || raw.parity?.status || ''),
    parity: {
      available: raw.parity?.available === true,
      status: String(raw.parity?.status || ''),
      note: String(raw.parity?.note || ''),
      exactZeroParity: raw.parity?.exactZeroParity === true,
      pointRuleVersionMatch: raw.parity?.pointRuleVersionMatch === true,
    },
    employeeSubtotals: (Array.isArray(raw.employeeSubtotals) ? raw.employeeSubtotals : []).map((item) => ({
      empCode: String(item?.emp_code || ''),
      empName: String(item?.emp_name || item?.emp_code || ''),
      diemQuy: numberOrNull(item?.point_quarter ?? item?.diem_quy),
      xuQuyTong: numberOrNull(item?.xu_quarter_total ?? item?.xu_quy_tong),
      phatDuKien: numberOrNull(item?.penalty_display ?? item?.phat_du_kien),
      quarterStatus: String(item?.quarter_status || ''),
    })),
  };
}

export function employeeVatKhoanDeduction(baseCost, phatDuKien) {
  const base = numberOrNull(baseCost);
  const penalty = numberOrNull(phatDuKien);
  if (base == null || penalty == null) return { baseCost: base, deduction: null, remaining: null };
  return {
    baseCost: base,
    deduction: -Math.max(0, penalty),
    remaining: Math.round(base - Math.max(0, penalty)),
  };
}
