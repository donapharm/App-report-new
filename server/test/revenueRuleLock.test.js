'use strict';
// ‼ KHOÁ LUẬT TÍNH DOANH THU (CEO chốt 2026-08-03).
//
// > CEO: "đề nghị mày thống nhất một bộ code để cho chuẩn, tháng nào cũng tính đúng
// > một công thức đó, nhảy tự động theo tháng, không có lệch — chứ tao loay hoay với
// > mấy vụ như này mệt lắm rồi."
//
// BỐI CẢNH — vì sao phải có khoá này:
// Ngày 02–03/08 App Report lệch App Sale tới 487.924.000đ. Nguyên nhân KHÔNG phải
// công thức gốc sai, mà vì có người THÊM một bộ lọc riêng (loại đơn nhập tay/Zalo)
// mà App Sale không có, rồi đem bản đó lên production. Mỗi lần như vậy CEO phải ngồi
// truy từng đơn.
//
// Test này khoá 3 điều:
//  1. LUẬT LÀ MỘT — App Report tính doanh thu ĐÚNG NHƯ App Sale, không thêm bộ lọc riêng.
//  2. KHÔNG KHOÁ CỨNG THÁNG — kỳ lấy theo biến/tháng lịch VN, tháng nào cũng chạy y nhau.
//  3. ĐỔI LUẬT LÀ PHẢI CỐ Ý — vân tay đổi thì test đỏ, buộc nâng version + ghi CHANGELOG.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'materialize_july_revenue.js');
const LOCK_FILE = path.join(ROOT, 'config', 'revenue_rule_lock.json');
const src = fs.readFileSync(SCRIPT, 'utf8');

// Chỉ lấy phần thân 2 hàm truy vấn nguồn — đây là nơi QUYẾT ĐỊNH đơn nào được tính.
// Sửa lời giải thích không làm đỏ test; đụng vào điều kiện lọc thì đỏ ngay.
function ruleBody() {
  const start = src.indexOf('async function fetchMisa(');
  const end = src.indexOf('async function main(');
  assert.ok(start > 0 && end > start, 'không tìm thấy vùng mã tính doanh thu');
  return src.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('--'))
    .join('\n');
}

test('‼ ĐỔI LUẬT TÍNH DOANH THU thì PHẢI cố ý (khoá vân tay)', () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  const actual = crypto.createHash('sha256').update(ruleBody()).digest('hex');
  assert.equal(actual, lock.ruleHash, [
    '',
    'LUẬT TÍNH DOANH THU ĐÃ BỊ ĐỔI.',
    '',
    'App Report phải tính GIỐNG HỆT ô "ĐÃ THỰC HIỆN" của App Sale:',
    '    CRM đã xuất hoá đơn  +  Đối tác đã xuất/giao',
    'KHÔNG được thêm bộ lọc riêng mà App Sale không có (đã gây lệch 487.924.000đ ngày 03/08).',
    '',
    'Nếu đây là thay đổi CỐ Ý và ĐÃ ĐỐI CHIẾU KHỚP App Sale:',
    `  1. cập nhật config/revenue_rule_lock.json  ->  ruleHash: "${actual}"`,
    '  2. nâng "version" trong file lock đó',
    '  3. ghi CHANGELOG.md: đổi gì, vì sao, đã đối chiếu App Sale ra số bao nhiêu',
    '',
  ].join('\n'));
});

test('‼ KHÔNG khoá cứng tháng — tháng nào cũng chạy một công thức', () => {
  // Kỳ phải lấy từ biến môi trường hoặc tháng lịch, KHÔNG được ghi cứng "07.2026".
  assert.match(src, /REVENUE_REFRESH_KY|MATERIALIZE_KY/,
    'kỳ phải nhận từ biến, để tháng nào cũng chạy được');
  assert.match(src, /function defaultKy\(\)/,
    'phải có defaultKy() để tự nhảy theo tháng hiện tại');
  const rule = ruleBody();
  assert.doesNotMatch(rule, /['"`]\d{2}\.20\d{2}['"`]/,
    'vùng tính doanh thu KHÔNG được ghi cứng kỳ dạng MM.YYYY');
  assert.doesNotMatch(rule, /['"`]20\d{2}-\d{2}-\d{2}['"`]/,
    'vùng tính doanh thu KHÔNG được ghi cứng ngày cụ thể');
});

test('‼ tháng hiện tại lấy theo GIỜ VIỆT NAM (GMT+7)', () => {
  const fn = src.slice(src.indexOf('function defaultKy()'), src.indexOf('function defaultKy()') + 400);
  assert.match(fn, /Asia\/Bangkok/,
    'defaultKy() phải dùng Asia/Bangkok — dùng giờ UTC thì 0h–7h sáng giờ VN ra tháng trước');
});

test('‼ KHÔNG được thêm bộ lọc riêng App Sale không có', () => {
  const rule = ruleBody();
  // Những cờ đã từng bị thêm vào rồi gây lệch — chặn quay lại.
  for (const banned of ['PARTNER_TOKEN_INVOICE', 'manual_zalo', 'MANUAL_ZALO']) {
    assert.doesNotMatch(rule, new RegExp(banned),
      `"${banned}" là bộ lọc riêng của App Report, App Sale KHÔNG có. Thêm vào là lệch tiền.`);
  }
  // Quy kỳ chỉ theo MỘT mốc ngày. Lọc kèm ngày đặt hàng = bộ lọc kép, từng làm
  // mất 382,6 triệu (SPEC_REVENUE_DELIVERY_PERIOD.md, CEO chốt 29/07).
  assert.doesNotMatch(rule, /o\.created_at\s*>=|o\.created_at\s*</,
    'CẤM lọc theo ngày đặt o.created_at — bộ lọc kép làm đơn rơi khỏi cả hai kỳ');
});

test('luật hai nguồn được ghi thành chữ trong chính script (để đối chiếu App Sale)', () => {
  assert.match(src, /revenue_bucket in \(official,pending\)/,
    'CRM: phải khớp "Đã ghi + Đề nghị ghi" của App Sale');
  assert.match(src, /amount `invoice_export_amount`/,
    'CRM: phải lấy "thành tiền xuất hoá đơn" của App Sale');
  assert.match(src, /`delivered_qty \* price`/,
    'Đối tác: phải khớp "SL giao thực × đơn giá" của App Sale');
});
