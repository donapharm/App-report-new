'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const policy = require('../src/accessPolicy');

const BLOCKED = [
  'VP002', 'VP003',
  'VP006', 'VP007', 'VP008', 'VP009', 'VP010', 'VP011',
  'VP012', 'VP013', 'VP014', 'VP015', 'VP016', 'VP017',
  'DN021', 'DN023',
];

test('denylist khớp đúng 16 tài khoản CEO chỉ định', () => {
  assert.deepEqual([...policy.BLOCKED_LOGIN_EMP_CODES].sort(), [...BLOCKED].sort());
  for (const code of BLOCKED) assert.equal(policy.isLoginBlocked(code), true, code);
  for (const code of ['CEO', 'DN001', 'DN006', 'VP004', 'VP018']) assert.equal(policy.isLoginBlocked(code), false, code);
});

test('VP018 chỉ được GET hai tab doanh thu và đúng ba export tường minh', () => {
  const session = { emp_code: 'VP018', role: 'sale' };
  const allowed = [
    '/api/me', '/api/periods', '/api/filters?ky=08.2026',
    '/api/revenue?dimension=unit', '/api/revenue/full?ky=08.2026',
    '/api/export/revenue.xlsx?ky=08.2026',
    '/api/export/revenue_report.xlsx?ky=08.2026',
    '/api/export/revenue_report.pdf?ky=08.2026',
  ];
  assert.equal(policy.REVENUE_ONLY_GET_PATHS.size, 9, 'allowlist phải exact: 8 path doanh thu/chung + đúng /cst');
  for (const route of allowed) assert.equal(policy.isRequestAllowed(session, { method: 'GET', path: route }), true, route);

  const forbidden = [
    '/api/overview', '/api/products', '/api/analysis', '/api/employee-cost', '/api/employee-cost/all',
    '/api/targets', '/api/catalog-management', '/api/catalog-cost-column-grants',
    '/api/export/revenue_full.xlsx', '/api/export/revenue_report.csv', '/api/export/revenue_report.pptx',
    '/api/export/overview.xlsx', '/api/dormant/gate',
    // Exact-path hardening: không canonicalize một biến thể thành allowlisted.
    '/api/revenue/', '/api//revenue', '/api/../me', '/api\\revenue',
    '/api/%72evenue', '/api/revenue#fragment', 'http://app-report.local/api/revenue',
  ];
  for (const route of forbidden) assert.equal(policy.isRequestAllowed(session, { method: 'GET', path: route }), false, route);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    for (const route of ['/api/revenue', '/api/export/revenue.xlsx', '/api/catalog-cost-column-grants/VP018']) {
      assert.equal(policy.isRequestAllowed(session, { method, path: route }), false, `${method} ${route}`);
    }
  }
  assert.equal(policy.isRequestAllowed({ emp_code: 'DN006' }, { method: 'GET', path: '/api/overview' }), true);
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
  assert.match(routes, /router\.get\('\/cst',[\s\S]*?const scope = auth\.cstScopeOf\(req\.session\);/,
    'route CST phải dùng scope riêng; không được nới scope chung của VP018');
});

