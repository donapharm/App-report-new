'use strict';
// CHẶN ĐẾM TRÙNG ĐƠN GIỮA HAI KỲ (CEO chốt 2026-07-30, việc 3).
//
// CEO: "phải có cơ chế chặn trùng đơn, tránh một đơn tính cho cả 2 tháng (như tính
// T06 rồi T07 tính nữa / tính T07 rồi T08 tính lại nữa)."
//
// Vì sao lớp cũ không đủ: `reconcile.duplicateLines` chỉ soát trùng TRONG CÙNG một
// kỳ. Một dòng nằm ở T06 rồi lại nằm ở T07 thì cả hai kỳ nhìn riêng đều SẠCH.
const test = require('node:test');
const assert = require('node:assert/strict');
const dup = require('../src/crossPeriodDuplicates');

const t06 = [
  { source_line_id: 'L1', emp_code: 'DN007', unit_code: 'U1', order_code: 'DH100', revenue: 100_000_000, revenue_date: '2026-06-25' },
  { source_line_id: 'L2', emp_code: 'DN008', unit_code: 'U2', order_code: 'DH200', revenue: 50_000_000, revenue_date: '2026-06-28' },
];
const t07 = [
  // ‼ Cùng L1: đơn đã tính ở T06 nay lại nằm ở T07 (sửa ngày thực giao mà kỳ cũ
  // chưa bỏ dòng ra) ⇒ doanh thu đếm đôi, NV được thưởng trên số đếm đôi.
  { source_line_id: 'L1', emp_code: 'DN007', unit_code: 'U1', order_code: 'DH100', revenue: 100_000_000, revenue_date: '2026-07-02' },
  { source_line_id: 'L3', emp_code: 'DN010', unit_code: 'U3', order_code: 'DH300', revenue: 30_000_000, revenue_date: '2026-07-10' },
];

test('‼ bắt được dòng bị tính cho CẢ HAI KỲ và nói đúng số tiền đếm đôi', () => {
  const result = dup.scan({ '06.2026': t06, '07.2026': t07 });
  assert.equal(result.status, 'duplicates_found');
  assert.equal(result.clean, false);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.doubleCountedRevenue, 100_000_000, 'giữ 1 lần là đúng, lần thứ hai là tiền đếm đôi');
  const entry = result.duplicates[0];
  assert.deepEqual(entry.kys, ['06.2026', '07.2026']);
  assert.equal(entry.basis, 'source_line_id');
  assert.equal(entry.hits.length, 2);
});

test('cùng kỳ trùng nhau thì KHÔNG tính vào đây (đã có lớp reconcile lo)', () => {
  const result = dup.scan({
    '07.2026': [
      { source_line_id: 'L9', order_code: 'DH900', revenue: 1_000_000 },
      { source_line_id: 'L9', order_code: 'DH900', revenue: 1_000_000 },
    ],
  });
  assert.equal(result.duplicateCount, 0, 'trùng trong cùng một kỳ là việc của reconcile.duplicateLines');
  assert.equal(result.status, 'clean');
});

test('không có source_line_id thì dùng order_item_id, rồi tới bộ ghép mã đơn + mã hàng', () => {
  assert.equal(dup.identityOf({ source_line_id: 'A' }).basis, 'source_line_id');
  assert.equal(dup.identityOf({ order_item_id: 'B' }).basis, 'order_item_id');
  assert.equal(dup.identityOf({ order_code: 'DH1', product_code: 'P1', unit_code: 'U1' }).basis, 'order+product+unit');
  const result = dup.scan({
    '06.2026': [{ order_code: 'DH500', product_code: 'P9', unit_code: 'U5', revenue: 7_000_000 }],
    '07.2026': [{ order_code: 'DH500', product_code: 'P9', unit_code: 'U5', revenue: 7_000_000 }],
  });
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.duplicates[0].basis, 'order+product+unit');
  assert.equal(result.doubleCountedRevenue, 7_000_000);
});

test('‼ dòng KHÔNG có khoá nhận dạng thì KHÔNG được tuyên là sạch', () => {
  const result = dup.scan({
    '07.2026': [{ emp_code: 'DN001', unit_code: 'U1', revenue: 9_000_000 }],
  });
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.unidentifiableCount, 1);
  assert.equal(result.clean, false, 'chưa thấy trùng KHÔNG có nghĩa là không trùng');
  assert.equal(result.status, 'unverifiable');
  assert.match(result.unidentifiable[0].reason, /KHÔNG chứng minh được là không trùng/);
  assert.equal(result.perKy['07.2026'].unidentifiable, 1);
});

test('sạch thật thì nói sạch, và nêu đủ các kỳ đã soát', () => {
  const result = dup.scan({ '06.2026': [t06[1]], '07.2026': [t07[1]] });
  assert.equal(result.status, 'clean');
  assert.equal(result.clean, true);
  assert.equal(result.doubleCountedRevenue, 0);
  assert.match(dup.summaryText(result), /Không có đơn nào bị tính cho hai kỳ \(06\.2026 · 07\.2026\)/);
});

test('câu chữ nêu đủ: bao nhiêu tiền đếm đôi · dòng nào · AI QUYẾT', () => {
  const message = dup.summaryText(dup.scan({ '06.2026': t06, '07.2026': t07 }));
  assert.match(message, /đang đếm đôi 100\.000\.000đ/);
  assert.match(message, /DH100/);
  assert.match(message, /nằm ở 06\.2026 \(2026-06-25\) \+ 07\.2026 \(2026-07-02\)/);
  assert.match(message, /VP018\/DN007 chốt dòng này thuộc kỳ NÀO/);
  // App Report KHÔNG tự chọn kỳ nào giữ — đó là quyết định nghiệp vụ.
  assert.match(message, /App Report KHÔNG tự chọn giúp/);
});

test('soát được nhiều hơn hai kỳ liền nhau (T06 → T07 → T08)', () => {
  const row = (ky, date) => ({ source_line_id: 'LX', order_code: 'DHX', emp_code: 'DN005', revenue: 20_000_000, revenue_date: date, ky });
  const result = dup.scan({
    '06.2026': [row('06.2026', '2026-06-30')],
    '07.2026': [row('07.2026', '2026-07-01')],
    '08.2026': [row('08.2026', '2026-08-01')],
  });
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.duplicates[0].kys, ['06.2026', '07.2026', '08.2026']);
  assert.equal(result.doubleCountedRevenue, 40_000_000, 'xuất hiện 3 kỳ = đếm đôi 2 lần');
});

test('‼ kỳ KHÔNG có dòng nào thì KHÔNG được tuyên là sạch', () => {
  const empty = dup.scan({ '05.2026': [], '06.2026': [] });
  assert.equal(empty.clean, false, 'không có dữ liệu để soát khác hoàn toàn với đã soát và không thấy trùng');
  assert.equal(empty.status, 'unverifiable');
  assert.deepEqual(empty.emptyKys, ['05.2026', '06.2026']);
  assert.match(dup.summaryText(empty), /CHƯA soát được, không phải "sạch"/);
  // Một kỳ có dòng, một kỳ rỗng: vẫn phải nêu kỳ rỗng ra.
  const half = dup.scan({ '06.2026': [{ source_line_id: 'Z1', revenue: 1_000 }], '07.2026': [] });
  assert.deepEqual(half.emptyKys, ['07.2026']);
  assert.equal(half.status, 'unverifiable');
});
