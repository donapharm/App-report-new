'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  attributableEmp, tallyRevenueByEmployee, tallyCatalogByEmployee, ambiguousCatalogPairs,
  proposeOwner, formatProposal,
} = require('../src/quarantineOwnerProposal');

/**
 * V1 — đề xuất chủ cho dòng cách ly `DH479816174`.
 * CEO ra lệnh: một cái tên KÈM CĂN CỨ, hoặc nói thẳng "không xác định được". CẤM ĐOÁN.
 * Bộ test này khoá đúng chữ "cấm đoán" lại — vì đoán trúng vài lần là người ta tin,
 * tới lần đoán trượt thì doanh số của một NV bị gán sai mà không ai soát.
 */

const line = (over = {}) => ({
  sale_order_no: 'DH1', sale_order_date: '2026-07-02', unit_code: '120.HTNT-PHARMACITY',
  qlnb_code: 'QL01', employee_code: 'DN009', employee_name: 'NV Chín',
  invoice_export_amount: 1_000_000, ...over,
});
const cat = (over = {}) => ({ unit_code: '120.HTNT-PHARMACITY', qlnb_code: 'QL01', emp_code: 'DN009', emp_name: 'NV Chín', nv_cnt: 1, ...over });

test('‼ VP018 (telesaler) KHÔNG được tính là ứng viên — chính nó gây ra vụ này', () => {
  assert.equal(attributableEmp('VP018'), '');
  assert.equal(attributableEmp('vp018'), '', 'chữ thường cũng phải chặn');
  assert.equal(attributableEmp('UNALLOCATED'), '', 'dòng đã cách ly không tự bầu cho ai');
  assert.equal(attributableEmp(''), '');
  assert.equal(attributableEmp(' dn009 '), 'DN009');
});

test('đếm doanh thu: gộp theo NV, đếm ĐƠN riêng với DÒNG riêng', () => {
  const rows = tallyRevenueByEmployee([
    line({ sale_order_no: 'DH1', qlnb_code: 'QL01' }),
    line({ sale_order_no: 'DH1', qlnb_code: 'QL02' }),   // cùng đơn, khác mặt hàng
    line({ sale_order_no: 'DH2', employee_code: 'DN010', employee_name: 'NV Mười', invoice_export_amount: 500_000 }),
    line({ employee_code: 'VP018' }),                    // bị chặn ⇒ không vào bảng
    line({ employee_code: 'UNALLOCATED' }),              // chính dòng đang hỏi
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.emp, row.lines, row.orders, row.amount]),
    [['DN009', 2, 1, 2_000_000], ['DN010', 1, 1, 500_000]],
  );
  assert.equal(Math.round(rows[0].share * 100), 67, 'tỷ lệ tính trên dòng gán được, không tính dòng cách ly');
});

test('danh mục: cặp đang gán NHIỀU NV thì bỏ khỏi căn cứ nhưng phải kể tên ra', () => {
  const rows = [cat(), cat({ qlnb_code: 'QL02' }), cat({ qlnb_code: 'QL03', nv_cnt: 2 })];
  const tally = tallyCatalogByEmployee(rows);
  assert.deepEqual(tally.map((row) => [row.emp, row.pairs]), [['DN009', 2]]);
  assert.deepEqual(ambiguousCatalogPairs(rows), [{ unit: '120.HTNT-PHARMACITY', product: 'QL03', count: 2 }]);
});

test('✅ hai nguồn cùng chỉ một người ⇒ đề xuất, độ chắc cao nhất', () => {
  const result = proposeOwner({ unitCode: '120.HTNT-PHARMACITY', lines: [line(), line({ sale_order_no: 'DH2' })], catalogRows: [cat()] });
  assert.equal(result.decision, 'PROPOSE');
  assert.equal(result.candidate, 'DN009');
  assert.equal(result.candidateName, 'NV Chín');
  assert.equal(result.strength, 'chắc');
});

test('✅ chỉ danh mục có, chưa có lịch sử ⇒ vẫn đề xuất nhưng ghi rõ độ chắc thấp hơn', () => {
  const result = proposeOwner({ lines: [], catalogRows: [cat()] });
  assert.equal(result.decision, 'PROPOSE');
  assert.equal(result.candidate, 'DN009');
  assert.equal(result.strength, 'khá chắc');
  assert.match(result.reason, /chưa có lịch sử doanh thu/);
});