test('quyền doanh thu và CST tạo hồ sơ hạn chế, hợp đúng path và luôn chỉ đọc', () => {
  const isolated = policy.createAccessPolicy({
    revenueCodes: ['QA_REVENUE_ONLY', 'QA_BOTH'],
    cstCodes: ['QA_CST_ONLY', 'QA_BOTH'],
  });
  const revenueOnly = { emp_code: 'QA_REVENUE_ONLY' };
  const cstOnly = { emp_code: 'QA_CST_ONLY' };
  const both = { emp_code: 'QA_BOTH' };
  const methods = ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  for (const session of [revenueOnly, cstOnly, both]) {
    assert.equal(isolated.accessProfileFor(session), 'revenue_only');
    for (const method of methods) {
      for (const route of ['/api/revenue', '/api/cst', '/api/export/revenue.xlsx', '/api/overview']) {
        assert.equal(isolated.isRequestAllowed(session, { method, path: route }), false, `${session.emp_code} ${method} ${route}`);
      }
    }
    assert.equal(isolated.isRequestAllowed(session, { method: 'GET', path: '/api/overview' }), false);
  }

  assert.equal(isolated.isRequestAllowed(cstOnly, { method: 'GET', path: '/api/cst' }), true);
  for (const route of ['/api/revenue', '/api/revenue/full', '/api/export/revenue.xlsx', '/api/export/revenue_report.xlsx', '/api/export/revenue_report.pdf', '/api/export/cst.xlsx']) {
    assert.equal(isolated.isRequestAllowed(cstOnly, { method: 'GET', path: route }), false, `CST-only ${route}`);
  }
  assert.equal(isolated.canReadAllCst(cstOnly), true);
  assert.equal(isolated.canReadAllRevenue(cstOnly), false);

  assert.equal(isolated.isRequestAllowed(revenueOnly, { method: 'GET', path: '/api/revenue' }), true);
  assert.equal(isolated.isRequestAllowed(revenueOnly, { method: 'GET', path: '/api/cst' }), false);
  assert.equal(isolated.canReadAllRevenue(revenueOnly), true);
  assert.equal(isolated.canReadAllCst(revenueOnly), false);

  assert.equal(isolated.isRequestAllowed(both, { method: 'GET', path: '/api/revenue' }), true);
  assert.equal(isolated.isRequestAllowed(both, { method: 'GET', path: '/api/cst' }), true);
  assert.equal(isolated.isRequestAllowed(both, { method: 'GET', path: '/api/export/cst.xlsx' }), false);
});

test('hai allowlist là hai tập chỉ-đọc, không alias và không thể đột biến chéo', () => {
  assert.notEqual(policy.COMPANY_REVENUE_READ_EMP_CODES, policy.COMPANY_CST_READ_EMP_CODES);
  assert.throws(() => policy.COMPANY_REVENUE_READ_EMP_CODES.add('QA_ALIAS'), /read-only/);
  assert.throws(() => policy.COMPANY_CST_READ_EMP_CODES.delete('VP018'), /read-only/);
  policy.COMPANY_REVENUE_READ_EMP_CODES.forEach((_value, _key, exposedSet) => {
    assert.equal(exposedSet, policy.COMPANY_REVENUE_READ_EMP_CODES, 'forEach không được rò Set mutable nội bộ');
    assert.throws(() => exposedSet.clear(), /read-only/);
  });
  assert.equal(policy.COMPANY_REVENUE_READ_EMP_CODES.has('QA_ALIAS'), false);
  assert.equal(policy.COMPANY_CST_READ_EMP_CODES.has('QA_ALIAS'), false);
  assert.equal(policy.COMPANY_CST_READ_EMP_CODES.has('VP018'), true);
});

