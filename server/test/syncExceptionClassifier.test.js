'use strict';
// PHÂN LOẠI DÒNG BỊ LOẠI — SPEC_REVENUE_SYNC_EXCEPTIONS.md §1–2.
// Đây là phần QUYẾT ĐỊNH (dễ sai, ảnh hưởng tiền). Test bám 2 vụ thật CEO đã nêu.
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/syncExceptionCatalog');
const {
  classifySyncExceptions, classifyMisa, classifyWeb, classifyIncomplete,
} = require('../src/syncExceptionClassifier');

const byCode = (rows) => rows.map((row) => [row.lineId, row.code, row.amount]);

test('‼ mọi mã do bộ phân loại sinh ra đều phải có trong danh mục', () => {
  const rows = classifySyncExceptions({
    period: '2026-07',
    sourceRows: [
      { source: 'CRM_MISA', source_line_id: 'm1', revenue_bucket: 'cancelled', revenue: 10 },
      { source: 'CRM_MISA', source_line_id: 'm2', revenue_bucket: 'official', revenue: 10 },
      { source: 'CRM_MISA', source_line_id: 'm3', revenue_bucket: 'official', revenue_date: '2026-06-30', revenue: 10 },
      { source: 'CRM_MISA', source_line_id: 'm4', revenue_bucket: 'official', revenue_date: '2026-07-02', revenue: 0 },
      { source: 'CRM_MISA', source_line_id: 'm5', is_test_suspected: true, revenue: 10 },
      { source: 'APP_WEB', source_line_id: 'w1', entity_group: 'INTERNAL' },
      { source: 'APP_WEB', source_line_id: 'w2', is_test: true },
      { source: 'APP_WEB', source_line_id: 'w3' },
      { source: 'APP_WEB', source_line_id: 'w4', delivered_qty: 0 },
      { source: 'APP_WEB', source_line_id: 'w5', delivered_qty: 3, date: '2026-06-11' },
    ],
    includedLineIds: [],
  });
  assert.equal(rows.length, 10, 'mỗi dòng nguồn bị loại đều phải có mặt');
  for (const row of rows) {
    assert.equal(catalog.describe(row.code).known, true, `mã ${row.code} chưa khai báo trong danh mục`);
  }
});

