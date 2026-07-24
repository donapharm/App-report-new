const NOTE = 'chưa lấy được điểm/xu kỳ này';

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
    source: String(raw.source || 'App VAT'),
    note: String(raw.note || (available ? '' : NOTE)),
    empCode: String(raw.emp_code || ''),
    empName: String(raw.emp_name || raw.emp_code || ''),
    selected: {
      month: numberOrNull(raw.selected?.month),
      year: numberOrNull(raw.selected?.year),
      quarter: numberOrNull(raw.selected?.quarter),
    },
    quarterLabel: String(raw.quarter_label || ''),
    diemThang: numberOrNull(raw.diem_thang),
    diemQuy: numberOrNull(raw.diem_quy),
    xuThang: numberOrNull(raw.xu_thang),
    xuQuy: numberOrNull(raw.xu_quy),
    xuQuyTong: numberOrNull(raw.xu_quy_tong),
    carry: numberOrNull(raw.carry),
    pctThang: numberOrNull(raw.pct_thang),
    pctQuy: numberOrNull(raw.pct_quy),
    thieuDu: numberOrNull(raw.thieu_du),
    thieuXu: numberOrNull(raw.thieu_xu),
    duXu: numberOrNull(raw.du_xu),
    phatDuKien: numberOrNull(raw.phat_du_kien),
    ruleVersion: String(raw.rule_version || ''),
    penaltyRule: String(raw.penalty_rule || ''),
    upstreamWarning: String(raw.upstream_warning || ''),
    warningCount: numberOrNull(raw.warning_count) || 0,
    employeeSubtotals: (Array.isArray(raw.employeeSubtotals) ? raw.employeeSubtotals : []).map((item) => ({
      empCode: String(item?.emp_code || ''),
      empName: String(item?.emp_name || item?.emp_code || ''),
      diemThang: numberOrNull(item?.diem_thang),
      diemQuy: numberOrNull(item?.diem_quy),
      xuThang: numberOrNull(item?.xu_thang),
      xuQuyTong: numberOrNull(item?.xu_quy_tong),
      carry: numberOrNull(item?.carry),
      pctQuy: numberOrNull(item?.pct_quy),
      phatDuKien: numberOrNull(item?.phat_du_kien),
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
