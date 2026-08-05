'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('../src/auth');

/**
 * SỰ CỐ 05/08/2026 — cổng quyền CEO khoá nhầm chính CEO.
 *
 * Tài khoản CEO trên PROD: `emp_code = 'CEO'` · `role = 'admin'` (bot xác nhận 05/08).
 * `isCeo(role)` chỉ nhận đúng chuỗi 'ceo' ⇒ trả **false** cho chính CEO, nên **6 cửa
 * tiền** (approve · reject · unlock · second · record · undo) trả 403 `CEO_ONLY` cho
 * người duy nhất được phép đi qua. Nằm im từ lúc dựng luồng duyệt, không ai kêu vì
 * frontend lại giấu mất nút.
 *
 * Bộ test này khoá cả hai vế: **CEO phải vào được**, và **admin khác vẫn phải bị chặn**.
 */

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
// Bỏ chú thích rồi mới soi — lời cảnh báo viết trong file không bị tính là vi phạm.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

test('‼ tài khoản CEO thật trên PROD (role admin) PHẢI đi qua', () => {
  assert.equal(auth.isCeoActor({ role: 'admin', emp_code: 'CEO' }), true);
  assert.equal(auth.isCeoActor({ role: 'admin', emp_code: ' ceo ' }), true, 'khoảng trắng/chữ thường vẫn phải nhận');
  assert.equal(auth.isCeoActor({ role: 'ceo', emp_code: 'CEO' }), true);
  assert.equal(auth.isCeoActor({ role: 'CEO', emp_code: '' }), true, 'role hoa thường không phân biệt');
});

test('‼ admin KHÁC vẫn bị chặn — lệnh CEO 04/08 "admin cũng không"', () => {
  for (const session of [
    { role: 'admin', emp_code: 'VP002' },
    { role: 'admin', emp_code: '' },
    { role: 'sale', emp_code: 'DN009' },
    { role: '', emp_code: 'DN001' },
    {}, null, undefined,
  ]) {
    assert.equal(auth.isCeoActor(session), false, `${JSON.stringify(session)} không được đi qua`);
  }
});

test('requireCeo dùng isCeoActor, trả đúng 403 CEO_ONLY cho người ngoài', () => {
  const run = (session) => {
    let status = 0; let body = null; let passed = false;
    auth.requireCeo({ session }, { status(c) { status = c; return this; }, json(p) { body = p; } }, () => { passed = true; });
    return { status, body, passed };
  };
  assert.equal(run({ role: 'admin', emp_code: 'CEO' }).passed, true, 'chính CEO — đây là cả lý do có bản sửa này');
  const blocked = run({ role: 'admin', emp_code: 'VP002' });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'CEO_ONLY');
});

test('‼ CẤM nới bằng isAdmin — sẽ trao quyền duyệt tiền cho mọi admin', () => {
  const source = code(read('server', 'src', 'auth.js'));
  const body = source.slice(source.indexOf('function isCeoActor'), source.indexOf('function requireCeo'));
  assert.doesNotMatch(body, /isAdmin/, 'isCeoActor mà gọi isAdmin là hỏng toàn bộ ý nghĩa');
  // Khẳng định bằng hành vi, không chỉ bằng chữ: admin thường vẫn phải trượt.
  assert.notEqual(auth.isCeoActor({ role: 'admin', emp_code: 'VP002' }), auth.isAdmin('admin'));
});

test('mã CEO lấy từ cấu hình, không rải chuỗi "CEO" khắp code', () => {
  assert.ok(auth.CEO_EMP_CODES instanceof Set);
  assert.equal(auth.CEO_EMP_CODES.has('CEO'), true, 'mặc định phải nhận đúng tài khoản PROD');
  assert.match(code(read('server', 'src', 'auth.js')), /process\.env\.CEO_EMP_CODES/);
});

test('‼ CHỈ MỘT bản định nghĩa — bảy bản chép là nguyên nhân sự cố', () => {
  // Trước 05/08 có tới BẢY chỗ tự xét "ai là CEO": auth.isCeo (sai) ·
  // requireCeoDelivery (quên .toUpperCase) · requireCeoQlnb · requireCeoPenaltyFormula ·
  // canEdit công thức phạt · routes.js:3028 · và 4 chỗ frontend (1 sai).
  // Nay tất cả gọi `auth.isCeoActor`.
  //
  // ‼ Chỉ cấm xét trên NGƯỜI ĐANG ĐĂNG NHẬP (`session`/`me`). So `row.emp_code === 'CEO'`
  // để TÌM DÒNG dữ liệu của CEO (vd bảng map Telegram) là việc khác, vẫn được phép —
  // cấm cả cái đó thì thành cấm nhầm.
  const actorCompare = /(session|me)\??\.(emp_code|role)[^\n]*===\s*'(CEO|ceo)'/;
  for (const file of [
    ['server', 'src', 'routes.js'],
    ['web', 'src', 'App.jsx'],
    ['web', 'src', 'CeoNotificationBell.jsx'],
    ['web', 'src', 'pages', 'DormantReports.jsx'],
    ['web', 'src', 'pages', 'PaymentSchedule.jsx'],
  ]) {
    const source = code(read(...file));
    assert.doesNotMatch(source, actorCompare, `${file.join('/')} còn tự xét quyền CEO của người đăng nhập`);
    assert.doesNotMatch(source, /toLowerCase\(\) === 'ceo'/, `${file.join('/')} còn tự so chuỗi role`);
  }
});

test('‼ cả 5 cửa CEO ở backend đều đi qua isCeoActor', () => {
  const routes = code(read('server', 'src', 'routes.js'));
  for (const guard of ['requireCeoDelivery', 'requireCeoQlnb', 'requireCeoPenaltyFormula']) {
    const at = routes.indexOf(`const ${guard} =`);
    assert.ok(at > 0, `thiếu ${guard}`);
    assert.match(routes.slice(at, at + 260), /auth\.isCeoActor\(req\.session\)/, `${guard} chưa dùng bản chung`);
  }
  assert.match(routes, /canEdit: auth\.isCeoActor\(req\.session\)/, 'nút sửa công thức phạt cũng phải theo danh tính');
});

test('‼ backend phải NÓI cho frontend biết, frontend không được đoán', () => {
  const routes = code(read('server', 'src', 'routes.js'));
  assert.match(routes, /is_ceo: auth\.isCeoActor\(req\.session\)/, '/me phải trả is_ceo');
  // Đây chính là dòng đã giấu mất nút Duyệt của CEO suốt cả tuần.
  assert.match(code(read('web', 'src', 'pages', 'PaymentSchedule.jsx')), /canRecord=\{!!me\?\.is_ceo\}/);
});

test('‼ ba cửa CEO trong routes.js đều gọi lại đúng một hàm', () => {
  const routes = code(read('server', 'src', 'routes.js'));
  for (const guard of ['requireCeoDelivery', 'requireCeoQlnb']) {
    const at = routes.indexOf(`const ${guard} =`);
    assert.ok(at > 0, `thiếu ${guard}`);
    assert.match(routes.slice(at, at + 200), /auth\.isCeoActor\(req\.session\)/);
  }
  assert.match(routes, /const canonicalCeo = auth\.isCeoActor\(req\.session\)/);
});
