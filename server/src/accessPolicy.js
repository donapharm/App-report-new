'use strict';

// CEO chốt 08/08/2026: các mã này không thuộc phạm vi được phép đăng nhập
// App Report. Giữ policy ở backend thay vì xóa khỏi users.json vì danh bạ còn
// được dùng để gắn tên vào dữ liệu báo cáo.
const BLOCKED_LOGIN_EMP_CODES = new Set([
  'VP002', 'VP003',
  'VP006', 'VP007', 'VP008', 'VP009', 'VP010', 'VP011',
  'VP012', 'VP013', 'VP014', 'VP015', 'VP016', 'VP017',
  'DN021', 'DN023',
]);

// VP018 chỉ được xem hai tab doanh thu. Backend là cổng quyết định cuối cùng;
// frontend chỉ dùng access profile để không hiện đường điều hướng sai quyền.
const REVENUE_ONLY_EMP_CODES = new Set(['VP018']);
const REVENUE_ONLY_GET_PATHS = new Set([
  '/me',
  '/periods',
  '/filters',
  '/revenue',
  '/revenue/full',
]);

function normalizeEmpCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isLoginBlocked(empCode) {
  return BLOCKED_LOGIN_EMP_CODES.has(normalizeEmpCode(empCode));
}

function accessProfileFor(sessionOrCode) {
  const code = typeof sessionOrCode === 'object'
    ? sessionOrCode?.emp_code
    : sessionOrCode;
  return REVENUE_ONLY_EMP_CODES.has(normalizeEmpCode(code)) ? 'revenue_only' : 'standard';
}

function normalizeApiPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  let pathname = raw;
  try { pathname = new URL(raw, 'http://app-report.local').pathname; } catch { /* fail closed below */ }
  if (pathname === '/api') return '/';
  return pathname.startsWith('/api/') ? pathname.slice(4) : pathname;
}

function isRequestAllowed(session, { method, path } = {}) {
  if (accessProfileFor(session) !== 'revenue_only') return true;
  if (String(method || '').toUpperCase() !== 'GET') return false;
  return REVENUE_ONLY_GET_PATHS.has(normalizeApiPath(path));
}

module.exports = {
  BLOCKED_LOGIN_EMP_CODES,
  REVENUE_ONLY_EMP_CODES,
  REVENUE_ONLY_GET_PATHS,
  normalizeEmpCode,
  normalizeApiPath,
  isLoginBlocked,
  accessProfileFor,
  isRequestAllowed,
};
