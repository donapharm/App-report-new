const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../src/salaryRevenueBridge');

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
  const handler = bridge.createHandler({ store: { getRows: () => [] }, tokenHashProvider: () => bridge.sha256('service-secret-123') });

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
  const handler = bridge.createHandler({ store, tokenHashProvider: () => bridge.sha256('service-secret-123') });
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
});

test('handler không chạy khi secret phía server chưa cấu hình', () => {
  const handler = bridge.createHandler({ store: { getRows: () => { throw new Error('không được đọc'); } }, tokenHashProvider: () => '' });
  const res = response();
  handler({ headers: {}, query: { thang: '2026-08' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'SALARY_REVENUE_NOT_CONFIGURED');
});
