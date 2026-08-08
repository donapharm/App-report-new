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

test('VP018 chỉ được GET đúng API tối thiểu của hai tab doanh thu', () => {
  const session = { emp_code: 'VP018', role: 'sale' };
  for (const route of ['/api/me', '/api/periods', '/api/filters?ky=08.2026', '/api/revenue?dimension=unit', '/api/revenue/full?ky=08.2026']) {
    assert.equal(policy.isRequestAllowed(session, { method: 'GET', path: route }), true, route);
  }
  for (const route of ['/api/overview', '/api/products', '/api/analysis', '/api/employee-cost', '/api/targets', '/api/export/revenue_report.xlsx', '/api/dormant/gate']) {
    assert.equal(policy.isRequestAllowed(session, { method: 'GET', path: route }), false, route);
  }
  assert.equal(policy.isRequestAllowed(session, { method: 'POST', path: '/api/revenue' }), false);
  assert.equal(policy.isRequestAllowed({ emp_code: 'DN006' }, { method: 'GET', path: '/api/overview' }), true);
});

test('auth từ chối phát token cho denylist và chặn route ngoài doanh thu của VP018', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reportnew-strict-access-'));
  const oldDir = process.env.AUTH_DATA_DIR;
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
    const invoke = (url, method = 'GET') => {
      let statusCode = 200; let body = null; let nextCalled = false;
      auth.requireAuth({ method, originalUrl: url, headers: { authorization: `Bearer ${token}` } }, {
        status(code) { statusCode = code; return this; },
        json(payload) { body = payload; return this; },
      }, () => { nextCalled = true; });
      return { statusCode, body, nextCalled };
    };
    assert.equal(invoke('/api/revenue?ky=08.2026').nextCalled, true);
    assert.equal(invoke('/api/revenue/full?ky=08.2026').nextCalled, true);
    assert.equal(invoke('/api/me').nextCalled, true);
    const forbidden = invoke('/api/employee-cost?ky=08.2026');
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.body.code, 'REVENUE_ONLY_ACCESS');
    assert.equal(invoke('/api/revenue', 'POST').statusCode, 403);
  } finally {
    if (oldDir === undefined) delete process.env.AUTH_DATA_DIR;
    else process.env.AUTH_DATA_DIR = oldDir;
    fs.rmSync(dir, { recursive: true, force: true });
    for (const mod of ['../src/auth', '../src/persist']) delete require.cache[require.resolve(mod)];
  }
});
