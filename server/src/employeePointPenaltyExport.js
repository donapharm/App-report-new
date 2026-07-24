'use strict';

const CONTRACT_PATH = '/api/integrations/datahub/employee-quarter-penalty';
const RULE_VERSION = 'penalty-quarter-v2026-05-r1';

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function safeText(value, max = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseQuarter(value) {
  const match = /^(\d{4})-Q([1-4])$/.exec(String(value || '').trim().toUpperCase());
  if (!match) {
    const error = new Error('Quý không hợp lệ; dùng định dạng YYYY-Q1..Q4.');
    error.status = 400;
    error.code = 'EMPLOYEE_POINT_PENALTY_QUARTER_INVALID';
    throw error;
  }
  const year = Number(match[1]);
  if (year < 2024 || year > 2100) {
    const error = new Error('Quý không hợp lệ; dùng định dạng YYYY-Q1..Q4.');
    error.status = 400;
    error.code = 'EMPLOYEE_POINT_PENALTY_QUARTER_INVALID';
    throw error;
  }
  const quarter = Number(match[2]);
  const month = quarter * 3;
  return {
    quarter: `${year}-Q${quarter}`,
    label: `Q${quarter}/${year}`,
    period: `${year}-${String(month).padStart(2, '0')}`,
    month,
    year,
  };
}

function unavailable({ empCode, quarter, combined, reason }) {
  return {
    ok: false,
    available: false,
    read_only: true,
    source: 'App Report',
    emp_code: normEmp(empCode),
    quarter: quarter.quarter,
    quarter_end_period: quarter.period,
    point_quarter: combined?.point_quarter == null ? null : Number(combined.point_quarter),
    xu_quarter: combined?.xu_quarter_total == null ? null : Number(combined.xu_quarter_total),
    missing_xu: combined?.missing_quarter == null ? null : Number(combined.missing_quarter),
    phat_tien: null,
    rule_version: RULE_VERSION,
    point_rule_version: safeText(combined?.point_rule_version, 120),
    xu_rule_version: safeText(combined?.xu_rule_version, 120),
    status: 'đang đối soát',
    blocked_reason: reason,
  };
}

function buildExportPayload({ empCode, quarter, combined }) {
  const parsedQuarter = typeof quarter === 'string' ? parseQuarter(quarter) : quarter;
  const code = normEmp(empCode);
  if (!code || code === 'ALL') {
    const error = new Error('Endpoint chỉ cho phép một mã nhân viên mỗi lần gọi.');
    error.status = 400;
    error.code = 'EMPLOYEE_POINT_PENALTY_EMP_INVALID';
    throw error;
  }
  if (!combined || combined.available !== true || combined.emp_code !== code) {
    return unavailable({ empCode: code, quarter: parsedQuarter, combined, reason: 'scoped_data_unavailable' });
  }
  if (combined.xu_quarter_total == null) {
    return unavailable({ empCode: code, quarter: parsedQuarter, combined, reason: 'xu_unavailable' });
  }
  if (combined.parity?.available !== true
    || combined.parity?.exactZeroParity !== true
    || combined.parity?.pointRuleVersionMatch !== true
    || combined.parity?.periodMatch !== true
    || combined.parity?.quarterEnd !== true) {
    return unavailable({ empCode: code, quarter: parsedQuarter, combined, reason: 'parity_not_exact_zero' });
  }
  const point = Number(combined.point_quarter);
  const xu = Number(combined.xu_quarter_total);
  const missing = Number(combined.missing_quarter);
  const penalty = Number(combined.penalty_display);
  const expectedMissing = Math.max(0, point - xu);
  const expectedPenalty = Math.floor(expectedMissing / 2) * 600000;
  const versionsValid = safeText(combined.point_rule_version, 120) && safeText(combined.xu_rule_version, 120);
  const valuesValid = [point, xu, missing, penalty].every(Number.isFinite)
    && point >= 0 && xu >= 0 && missing >= 0 && penalty >= 0
    && Math.abs(missing - expectedMissing) < 1e-9
    && penalty === expectedPenalty;
  if (!versionsValid || !valuesValid) {
    return unavailable({ empCode: code, quarter: parsedQuarter, combined, reason: 'validated_values_invalid' });
  }
  return {
    ok: true,
    available: true,
    read_only: true,
    source: 'App Report',
    emp_code: code,
    quarter: parsedQuarter.quarter,
    quarter_end_period: parsedQuarter.period,
    point_quarter: point,
    xu_quarter: xu,
    missing_xu: missing,
    phat_tien: penalty,
    rule_version: RULE_VERSION,
    point_rule_version: safeText(combined.point_rule_version, 120),
    xu_rule_version: safeText(combined.xu_rule_version, 120),
    status: 'chốt quý — sẵn sàng DataHub duyệt',
    blocked_reason: '',
  };
}

module.exports = {
  CONTRACT_PATH,
  RULE_VERSION,
  parseQuarter,
  buildExportPayload,
};
