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

// ‼ CEO chốt 04/08: "chỉ duy nhất CEO được phép ghi thôi" — admin cũng không.
test('‼ cả 3 route ghi sổ chỉ CEO được vào, admin KHÔNG được', () => {
  const auth = require('../src/auth');
  for (const path of PATHS) {
    const handlers = findRoute(path).map((item) => item.handle);
    assert.ok(handlers.includes(auth.requireAuth), `${path} thiếu requireAuth`);
    assert.ok(handlers.includes(auth.requireCeo), `${path} phải dùng requireCeo`);
    assert.ok(!handlers.includes(auth.requireAdmin), `${path} còn requireAdmin — admin sẽ ghi được tiền`);
  }
});

test('requireCeo chặn đúng: admin/sale bị 403, chỉ ceo đi qua', () => {
  const auth = require('../src/auth');
  const run = (role) => {
    let status = 0; let body = null; let passed = false;
    auth.requireCeo({ session: { role } }, { status(code) { status = code; return this; }, json(payload) { body = payload; } }, () => { passed = true; });
    return { status, body, passed };
  };
  assert.equal(run('ceo').passed, true);
  for (const role of ['admin', 'sale', '', undefined, 'CEO_FAKE']) {
    const result = run(role);
    assert.equal(result.passed, false, `role ${role} không được đi qua`);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'CEO_ONLY');
  }
  assert.equal(run('CEO').passed, true, 'không phân biệt hoa thường');
});

test('‼ MỌI route ghi sổ thanh toán đều phải no-store và lấy người ghi từ PHIÊN', () => {
  const source = require('fs').readFileSync(require.resolve('../src/routes'), 'utf8');
  // Đếm cứng "đúng 3 route" là sai: thêm route mới (đề nghị/duyệt/từ chối) sẽ làm
  // test đỏ oan, hoặc tệ hơn là bị sửa thành số lớn hơn mà không ai soi từng route.
  // Nay quét TỪNG route ghi và bắt buộc mỗi cái phải no-store.
  const paths = [...source.matchAll(/router\.post\(`?'?\/employee-cost\/payment\/([a-z-]+|\$\{path\})/g)].map((m) => m[1]);
  assert.ok(paths.length >= 6, `phải có đủ route ghi sổ, thấy ${paths.join(', ')}`);
  for (const marker of ['second', 'record', 'undo', 'request', 'request-unlock']) {
    const at = source.indexOf(`/employee-cost/payment/${marker}'`);
    assert.ok(at > 0, `thiếu route ${marker}`);
    assert.match(source.slice(at, at + 1400), /private, no-store/, `route ${marker} phải no-store`);
  }
  const block = source.slice(source.indexOf('function paymentTarget(req)'), source.indexOf('/* ---------- Màn "CHƯA ĐỒNG BỘ"'));
  assert.match(block, /PAYMENT_EMP_NOT_IN_ROSTER/, 'phải chặn mã NV ngoài roster');
  assert.match(block, /actor: req\.session\?\.emp_code/, 'người ghi lấy từ PHIÊN, không lấy từ body');
});

test('‼ duyệt · từ chối · mở khoá sớm CHỈ CEO; đề nghị thì NV tự bấm cho chính mình', () => {
  const source = require('fs').readFileSync(require.resolve('../src/routes'), 'utf8');
  // Ba thao tác quyền lực phải đi qua requireCeo.
  assert.match(source, /\[\['unlock', 'grantUnlock'\], \['approve', 'approvePayment'\], \['reject', 'rejectPayment'\]\]/);
  const ceoLoop = source.slice(source.indexOf("['unlock', 'grantUnlock']"), source.indexOf("router.post('/employee-cost/payment/second'"));
  assert.match(ceoLoop, /auth\.requireCeo/, 'mở khoá/duyệt/từ chối phải requireCeo');
  // NV đề nghị: KHÔNG requireCeo, nhưng phải tự khoá phạm vi về chính mình.
  const selfBlock = source.slice(source.indexOf('function selfPaymentTarget'), source.indexOf("router.post('/employee-cost/payment/request-unlock'"));
  assert.doesNotMatch(selfBlock, /auth\.requireCeo/);
  assert.match(selfBlock, /Chỉ đề nghị được cho chính mình/);
  assert.match(selfBlock, /PAYMENT_EMP_FORBIDDEN/);
});

test('‼ NV KHÔNG được nhập số tiền ở luồng đề nghị', () => {
  const source = require('fs').readFileSync(require.resolve('../src/routes'), 'utf8');
  const selfBlock = source.slice(source.indexOf('function selfPaymentTarget'),
    source.indexOf("for (const [path, action] of"));
  assert.doesNotMatch(selfBlock, /req\.body\?\.amount/, 'luồng đề nghị tuyệt đối không đọc số tiền từ NV');
});
