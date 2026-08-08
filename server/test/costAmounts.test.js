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

// DN001 full-time: c36/c41/c43/c44/c45 (c44 phái sinh từ c43).
const rateRow = (unit, c5, rates) => ({ unit_code: unit, c5, c16: `Hàng ${c5}`, ...rates });
const FULL = { c36: 1, c41: 2, c43: 10, c44: 50, c45: 3 };
const COLS = [{ key: 'c36' }, { key: 'c41' }, { key: 'c43' }, { key: 'c44' }, { key: 'c45' }];

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

test('C32 = doanh thu (có VAT = gốc, chưa VAT = ÷1,05); C47 = Σ(% × doanh thu) khớp luật màn Chi phí', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', FULL)]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, revenueRowsOf: () => revenueRows(1_050_000),
  });
  assert.equal(result.available, true);
  const row = result.rows[0];
  // C32: 1.050.000 có VAT ⇒ 1.000.000 chưa VAT.
  assert.equal(row.c32WithVat, 1_050_000);
  assert.equal(row.c32NoVat, 1_000_000);
  // C47 chưa VAT trên nền 1.000.000:
  //   c36 1% = 10.000 · c41 2% = 20.000 · c43 10% = 100.000
  //   c44 50% CỦA C43 (phái sinh) = 50.000 · c45 3% = 30.000  ⇒ tổng 210.000
  assert.equal(row.c47NoVat, 210_000);
  // Cùng công thức trên nền có VAT (1.050.000) ⇒ 220.500.
  assert.equal(row.c47WithVat, 220_500);
});

test('thiếu % một cột ⇒ C47 = null + nói thiếu cột nào; TUYỆT ĐỐI không suy 0 rồi cộng nửa tổng', async () => {
  const store = memStore();
  await seed(store, [rateRow('120.HTNT', 'G1.A', { ...FULL, c45: null })]);
  const result = costAmounts.buildAmounts({
    period: '2026-08', session: CEO, store, revenueRowsOf: () => revenueRows(1_050_000),
  });
  const row = result.rows[0];
  assert.equal(row.c47NoVat, null);
  assert.equal(row.c47Reason, 'THIEU_PHAN_TRAM');
  assert.deepEqual(row.c47Missing, ['c45']);
  // C32 vẫn có (doanh thu không phụ thuộc %), nhưng tổng C47 của NV phải là null.
  assert.equal(row.c32NoVat, 1_000_000);
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
