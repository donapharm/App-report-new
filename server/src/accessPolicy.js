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

// VP018 chỉ được xem hai tab doanh thu và tab Cơ số thầu. Backend là cổng quyết định cuối cùng;
// frontend chỉ dùng access profile để không hiện đường điều hướng sai quyền.
const REVENUE_ONLY_EMP_CODES = new Set(['VP018']);
const REVENUE_ONLY_GET_PATHS = new Set([
  '/me',
  '/periods',
  '/filters',
  '/revenue',
  '/revenue/full',
  '/cst',
  // Export của đúng hai tab doanh thu. Tab CST chỉ đọc trên màn, không export.
  // Liệt kê exact path, không wildcard;
  // CSV/PPTX và mọi export khác vẫn fail-closed.
  '/export/revenue.xlsx',
  '/export/revenue_report.xlsx',
  '/export/revenue_report.pdf',
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

function canReadAllRevenue(sessionOrCode) {
  return accessProfileFor(sessionOrCode) === 'revenue_only';
}

function canReadAllCst(sessionOrCode) {
  return accessProfileFor(sessionOrCode) === 'revenue_only';
}

function normalizeApiPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  // req.originalUrl luôn là path tương đối. Không dùng URL() để canonicalize vì
  // nó biến /api/../me hoặc dấu gạch chéo ngược thành path allowlisted. Với
  // policy exact-path, mọi biểu diễn khác byte/path chuẩn phải fail-closed.
  if (!raw.startsWith('/') || raw.includes('\\') || raw.includes('#')) return '/__invalid_revenue_only_path__';
  const pathname = raw.split('?', 1)[0];
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
  canReadAllRevenue,
  canReadAllCst,
  isRequestAllowed,
};
