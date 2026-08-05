'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  statusKeyOf, groupByStatus, findGroupsMatching, reasonOf,
  detailRowOf, buildDetail, auditTotals, formatGroups, formatDetail,
} = require('../src/misaPendingLedger');

/**
 * V2 — bảng kê khoản MISA "Đề nghị ghi" 3.995.000đ để kế toán chỉ trả lời GHI/HUỶ.
 * Điểm chết người: dán nhầm bảng ⇒ kế toán ghi nhầm doanh thu vào kỳ sắp khoá sổ.
 * Nên toàn bộ test dưới đây xoay quanh một câu: THÀ KHÔNG IN CÒN HƠN IN NHẦM.
 */

const line = (over = {}) => ({
  sale_order_no: 'DH100', sale_order_date: '2026-07-15', unit_code: '175.BVĐK',
  qlnb_code: 'QL07', product_name: 'Pizar-3', employee_code: 'DN009', employee_name: 'NV Chín',
  invoice_export_amount: 1_000_000, revenue_bucket: 'proposed', revenue_status: 'Đề nghị ghi', mapping_status: 'mapped',
  ...over,
});

test('khoá nhóm gồm ĐỦ ba cột trạng thái — thiếu một cột là gộp nhầm hai loại', () => {
  assert.equal(statusKeyOf(line()), 'proposed | Đề nghị ghi | mapped');
  assert.equal(statusKeyOf({}), ' |  | ');
});

test('gom nhóm: đếm dòng, đếm đơn riêng, cộng tiền', () => {
  const groups = groupByStatus([
    line({ sale_order_no: 'DH1', invoice_export_amount: 2_000_000 }),
    line({ sale_order_no: 'DH1', qlnb_code: 'QL08', invoice_export_amount: 1_995_000 }),
    line({ sale_order_no: 'DH2', revenue_bucket: 'official', revenue_status: 'Đã ghi', invoice_export_amount: 9_000_000 }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].amount, 9_000_000, 'sắp theo tiền giảm dần');
  const pending = groups.find((group) => group.bucket === 'proposed');
  assert.deepEqual([pending.lines, pending.orders, pending.amount], [2, 1, 3_995_000]);
});

test('‼ tìm nhóm theo SỐ TIỀN, không đoán tên trạng thái', () => {
  // Không ai trong repo biết chắc "Đề nghị ghi" nằm ở cột nào, viết hoa hay thường.
  // Nên cách tìm là: nhóm nào cộng đúng 3.995.000đ.
  const groups = groupByStatus([
    line({ sale_order_no: 'DH1', invoice_export_amount: 2_000_000 }),
    line({ sale_order_no: 'DH2', invoice_export_amount: 1_995_000 }),
    line({ sale_order_no: 'DH3', revenue_bucket: 'cancelled', revenue_status: 'Huỷ', invoice_export_amount: 3_995_001 }),
  ]);
  const matched = findGroupsMatching(groups, 3_995_000);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].bucket, 'proposed');
});

test('‼ lệch MỘT ĐỒNG là không khớp — "gần đúng" chính là cách dán nhầm bảng', () => {
  const groups = groupByStatus([line({ invoice_export_amount: 3_995_001 })]);
  assert.deepEqual(findGroupsMatching(groups, 3_995_000), []);
  assert.deepEqual(findGroupsMatching(groups, 0), [], 'số cần tìm bằng 0 thì không khớp bừa vào nhóm rỗng');
});

test('lý do lấy từ danh mục 14 mã có sẵn, không tự nghĩ chữ mới', () => {
  const outside = reasonOf(line({ revenue_bucket: 'proposed' }));
  assert.equal(outside.code, 'MISA_CHUA_GHI_DOANH_SO');
  assert.match(outside.owner, /Kế toán/);
  assert.match(outside.action, /Ghi doanh số|xác nhận huỷ/);
  const noDate = reasonOf({ revenue_bucket: 'official', sale_order_date: '' });
  assert.equal(noDate.code, 'MISA_THIEU_NGAY_DOANH_THU');
});

test('dòng bảng có đủ 6 cột CEO yêu cầu, thiếu thì hiện "—" chứ không hiện rỗng', () => {
  const row = detailRowOf(line());
  assert.deepEqual(
    [row.orderCode, row.date, row.unitCode, row.productCode, row.empCode, row.amount],
    ['DH100', '2026-07-15', '175.BVĐK', 'QL07', 'DN009', 1_000_000],
  );
  const bare = detailRowOf({});
  assert.deepEqual([bare.orderCode, bare.date, bare.unitCode, bare.productCode], ['—', '—', '—', '—']);
  assert.equal(bare.empCode, 'UNALLOCATED', 'không có NV thì nói rõ là chưa phân bổ');
});

