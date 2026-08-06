const test = require('node:test');
const assert = require('node:assert/strict');

const { MISA_UNIVERSE_SQL, PARTNER_UNIVERSE_SQL, RUN_BY_ID_SQL, buildExceptionPayload } = require('../scripts/build_sync_exceptions');
const scriptSource = require('node:fs').readFileSync(require.resolve('../scripts/build_sync_exceptions.js'), 'utf8');

// ── Universe SQL: điểm mấu chốt của V-C là KHÔNG LỌC ─────────────────────────

test('universe MISA lấy TOÀN BỘ dòng của run: không lọc bucket, không lọc ngày', () => {
  assert.doesNotMatch(MISA_UNIVERSE_SQL, /revenue_bucket\s*<>/);
  assert.doesNotMatch(MISA_UNIVERSE_SQL, /sale_order_date\s*>=/);
  assert.match(MISA_UNIVERSE_SQL, /WHERE l\.run_id = \$1/);
});

test('universe đối tác đọc line_calc (kể cả đơn huỷ), không đòi delivered_amount>0', () => {
  // CTE dùng chung của App Sale giữ nguyên byte (bên trong nó có lọc riêng cho KPI);
  // điều phải kiểm là câu SELECT CUỐI đọc từ line_calc — tầng chưa cắt đơn huỷ —
  // và không tự thêm điều kiện delivered/cancelled nào.
  const finalSelect = PARTNER_UNIVERSE_SQL.slice(PARTNER_UNIVERSE_SQL.lastIndexOf('SELECT lc.'));
  assert.match(finalSelect, /FROM line_calc lc/);
  assert.doesNotMatch(finalSelect, /delivered_amount\s*>\s*0/);
  assert.doesNotMatch(finalSelect, /is_cancelled\s*(?:=|IS)/);
  assert.doesNotMatch(finalSelect, /WHERE/);
});

test('chỉ đối chiếu trong CỬA SỔ TƯƠI: slot khác run nguồn ⇒ BỎ QUA exit 2, không phải lệch số', () => {
  // Chốt sau 2 lần chạy thật 06/08: App Sale chỉ giữ dòng thô của run MỚI NHẤT
  // (T07 run #299 còn 4/2016 dòng, T08 run #378 còn 1/513). Slot khác run nguồn
  // ⇒ universe không còn ⇒ bỏ qua chờ lần dựng slot kế — KHÔNG báo "không cân",
  // KHÔNG khuyên materialize lại kỳ khoá sổ.
  assert.match(RUN_BY_ID_SQL, /WHERE id = \$1::bigint AND status='success'/);
  assert.match(scriptSource, /RUN_BY_ID_SQL, \[slotRunId\]/);
  assert.match(scriptSource, /ngoài "cửa sổ tươi"[\s\S]*?process\.exit\(2\)/);
  assert.doesNotMatch(scriptSource, /chạy lại materialize trước rồi mới phân loại/);
});

// ── Phép cân trên fixture nhỏ ────────────────────────────────────────────────

const misaRow = (id, amount, extra = {}) => ({
  source: 'CRM_MISA', source_line_id: `MISA:${id}`, sale_order_no: `DH${id}`,
  sale_order_date: '2026-07-10', revenue: amount, invoice_export_amount: amount,
  revenue_bucket: 'official', ...extra,
});

test('cân khi mọi dòng bị loại đều có mã: Σ(vào) + Σ(loại) == Σ(nguồn)', () => {
  const sourceRows = [
    misaRow(1, 1000),
    misaRow(2, 250, { revenue_bucket: 'draft' }),        // MISA_CHUA_GHI_DOANH_SO
    misaRow(3, 500, { sale_order_date: '' }),            // MISA_THIEU_NGAY_DOANH_THU
  ];
  const slotRows = [{ source_line_id: 'MISA:1', revenue: 1000 }];
  const { report, source, included } = buildExceptionPayload({ period: '2026-07', sourceRows, slotRows });
  assert.equal(source.amount, 1750);
  assert.equal(included.amount, 1000);
  assert.equal(report.totals.excludedAmount, 750);
  assert.equal(report.balanced, true);
});

test('dòng NGOÀI KỲ (nhóm note) vẫn được liệt kê nhưng đứng ngoài phép cân', () => {
  const sourceRows = [
    misaRow(1, 1000),
    misaRow(9, 999, { sale_order_date: '2026-06-28' }),  // MISA_NGAY_NGOAI_KY — tiền của T06
  ];
  const slotRows = [{ source_line_id: 'MISA:1', revenue: 1000 }];
  const { report, source } = buildExceptionPayload({ period: '2026-07', sourceRows, slotRows });
  assert.equal(source.amount, 1000, 'tiền kỳ khác không được cộng vào nguồn của kỳ');
  assert.equal(report.balanced, true);
  assert.ok(report.rows.some((row) => row.code === 'MISA_NGAY_NGOAI_KY'), 'nhưng dòng đó vẫn phải hiện ra');
});

test('slot chứa dòng KHÔNG có trong nguồn ⇒ KHÔNG cân — phải lộ ra, không được ghi', () => {
  const sourceRows = [misaRow(1, 1000)];
  const slotRows = [
    { source_line_id: 'MISA:1', revenue: 1000 },
    { source_line_id: 'MISA:404', revenue: 777 },        // slot dựng từ run cũ
  ];
  const { report } = buildExceptionPayload({ period: '2026-07', sourceRows, slotRows });
  assert.equal(report.balanced, false);
  assert.notEqual(report.totals.amountDiff, 0);
});

test('dòng bị loại không khớp luật nào ra KHONG_RO — không dòng nào biến mất lặng lẽ', () => {
  const sourceRows = [
    misaRow(1, 1000),
    { source: 'APP_WEB', source_line_id: 'WEB:7', order_code: 'PO7', date: '2026-07-05',
      entity_group: 'PARTNER', has_response: true, delivered_qty: 3, revenue: 300, amount: 300,
      status: 'CANCELLED_BUT_DELIVERED' },               // đơn huỷ từng giao — catalog chưa có mã
  ];
  const slotRows = [{ source_line_id: 'MISA:1', revenue: 1000 }];
  const { report } = buildExceptionPayload({ period: '2026-07', sourceRows, slotRows });
  const stray = report.rows.find((row) => row.lineId === 'WEB:7');
  assert.ok(stray, 'dòng lạ phải có mặt trong danh sách');
  assert.equal(stray.code, 'KHONG_RO');
  assert.equal(report.balanced, true, 'KHONG_RO thuộc nhóm loại nên phép cân vẫn khép kín');
});
