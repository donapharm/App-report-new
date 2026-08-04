'use strict';
// Quyền ghi sổ thanh toán — TIỀN THẬT, phải khoá ở BACKEND, không tin frontend.
const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../src/routes');

function findRoute(path) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods.post);
  assert.ok(layer, `không thấy route ${path}`);
  return layer.route.stack;
}

const PATHS = ['/employee-cost/payment/second', '/employee-cost/payment/record', '/employee-cost/payment/undo'];

test('‼ cả 3 route ghi sổ đều phải qua requireAuth + requireAdmin', () => {
  const auth = require('../src/auth');
  for (const path of PATHS) {
    const handlers = findRoute(path).map((item) => item.handle);
    assert.ok(handlers.includes(auth.requireAuth), `${path} thiếu requireAuth`);
    assert.ok(handlers.includes(auth.requireAdmin), `${path} thiếu requireAdmin — NV sẽ ghi được tiền`);
  }
});

test('route ghi sổ không được cache ở trình duyệt', () => {
  const source = require('fs').readFileSync(require.resolve('../src/routes'), 'utf8');
  const block = source.slice(source.indexOf('function paymentTarget(req)'), source.indexOf("router.post('/employee-cost/visibility'"));
  assert.equal((block.match(/private, no-store/g) || []).length, 3, 'cả 3 route phải no-store');
  assert.match(block, /PAYMENT_EMP_NOT_IN_ROSTER/, 'phải chặn mã NV ngoài roster');
  assert.match(block, /actor: req\.session\?\.emp_code/, 'người ghi lấy từ PHIÊN, không lấy từ body');
});