test('✅ chỉ lịch sử có và ĐỒNG NHẤT một người ⇒ đề xuất', () => {
  const result = proposeOwner({ lines: [line(), line({ sale_order_no: 'DH2' })], catalogRows: [] });
  assert.equal(result.decision, 'PROPOSE');
  assert.equal(result.candidate, 'DN009');
});

test('‼ HAI NGUỒN CHỎI NHAU ⇒ KHÔNG đề xuất ai — đây là lệnh trực tiếp của CEO', () => {
  const result = proposeOwner({
    lines: [line({ employee_code: 'DN010', employee_name: 'NV Mười' })],
    catalogRows: [cat()],   // danh mục nói DN009, doanh thu nói DN010
  });
  assert.equal(result.decision, 'CONFLICT');
  assert.equal(result.candidate, '', 'chỏi nhau mà vẫn chọn một người là đoán');
  // Vẫn phải trả về ĐỦ SỐ để CEO tự nhìn mà quyết.
  assert.equal(result.catalog.length, 1);
  assert.equal(result.revenue.length, 1);
});

test('‼ danh mục gán đơn vị cho nhiều NV ⇒ CONFLICT, không lấy người đầu bảng', () => {
  const result = proposeOwner({ lines: [], catalogRows: [cat(), cat({ qlnb_code: 'QL02', emp_code: 'DN010', emp_name: 'NV Mười' })] });
  assert.equal(result.decision, 'CONFLICT');
  assert.equal(result.candidate, '');
});

test('nhiều NV cùng bán, một người áp đảo ≥80% ⇒ đề xuất nhưng đánh dấu "yếu"', () => {
  const many = Array.from({ length: 9 }, (_, i) => line({ sale_order_no: `DH${i}` }));
  const result = proposeOwner({ lines: [...many, line({ sale_order_no: 'DHX', employee_code: 'DN010' })], catalogRows: [] });
  assert.equal(result.decision, 'PROPOSE');
  assert.equal(result.candidate, 'DN009');
  assert.match(result.strength, /yếu/);
  assert.match(result.reason, /9\/10 dòng = 90%/);
});

test('‼ chia đều thì KHÔNG đoán — 50/50 không phải là "người dẫn đầu"', () => {
  const result = proposeOwner({
    lines: [line(), line({ sale_order_no: 'DH2', employee_code: 'DN010', employee_name: 'NV Mười' })],
    catalogRows: [],
  });
  assert.equal(result.decision, 'CONFLICT');
  assert.equal(result.candidate, '');
});

test('không nguồn nào tra ra ai ⇒ UNKNOWN, không phải "gán cho người gần nhất"', () => {
  const result = proposeOwner({ lines: [line({ employee_code: 'VP018' })], catalogRows: [] });
  assert.equal(result.decision, 'UNKNOWN');
  assert.equal(result.candidate, '');
});

test('mã VP còn lại vẫn hiện, nhưng bắt buộc gắn cảnh báo xác nhận vai trò', () => {
  // VP004 chưa từng được CEO xác nhận là non-sale ⇒ không được xoá lặng lẽ,
  // cũng không được gán mà không hỏi.
  const result = proposeOwner({ lines: [line({ employee_code: 'VP004', employee_name: 'VP Bốn' })], catalogRows: [] });
  assert.equal(result.candidate, 'VP004');
  assert.ok(result.warnings.some((item) => /VP004.*xác nhận/.test(item)), 'phải cảnh báo trước khi gán cho mã văn phòng');
});

test('bản in ra phải có đủ CẢ HAI bảng căn cứ, kể cả khi không kết luận được', () => {
  const printed = formatProposal(proposeOwner({
    unitCode: '120.HTNT-PHARMACITY', orderCode: 'DH479816174',
    lines: [line({ employee_code: 'DN010', employee_name: 'NV Mười' })], catalogRows: [cat()],
  }));
  assert.match(printed, /KHÔNG XÁC ĐỊNH ĐƯỢC/);
  assert.match(printed, /DANH MỤC PHÂN CÔNG/);
  assert.match(printed, /LỊCH SỬ DOANH THU/);
  assert.match(printed, /DN009/);
  assert.match(printed, /DN010/);
  assert.match(printed, /DH479816174/);
});

