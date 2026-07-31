'use strict';

/**
 * Phạm vi công thức thưởng/phạt theo nhân viên — quyết định CEO 31/07/2026.
 *
 * DN022 không được đi qua công thức thưởng P1/P2 hoặc phạt theo target/C45
 * hiện tại. Mã này chờ một công thức riêng do CEO ban hành sau.
 *
 * Phạt thiếu Xu là một luồng độc lập. Chỉ ba mã CTV dưới đây thuộc phạm vi
 * phạt Xu; việc loại DN022 khỏi công thức tiền hiện tại không được vô tình
 * loại DN022 khỏi phép tính Xu.
 */
const SEPARATE_FORMULA_EMP_CODES = new Set(['DN022']);
const XU_PENALTY_EMP_CODES = new Set(['DN002', 'DN004', 'DN022']);
// Chỉ áp dụng cho tin có nội dung thưởng/phạt bằng tiền. Không đưa các mã này
// vào notify_optout chung vì họ vẫn có thể nhận target, doanh thu và cảnh báo
// vận hành đúng phạm vi.
const MONETARY_NOTIFY_BLOCKED_EMP_CODES = new Set([
  'DN002', 'DN004', 'DN021', 'DN022', 'DN023', 'VP004', 'VP018',
]);

const normalizeEmpCode = (value) => String(value || '').trim().toUpperCase();
const requiresSeparateFormula = (empCode) => SEPARATE_FORMULA_EMP_CODES.has(normalizeEmpCode(empCode));
const isXuPenaltyEmployee = (empCode) => XU_PENALTY_EMP_CODES.has(normalizeEmpCode(empCode));
const isMonetaryNotifyBlocked = (empCode) => MONETARY_NOTIFY_BLOCKED_EMP_CODES.has(normalizeEmpCode(empCode));

const SEPARATE_FORMULA_REASON = 'employee_separate_formula_pending';
const SEPARATE_FORMULA_MESSAGE = 'DN022 đang chờ công thức thưởng/phạt riêng do CEO ban hành; hệ thống không áp dụng công thức P1/P2 hoặc phạt target/C45 hiện tại.';

module.exports = {
  SEPARATE_FORMULA_EMP_CODES,
  XU_PENALTY_EMP_CODES,
  MONETARY_NOTIFY_BLOCKED_EMP_CODES,
  SEPARATE_FORMULA_REASON,
  SEPARATE_FORMULA_MESSAGE,
  normalizeEmpCode,
  requiresSeparateFormula,
  isXuPenaltyEmployee,
  isMonetaryNotifyBlocked,
};
