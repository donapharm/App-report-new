'use strict';

/**
 * Chính sách phân bổ doanh thu theo vai trò nhân viên.
 *
 * CEO chốt 31/07/2026: VP018 là Telesaler, không phải nhân viên Sale nên
 * tuyệt đối không được nhận doanh thu từ C6/emp_code. Nếu nguồn gán nhầm,
 * App Report giữ nguyên doanh thu toàn công ty nhưng cách ly phần phân bổ
 * nhân viên về UNALLOCATED để không làm sai doanh số, target hay thưởng/phạt.
 */
const REVENUE_ATTRIBUTION_BLOCKED_EMP_CODES = new Set(['VP018']);

function normalizeEmpCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isRevenueAttributionBlocked(empCode) {
  return REVENUE_ATTRIBUTION_BLOCKED_EMP_CODES.has(normalizeEmpCode(empCode));
}

function quarantineRevenueRow(row = {}, { now = '' } = {}) {
  const empCode = normalizeEmpCode(row.emp_code);
  if (!isRevenueAttributionBlocked(empCode)) return row;
  return {
    ...row,
    raw_emp_code: row.raw_emp_code || row.raw_nv || row.emp_code,
    blocked_emp_code: empCode,
    emp_code: 'UNALLOCATED',
    emp_name: 'Chưa phân bổ',
    attribution_status: 'NON_SALES_ROLE_QUARANTINED',
    ...(now ? { attribution_quarantined_at: now } : {}),
  };
}

module.exports = {
  REVENUE_ATTRIBUTION_BLOCKED_EMP_CODES,
  normalizeEmpCode,
  isRevenueAttributionBlocked,
  quarantineRevenueRow,
};