test('auth từ chối phát token cho denylist và chặn route ngoài doanh thu của VP018', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reportnew-strict-access-'));
  const oldDir = process.env.AUTH_DATA_DIR;
  const employeeStore = require('../src/store');
  const oldFindUserByCode = employeeStore.findUserByCode;
  employeeStore.findUserByCode = (code) => String(code || '').toUpperCase() === 'VP018'
    ? { emp_code: 'VP018', name: 'VP018', role: 'sale', phone: null }
    : oldFindUserByCode(code);
  process.env.AUTH_DATA_DIR = dir;
  try {
    fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify([
      { th: 'blocked', emp_code: 'VP003', role: 'sale', name: 'blocked', expires_at: Date.now() + 60_000 },
      { th: 'allowed', emp_code: 'CEO', role: 'admin', name: 'allowed', expires_at: Date.now() + 60_000 },
    ]));
    fs.writeFileSync(path.join(dir, 'devices.json'), JSON.stringify([
      { id: 'a'.repeat(64), device_id_hash: 'a'.repeat(64), emp_code: 'VP003' },
      { id: 'b'.repeat(64), device_id_hash: 'b'.repeat(64), emp_code: 'CEO' },
    ]));
    fs.writeFileSync(path.join(dir, 'audit_auth.json'), '[]');
    for (const mod of ['../src/auth', '../src/persist']) delete require.cache[require.resolve(mod)];
    const auth = require('../src/auth');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'))).map((x) => x.emp_code), ['CEO']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'devices.json'))).map((x) => x.emp_code), ['CEO']);
    for (const code of BLOCKED) {
      assert.throws(() => auth.issueToken({ emp_code: code, name: code, role: 'sale' }, { method: 'qa-strict-access' }), {
        code: 'APP_REPORT_ACCESS_REVOKED', status: 403,
      });
    }

    const token = auth.issueToken({ emp_code: 'VP018', name: 'Nguyễn Thị Kim Ngọc', role: 'sale' }, { method: 'qa-strict-access' });
    const invokeMiddleware = (middleware, url, method = 'GET') => {
      let statusCode = 200; let body = null; let nextCalled = false;
      middleware({ method, originalUrl: url, headers: { authorization: `Bearer ${token}` } }, {
        status(code) { statusCode = code; return this; },
        json(payload) { body = payload; return this; },
      }, () => { nextCalled = true; });
      return { statusCode, body, nextCalled };
    };
    const invoke = (url, method = 'GET') => invokeMiddleware(auth.requireAuth, url, method);
    const invokeBoundary = (url, method = 'GET') => invokeMiddleware(auth.enforceAccessPolicyBoundary, url, method);
    assert.equal(invoke('/api/revenue?ky=08.2026').nextCalled, true);
    assert.equal(invoke('/api/revenue/full?ky=08.2026').nextCalled, true);
    assert.equal(invoke('/api/export/revenue.xlsx?ky=08.2026').nextCalled, true);
    assert.equal(invoke('/api/export/revenue_report.xlsx?ky=08.2026').nextCalled, true);
    assert.equal(invoke('/api/export/revenue_report.pdf?ky=08.2026').nextCalled, true);
    assert.equal(invoke('/api/me').nextCalled, true);
    assert.deepEqual(auth.scopeOf({ emp_code: 'VP018', role: 'sale' }), { empCode: 'VP018' }, 'scope chung vẫn self-only');
    assert.deepEqual(auth.revenueScopeOf({ emp_code: 'VP018', role: 'sale' }), { empCode: null }, 'chỉ revenue scope mới đọc toàn công ty');
    assert.deepEqual(auth.revenueScopeOf({ emp_code: 'DN006', role: 'sale' }), { empCode: 'DN006' }, 'NON_SALES_ROLE/scope chuẩn không đổi');
    for (const route of ['/api/employee-cost?ky=08.2026', '/api/catalog-management', '/api/export/revenue_report.csv']) {
      const forbidden = invoke(route);
      assert.equal(forbidden.statusCode, 403, route);
      assert.equal(forbidden.body.code, 'REVENUE_ONLY_ACCESS', route);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      assert.equal(invoke('/api/revenue', method).statusCode, 403, method);
      assert.equal(invokeBoundary('/api/revenue', method).statusCode, 403, `router boundary ${method}`);
    }
    for (const route of ['/api/employee-cost/not-a-real-subroute', '/api/revenue/', '/api//revenue', '/api/../me', '/api\\revenue', '/api/%72evenue']) {
      assert.equal(invokeBoundary(route).statusCode, 403, `${route} không rơi qua 404/canonicalization`);
    }
    assert.equal(invokeBoundary('/api/export/revenue_report.pdf?ky=08.2026').nextCalled, true, 'GET allowlist đi tiếp tới route');
  } finally {
    employeeStore.findUserByCode = oldFindUserByCode;
    if (oldDir === undefined) delete process.env.AUTH_DATA_DIR;
    else process.env.AUTH_DATA_DIR = oldDir;
    fs.rmSync(dir, { recursive: true, force: true });
    for (const mod of ['../src/auth', '../src/persist']) delete require.cache[require.resolve(mod)];
  }
});
