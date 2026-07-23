'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const khoan = require('../src/employeeVatKhoan');

const PERIOD = { month: 7, year: 2026, period: '2026-07' };
const TOKEN = 'test-vat-service-token-secret';

function vatFixture(overrides = {}) {
  return {
    ok: true,
    emp_code: 'DN001',
    emp_name: 'Nhân viên Một',
    viewAll: false,
    selected: { month: 7, year: 2026, quarter: 3 },
    quy: { label: 'Q3/2026 (07-09)' },
    diem: { thang: { total: 12.34 }, quy: { total: 28.5 } },
    xu: { thang: { xu: 9.1 }, quy: { xu: 20.25, xu_tong: 22.25 }, du_quy_truoc: 2 },
    pct: { thang: 73.74, quy: 78.07 },
    thieu_du: -6.25,
    thieu_xu: 6.25,
    du_xu: 0,
    phat_du_kien: 1_800_000,
    rule_version: 'khoan-ssot-v2026-05-r1',
    warning: { message: 'Cảnh báo từ VAT' },
    rules: { penalty: '2đ thiếu = 600Kđ phạt' },
    service_auth: { header: 'must not pass through' },
    doanh_thu: { secret: 'not part of the projection' },
    ...overrides,
  };
}

const response = (body = vatFixture(), status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('period parser uses the end month and rejects partial/invalid ranges before upstream fallback can occur', () => {
  assert.deepEqual(khoan.parsePeriod({ from: '2026-05', to: '2026-07' }), PERIOD);
  assert.deepEqual(khoan.parsePeriod({ month: 7, year: 2026 }), PERIOD);
  for (const input of [
    { from: '2026-07' }, { to: '2026-07' }, { from: '2026-08', to: '2026-07' },
    { from: 'bad', to: '2026-07' }, { month: 13, year: 2026 },
  ]) assert.throws(() => khoan.parsePeriod(input), { code: 'EMPLOYEE_VAT_KHOAN_PERIOD_INVALID' });
});

test('projection copies canonical VAT fields exactly and drops unrelated/auth fields', () => {
  const projected = khoan.projectDashboard(vatFixture(), 'DN001', PERIOD);
  assert.deepEqual({
    diem_thang: projected.diem_thang,
    diem_quy: projected.diem_quy,
    xu_thang: projected.xu_thang,
    xu_quy: projected.xu_quy,
    xu_quy_tong: projected.xu_quy_tong,
    carry: projected.carry,
    pct_thang: projected.pct_thang,
    pct_quy: projected.pct_quy,
    thieu_du: projected.thieu_du,
    thieu_xu: projected.thieu_xu,
    du_xu: projected.du_xu,
    phat_du_kien: projected.phat_du_kien,
  }, {
    diem_thang: 12.34, diem_quy: 28.5,
    xu_thang: 9.1, xu_quy: 20.25, xu_quy_tong: 22.25, carry: 2,
    pct_thang: 73.74, pct_quy: 78.07,
    thieu_du: -6.25, thieu_xu: 6.25, du_xu: 0, phat_du_kien: 1_800_000,
  });
  assert.equal(projected.rule_version, 'khoan-ssot-v2026-05-r1');
  assert.equal(projected.service_auth, undefined);
  assert.equal(projected.doanh_thu, undefined);
});

test('projection fails closed on identity, all-scope, period, missing-field or invalid-number mismatches', () => {
  assert.equal(khoan.projectDashboard(vatFixture({ emp_code: 'DN999' }), 'DN001', PERIOD), null);
  assert.equal(khoan.projectDashboard(vatFixture({ viewAll: true }), 'DN001', PERIOD), null);
  assert.equal(khoan.projectDashboard(vatFixture({ selected: { month: 6, year: 2026, quarter: 2 } }), 'DN001', PERIOD), null);
  assert.equal(khoan.projectDashboard(vatFixture({ diem: { thang: {}, quy: { total: 1 } } }), 'DN001', PERIOD), null);
  assert.equal(khoan.projectDashboard(vatFixture({ phat_du_kien: -1 }), 'DN001', PERIOD), null);
  assert.equal(khoan.projectDashboard(vatFixture({ rules: {} }), 'DN001', PERIOD), null);
});

test('sale spoofed emp is ignored, upstream receives own code and Bearer stays backend-only', async () => {
  let captured;
  const audits = [];
  const payload = await khoan.getForSession({
    session: { emp_code: 'DN001', role: 'sale' },
    scope: { empCode: 'DN001' },
    requestedEmp: 'DN999',
    period: PERIOD,
  }, {
    baseUrl: 'http://vat.test', serviceToken: TOKEN, backoffMs: [], auditImpl: (entry) => audits.push(entry),
    fetchImpl: async (url, options) => { captured = { url, options }; return response(); },
  });
  assert.equal(captured.url, 'http://vat.test/api/khoan/dashboard?month=7&year=2026&emp_code=DN001');
  assert.equal(captured.options.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(payload.emp_code, 'DN001');
  assert.equal(audits[0].empCode, 'DN001');
  assert.equal(JSON.stringify(payload).includes(TOKEN), false);
  assert.equal(JSON.stringify(audits).includes(TOKEN), false);
});

test('admin may select one employee and the response must match that exact identity', async () => {
  let calledUrl = '';
  const payload = await khoan.getForSession({
    session: { emp_code: 'CEO', role: 'ceo' }, scope: { empCode: null }, requestedEmp: 'DN002', period: PERIOD,
  }, {
    baseUrl: 'http://vat.test', serviceToken: TOKEN, backoffMs: [], auditImpl: () => {},
    fetchImpl: async (url) => { calledUrl = url; return response(vatFixture({ emp_code: 'DN002', emp_name: 'Nhân viên Hai' })); },
  });
  assert.match(calledUrl, /emp_code=DN002$/);
  assert.equal(payload.emp_code, 'DN002');
});

test('missing config fails before network; 401/400 fail closed without token or invented values', async () => {
  let calls = 0;
  const missing = await khoan.fetchDashboard('DN001', PERIOD, {
    baseUrl: '', serviceToken: '', fetchImpl: async () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(missing.outcome, 'not_configured');
  assert.deepEqual(missing.payload, khoan.emptyPayload('DN001', PERIOD));

  for (const status of [401, 400]) {
    const result = await khoan.fetchDashboard('DN001', PERIOD, {
      baseUrl: 'http://vat.test', serviceToken: TOKEN, backoffMs: [], fetchImpl: async () => response({}, status),
    });
    assert.equal(result.outcome, status === 401 ? 'upstream_unauthorized' : 'upstream_bad_request');
    assert.equal(result.payload.available, false);
    assert.equal(result.payload.note, 'chưa lấy được điểm/xu kỳ này');
    assert.equal(result.payload.phat_du_kien, undefined);
  }
});

test('upstream timeout is hard-capped at five seconds even when config requests longer', async () => {
  let signal;
  let elapsed = 0;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback, ms) => { elapsed = ms; return 1; };
  global.clearTimeout = () => {};
  try {
    await khoan.fetchDashboard('DN001', PERIOD, {
      baseUrl: 'http://vat.test', serviceToken: TOKEN, timeoutMs: 60_000, backoffMs: [],
      fetchImpl: async (_url, options) => { signal = options.signal; return response(); },
    });
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
  assert.equal(elapsed, 5_000);
  assert.equal(signal instanceof AbortSignal, true);
});

test('timeout remains active while reading a stalled upstream response body', async () => {
  const result = await khoan.fetchDashboard('DN001', PERIOD, {
    baseUrl: 'http://vat.test', serviceToken: TOKEN, timeoutMs: 100, backoffMs: [],
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        const error = new Error('body timeout');
        error.name = 'AbortError';
        reject(error);
      }, { once: true })),
    }),
  });
  assert.equal(result.outcome, 'upstream_unavailable');
  assert.equal(result.attempts, 1);
  assert.equal(result.payload.available, false);
});

