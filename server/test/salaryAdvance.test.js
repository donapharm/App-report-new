'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const salaryAdvance = require('../src/salaryAdvance');

const valid = (overrides = {}) => ({
  ok: true, available: true, applicable: true, period: '2026-07', emp_code: 'DN101',
  amount: 0, currency: 'VND', locked: false, status: 'draft', reason: null, ...overrides,
});
const response = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

test('strict schema preserves zero and rejects wrong scope, non-finite amount and extra payroll fields', () => {
  assert.equal(salaryAdvance.validateProjection(valid(), { period: '2026-07', empCode: 'DN101' }).amount, 0);
  for (const payload of [
    valid({ period: '2026-08' }), valid({ emp_code: 'DN999' }), valid({ currency: 'USD' }),
    valid({ amount: Infinity }), { ...valid(), net: 15_000_000 },
  ]) assert.throws(() => salaryAdvance.validateProjection(payload, { period: '2026-07', empCode: 'DN101' }), { code: 'SALARY_ADVANCE_INVALID_PAYLOAD' });
  const notSale = valid({ available: true, applicable: false, amount: null, reason: 'not_eligible' });
  assert.equal(salaryAdvance.validateProjection(notSale, { period: '2026-07', empCode: 'DN101' }).applicable, false);
  for (const reason of ['period_not_found', 'employee_not_found', 'duplicate_employee']) {
    const missing = valid({ available: false, applicable: null, amount: null, locked: null, status: 'unavailable', reason });
    assert.equal(salaryAdvance.validateProjection(missing, { period: '2026-07', empCode: 'DN101' }).reason, reason);
  }
});

test('client sends server-only bearer, retries one 503, caches and coalesces single-flight', async () => {
  let calls = 0; let authorization = '';
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const client = salaryAdvance.createClient({
    baseUrl: 'http://salary.internal', token: 'unit-secret-only', retryDelayMs: 0,
    sleep: async () => {}, logger: { warn() {} },
    fetchImpl: async (_url, options) => {
      calls += 1; authorization = options.headers.Authorization;
      if (calls === 1) return response(503, {});
      await pending;
      return response(200, valid());
    },
  });
  const a = client.get('2026-07', 'dn101');
  const b = client.get('2026-07', 'DN101');
  release();
  assert.strictEqual(await a, await b);
  assert.equal(calls, 2, 'one retry only and concurrent callers share the same flight');
  assert.equal(authorization, 'Bearer unit-secret-only');
  await client.get('2026-07', 'DN101');
  assert.equal(calls, 2, 'validated projection is cached');
});

test('client times out with one retry, rejects invalid payload, and never retries 401', async () => {
  let timeoutCalls = 0;
  const timeoutClient = salaryAdvance.createClient({
    baseUrl: 'http://salary.internal', token: 'unit-secret-only', timeoutMs: 5, retryDelayMs: 0,
    sleep: async () => {}, logger: { warn() {} },
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      timeoutCalls += 1;
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }),
  });
  await assert.rejects(timeoutClient.get('2026-07', 'DN101'), { code: 'SALARY_ADVANCE_TIMEOUT' });
  assert.equal(timeoutCalls, 2);

  let authCalls = 0;
  const authClient = salaryAdvance.createClient({ baseUrl: 'http://salary.internal', token: 'x', logger: { warn() {} }, fetchImpl: async () => { authCalls += 1; return response(401, {}); } });
  await assert.rejects(authClient.get('2026-07', 'DN101'), { code: 'SALARY_ADVANCE_UPSTREAM_ERROR' });
  assert.equal(authCalls, 1);

  const invalidClient = salaryAdvance.createClient({ baseUrl: 'http://salary.internal', token: 'x', logger: { warn() {} }, fetchImpl: async () => response(200, valid({ emp_code: 'DN999' })) });
  await assert.rejects(invalidClient.get('2026-07', 'DN101'), { code: 'SALARY_ADVANCE_INVALID_PAYLOAD' });
});

test('missing real secret fails before network and build/import remains safe', async () => {
  let calls = 0;
  const client = salaryAdvance.createClient({ token: '', fetchImpl: async () => { calls += 1; } , logger: { warn() {} } });
  await assert.rejects(client.get('2026-07', 'DN101'), { code: 'SALARY_ADVANCE_NOT_CONFIGURED' });
  assert.equal(calls, 0);
});

test('safe projection embeds upstream data and fails closed without inventing zero', async () => {
  const available = await salaryAdvance.safeGetFirstAdvance('2026-07', 'DN101', async () => valid({ amount: 123_000 }));
  assert.equal(available.amount, 123_000);
  const unavailable = await salaryAdvance.safeGetFirstAdvance('2026-07', 'DN101', async () => { throw new Error('offline'); });
  assert.deepEqual(unavailable, {
    available: false, applicable: null, period: '2026-07', emp_code: 'DN101', amount: null,
    currency: 'VND', locked: null, status: 'unavailable', reason: 'upstream_unavailable',
  });
});

