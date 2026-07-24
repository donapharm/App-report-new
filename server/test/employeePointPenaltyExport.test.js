'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
process.env.APP_REPORT_SERVICE_TOKEN = 'test-datahub-service-token-secret';
const penaltyExport = require('../src/employeePointPenaltyExport');
const auth = require('../src/auth');

function fixture(overrides = {}) {
  return {
    available: true,
    emp_code: 'DN009',
    point_quarter: 48,
    xu_quarter_total: 40,
    missing_quarter: 8,
    penalty_display: 2400000,
    point_rule_version: 'point-local-2026-05-r1',
    xu_rule_version: 'xu-v2026-05-r1',
    parity: {
      available: true,
      quarterEnd: true,
      exactZeroParity: true,
      pointRuleVersionMatch: true,
      periodMatch: true,
    },
    ...overrides,
  };
}

test('quarter parser accepts only canonical quarters and maps to quarter-end month', () => {
  assert.deepEqual(penaltyExport.parseQuarter('2026-Q3'), {
    quarter: '2026-Q3', label: 'Q3/2026', period: '2026-09', month: 9, year: 2026,
  });
  for (const value of ['', '2026-09', 'Q3/2026', '2026-Q5', '2023-Q4']) {
    assert.throws(() => penaltyExport.parseQuarter(value), { code: 'EMPLOYEE_POINT_PENALTY_QUARTER_INVALID' });
  }
});

test('validated quarter payload exports one employee and the exact App Report penalty read-only', () => {
  const payload = penaltyExport.buildExportPayload({ empCode: 'dn009', quarter: '2026-Q3', combined: fixture() });
  assert.equal(payload.available, true);
  assert.equal(payload.read_only, true);
  assert.equal(payload.emp_code, 'DN009');
  assert.equal(payload.quarter_end_period, '2026-09');
  assert.equal(payload.point_quarter, 48);
  assert.equal(payload.xu_quarter, 40);
  assert.equal(payload.missing_xu, 8);
  assert.equal(payload.phat_tien, 2400000);
  assert.equal(payload.rule_version, penaltyExport.RULE_VERSION);
});

test('parity, xu, identity, versions and formula mismatches all fail closed with null penalty', () => {
  const cases = [
    fixture({ parity: { available: false, quarterEnd: true, exactZeroParity: true, pointRuleVersionMatch: true, periodMatch: true } }),
    fixture({ parity: { available: true, quarterEnd: false, exactZeroParity: true, pointRuleVersionMatch: true, periodMatch: true } }),
    fixture({ parity: { available: true, quarterEnd: true, exactZeroParity: false, pointRuleVersionMatch: true, periodMatch: true } }),
    fixture({ parity: { available: true, quarterEnd: true, exactZeroParity: true, pointRuleVersionMatch: false, periodMatch: true } }),
    fixture({ parity: { available: true, quarterEnd: true, exactZeroParity: true, pointRuleVersionMatch: true, periodMatch: false } }),
    fixture({ xu_quarter_total: null }),
    fixture({ emp_code: 'DN001' }),
    fixture({ point_rule_version: '' }),
    fixture({ missing_quarter: 7 }),
    fixture({ penalty_display: 1800000 }),
  ];
  for (const combined of cases) {
    const payload = penaltyExport.buildExportPayload({ empCode: 'DN009', quarter: '2026-Q3', combined });
    assert.equal(payload.available, false);
    assert.equal(payload.phat_tien, null);
    assert.equal(payload.status, 'đang đối soát');
  }
  assert.throws(() => penaltyExport.buildExportPayload({ empCode: 'ALL', quarter: '2026-Q3', combined: fixture() }), {
    code: 'EMPLOYEE_POINT_PENALTY_EMP_INVALID',
  });
});

test('DataHub middleware rejects user/invalid auth and accepts only its service token', () => {
  const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  for (const headers of [{}, { authorization: 'Bearer invalid' }, { cookie: 'session=user-token' }]) {
    const res = response();
    let nextCalled = false;
    auth.requireDataHubService({ headers }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'DATAHUB_SERVICE_AUTH_REQUIRED');
  }
  for (const headers of [
    { authorization: 'Bearer test-datahub-service-token-secret' },
    { 'x-app-report-service-token': 'test-datahub-service-token-secret' },
  ]) {
    const req = { headers };
    const res = response();
    let nextCalled = false;
    auth.requireDataHubService(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.session.service, 'datahub');
    assert.equal(req.session.role, 'ceo');
  }
});

test('route contract is GET-only, service-token-only and contains no DataHub write path', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth.js'), 'utf8');
  assert.match(routes, /router\.get\('\/integrations\/datahub\/employee-quarter-penalty', auth\.requireDataHubService/);
  assert.doesNotMatch(routes, /router\.(?:post|put|patch|delete)\('\/integrations\/datahub\/employee-quarter-penalty'/);
  assert.match(auth, /function requireDataHubService/);
  assert.match(auth, /DATAHUB_SERVICE_AUTH_REQUIRED/);
  assert.doesNotMatch(JSON.stringify(penaltyExport), /DATA_HUB_ASSIGNMENT_KEY|payroll/i);
});
