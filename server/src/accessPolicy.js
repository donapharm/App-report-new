'use strict';

// CEO chốt 08/08/2026: các mã này không thuộc phạm vi được phép đăng nhập
// App Report. Giữ policy ở backend thay vì xóa khỏi users.json vì danh bạ còn
// được dùng để gắn tên vào dữ liệu báo cáo.
// CONTRACT CEO 26/08/2026: denylist này CHỈ quyết định quyền đăng nhập. DN021 và
// DN023 vẫn thuộc reporting roster 21 người của CEO; cấm tái dùng tập này để lọc
// tổng hợp doanh thu/chi phí. Quyền gửi ngoài được chặn bằng policy riêng.
const BLOCKED_LOGIN_EMP_CODES = new Set([
  'VP002', 'VP003',
  'VP006', 'VP007', 'VP008', 'VP009', 'VP010',
  'VP012', 'VP013', 'VP014', 'VP015', 'VP016', 'VP017',
  'DN021', 'DN023',
]);

// VP011/VP018/VP019 chỉ được xem hai tab doanh thu và tab Cơ số thầu. Backend là cổng quyết định cuối cùng;
// frontend chỉ dùng access profile để không hiện đường điều hướng sai quyền.
function readonlySet(values, label) {
  const source = new Set(values);
  const rejectMutation = () => { throw new TypeError(`${label} is read-only`); };
  const facade = {
    get size() { return source.size; },
    has: source.has.bind(source),
    values: source.values.bind(source),
    keys: source.keys.bind(source),
    entries: source.entries.bind(source),
    forEach(callback, thisArg) {
      for (const value of source) callback.call(thisArg, value, value, facade);
    },
    [Symbol.iterator]: source[Symbol.iterator].bind(source),
    add: rejectMutation,
    delete: rejectMutation,
    clear: rejectMutation,
  };
  return Object.freeze(facade);
}

const COMMON_RESTRICTED_GET_PATHS = [
  '/me',
  '/periods',
  '/filters',
];
const REVENUE_GET_PATHS = [
  '/revenue',
  '/revenue/full',
  '/export/revenue.xlsx',
  '/export/revenue_report.xlsx',
  '/export/revenue_report.pdf',
];
const CST_GET_PATHS = ['/cst'];

function normalizeEmpCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isLoginBlocked(empCode) {
  return BLOCKED_LOGIN_EMP_CODES.has(normalizeEmpCode(empCode));
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

const DEFAULT_REVENUE_ONLY_EMP_CODES = Object.freeze(['VP011', 'VP018', 'VP019']);

function createAccessPolicy({ revenueCodes = DEFAULT_REVENUE_ONLY_EMP_CODES, cstCodes = DEFAULT_REVENUE_ONLY_EMP_CODES } = {}) {
  const companyRevenueCodes = new Set(revenueCodes.map(normalizeEmpCode));
  const companyCstCodes = new Set(cstCodes.map(normalizeEmpCode));
  const restrictedCodes = new Set([...companyRevenueCodes, ...companyCstCodes]);
  const COMPANY_REVENUE_READ_EMP_CODES = readonlySet(companyRevenueCodes, 'COMPANY_REVENUE_READ_EMP_CODES');
  const COMPANY_CST_READ_EMP_CODES = readonlySet(companyCstCodes, 'COMPANY_CST_READ_EMP_CODES');
  const REVENUE_ONLY_EMP_CODES = readonlySet(restrictedCodes, 'REVENUE_ONLY_EMP_CODES');
  const REVENUE_ONLY_GET_PATHS = readonlySet([
    ...COMMON_RESTRICTED_GET_PATHS,
    ...REVENUE_GET_PATHS,
    ...CST_GET_PATHS,
  ], 'REVENUE_ONLY_GET_PATHS');

  function codeOf(sessionOrCode) {
    return normalizeEmpCode(typeof sessionOrCode === 'object' ? sessionOrCode?.emp_code : sessionOrCode);
  }

  function accessProfileFor(sessionOrCode) {
    return restrictedCodes.has(codeOf(sessionOrCode)) ? 'revenue_only' : 'standard';
  }

  function canReadAllRevenue(sessionOrCode) {
    return companyRevenueCodes.has(codeOf(sessionOrCode));
  }

  function canReadAllCst(sessionOrCode) {
    return companyCstCodes.has(codeOf(sessionOrCode));
  }

  function isRequestAllowed(session, { method, path } = {}) {
    if (accessProfileFor(session) !== 'revenue_only') return true;
    if (String(method || '').toUpperCase() !== 'GET') return false;
    const normalizedPath = normalizeApiPath(path);
    if (COMMON_RESTRICTED_GET_PATHS.includes(normalizedPath)) return true;
    if (companyRevenueCodes.has(codeOf(session)) && REVENUE_GET_PATHS.includes(normalizedPath)) return true;
    if (companyCstCodes.has(codeOf(session)) && CST_GET_PATHS.includes(normalizedPath)) return true;
    return false;
  }

  return {
    COMPANY_REVENUE_READ_EMP_CODES,
    COMPANY_CST_READ_EMP_CODES,
    REVENUE_ONLY_EMP_CODES,
    REVENUE_ONLY_GET_PATHS,
    accessProfileFor,
    canReadAllRevenue,
    canReadAllCst,
    isRequestAllowed,
  };
}

const policy = createAccessPolicy();

module.exports = {
  BLOCKED_LOGIN_EMP_CODES,
  DEFAULT_REVENUE_ONLY_EMP_CODES,
  ...policy,
  normalizeEmpCode,
  normalizeApiPath,
  isLoginBlocked,
  createAccessPolicy,
};
