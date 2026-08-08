/**
 * TRANG HOME HỎI QUYỀN THẤY Ô "APP REPORT" (CEO chốt 08/08/2026)
 *
 * CEO: *"các tài khoản này không can thiệp và không vào được App Report.
 * Không cho hiển thị thấy trên home.donapharm.vn."*
 *
 * Điểm phải khoá: Home KHÔNG được giữ bản sao danh sách bị chặn — hỏi App Report,
 * và endpoint fail-closed (không biết ⇒ ẩn).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
const accessPolicy = require('../src/accessPolicy');

const at = SOURCE.indexOf("router.get('/integrations/home/app-visibility'");
assert.ok(at >= 0, 'không tìm thấy route app-visibility cho Home');
// Lấy CẢ khối chú thích phía trên (nằm trước dòng router.get) — phần giải thích
// "vì sao" cũng là hợp đồng, không được ai lặng lẽ xoá.
const DOC_START = SOURCE.lastIndexOf('/**', at);
const BODY = SOURCE.slice(DOC_START, SOURCE.indexOf("router.get('/integrations/datahub/employee-quarter-penalty'", at));

test('chỉ gọi được bằng service token, không mở cho người dùng thường', () => {
  assert.match(SOURCE.slice(at, SOURCE.indexOf('\n', at)), /auth\.requireDataHubService/);
});

test('fail-closed: mã sai/rỗng/không có trong danh bạ đều ẩn ô', () => {
  assert.match(BODY, /reason: 'EMP_CODE_INVALID'[\s\S]*?visible: false|visible: false, reason: 'EMP_CODE_INVALID'/);
  assert.match(BODY, /visible: false, reason: 'NOT_IN_DIRECTORY'/);
  const invalidFirst = BODY.indexOf('EMP_CODE_INVALID');
  const allowAt = BODY.indexOf('visible: true');
  assert.ok(invalidFirst >= 0 && allowAt > invalidFirst, 'chặn phải đứng trước nhánh cho phép');
});

test('16 mã CEO khoá đều bị ẩn khỏi Home; người bình thường vẫn thấy', () => {
  const blocked = ['VP002', 'VP003', 'VP006', 'VP007', 'VP008', 'VP009', 'VP010', 'VP011',
    'VP012', 'VP013', 'VP014', 'VP015', 'VP016', 'VP017', 'DN021', 'DN023'];
  assert.equal(blocked.length, 16, 'đúng 16 mã theo lệnh CEO 08/08');
  for (const code of blocked) assert.equal(accessPolicy.isLoginBlocked(code), true, code);
  for (const code of ['DN001', 'DN006', 'VP004', 'VP018', 'CEO']) {
    assert.equal(accessPolicy.isLoginBlocked(code), false, code);
  }
});

test('VP018 vẫn thấy ô nhưng kèm nhãn revenue_only để Home nói đúng kỳ vọng', () => {
  assert.equal(accessPolicy.accessProfileFor('VP018'), 'revenue_only');
  assert.equal(accessPolicy.accessProfileFor('DN001'), 'standard');
  assert.match(BODY, /accessProfile: accessPolicy\.accessProfileFor\(empCode\)/);
});

test('KHÔNG rò thông tin: chỉ trả quyết định, không tên/SĐT/danh sách người bị chặn', () => {
  assert.doesNotMatch(BODY, /\bname\b|\bphone\b|BLOCKED_LOGIN_EMP_CODES/);
  assert.match(BODY, /Không trả gì ngoài quyết định/);
});

test('nguồn sự thật DUY NHẤT là accessPolicy — Home không được giữ bản sao', () => {
  assert.match(BODY, /Nguồn sự thật DUY NHẤT là `accessPolicy`/);
  // Route dùng đúng policy đang chặn đăng nhập, không tự dựng danh sách thứ hai.
  assert.match(BODY, /accessPolicy\.isLoginBlocked\(empCode\)/);
});
