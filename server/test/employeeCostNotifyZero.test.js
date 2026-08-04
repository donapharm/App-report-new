'use strict';
/**
 * DIỄN TẬP KHÔ 05/08/2026 bắt được 2 lỗi TRƯỚC KHI có tin nào bay đi.
 * Test này khoá cả hai lại.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const notify = require('../src/employeeCostNotify');

const row = { emp_code: 'DN004', name: 'Bùi Hoàng Ngọc Quyên', ky: '08.2026' };

test('‼ KHÔNG gửi tin 0đ — DN004·DN005·DN012·DN017 bị dựng thành "bạn nhận 0đ"', () => {
  // Lỗi cũ: `if (!total)` chỉ kiểm CÁI HỘP, không kiểm SỐ TIỀN bên trong.
  for (const amount of [0, -1, null, undefined, NaN, '']) {
    assert.equal(notify.messageFor({ kind: 'month', row, total: { amount } }), null,
      `số tiền ${JSON.stringify(amount)} vẫn dựng ra tin là sai`);
  }
});

test('có tiền thật thì vẫn gửi bình thường', () => {
  const text = notify.messageFor({ kind: 'month', row, total: { amount: 3_158_894 } });
  assert.ok(text);
  assert.match(text, /Tháng 08/);
  assert.match(text, /Bùi Hoàng Ngọc Quyên/);
});

test('‼ "0đ thật" KHÁC "không lấy được nguồn" — không gộp làm một', () => {
  // Không có nguồn thì đi lối riêng, và tin đó PHẢI nói rõ không phải NV không có chi phí.
  const text = notify.unavailableMessageFor({ emp_code: 'DN002', name: 'Nguyễn Thị Hằng Nga', ky: '08.2026' });
  assert.match(text, /chưa lấy được dữ liệu chi phí/);
  assert.match(text, /KHÔNG phải bạn không có chi phí/);
  assert.doesNotMatch(text, /0đ/, 'tin lỗi nguồn tuyệt đối không được nêu số 0');
});

test('‼ diễn tập phải lấy ngày theo GIỜ VN, không lấy giờ UTC', () => {
  // Bot bắt 05/08 06:23: script in mốc 2026-08-04 vì `toISOString()` trả ngày UTC.
  // Từ 00:00–07:00 giờ VN thì UTC vẫn còn HÔM QUA ⇒ đầu tháng chọn NHẦM THÁNG TRƯỚC.
  const source = fs.readFileSync(require.resolve('../scripts/test_notify_dryrun.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.doesNotMatch(code, /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/,
    'lấy ngày kiểu UTC trong script diễn tập');
  assert.match(code, /vnToday\(\)/, 'phải dùng helper giờ VN sẵn có');
});
