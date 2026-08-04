'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../src/routes');
const store = require('../src/syncExceptionStore');
const persist = require('../src/persist');

function invoke(query, session = { emp_code: 'CEO', role: 'ceo' }) {
  const layer = router.stack.find((item) => item.route?.path === '/revenue/sync-exceptions' && item.route.methods.get);
  assert.ok(layer, 'thiếu route /revenue/sync-exceptions');
  const handler = layer.route.stack.at(-1).handle;
  let statusCode = 200; let body = null; const headers = {};
  handler({ query, session }, {
    status(code) { statusCode = code; return this; },
    set(key, value) { headers[key.toLowerCase()] = value; return this; },
    json(payload) { body = payload; return this; },
  });
  return { statusCode, body, headers };
}

test.beforeEach(() => persist.save(store.FILE, {}));

test('‼ chưa chạy phân loại KHÁC HẲN đã chạy và sạch', () => {
  const result = invoke({ ky: '2026-07' });
  assert.equal(result.body.ran, false, 'phải nói rõ CHƯA CHẠY');
  assert.equal(result.body.report, null, 'không được trả báo cáo rỗng làm người xem tưởng sạch');
  assert.match(result.body.note, /chưa chạy phân loại/);
});

test('có dữ liệu ⇒ trả báo cáo kèm bất biến và ai xử lý', () => {
  store.write('2026-07', {
    runId: 'run-1', source: { amount: 1_000_000, rows: 3 }, included: { amount: 700_000, rows: 2 },
    exceptions: [{ code: 'MISA_THIEU_NGAY_DOANH_THU', amount: 300_000, orderCode: 'DH479815711' }],
  });
  const { body, headers } = invoke({ ky: '07.2026' });
  assert.equal(body.ran, true);
  assert.equal(body.report.balanced, true);
  assert.equal(body.report.totals.excludedAmount, 300_000);
  assert.equal(body.report.rows[0].owner, 'Kế toán MISA');
  assert.equal(body.report.rows[0].orderCode, 'DH479815711');
  assert.equal(headers['cache-control'], 'private, no-store');
});

test('kỳ sai khuôn bị chặn', () => {
  assert.equal(invoke({ ky: 'bậy' }).statusCode, 400);
  assert.equal(invoke({}).statusCode, 400);
});

test('route phải khoá quyền admin', () => {
  const auth = require('../src/auth');
  const layer = router.stack.find((item) => item.route?.path === '/revenue/sync-exceptions');
  const handlers = layer.route.stack.map((item) => item.handle);
  assert.ok(handlers.includes(auth.requireAuth));
  assert.ok(handlers.includes(auth.requireAdmin));
});

test('kho: kỳ sai khuôn không ghi được, và không phình vô hạn', () => {
  assert.throws(() => store.write('bậy', {}), { code: 'SYNC_EXCEPTION_PERIOD_INVALID' });
  for (let i = 0; i < store.MAX_PERIODS + 5; i += 1) {
    const month = String((i % 12) + 1).padStart(2, '0');
    store.write(`${2000 + Math.floor(i / 12)}-${month}`, { exceptions: [] });
  }
  assert.ok(Object.keys(persist.load(store.FILE, {})).length <= store.MAX_PERIODS);
});
