/**
 * MENU RIÊNG "THÀNH TIỀN C32/C47" (Đợt 3 — SPEC_COST_RATES_LOCAL_SYNC · CEO chốt 08/08/2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const costAmounts = require('../src/costAmounts');
const sync = require('../src/costRatesSync');

const memStore = () => {
  const data = {};
  return { data, load: (n, d) => data[n] ?? d, save: (n, v) => { data[n] = v; } };
};

// ‼ C47 = C32 − 13 cột (LOẠI C44) — công thức gốc file CP_TOTAL V29.9 cột AU.
// CEO đính chính 09/08/2026: C47 là phần CÒN LẠI, không phải tổng cộng lại.
const rateRow = (unit, c5, rates) => ({ unit_code: unit, c5, c16: `Hàng ${c5}`, ...rates });
// Ngân sách C32 = 10%; đã chia: c36 1 + c41 2 + c43 3 + c45 0,5 = 6,5 ⇒ C47 còn 3,5%.
// c44 = 50 cố tình để RẤT LỚN: nếu ai đó lỡ đưa C44 vào công thức thì test vỡ ngay.
const FULL = {
  c32: 10, c33: 0, c34: 0, c35: 0, c36: 1, c37: 0, c38: 0, c39: 0,
  c40: 0, c41: 2, c42: 0, c43: 3, c44: 50, c45: 0.5, c46: 0,
};
const COLS = Object.keys(FULL).map((key) => ({ key }));

const seed = async (store, rows) => sync.syncPeriod({
  period: '2026-08', empCodes: ['DN001'], actor: 'CEO',
  fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: COLS, rows }] } }),
  store, now: () => '2026-08-08T16:00:00.000+07:00',
});

const revenueRows = (revenue) => [{
  emp_code: 'DN001', unit_code: '120.HTNT', c5: 'G1.A', product_name: 'Hàng G1.A',
  date: '2026-08-05', revenue, source_order: 'DH1', source_line_id: 'L1',
}];

const CEO = { emp_code: 'CEO', isCeo: true };

test('chưa đồng bộ % ⇒ nói CHUA_DONG_BO, không bịa bảng tiền rỗng', () => {
  const store = memStore();
  const result = costAmounts.buildAmounts({ period: '2026-08', session: CEO, store, revenueRowsOf: () => [] });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'CHUA_DONG_BO');
});

test('‼ C47 là PHẦN CÒN LẠI = C32 trừ 13 cột, KHÔNG phải tổng cộng lại (CEO 09/08)', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, revenueRowsOf: () => revenueRows(1_050_000),
  });
  assert.equal(result.available, true);
  const row = result.rows[0];
  // Doanh thu giữ riêng làm cơ sở đối chiếu — KHÔNG phải là C32.
  assert.equal(row.revenueWithVat, 1_050_000);
  assert.equal(row.revenueNoVat, 1_000_000);
  // C32 = 10% ngân sách × doanh thu.
  assert.equal(row.c32Percent, 10);
  assert.equal(row.c32NoVat, 100_000);
  assert.equal(row.c32WithVat, 105_000);
  // C47% = 10 − (1 + 2 + 3 + 0,5) = 3,5  ⇒ CÒN LẠI, không phải 6,5 đã chia.
  assert.equal(row.c47Percent, 3.5);
  assert.equal(row.c47NoVat, 35_000);
  assert.equal(row.c47WithVat, 36_750);
  assert.equal(row.c47Negative, false);
});

test('C44 nằm NGOÀI công thức C47 — đúng file gốc (=AF-…-AS-AT, không có AR)', () => {
  assert.equal(costAmounts.C47_SUBTRACTED.includes('c44'), false);
  assert.deepEqual([...costAmounts.C47_EXCLUDED], ['c44']);
  // Đúng 13 cột bị trừ, đúng thứ tự file gốc.
  assert.deepEqual([...costAmounts.C47_SUBTRACTED], [
    'c33', 'c34', 'c35', 'c36', 'c37', 'c38', 'c39', 'c40', 'c41', 'c42', 'c43', 'c45', 'c46',
  ]);
  assert.equal(costAmounts.C47_BUDGET, 'c32');
  assert.equal(costAmounts.C47_REQUIRED.length, 14);
});

test('KHÔNG được dùng costColumns của NV (C36+C41+C43+C44+C45) làm công thức C47', () => {
  // Đó là tập cột NV ĐƯỢC NHẬN ở màn "Chi phí của tôi" — khác hẳn công thức C47 của
  // dòng dữ liệu. Lẫn hai tập này chính là lỗi bản đầu.
  const templates = require('../src/employeeCostTemplates');
  const fulltime = templates.resolveTemplate('DN001').costColumns;
  assert.notDeepEqual([...costAmounts.C47_SUBTRACTED], [...fulltime]);
  for (const key of fulltime) {
    if (key === 'c44') continue;
    assert.ok(costAmounts.C47_SUBTRACTED.includes(key), `${key} phải nằm trong công thức C47`);
  }
});

test('chia vượt ngân sách ⇒ C47 ÂM và được ĐÁNH DẤU, không hiển thị lặng lẽ', async () => {
  const store = memStore();
  // Ngân sách 1% nhưng đã chia 6,5% ⇒ C47 = −5,5%.
  await seed(store, [rateRow('120.HTNT', 'G1.A', { ...FULL, c32: 1 })]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, revenueRowsOf: () => revenueRows(1_050_000),
  });
  const row = result.rows[0];
  assert.equal(row.c47Percent, -5.5);
  assert.equal(row.c47Negative, true);
  assert.equal(result.employees[0].negativePairs, 1);
});

test('thiếu % một cột ⇒ C47 = null + nói thiếu cột nào; TUYỆT ĐỐI không suy 0 rồi trừ nửa vời', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', { ...FULL, c45: null })]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, revenueRowsOf: () => revenueRows(1_050_000),
  });
  const row = result.rows[0];
  assert.equal(row.c47NoVat, null);
  assert.equal(row.c47Reason, 'THIEU_PHAN_TRAM');
  assert.deepEqual(row.c47Missing, ['c45']);
  // C32 vẫn tính được (chỉ cần % ngân sách), nhưng tổng C47 của NV phải là null.
  assert.equal(row.c32NoVat, 100_000);
  assert.equal(result.employees[0].c47NoVat, null);
  assert.equal(result.employees[0].missingPairs, 1);
});

test('hai dòng cùng cặp lệch % ⇒ XUNG_DOT, không lấy bừa một bên', async () => {
  const store = memStore();
  await seed(store, [
    rateRow('120.HTNT', 'G1.A', FULL),
    rateRow('120.HTNT', 'G1.A', { ...FULL, c36: 9 }),
  ]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, revenueRowsOf: () => revenueRows(1_050_000),
  });
  assert.equal(result.rows[0].c47NoVat, null);
  assert.equal(result.rows[0].c47Reason, 'XUNG_DOT');
});

test('NV chỉ thấy hàng của CHÍNH MÌNH — không có đường hỏi tiền người khác', async () => {
  const store = memStore();
  await sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001', 'DN002'], actor: 'CEO',
    fetchImpl: async (emp) => ({
      outcome: 'ok',
      payload: { periods: [{ period: '2026-08', columns: COLS, rows: [rateRow(emp === 'DN001' ? '120.HTNT' : '033.BVDK', 'G1.A', FULL)] }] },
    }),
    store, now: () => '2026-08-08T16:00:00.000+07:00',
  });
  const asDn001 = costAmounts.buildAmounts({
    period: '2026-08', session: { emp_code: 'DN001', isCeo: false }, store,
    revenueRowsOf: (emp) => (emp === 'DN001' ? revenueRows(1_050_000) : []),
  });
  assert.deepEqual([...new Set(asDn001.rows.map((r) => r.empCode))], ['DN001']);
  assert.equal(asDn001.employees.length, 1);
  // CEO thì thấy cả hai.
  const asCeo = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, revenueRowsOf: () => revenueRows(1_050_000),
  });
  assert.equal(asCeo.employees.length, 2);
});

test('mã lạ không có trong kho ⇒ fail-closed, không rơi về "thấy hết"', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: { emp_code: 'DN999', isCeo: false }, store, revenueRowsOf: () => revenueRows(1_050_000),
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'KHONG_CO_TRONG_KHO');
  assert.deepEqual(result.rows, []);
});

test('công tắc dùng kho RIÊNG, mặc định TẮT — không dính công tắc "Chi phí của tôi"', () => {
  assert.equal(costAmounts.VISIBILITY_FILE, 'cost_amounts_visibility');
  const employeeCostVisibility = require('../src/employeeCostVisibility');
  assert.notEqual(costAmounts.VISIBILITY_FILE, employeeCostVisibility.STORE_FILE);
  // Roster rỗng ⇒ mọi mã đều fail-closed.
  assert.equal(costAmounts.decisionFor('DN001', []).enabled, false);
});

test('đúng 4 cột CEO chốt, không hơn không kém', () => {
  assert.deepEqual(costAmounts.COLUMNS.map((c) => c.key), ['c32NoVat', 'c32WithVat', 'c47NoVat', 'c47WithVat']);
});

/* ── CHI TIẾT TỪNG DÒNG ĐƠN HÀNG (CEO 09/08: "tôi muốn CẢ HAI" — màn + Excel) ──
 * CEO xin thêm "các cột bên tab Chi phí của tôi" vào menu Thành tiền. Nguyên tắc:
 * chi tiết là ADDITIVE — bật hay tắt thì mọi con số tổng phải Y HỆT, vì đó là số
 * CEO đọc để ra quyết định.                                                     */