test('502 and timeout retry with bounded backoff, while invalid payload does not retry', async () => {
  let calls = 0;
  const waits = [];
  const recovered = await khoan.fetchDashboard('DN001', PERIOD, {
    baseUrl: 'http://vat.test', serviceToken: TOKEN, backoffMs: [2, 4], sleepImpl: async (ms) => waits.push(ms),
    fetchImpl: async () => { calls += 1; return calls < 3 ? response({}, 502) : response(); },
  });
  assert.equal(recovered.outcome, 'ok');
  assert.equal(recovered.attempts, 3);
  assert.deepEqual(waits, [2, 4]);

  calls = 0;
  const timedOutThenRecovered = await khoan.fetchDashboard('DN001', PERIOD, {
    baseUrl: 'http://vat.test', serviceToken: TOKEN, backoffMs: [1], sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) { const error = new Error('timeout'); error.name = 'AbortError'; throw error; }
      return response();
    },
  });
  assert.equal(calls, 2);
  assert.equal(timedOutThenRecovered.outcome, 'ok');

  calls = 0;
  const invalid = await khoan.fetchDashboard('DN001', PERIOD, {
    baseUrl: 'http://vat.test', serviceToken: TOKEN, backoffMs: [2, 4],
    fetchImpl: async () => { calls += 1; return response({ ok: true }); },
  });
  assert.equal(calls, 1);
  assert.equal(invalid.outcome, 'invalid_payload');
});

