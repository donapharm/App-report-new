'use strict';

const accessPolicy = require('./accessPolicy');

const EMP_CODE_PATTERN = /^[A-Z][A-Z0-9._-]{1,31}$/;
const ACCESS_PROFILE_NONE = 'none';

/**
 * Quyết định duy nhất để Home có render ô App Report hay không.
 *
 * Denylist và revenue-only luôn lấy trực tiếp từ accessPolicy của App Report;
 * Home không được nhận hoặc giữ một bản sao danh sách. Với mã thông thường,
 * account phải còn tồn tại trong danh bạ App Report thì mới được mời đăng nhập.
 */
function decide(rawEmpCode, { findUserByCode } = {}) {
  const empCode = accessPolicy.normalizeEmpCode(rawEmpCode);
  if (!EMP_CODE_PATTERN.test(empCode)) {
    return { empCode, visible: false, reason: 'INVALID_EMP_CODE', accessProfile: ACCESS_PROFILE_NONE };
  }

  const accessProfile = accessPolicy.accessProfileFor(empCode);
  if (accessPolicy.isLoginBlocked(empCode)) {
    return { empCode, visible: false, reason: 'LOGIN_BLOCKED', accessProfile };
  }

  // Policy revenue-only là quyết định chủ động của CEO và vẫn phải hiện ô Home.
  if (accessProfile === 'revenue_only') {
    return { empCode, visible: true, reason: 'REVENUE_ONLY', accessProfile };
  }

  const accountExists = typeof findUserByCode === 'function' && !!findUserByCode(empCode);
  if (!accountExists) {
    return { empCode, visible: false, reason: 'ACCOUNT_NOT_FOUND', accessProfile: ACCESS_PROFILE_NONE };
  }

  return { empCode, visible: true, reason: 'ALLOWED', accessProfile };
}

module.exports = { decide, EMP_CODE_PATTERN, ACCESS_PROFILE_NONE };