const twoOrders = () => [
  { emp_code: 'DN001', unit_code: '120.HTNT', c5: 'G1.A', product_name: 'Hàng G1.A', date: '2026-08-05',
    revenue: 630_000, source_order: 'DH1', source_line_id: 'L1', quantity: 3, route: 'TUYẾN A', contractor_code: '01.DONA' },
  { emp_code: 'DN001', unit_code: '120.HTNT', c5: 'G1.A', product_name: 'Hàng G1.A', date: '2026-08-07',
    revenue: 420_000, source_order: 'DH2', source_line_id: 'L2', quantity: 2, route: 'TUYẾN A', contractor_code: '01.DONA' },
];

test('mức mặc định là CẶP — không tốn công gom dòng gốc khi không ai hỏi', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, revenueRowsOf: () => twoOrders(),
  });
  assert.equal(result.level, 'pair');
  assert.deepEqual(result.orderRows, []);
  assert.equal(result.rows.length, 1, 'hai đơn cùng cặp vẫn gộp thành MỘT dòng cặp');
});

test('‼ bật chi tiết KHÔNG làm đổi bất kỳ con số tổng nào', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const args = { period: '2026-08', session: CEO, store, revenueRowsOf: () => twoOrders() };
  const pair = costAmounts.buildAmounts(args);
  const order = costAmounts.buildAmounts({ ...args, level: 'order' });
  assert.deepEqual(order.rows, pair.rows, 'bảng mức cặp phải y hệt');
  assert.deepEqual(order.employees, pair.employees);
  assert.deepEqual(order.grand, pair.grand);
});