test('vụ 2.399.520đ — MISA có tiền, đã ghi doanh số, THIẾU NGÀY', () => {
  const rows = classifySyncExceptions({
    period: '2026-07',
    sourceRows: [{
      source: 'CRM_MISA', source_order: 'DH479815711', qlnb_code: 'QL01',
      revenue_bucket: 'official', revenue: 2_399_520, revenue_date: null,
    }],
    includedLineIds: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'MISA_THIEU_NGAY_DOANH_THU');
  assert.equal(rows[0].orderCode, 'DH479815711');
  assert.equal(rows[0].amount, 2_399_520);
  assert.equal(catalog.describe(rows[0].code).owner, 'Kế toán MISA');
  // Không được gộp với "tiền bằng 0" — hai bên xử lý khác nhau.
  assert.notEqual(rows[0].code, 'MISA_TIEN_BANG_0');
});

test('thiếu ngày mà tiền bằng 0 thì là chuyện khác — mã khác, người khác lo', () => {
  assert.equal(classifyMisa({ revenue_bucket: 'official', revenue: 0 }, '2026-07'), 'MISA_TIEN_BANG_0');
  assert.equal(classifyMisa({ revenue_bucket: 'official', revenue: 5 }, '2026-07'), 'MISA_THIEU_NGAY_DOANH_THU');
});

test('vụ 275,9tr — 175.BVĐK Vũng Tàu: VÀO ĐỦ TIỀN nhưng thiếu danh mục đơn vị', () => {
  const rows = classifySyncExceptions({
    period: '2026-07',
    sourceRows: [{
      source: 'CRM_MISA', source_line_id: 'vt1', unit_code: '175.BVĐK VŨNG TÀU',
      revenue_bucket: 'official', revenue_date: '2026-07-10', revenue: 275_900_000,
    }],
    includedLineIds: ['vt1'],
    knownUnits: new Set(['108.BVĐK ABC']),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'DON_VI_THIEU_DANH_MUC');
  assert.equal(catalog.describe(rows[0].code).group, catalog.INCOMPLETE, 'nhóm này VẪN tính tiền');
  assert.equal(rows[0].amount, 275_900_000);
});

test('‼ dòng ĐÃ ĐƯA VÀO doanh thu chỉ được gắn mã "thiếu thông tin", cấm gắn mã loại', () => {
  const rows = classifySyncExceptions({
    period: '2026-07',
    sourceRows: [{
      // Dòng này nếu đem đi soi luật loại thì dính MISA_TIEN_BANG_0 + MISA_NGAY_NGOAI_KY.
      source: 'CRM_MISA', source_line_id: 'in1', unit_code: 'U9',
      revenue_bucket: 'official', revenue_date: '2026-06-01', revenue: 0,
    }],
    includedLineIds: ['in1'],
    knownUnits: new Set(['U1']),
  });
  assert.deepEqual(rows.map((row) => row.code), ['DON_VI_THIEU_DANH_MUC']);
});

test('dòng đã đưa vào, thông tin đủ ⇒ không sinh cảnh báo nào', () => {
  const rows = classifySyncExceptions({
    period: '2026-07',
    sourceRows: [{ source: 'CRM_MISA', source_line_id: 'ok1', unit_code: 'U1', iit_code: 'P1', emp_code: 'DN001', revenue: 100 }],
    includedLineIds: ['ok1'],
    knownUnits: new Set(['U1']), knownProducts: new Set(['P1']), roster: new Set(['DN001']),
  });
  assert.deepEqual(rows, []);
});

test('‼ bị loại mà không khớp luật nào ⇒ vẫn xuất ra với KHONG_RO, không nuốt', () => {
  const rows = classifySyncExceptions({
    period: '2026-07',
    sourceRows: [{
      source: 'APP_WEB', source_line_id: 'la1', entity_group: 'PARTNER',
      delivered_qty: 7, date: '2026-07-15',
    }],
    includedLineIds: [],
  });
  assert.deepEqual(byCode(rows), [['la1', 'KHONG_RO', 0]]);
  assert.equal(catalog.describe('KHONG_RO').known, false, 'mã này phải hiện là "chưa khai báo" để người ta đi khai');
});

test('HOLD_GOLIVE đã giao mà vẫn bị loại ⇒ phải lộ ra, không im lặng', () => {
  const rows = classifySyncExceptions({
    period: '2026-07',
    sourceRows: [{
      source: 'APP_WEB', source_line_id: 'h1', entity_group: 'PARTNER', status: 'HOLD_GOLIVE',
      delivered_qty: 5, date: '2026-07-20', amount: 1_000,
    }],
    includedLineIds: [],
  });
  assert.deepEqual(byCode(rows), [['h1', 'WEB_HOLD_GOLIVE_DA_GIAO', 1_000]]);
  assert.equal(catalog.describe(rows[0].code).group, catalog.NOTE, 'CEO chốt 29/07: loại này VẪN TÍNH tiền');
});

test('APP WEB: có phản hồi mới xét số lượng giao; chưa phản hồi là chuyện khác', () => {
  assert.equal(classifyWeb({ entity_group: 'PARTNER' }, '2026-07'), 'WEB_CHUA_CO_PHAN_HOI');
  assert.equal(classifyWeb({ entity_group: 'PARTNER', delivered_qty: 0 }, '2026-07'), 'WEB_GIAO_BANG_0');
  assert.equal(classifyWeb({ is_test: true }, '2026-07'), 'WEB_DON_TEST');
  // Đơn test NHƯNG đã có phản hồi thật ⇒ không được vội gắn cờ test.
  assert.notEqual(classifyWeb({ is_test: true, delivered_qty: 4, date: '2026-07-03' }, '2026-07'), 'WEB_DON_TEST');
});

test('một dòng có thể thiếu NHIỀU thứ — phải kể hết, không dừng ở lỗi đầu tiên', () => {
  const codes = classifyIncomplete(
    { unit_code: 'U9', iit_code: 'P9', emp_code: 'DN999' },
    { knownUnits: new Set(['U1']), knownProducts: new Set(['P1']), roster: new Set(['DN001']) },
  );
  assert.deepEqual(codes, ['DON_VI_THIEU_DANH_MUC', 'MA_HANG_THIEU_DANH_MUC', 'NV_XUNG_DOT_ROSTER']);
});

test('không có danh mục đối chiếu thì KHÔNG được tự suy ra là thiếu', () => {
  assert.deepEqual(classifyIncomplete({ unit_code: 'U9', iit_code: 'P9', emp_code: 'DN999' }, {}), []);
  // Nhưng UNALLOCATED thì luôn là xung đột roster, khỏi cần danh mục.
  assert.deepEqual(classifyIncomplete({ emp_code: 'UNALLOCATED' }, {}), ['NV_XUNG_DOT_ROSTER']);
});

test('‼ tổng tiền loại + tổng tiền đưa vào phải bằng tổng nguồn', () => {
  const sourceRows = [
    { source: 'CRM_MISA', source_line_id: 'a', revenue_bucket: 'official', revenue_date: '2026-07-01', revenue: 700_000 },
    { source: 'CRM_MISA', source_line_id: 'b', revenue_bucket: 'official', revenue: 200_000 },
    { source: 'APP_WEB', source_line_id: 'c', entity_group: 'PARTNER', amount: 100_000 },
  ];
  const rows = classifySyncExceptions({ period: '2026-07', sourceRows, includedLineIds: ['a'] });
  const sourceAmount = 1_000_000;
  const includedAmount = 700_000;
  const excludedAmount = rows
    .filter((row) => catalog.describe(row.code).group === catalog.EXCLUDED)
    .reduce((sum, row) => sum + row.amount, 0);
  assert.equal(includedAmount + excludedAmount, sourceAmount, 'lệch ⇒ có dòng bốc hơi');
});

test('kỳ khác thì chỉ ghi chú, không kêu là lỗi', () => {
  const rows = classifySyncExceptions({
    period: '2026-07',
    sourceRows: [{ source: 'CRM_MISA', source_line_id: 'p1', revenue_bucket: 'official', revenue_date: '2026-08-03', revenue: 50 }],
    includedLineIds: [],
  });
  assert.equal(rows[0].code, 'MISA_NGAY_NGOAI_KY');
  assert.equal(catalog.describe(rows[0].code).group, catalog.NOTE);
});

test('thiếu source_line_id vẫn nhận diện được dòng bằng đơn + mã hàng', () => {
  const rows = classifySyncExceptions({
    period: '2026-07',
    sourceRows: [{ source_order: 'DH1', qlnb_code: 'QL9', revenue_bucket: 'official', revenue: 10 }],
    includedLineIds: [],
  });
  assert.equal(rows[0].lineId, 'DH1|QL9');
});
