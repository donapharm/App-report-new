const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../src/salaryRevenueBridge');
const auditSupport = require('../src/salaryRevenueAudit');

function controls({ limit = 100 } = {}) {
  const audit = [];
  return { audit, auditor: (entry) => audit.push(entry), limiter: auditSupport.createMinuteLimiter({ limit, now: () => 1_000 }) };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('đổi YYYY-MM sang kỳ App Report MM.YYYY và từ chối tháng sai', () => {
  assert.equal(bridge.uiPeriod('2026-08'), '08.2026');
  for (const invalid of ['', '08.2026', '2026-00', '2026-13', '2026-8']) assert.equal(bridge.uiPeriod(invalid), '');
});

test('gom đúng doanh thu theo mã NV, chuẩn hóa mã và không trả mã ngoài hợp đồng', () => {
  assert.deepEqual(bridge.aggregateByEmployee([
    { emp_code: 'dn006', revenue: 100.4 },
    { emp_code: 'DN006', revenue: 50.4 },
    { emp_code: 'VP004', revenue: -20 },
    { emp_code: 'UNALLOCATED', revenue: 999 },
    { emp_code: 'DN007', revenue: 'không-phải-số' },
  ]), [
    { ma: 'DN006', doanhSo: 151 },
    { ma: 'VP004', doanhSo: -20 },
  ]);
});

test('handler fail-closed: thiếu token 401, sai token 403, tháng sai 400', () => {
  const c = controls();
  const handler = bridge.createHandler({ store: { getRows: () => [] }, tokenHashProvider: () => bridge.sha256('service-secret-123'), ...c });

  let res = response();
  handler({ headers: {}, query: { thang: '2026-08' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['www-authenticate'], 'Bearer');

  res = response();
  handler({ headers: { authorization: 'Bearer wrong' }, query: { thang: '2026-08' } }, res);
  assert.equal(res.statusCode, 403);

  res = response();
  handler({ headers: { authorization: 'Bearer service-secret-123' }, query: { thang: '2026-13' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(c.audit.map(({ status, recordCount }) => [status, recordCount]), [[401, 0], [403, 0], [400, 0]]);
});

test('handler trả đúng schema tối thiểu và chỉ đọc đúng kỳ yêu cầu', () => {
  const calls = [];
  const store = {
    getRows(args) {
      calls.push(args);
      return [
        { emp_code: 'DN006', revenue: 420000000.4 },
        { emp_code: 'DN099', revenue: 50000000 },
      ];
    },
  };
  const c = controls();
  const handler = bridge.createHandler({ store, tokenHashProvider: () => bridge.sha256('service-secret-123'), ...c });
  const res = response();
  handler({ headers: { authorization: 'Bearer service-secret-123' }, query: { thang: '2026-08' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(calls, [{ ky: '08.2026', scope: {} }]);
  assert.deepEqual(res.body, {
    thang: '2026-08',
    data: [
      { ma: 'DN006', doanhSo: 420000000 },
      { ma: 'DN099', doanhSo: 50000000 },
    ],
  });
  assert.deepEqual(Object.keys(res.body).sort(), ['data', 'thang']);
  assert.deepEqual(c.audit, [{ month: '2026-08', recordCount: 2, status: 200, result: 'ok' }]);
});

test('handler không chạy khi secret phía server chưa cấu hình', () => {
  const c = controls();
  const handler = bridge.createHandler({ store: { getRows: () => { throw new Error('không được đọc'); } }, tokenHashProvider: () => '', ...c });
  const res = response();
  handler({ headers: {}, query: { thang: '2026-08' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'SALARY_REVENUE_NOT_CONFIGURED');
  assert.equal(c.audit[0].status, 503);
});

test('rate limit trả 429, ghi audit và audit không chứa token hoặc số tiền', () => {
  const c = controls({ limit: 2 });
  const handler = bridge.createHandler({
    store: { getRows: () => [{ emp_code: 'DN001', revenue: 987654321 }] },
    tokenHashProvider: () => bridge.sha256('top-secret-value'),
    ...c,
  });
  for (let i = 0; i < 3; i += 1) {
    const res = response();
    handler({ headers: { authorization: 'Bearer top-secret-value' }, query: { thang: '2026-08' } }, res);
    assert.equal(res.statusCode, i < 2 ? 200 : 429);
  }
  assert.equal(c.audit.at(-1).status, 429);
  const serialized = JSON.stringify(c.audit);
  assert.doesNotMatch(serialized, /top-secret-value|987654321/);
});

test('file audit chỉ ghi metadata tối thiểu, timestamp GMT+7 và mode 0600', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-revenue-audit-'));
  const file = path.join(dir, 'audit.jsonl');
  try {
    const auditor = auditSupport.createFileAuditor({ file, now: () => Date.UTC(2026, 7, 17, 23, 30, 0) });
    auditor({ month: '2026-08', recordCount: 2, status: 200, result: 'ok', token: 'must-not-leak', amount: 999 });
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'month', 'recordCount', 'result', 'status']);
    assert.equal(entry.at, '2026-08-18T06:30:00+07:00');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(entry), /must-not-leak|999/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
