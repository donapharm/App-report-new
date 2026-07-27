'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const costNotify = require('../src/employeeCostNotify');

function freshState(t) {
  const file = costNotify.STATE_FILE;
  const had = fs.existsSync(file);
  const backup = had ? fs.readFileSync(file, 'utf8') : null;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* ignore */ }
  fs.writeFileSync(file, '{}', 'utf8');
  t.after(() => { if (had) fs.writeFileSync(file, backup, 'utf8'); else { try { fs.unlinkSync(file); } catch { /* ignore */ } } });
}

const ROW = { emp_code: 'DN001', name: 'Nguyễn Văn A', ky: '07.2026', from: '2026-07-01', to: '2026-07-27' };

test('số đã chốt -> gửi số, KHÔNG gắn nhãn tạm tính', () => {
  const total = costNotify.totalFromSummary({ reliable: true, periodTotal: 46_878_505, provisionalPeriodTotal: 46_878_505 });
  assert.deepEqual(total, { amount: 46_878_505, provisional: false });
  const text = costNotify.messageFor({ kind: 'week', row: ROW, total });
  assert.match(text, /46\.878\.505đ/);
  assert.doesNotMatch(text, /TẠM TÍNH/);
});

test('‼ số chưa chốt -> VẪN gửi số nhưng BẮT BUỘC có nhãn TẠM TÍNH + số mã còn thiếu', () => {
  // fail-closed: periodTotal = null khi reliable=false; phải rơi về provisional.
  const total = costNotify.totalFromSummary({ reliable: false, periodTotal: null, provisionalPeriodTotal: 46_878_505 });
  assert.deepEqual(total, { amount: 46_878_505, provisional: true });
  const text = costNotify.messageFor({ kind: 'week', row: ROW, total, gaps: { pairs: 192 } });
  assert.match(text, /46\.878\.505đ/);
  assert.match(text, /TẠM TÍNH/);
  assert.match(text, /còn 192 dòng chưa được gán tỷ lệ %/);
  assert.match(text, /có thể thay đổi/);
});

test('chưa chốt mà không biết số dòng thiếu -> vẫn phải có nhãn TẠM TÍNH', () => {
  const total = costNotify.totalFromSummary({ reliable: false, provisionalPeriodTotal: 1_000 });
  for (const gaps of [{}, { pairs: null }, { pairs: 0 }]) {
    const text = costNotify.messageFor({ kind: 'month', row: ROW, total, gaps });
    assert.match(text, /TẠM TÍNH/);
    assert.doesNotMatch(text, /còn .* dòng/, 'không biết thì đừng bịa con số');
  }
});

test('không có số nào dùng được -> null, nơi gọi bỏ qua (không gửi "0đ")', () => {
  assert.equal(costNotify.totalFromSummary({ reliable: false, periodTotal: null, provisionalPeriodTotal: null }), null);
  assert.equal(costNotify.totalFromSummary({}), null);
  assert.equal(costNotify.messageFor({ kind: 'week', row: ROW, total: null }), null);
});

test('tin tuần ghi lũy kế theo ngày; tin tháng ghi trọn tháng', () => {
  const total = { amount: 5_000_000, provisional: false };
  assert.match(costNotify.messageFor({ kind: 'week', row: ROW, total }), /Lũy kế từ 01\/07 đến 27\/07/);
  assert.match(costNotify.messageFor({ kind: 'month', row: ROW, total }), /Trọn tháng 07/);
});

test('mất nguồn chi phí -> tin nói rõ lỗi nguồn và TUYỆT ĐỐI không nêu số', () => {
  const text = costNotify.unavailableMessageFor(ROW);
  assert.match(text, /chưa lấy được dữ liệu chi phí/);
  assert.match(text, /KHÔNG phải bạn không có chi phí/);
  assert.doesNotMatch(text, /\d[\d.]*đ/, 'không được lọt bất kỳ con số tiền nào');
});

test('self-scoped: tin chỉ chứa tên/mã của chính người nhận', () => {
  const text = costNotify.messageFor({ kind: 'week', row: ROW, total: { amount: 1_000, provisional: false } });
  assert.match(text, /Nguyễn Văn A/);
  assert.doesNotMatch(text, /DN00[2-9]|tổng công ty|toàn công ty/i);
});

test('chống trùng: đã gửi kỳ nào thì thôi kỳ đó, kỳ khác vẫn gửi', (t) => {
  freshState(t);
  assert.equal(costNotify.alreadySent('week', 'week|2026-07-25', 'DN001'), false);
  costNotify.markSent('week', 'week|2026-07-25', 'DN001');
  assert.equal(costNotify.alreadySent('week', 'week|2026-07-25', 'DN001'), true);
  assert.equal(costNotify.alreadySent('week', 'week|2026-08-01', 'DN001'), false, 'tuần sau vẫn gửi');
  assert.equal(costNotify.alreadySent('month', 'week|2026-07-25', 'DN001'), false, 'loại tin khác đếm riêng');
  assert.equal(costNotify.alreadySent('week', 'week|2026-07-25', 'DN002'), false, 'NV khác đếm riêng');
});

test('HTML thân thư không nuốt nội dung và có chú thích "số của riêng bạn"', () => {
  const html = costNotify.htmlFor('💰 Tổng: 1.000đ\n⚠ TẠM TÍNH');
  assert.match(html, /1\.000đ/);
  assert.match(html, /TẠM TÍNH/);
  assert.match(html, /Số của riêng bạn/);
});
