'use strict';
// MÀN "CHƯA ĐỒNG BỘ" — CEO chốt 29/07: KHÔNG DÒNG NÀO ĐƯỢC BIẾN MẤT LẶNG LẼ.
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/syncExceptionCatalog');
const { buildSyncExceptionReport } = require('../src/syncExceptionReport');

test('‼ MỌI mã lý do đều phải nói đủ: nghĩa · ai xử lý · làm gì', () => {
  for (const code of catalog.codes()) {
    const item = catalog.describe(code);
    assert.ok(item.meaning && item.meaning.length > 8, `${code} thiếu nghĩa`);
    assert.ok(item.owner, `${code} thiếu người xử lý`);
    assert.ok(item.action && item.action.length > 5, `${code} thiếu việc phải làm`);
    assert.doesNotMatch(item.meaning, /không hợp lệ$/i, `${code} dùng lý do chung chung`);
  }
});

test('hai vụ thật phải có mã riêng, không gộp chung', () => {
  // 2.399.520đ — đơn DH479815711, MISA thiếu ngày doanh thu.
  const missingDate = catalog.describe('MISA_THIEU_NGAY_DOANH_THU');
  assert.equal(missingDate.group, catalog.EXCLUDED);
  assert.equal(missingDate.owner, 'Kế toán MISA');
  // 275,9 triệu — 175.BVĐK Vũng Tàu: TÍNH ĐỦ TIỀN nhưng mất tỉnh khi lọc.
  const missingUnit = catalog.describe('DON_VI_THIEU_DANH_MUC');
  assert.equal(missingUnit.group, catalog.INCOMPLETE, 'nhóm này VẪN tính tiền, không phải bị loại');
  assert.match(missingUnit.meaning, /lọc theo tỉnh/);
  // HOLD_GOLIVE đã giao: CEO chốt VẪN TÍNH — chỉ là ghi chú.
  assert.equal(catalog.describe('WEB_HOLD_GOLIVE_DA_GIAO').group, catalog.NOTE);
});

test('‼ mã lý do lạ KHÔNG được nuốt — phải hiện ra để khai báo', () => {
  const unknown = catalog.describe('LY_DO_LA_HOAC');
  assert.equal(unknown.known, false);
  assert.equal(unknown.owner, 'App Report');
  assert.match(unknown.action, /Khai báo mã lý do này/);
  const report = buildSyncExceptionReport({
    period: '2026-07', source: { amount: 100, rows: 1 }, included: { amount: 0, rows: 0 },
    exceptions: [{ code: 'LY_DO_LA_HOAC', amount: 100 }],
  });
  assert.deepEqual(report.unknownCodes, ['LY_DO_LA_HOAC']);
});

test('‼ BẤT BIẾN: đưa vào + loại == nguồn, cả tiền lẫn số dòng', () => {
  const ok = buildSyncExceptionReport({
    period: '2026-07', source: { amount: 1_000_000, rows: 3 }, included: { amount: 700_000, rows: 2 },
    exceptions: [{ code: 'MISA_THIEU_NGAY_DOANH_THU', amount: 300_000, orderCode: 'DH479815711' }],
  });
  assert.equal(ok.balanced, true);
  assert.equal(ok.totals.amountDiff, 0);
  assert.equal(ok.totals.rowDiff, 0);
});

test('‼ lệch một đồng ⇒ balanced=false và nêu ĐÚNG số lệch', () => {
  const off = buildSyncExceptionReport({
    period: '2026-07', source: { amount: 1_000_000, rows: 3 }, included: { amount: 700_000, rows: 2 },
    exceptions: [{ code: 'MISA_THIEU_NGAY_DOANH_THU', amount: 299_999 }],
  });
  assert.equal(off.balanced, false);
  assert.equal(off.totals.amountDiff, 1, 'phải chỉ ra thiếu đúng 1đ');
});

test('dòng "vào đủ tiền nhưng thiếu thông tin" KHÔNG bị trừ khỏi tổng nguồn', () => {
  const report = buildSyncExceptionReport({
    period: '2026-07', source: { amount: 1_000_000, rows: 2 }, included: { amount: 1_000_000, rows: 2 },
    exceptions: [{ code: 'DON_VI_THIEU_DANH_MUC', amount: 275_900_000, unitCode: '175.BVĐK Vũng Tàu' }],
  });
  assert.equal(report.balanced, true, 'nhóm incomplete nằm TRONG phần đưa vào, không tính lại');
  assert.equal(report.totals.excludedAmount, 0);
  assert.equal(report.totals.incompleteRows, 1);
  assert.equal(report.totals.incompleteAmount, 275_900_000);
});

test('‼ thiếu số nguồn thì KHÔNG được kết luận "đã cân"', () => {
  const report = buildSyncExceptionReport({ period: '2026-07', exceptions: [{ code: 'WEB_GIAO_BANG_0', amount: 5 }] });
  assert.equal(report.measurable, false);
  assert.equal(report.balanced, null, 'chưa đủ căn cứ ≠ đã cân');
  assert.equal(report.totals.amountDiff, null);
});

test('gom theo mã lý do, xếp tiền lớn lên đầu để xử trước', () => {
  const report = buildSyncExceptionReport({
    period: '2026-07', source: { amount: 1_000, rows: 3 }, included: { amount: 0, rows: 0 },
    exceptions: [
      { code: 'WEB_GIAO_BANG_0', amount: 100 },
      { code: 'MISA_THIEU_NGAY_DOANH_THU', amount: 600 },
      { code: 'WEB_GIAO_BANG_0', amount: 300 },
    ],
  });
  assert.deepEqual(report.byCode.map((item) => [item.code, item.rows, item.amount]), [
    ['MISA_THIEU_NGAY_DOANH_THU', 1, 600],
    ['WEB_GIAO_BANG_0', 2, 400],
  ]);
  assert.equal(report.rows[0].amount, 600, 'dòng tiền lớn nhất lên đầu');
  assert.equal(report.rows[0].owner, 'Kế toán MISA', 'mỗi dòng kèm luôn ai xử lý');
});
