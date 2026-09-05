'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');

const HOME_TOKEN = 'test-home-service-token-secret-20260808';
const DATAHUB_TOKEN = 'test-datahub-service-token-secret-20260808';
process.env.APP_REPORT_HOME_SERVICE_TOKEN_SHA256 = crypto.createHash('sha256').update(HOME_TOKEN).digest('hex');
process.env.APP_REPORT_SERVICE_TOKEN = DATAHUB_TOKEN;

const accessPolicy = require('../src/accessPolicy');
const visibility = require('../src/homeAppReportVisibility');
const auth = require('../src/auth');

const known = new Set(['CEO', 'DN001', 'DN007']);
const findUserByCode = (code) => known.has(code) ? { emp_code: code } : null;

test('exact CEO-blocked policy is hidden without copying the list', () => {
  assert.equal(accessPolicy.BLOCKED_LOGIN_EMP_CODES.size, 15);
  for (const empCode of accessPolicy.BLOCKED_LOGIN_EMP_CODES) {
    assert.deepEqual(visibility.decide(empCode, { findUserByCode }), {
      empCode,
      visible: false,
      reason: 'LOGIN_BLOCKED',
      accessProfile: 'standard',
    });
  }

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'homeAppReportVisibility.js'), 'utf8');
  assert.match(source, /require\('\.\/accessPolicy'\)/);
  assert.doesNotMatch(source, /VP002|VP003|DN021|DN023/);
});

test('revenue-only trio remains visible while standard known accounts are allowed', () => {
  for (const empCode of ['VP011', 'VP018', 'VP019']) assert.deepEqual(visibility.decide(` ${empCode.toLowerCase()} `, { findUserByCode }), {
    empCode,
    visible: true,
    reason: 'REVENUE_ONLY',
    accessProfile: 'revenue_only',
  });
  assert.deepEqual(visibility.decide('dn007', { findUserByCode }), {
    empCode: 'DN007',
    visible: true,
    reason: 'ALLOWED',
    accessProfile: 'standard',
  });
});

test('missing, malformed and unknown accounts fail closed with the exact response keys', () => {
  for (const raw of ['', ' ', 'A', 'DN 001', '../CEO']) {
    const result = visibility.decide(raw, { findUserByCode });
    assert.equal(result.visible, false);
    assert.equal(result.reason, 'INVALID_EMP_CODE');
    assert.equal(result.accessProfile, 'none');
    assert.deepEqual(Object.keys(result), ['empCode', 'visible', 'reason', 'accessProfile']);
  }
  assert.deepEqual(visibility.decide('DN999', { findUserByCode }), {
    empCode: 'DN999',
    visible: false,
    reason: 'ACCOUNT_NOT_FOUND',
    accessProfile: 'none',
  });
});

test('Home middleware accepts only the dedicated Home bearer token', () => {
  const response = () => ({
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  for (const headers of [
    {},
    { authorization: 'Bearer invalid' },
    { authorization: `Bearer ${DATAHUB_TOKEN}` },
    { authorization: HOME_TOKEN },
    { cookie: 'session=user-token' },
    { 'x-app-report-service-token': HOME_TOKEN },
  ]) {
    const res = response();
    let nextCalled = false;
    auth.requireHomeService({ headers }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'HOME_SERVICE_AUTH_REQUIRED');
    assert.equal(res.headers['cache-control'], 'no-store');
  }

  const req = { headers: { authorization: `Bearer ${HOME_TOKEN}` } };
  const res = response();
  let nextCalled = false;
  auth.requireHomeService(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.session.service, 'home');
  assert.equal(req.session.role, 'service');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('missing or DataHub-shared Home credential fails closed at module startup', () => {
  const script = `
    const auth = require('./src/auth');
    const res = { statusCode: 200, set(){return this;}, status(c){this.statusCode=c;return this;}, json(b){this.body=b;return this;} };
    let next = false;
    auth.requireHomeService({ headers: { authorization: 'Bearer ${DATAHUB_TOKEN}' } }, res, () => { next = true; });
    if (next || res.statusCode !== 401 || res.body?.code !== 'HOME_SERVICE_AUTH_REQUIRED') process.exit(9);
  `;
  for (const homeHash of [
    '',
    crypto.createHash('sha256').update(DATAHUB_TOKEN).digest('hex'),
  ]) {
    const child = spawnSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        APP_REPORT_HOME_SERVICE_TOKEN_SHA256: homeHash,
        APP_REPORT_SERVICE_TOKEN: DATAHUB_TOKEN,
      },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  }
});

test('HTTP contract is GET-only, no-store and returns exact decisions', async (t) => {
  const store = require('../src/store');
  const routes = require('../src/routes');
  const originalFind = store.findUserByCode;
  store.findUserByCode = findUserByCode;
  t.after(() => { store.findUserByCode = originalFind; });

  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/integrations/home/app-report-visibility`;

  for (const authorization of ['', 'Bearer wrong-token']) {
    const unauthenticated = await fetch(`${base}?empCode=VP003`, {
      headers: authorization ? { authorization } : {},
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');
  }

  const rawToken = await fetch(`${base}?empCode=VP003`, {
    headers: { authorization: HOME_TOKEN },
  });
  assert.equal(rawToken.status, 401);
  assert.equal(rawToken.headers.get('cache-control'), 'no-store');

  const cases = [
    ['VP003', { empCode: 'VP003', visible: false, reason: 'LOGIN_BLOCKED', accessProfile: 'standard' }],
    ...['VP011', 'VP018', 'VP019'].map((empCode) => [empCode, { empCode, visible: true, reason: 'REVENUE_ONLY', accessProfile: 'revenue_only' }]),
    ['DN007', { empCode: 'DN007', visible: true, reason: 'ALLOWED', accessProfile: 'standard' }],
    ['DN999', { empCode: 'DN999', visible: false, reason: 'ACCOUNT_NOT_FOUND', accessProfile: 'none' }],
  ];
  for (const [empCode, expected] of cases) {
    const response = await fetch(`${base}?empCode=${encodeURIComponent(empCode)}`, {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), expected);
  }

  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  assert.match(routeSource, /router\.get\('\/integrations\/home\/app-report-visibility', auth\.requireHomeService/);
  assert.doesNotMatch(routeSource, /router\.(?:post|put|patch|delete)\('\/integrations\/home\/app-report-visibility'/);
});