test('chi tiết có ĐỦ cột như tab "Chi phí của tôi", nhãn chép đúng', () => {
  assert.deepEqual(costAmounts.DETAIL_COLUMNS.map((c) => c.label), [
    'Ngày', 'Mã đơn', 'Tuyến', 'Đơn vị', 'Nhà thầu', 'Mã QLNB', 'Tên hàng',
    'Hàm lượng', 'ĐVT', 'Giá trúng thầu', 'SL', 'Thành tiền trước VAT',
  ]);
});

test('mỗi đơn một dòng, tiền C32/C47 tính trên doanh thu CỦA CHÍNH DÒNG đó', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, level: 'order', revenueRowsOf: () => twoOrders(),
  });
  assert.equal(result.orderRows.length, 2);
  const [dh1, dh2] = result.orderRows.sort((a, b) => a.orderCode.localeCompare(b.orderCode));
  assert.equal(dh1.orderCode, 'DH1');
  assert.equal(dh1.quantity, 3);
  assert.equal(dh1.revenueNoVat, 600_000, '630.000 ÷ 1,05');
  assert.equal(dh1.c32NoVat, 60_000, 'C32 10% của 600.000');
  assert.equal(dh2.revenueNoVat, 400_000);
  assert.equal(dh2.c32NoVat, 40_000);
  // ‼ Cộng chi tiết phải RA ĐÚNG số mức cặp — không phải một cách tính thứ hai.
  assert.equal(dh1.c32NoVat + dh2.c32NoVat, result.rows[0].c32NoVat);
  assert.equal(dh1.revenueNoVat + dh2.revenueNoVat, result.rows[0].revenueNoVat);
});