/* ── Script chạy thật ────────────────────────────────────────────────────────── */

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'propose_quarantine_owner.js'), 'utf8');

test('‼ script CHỈ ĐỌC — không được có UPDATE/INSERT/DELETE', () => {
  const sql = script.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i,
    'App Report không có quyền đổi phân công — việc gán do App Sale làm sau khi CEO gật');
});

test('‼ đọc không được phải thoát mã 2, KHÔNG được lẫn với "không tra ra ai"', () => {
  // Mã 1 = tra rồi nhưng không kết luận được (cần người quyết).
  // Mã 2 = chưa tra được gì. Gộp hai cái này là báo nhầm "đã tra, chịu".
  assert.match(script, /CHƯA kết luận được gì/);
  assert.equal((script.match(/process\.exit\(2\)/g) || []).length >= 3, true);
  assert.match(script, /result\.decision === 'PROPOSE' \? 0 : 1/);
});

test('mặc định trỏ đúng dòng CEO đang hỏi, nhưng đổi được qua tham số', () => {
  assert.match(script, /arg\('unit', '120\.HTNT-PHARMACITY'\)/);
  assert.match(script, /arg\('order', 'DH479816174'\)/);
});

/* ── Chẩn đoán CẶP của đơn đang hỏi (thêm 06/08, hạn khoá sổ còn 2 ngày) ─────── */

const { diagnoseOrderPair } = require('../src/quarantineOwnerProposal');

const misa = (over = {}) => ({
  sale_order_no: 'DH479816174', unit_code: '120.HTNT-PHARMACITY',
  qlnb_code: 'G1.GE.QĐ139.1104.N2.162', invoice_export_amount: 1_795_600, ...over,
});

test('‼ cặp THIẾU trong bảng phân công ⇒ chỉ đúng việc App Sale phải làm', () => {
  const d = diagnoseOrderPair({
    orderCode: 'DH479816174', unitCode: '120.HTNT-PHARMACITY',
    lines: [misa()],
    catalogRows: [cat({ qlnb_code: 'MÃ-KHÁC' })],   // đơn vị có phân công, nhưng không phải cặp này
  });
  assert.equal(d.found, true);
  assert.equal(d.productCode, 'G1.GE.QĐ139.1104.N2.162');
  assert.equal(d.amount, 1_795_600);
  assert.equal(d.inCatalog, false);
  assert.match(d.verdict, /CẶP THIẾU/);
  assert.match(d.action, /THÊM cặp \(120\.HTNT-PHARMACITY × G1\.GE\.QĐ139\.1104\.N2\.162\)/);
});

test('‼ cặp gán NHIỀU NV ⇒ bảo gỡ còn một, không bảo thêm mới', () => {
  const d = diagnoseOrderPair({
    orderCode: 'DH479816174', unitCode: '120.HTNT-PHARMACITY',
    lines: [misa()],
    catalogRows: [cat({ qlnb_code: 'G1.GE.QĐ139.1104.N2.162', nv_cnt: 2, emp_code: 'DN001' })],
  });
  assert.equal(d.nvCount, 2);
  assert.match(d.verdict, /ĐANG GÁN 2 NV/);
  assert.match(d.action, /GỠ còn ĐÚNG MỘT NV/);
});

test('cặp đã đúng 1 NV ⇒ nói thẳng lỗi KHÔNG nằm ở bảng phân công', () => {
  const d = diagnoseOrderPair({
    orderCode: 'DH479816174', unitCode: '120.HTNT-PHARMACITY',
    lines: [misa()],
    catalogRows: [cat({ qlnb_code: 'G1.GE.QĐ139.1104.N2.162', nv_cnt: 1, emp_code: 'DN001' })],
  });
  assert.equal(d.nvCount, 1);
  assert.deepEqual(d.emps, ['DN001']);
  assert.match(d.action, /KHÔNG phải bảng phân công/);
});

test('‼ không thấy đơn ⇒ CẤM suy ra "đã hết cách ly"', () => {
  const d = diagnoseOrderPair({ orderCode: 'DH479816174', unitCode: '120.HTNT-PHARMACITY', lines: [misa({ sale_order_no: 'DH-KHAC' })], catalogRows: [] });
  assert.equal(d.found, false);
  assert.match(d.verdict, /KHÔNG TÌM THẤY ĐƠN/);
  assert.match(d.action, /CẤM suy ra/);
});