test('audit records actor, scoped employee, period, outcome and rule version without credentials', () => {
  const originalLoad = require('../src/persist').load;
  const originalSave = require('../src/persist').save;
  let saved;
  require('../src/persist').load = () => [];
  require('../src/persist').save = (name, rows) => { saved = { name, rows }; };
  try {
    khoan.writeAudit({ actor: 'CEO', role: 'ceo', empCode: 'DN001', period: PERIOD, outcome: 'ok', attempts: 1, ruleVersion: 'khoan-ssot-v2026-05-r1' });
  } finally {
    require('../src/persist').load = originalLoad;
    require('../src/persist').save = originalSave;
  }
  assert.equal(saved.name, khoan.AUDIT_FILE);
  assert.deepEqual(saved.rows[0], {
    at: saved.rows[0].at, event: 'view', actor: 'CEO', role: 'ceo', empCode: 'DN001',
    month: 7, year: 2026, outcome: 'ok', attempts: 1, ruleVersion: 'khoan-ssot-v2026-05-r1',
  });
  assert.equal(JSON.stringify(saved).includes(TOKEN), false);
});

test('successful upstream data fails closed when mandatory audit cannot be persisted', async () => {
  const payload = await khoan.getForSession({
    session: { emp_code: 'DN001', role: 'sale' }, scope: { empCode: 'DN001' }, requestedEmp: 'DN999', period: PERIOD,
  }, {
    baseUrl: 'http://vat.test', serviceToken: TOKEN, backoffMs: [], fetchImpl: async () => response(),
    auditImpl: () => { throw new Error('audit unavailable'); },
  });
  assert.equal(payload.available, false);
  assert.equal(payload.note, 'chưa lấy được điểm/xu kỳ này');
  assert.equal(payload.phat_du_kien, undefined);
});

test('ALL is a display-only sum of complete per-employee VAT projections and fails closed on partial data', () => {
  const one = khoan.projectDashboard(vatFixture(), 'DN001', PERIOD);
  const two = khoan.projectDashboard(vatFixture({ emp_code: 'DN002', phat_du_kien: 600_000, pct: { thang: 100, quy: 95 } }), 'DN002', PERIOD);
  const aggregate = khoan.aggregatePayloads([one, two], [
    { emp_code: 'DN001', name: 'Một' }, { emp_code: 'DN002', name: 'Hai' },
  ], PERIOD);
  assert.equal(aggregate.available, true);
  assert.equal(aggregate.diem_quy, 57);
  assert.equal(aggregate.phat_du_kien, 2_400_000);
  assert.equal(aggregate.pct_quy, null);
  assert.equal(aggregate.warning_count, 1);
  assert.deepEqual(aggregate.employeeSubtotals.map((item) => [item.emp_code, item.emp_name, item.phat_du_kien]), [
    ['DN001', 'Một', 1_800_000], ['DN002', 'Hai', 600_000],
  ]);
  assert.equal(khoan.aggregatePayloads([one, khoan.emptyPayload('DN002', PERIOD)], [], PERIOD).available, false);
  assert.equal(khoan.aggregatePayloads([one, { ...two, penalty_rule: 'rule khác' }], [], PERIOD).available, false);
});

test('route contract keeps auth/scope backend-side and token names out of frontend source', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'api.js'), 'utf8');
  assert.match(routes, /router\.get\('\/employee-cost\/diem-xu', auth\.requireAuth/);
  assert.match(routes, /auth\.scopeOf\(req\.session\)/);
  assert.match(routes, /employeeCost\.resolveScopedEmployee/);
  assert.doesNotMatch(apiSource, /VAT_SERVICE_TOKEN|Authorization:\s*Bearer/);
});