test('bảng sắp theo ngày rồi tới mã đơn — kế toán dò theo sổ của họ', () => {
  const rows = buildDetail([
    line({ sale_order_date: '2026-07-20', sale_order_no: 'DH9' }),
    line({ sale_order_date: '2026-07-02', sale_order_no: 'DH5' }),
    line({ sale_order_date: '2026-07-02', sale_order_no: 'DH1' }),
  ]);
  assert.deepEqual(rows.map((row) => row.orderCode), ['DH1', 'DH5', 'DH9']);
});

test('‼ BẤT BIẾN: tổng bảng in ra phải bằng đúng số đang đối chiếu', () => {
  const rows = buildDetail([line({ invoice_export_amount: 2_000_000 }), line({ sale_order_no: 'DH2', invoice_export_amount: 1_995_000 })]);
  assert.deepEqual(auditTotals(rows, 3_995_000), { ok: true, detailTotal: 3_995_000, expected: 3_995_000, diff: 0, rows: 2 });
  const bad = auditTotals(rows, 4_000_000);
  assert.equal(bad.ok, false);
  assert.equal(bad.diff, -5_000);
});

test('‼ tổng lệch thì BẢN IN phải hét lên, không được in êm ru', () => {
  const rows = buildDetail([line({ invoice_export_amount: 1_000_000 })]);
  const printed = formatDetail({ rows, audit: auditTotals(rows, 3_995_000), period: '2026-07' });
  assert.match(printed, /LỆCH/);
  assert.match(printed, /DỪNG, không gửi bảng này đi/);
});

test('bản in cho kế toán: có cột GHI/HUỶ, có hạn 08/08, có tên đơn vị và mặt hàng', () => {
  const rows = buildDetail([line(), line({ sale_order_no: 'DH2', qlnb_code: 'QL08', product_name: 'Pizar-5', invoice_export_amount: 2_995_000 })]);
  const printed = formatDetail({ rows, audit: auditTotals(rows, 3_995_000), period: '2026-07' });
  assert.match(printed, /GHI\/HUỶ/);
  assert.match(printed, /GHI hay HUỶ/);
  assert.match(printed, /08\/08/);
  assert.match(printed, /Pizar-3/);
  assert.match(printed, /Pizar-5/);
  assert.match(printed, /175\.BVĐK/);
  assert.match(printed, /VÌ SAO CÁC DÒNG NÀY CHƯA VÀO DOANH THU/);
});

test('‼ không tìm ra nhóm khớp ⇒ in TOÀN BỘ phân nhóm và nói rõ chưa gửi ai', () => {
  const printed = formatGroups(groupByStatus([line(), line({ sale_order_no: 'DH2', revenue_bucket: 'official' })]), 3_995_000);
  assert.match(printed, /Không nhóm trạng thái nào cộng đúng/);
  assert.match(printed, /CHƯA gửi bảng nào cho kế toán/);
  assert.match(printed, /proposed \| Đề nghị ghi \| mapped/);
});

/* ── Script chạy thật ────────────────────────────────────────────────────────── */

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'misa_pending_detail.js'), 'utf8');

test('‼ script CHỈ ĐỌC', () => {
  const sql = script.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i);
});

test('‼ KHÔNG được lọc bỏ dòng excluded — đó chính là thứ cần đem đi hỏi', () => {
  const sql = script.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.doesNotMatch(sql, /revenue_bucket <> 'excluded'/,
    'bản mirror doanh thu lọc dòng này đi; ở đây lọc là không còn gì để hỏi kế toán');
});

test('‼ nhiều nhóm cùng khớp số ⇒ vẫn dừng, không tự chọn nhóm đầu', () => {
  assert.match(script, /chosen\.length !== 1/);
  assert.match(script, /phải chỉ đúng một/);
});

test('tổng lệch thì thoát mã 1, không được thoát 0 rồi để người ta tưởng xong', () => {
  assert.match(script, /process\.exit\(audit\.ok \? 0 : 1\)/);
});

test('mặc định đúng kỳ và đúng số CEO đang hỏi', () => {
  assert.match(script, /arg\('period', '2026-07'\)/);
  assert.match(script, /arg\('amount', '3995000'\)/);
});