test('chi tiết thừa hưởng ĐÚNG bộ lọc — không có đường lách xem dòng ngoài phạm vi', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, level: 'order',
    filters: { routes: ['TUYẾN KHÔNG CÓ'] },
    revenueRowsOf: () => twoOrders(),
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.orderRows.length, 0, 'cặp bị lọc ra thì dòng đơn của nó cũng phải mất');
});

test('‼ cắt bớt vì quá nhiều dòng thì NÓI RA, và tổng vẫn là số THẬT', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const many = Array.from({ length: costAmounts.ORDER_ROW_LIMIT + 25 }, (_, i) => ({
    emp_code: 'DN001', unit_code: '120.HTNT', c5: 'G1.A', date: '2026-08-05',
    revenue: 1_050, source_order: `DH${i}`, source_line_id: `L${i}`, quantity: 1,
  }));
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, level: 'order', revenueRowsOf: () => many,
  });
  assert.equal(result.orderRows.length, costAmounts.ORDER_ROW_LIMIT);
  assert.equal(result.orderRowsTotal, costAmounts.ORDER_ROW_LIMIT + 25, 'tổng phải là số THẬT, không phải số còn lại sau khi cắt');
  assert.equal(result.orderRowsTruncated, true);
});

test('ngày không đáng tin ⇒ để trống, không bịa ngày giao dịch', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, level: 'order',
    // Slot kỳ cũ gắn ngày kỹ thuật + đánh dấu grain là 'period'.
    revenueRowsOf: () => [{ emp_code: 'DN001', unit_code: '120.HTNT', c5: 'G1.A', date: '2026-08-01',
      date_granularity: 'period', revenue: 1_050_000, source_order: 'DH9', source_line_id: 'L9' }],
  });
  assert.equal(result.orderRows[0].date, '');
});

test('‼ chi tiết từng đơn CHỈ CEO — NV bật cờ level=order vẫn không được mở', async () => {
  // Bot chặn Gate 1 (09/08): "level=order mở chi tiết đơn/giá/số lượng/doanh thu cho
  // mọi NV có menu Thành tiền". CEO xin bảng chi tiết để TỰ làm báo cáo, không hề nói
  // mở cho NV — mà menu này vốn sinh ra để giảm rủi ro lộ lọt.
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const asEmp = costAmounts.buildAmounts({
    period: '2026-08', session: { emp_code: 'DN001', isCeo: false }, store, level: 'order',
    revenueRowsOf: () => twoOrders(),
  });
  assert.equal(asEmp.level, 'pair', 'NV ép level=order vẫn phải rơi về mức cặp');
  assert.deepEqual(asEmp.orderRows, []);
  // NV vẫn xem được mức cặp của chính mình như cũ — không cắt mất thứ đang có.
  assert.equal(asEmp.rows.length, 1);
  // CEO thì mở được.
  const asCeo = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, level: 'order', revenueRowsOf: () => twoOrders(),
  });
  assert.equal(asCeo.level, 'order');
  assert.equal(asCeo.orderRows.length, 2);
});