test('after-penalty guard flags impossible advances without calculating a remaining KPI', () => {
  const projection = valid({ amount: 120_000 });
  const normal = salaryAdvance.withAfterPenaltyGuard(projection, 150_000);
  assert.equal(normal.suspect, false);
  assert.equal(normal.suspect_reason, null);

  const suspect = salaryAdvance.withAfterPenaltyGuard(projection, 100_000);
  assert.equal(suspect.amount, 120_000, 'raw upstream amount remains unchanged');
  assert.equal(suspect.suspect, true);
  assert.equal(suspect.suspect_reason, 'amount_exceeds_after_penalty_total');
  assert.equal(Object.hasOwn(suspect, 'remainingAfterAdvance'), false);

  const unknown = salaryAdvance.withAfterPenaltyGuard(projection, null);
  assert.equal(unknown.suspect, null);
  assert.equal(unknown.suspect_reason, 'after_penalty_total_unavailable');
});

function invokeRoute(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      headersSent: false, statusCode: 200, headers: {},
      set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.headersSent = true; resolve(this); return this; },
    };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
}

test('Report route enforces self/admin/ALL backend scope and isolates upstream failure', async () => {
  const visibility = require('../src/employeeCostVisibility');
  const router = require('../src/routes');
  const layer = router.stack.find((candidate) => candidate.route?.path === '/employee-cost/salary-advance' && candidate.route.methods.get);
  assert.ok(layer, 'salary advance route exists');
  const handler = layer.route.stack.at(-1).handle;
  const originalRun = visibility.run;
  const originalGet = salaryAdvance.getFirstAdvance;
  const calls = [];
  visibility.run = async (_options, loader) => loader();
  salaryAdvance.getFirstAdvance = async (period, empCode) => { calls.push({ period, empCode }); return valid({ period, emp_code: empCode, amount: 123_000 }); };
  try {
    let res = await invokeRoute(handler, { query: { period: '2026-07' }, session: { emp_code: 'DN101', role: 'sale' } });
    assert.equal(res.statusCode, 200); assert.equal(res.body.salaryAdvance.emp_code, 'DN101');
    res = await invokeRoute(handler, { query: { period: '2026-07', emp: 'DN999' }, session: { emp_code: 'DN101', role: 'sale' } });
    assert.equal(res.statusCode, 403);
    res = await invokeRoute(handler, { query: { period: '2026-07', emp: 'DN202' }, session: { emp_code: 'CEO', role: 'ceo' } });
    assert.equal(res.statusCode, 200); assert.equal(res.body.salaryAdvance.emp_code, 'DN202');
    const beforeAll = calls.length;
    res = await invokeRoute(handler, { query: { period: '2026-07', emp: 'ALL' }, session: { emp_code: 'CEO', role: 'ceo' } });
    assert.equal(res.body.salaryAdvance.reason, 'select_employee'); assert.equal(calls.length, beforeAll, 'ALL never fans out upstream');
    salaryAdvance.getFirstAdvance = async () => { throw Object.assign(new Error('timeout'), { code: 'SALARY_ADVANCE_TIMEOUT' }); };
    res = await invokeRoute(handler, { query: { period: '2026-07', emp: 'DN202' }, session: { emp_code: 'CEO', role: 'ceo' } });
    assert.equal(res.statusCode, 200); assert.equal(res.body.salaryAdvance.reason, 'upstream_unavailable');
    assert.equal(res.headers['cache-control'], 'private, no-store');
  } finally { visibility.run = originalRun; salaryAdvance.getFirstAdvance = originalGet; }
});

test('main employee-cost response owns the self-scoped Salary field and browser never contains Salary secret/cookie', () => {
  const root = path.resolve(__dirname, '../..');
  const routes = fs.readFileSync(path.join(root, 'server/src/routes.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'web/src/pages/EmployeeCost.jsx'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'web/src/api.js'), 'utf8');
  assert.equal((page.match(/<SalaryAdvanceKpi\b/g) || []).length, 1, 'KPI component count does not increase');
  assert.equal((page.match(/function SalaryAdvanceKpi\b/g) || []).length, 1);
  assert.match(page, /const SALARY_ADVANCE_UI = true/);
  assert.match(routes, /salaryAdvance:\s*resolvedSalaryAdvance/);
  assert.match(routes, /salaryAdvance\.withAfterPenaltyGuard/);
  assert.match(routes, /includeSalaryAdvance:\s*false/);
  assert.match(page, /salaryAdvance=\{model\.salaryAdvance\}/);
  assert.doesNotMatch(page, /employeeCostSalaryAdvance\(/);
  assert.match(page, /period=\{range\.to\}/);
  assert.match(page, /Number\.isSafeInteger\(salaryAdvance\.amount\)/);
  assert.match(page, /salaryAdvance\.amount\.toLocaleString\('vi-VN'\).*₫/s);
  assert.match(page, /Dự kiến · chưa chốt trên App Salary/);
  assert.match(page, /Số ứng lớn hơn tổng chi phí sau phạt — nghi sai, đang đối chiếu/);
  assert.match(page, /const statusText = salaryAdvance\.locked \? 'Đã chốt trên App Salary' : 'Dự kiến · chưa chốt trên App Salary'/);
  assert.doesNotMatch(page, /function RemainingAfterAdvanceKpi|<RemainingAfterAdvanceKpi\b/);
  const apiBlock = api.match(/employeeCostSalaryAdvance:[\s\S]*?\n  employeeCostDiemXu:/)?.[0] || '';
  assert.match(apiBlock, /employee-cost\/salary-advance/);
  assert.doesNotMatch(apiBlock, /SALARY_SERVICE_TOKEN|document\.cookie|credentials|Cookie/i);
  assert.doesNotMatch(page, /SALARY_SERVICE_TOKEN|salary\.donapharm\.asia|\/api\/db/);
});
