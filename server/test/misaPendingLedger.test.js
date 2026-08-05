'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  statusKeyOf, groupByStatus, findGroupsMatching, reasonOf,
  detailRowOf, buildDetail, splitByMoney, frozenPeriodPin, auditTotals, formatGroups, formatDetail,
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

test('‼ lý do gọi LẠI classifyMisa, không viết luật riêng', () => {
  // Bản đầu tự viết luật rồi NÓI SAI trên PROD: dán nhãn "Bucket ngoài
  // official/pending" cho 18 dòng có bucket = 'pending' — tức đang nằm TRONG.
  const outside = reasonOf(line({ revenue_bucket: 'proposed' }), '2026-07');
  assert.equal(outside.code, 'MISA_CHUA_GHI_DOANH_SO');
  const zero = reasonOf(line({ revenue_bucket: 'pending', invoice_export_amount: 0 }), '2026-07');
  assert.equal(zero.code, 'MISA_TIEN_BANG_0', 'dòng 0đ phải ra đúng mã của nó');
  const noDate = reasonOf({ revenue_bucket: 'official', sale_order_date: '', invoice_export_amount: 5 }, '2026-07');
  assert.equal(noDate.code, 'MISA_THIEU_NGAY_DOANH_THU');
});

test('‼ bucket "pending" có tiền KHÔNG phải ngoại lệ — cấm dán nhãn sai', () => {
  const ok = reasonOf(line({ revenue_bucket: 'pending', invoice_export_amount: 3_995_000, sale_order_date: '2026-07-29' }), '2026-07');
  assert.equal(ok.code, '');
  assert.equal(ok.excluded, false);
  assert.doesNotMatch(ok.meaning, /ngoài official\/pending/, 'đây chính là câu đã nói sai trên PROD');
  assert.match(ok.meaning, /VẪN được tính vào doanh thu/);
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
  const rows = buildDetail([line(), line({ sale_order_no: 'DH2', qlnb_code: 'QL08', product_name: 'Pizar-5', invoice_export_amount: 2_995_000 })], '2026-07');
  const printed = formatDetail({ rows, audit: auditTotals(rows, 3_995_000), period: '2026-07', frozen: null });
  assert.match(printed, /GHI\/HUỶ/);
  assert.match(printed, /GHI hay HUỶ/);
  assert.match(printed, /08\/08/);
  assert.match(printed, /Pizar-3/);
  assert.match(printed, /Pizar-5/);
  assert.match(printed, /175\.BVĐK/);
  assert.match(printed, /VÌ SAO CÁC ĐƠN NÀY CẦN QUYẾT/);
});

/* ── Sửa 05/08 11:20, sau bản in THẬT trên PROD ─────────────────────────────── */

test('‼ 17 dòng 0đ KHÔNG được trộn vào câu hỏi của kế toán', () => {
  // Bản in thật: 18 dòng · 11 đơn, nhưng toàn bộ tiền nằm ở ĐÚNG MỘT đơn.
  // Đưa cả 11 đơn cho kế toán là bắt họ quyết 11 lần cho 1 câu hỏi.
  // Dựng đúng dữ liệu THẬT của PROD: bucket 'pending' (không phải 'proposed').
  const real = { revenue_bucket: 'pending' };
  const lines = [
    ...Array.from({ length: 17 }, (_, i) => line({ ...real, sale_order_no: `DH0${i}`, invoice_export_amount: 0 })),
    line({ ...real, sale_order_no: 'DH479816093', invoice_export_amount: 3_995_000 }),
  ];
  const rows = buildDetail(lines, '2026-07');
  const { decide, zero } = splitByMoney(rows);
  assert.equal(decide.length, 1);
  assert.equal(zero.length, 17);
  const printed = formatDetail({ rows, audit: auditTotals(rows, 3_995_000), period: '2026-07', frozen: null });
  assert.match(printed, /TRẢ LỜI 1 CÂU/, 'phải nói rõ chỉ có 1 câu hỏi');
  assert.match(printed, /17 DÒNG 0đ .* KHÔNG hỏi kế toán/);
  assert.match(printed, /MISA_TIEN_BANG_0/, 'dòng 0đ vẫn phải hiện — không dòng nào biến mất lặng lẽ');
  assert.match(printed, /Chuyển App Sale \/ MISA soát lại/, 'phải chỉ đúng người xử lý');
});

test('‼ CẤM cắt cụt mã đơn vị / mã hàng — mã cụt tra MISA không ra đơn nào', () => {
  // Bản in thật cắt `G1.GE.QĐ139.1487.N3.691` (23 ký tự) thành `…N3.69` vì cột rộng 22,
  // và `186.BVĐK AN PHÚ CNIII-PKĐK AN PHÚ` thành `186.BVĐK AN PHÚ CNIII-PK`.
  const product = 'G1.GE.QĐ139.1487.N3.691';
  const unit = '186.BVĐK AN PHÚ CNIII-PKĐK AN PHÚ';
  const rows = buildDetail([line({
    revenue_bucket: 'pending', sale_order_no: 'DH479816093', unit_code: unit,
    qlnb_code: product, invoice_export_amount: 3_995_000,
  })], '2026-07');
  const printed = formatDetail({ rows, audit: auditTotals(rows, 3_995_000), period: '2026-07' });
  assert.ok(printed.includes(product), 'mã hàng phải in ĐỦ, không cắt');
  assert.ok(printed.includes(unit), 'mã đơn vị phải in ĐỦ, không cắt');
  // Tên trạng thái ở bảng phân nhóm cũng vậy.
  const longKey = 'pending | Đề nghị ghi chờ kế toán xác nhận lần cuối | mapped_by_catalog';
  const groups = groupByStatus([line({ revenue_status: 'Đề nghị ghi chờ kế toán xác nhận lần cuối', mapping_status: 'mapped_by_catalog', revenue_bucket: 'pending' })]);
  assert.ok(formatGroups(groups, 1).includes(longKey), 'tên nhóm cắt cụt là chỉ nhầm nhóm ở lần chạy sau');
});

test('‼ kỳ ĐÃ KHOÁ SỔ thì phải cảnh báo HUỶ không miễn phí', () => {
  const pin = frozenPeriodPin('2026-07');
  assert.ok(pin, 'T07 phải nằm trong danh sách kỳ đã ghim');
  assert.equal(pin.ky, '07.2026');
  const rows = buildDetail([line({ invoice_export_amount: 3_995_000 })], '2026-07');
  const printed = formatDetail({ rows, audit: auditTotals(rows, 3_995_000), period: '2026-07' });
  assert.match(printed, /KỲ 07\.2026 ĐÃ KHOÁ SỔ/);
  assert.match(printed, /GHI  ⇒ số không đổi/);
  assert.match(printed, /HUỶ  ⇒ doanh thu kỳ GIẢM 3\.995\.000đ/);
  assert.match(printed, /BÁO CEO TRƯỚC/);
  // Kỳ chưa khoá sổ thì không doạ người ta.
  assert.equal(frozenPeriodPin('2026-08'), null);
  assert.doesNotMatch(formatDetail({ rows, period: '2026-08' }), /ĐÃ KHOÁ SỔ/);
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
