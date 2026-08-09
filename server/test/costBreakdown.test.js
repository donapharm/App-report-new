/**
 * MENU "TỔNG HỢP CHI PHÍ C33–C46" (CEO 09/08/2026): "tao chi hết 8% là bao nhiêu
 * tiền, chi tiết ở mỗi cột, mỗi mã đơn vị, nhóm mã, mỗi NV, mỗi tuyến — VẪN TÍNH
 * C44 nhưng nêu rõ" + bộ lọc 6 chiều + xuất Excel nhiều kỳ chọn cột.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const breakdown = require('../src/costBreakdown');
const sync = require('../src/costRatesSync');

const memStore = () => {
  const data = {};
  return { data, load: (n, d) => data[n] ?? d, save: (n, v) => { data[n] = v; } };
};
const SEP = String.fromCharCode(31);

// % đủ 14 cột — C44 = 0,5 để thấy rõ chênh lệch hai dòng tổng.
const RATES = {
  c33: 0.3, c34: 0.3, c35: 0.4, c36: 1, c37: 0.5, c38: 0.5, c39: 1,
  c40: 0.5, c41: 1, c42: 0.5, c43: 1.5, c44: 0.5, c45: 0.5, c46: 0,
};
const SPENT_ALL = Object.values(RATES).reduce((a, b) => a + b, 0);           // 8,5 (có C44)
const SPENT_C47 = SPENT_ALL - RATES.c44;                                     // 8,0 (không C44)

const rateRow = (unit, c5, rates = RATES) => ({ unit_code: unit, c5, c16: `Hàng ${c5}`, ...rates });
const COLS = Object.keys(RATES).map((key) => ({ key }));
const seed = async (store, period, byEmp) => sync.syncPeriod({
  period, empCodes: Object.keys(byEmp), actor: 'CEO',
  fetchImpl: async (empCode) => ({ outcome: 'ok', payload: { periods: [{ period, columns: COLS, rows: byEmp[empCode] }] } }),
  store, now: () => '2026-08-08T16:00:00.000+07:00',
});

const revRow = (emp, unit, c5, revenue) => ({
  emp_code: emp, unit_code: unit, c5, product_name: `Hàng ${c5}`,
  date: '2026-08-05', revenue, source_order: `DH-${emp}-${c5}`, source_line_id: `L-${emp}-${c5}`,
});
const attrs = (map) => (/* period */) => new Map(Object.entries(map).map(([k, v]) => [k.replace('|', SEP), v]));

test('ví dụ CEO nguyên văn: chi 8% (không C44) từ 100 triệu = 8 triệu; có C44 = 8,5 triệu — hai tổng TÁCH BẠCH', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A')] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee',
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 105_000_000)],
  });
  const row = result.rows[0];
  assert.equal(row.key, 'DN001');
  assert.equal(row.revenueNoVat, 100_000_000);
  assert.equal(row.spentTowardC47NoVat, SPENT_C47 / 100 * 100_000_000);  // 8.000.000
  assert.equal(row.spentWithC44NoVat, SPENT_ALL / 100 * 100_000_000);    // 8.500.000
  // Chênh lệch hai tổng = chính tiền C44.
  assert.equal(row.spentWithC44NoVat - row.spentTowardC47NoVat, row.columns.c44.noVat);
  assert.match(result.c44Note, /NGOÀI công thức C47/);
});

test('C44 vẫn là MỘT CỘT trong bảng (CEO: "vẫn tính, nhưng nêu rõ") — gắn cờ outsideC47', () => {
  const c44 = breakdown.BREAKDOWN_COLUMNS.find((column) => column.key === 'c44');
  assert.equal(c44.outsideC47, true);
  assert.equal(breakdown.BREAKDOWN_COLUMNS.length, 14);
  // Chỉ duy nhất C44 nằm ngoài công thức.
  assert.deepEqual(breakdown.BREAKDOWN_COLUMNS.filter((column) => column.outsideC47).map((c) => c.key), ['c44']);
});

test('gộp theo NHÓM MÃ đơn vị dùng đúng luật tiền tố số (001, 033)', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [
    rateRow('001.BVĐK ĐỒNG NAI', 'G1.A'), rateRow('001.NT-BVĐK ĐỒNG NAI', 'G1.B'), rateRow('033.PKĐK LONG KHÁNH', 'G1.C'),
  ] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'group',
    revenueRowsOf: () => [
      revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 105_000),
      revRow('DN001', '001.NT-BVĐK ĐỒNG NAI', 'G1.B', 105_000),
      revRow('DN001', '033.PKĐK LONG KHÁNH', 'G1.C', 105_000),
    ],
  });
  assert.deepEqual(result.rows.map((row) => [row.key, row.pairCount]), [['001', 2], ['033', 1]]);
});

test('bộ lọc 6 chiều: nhà thầu · đơn vị · nhóm · NV · tuyến · ưu tiên H.A*', async () => {
  const store = memStore();
  await seed(store, '2026-08', {
    DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A')],
    DN002: [rateRow('033.PKĐK LONG KHÁNH', 'G1.B')],
  });
  const catalogAttrs = attrs({
    '001.BVĐK ĐỒNG NAI|G1.A': { contractor: '02.AFP', route: 'CL', priority: 'H.A*' },
    '033.PKĐK LONG KHÁNH|G1.B': { contractor: '01.DONA', route: 'NCL', priority: 'H.B' },
  });
  const revenueRowsOf = (emp) => (emp === 'DN001'
    ? [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 105_000)]
    : [revRow('DN002', '033.PKĐK LONG KHÁNH', 'G1.B', 105_000)]);
  const base = { periods: ['2026-08'], store, revenueRowsOf, catalogAttrsOf: catalogAttrs, groupBy: 'employee' };

  for (const [filters, expected] of [
    [{ contractors: ['02.AFP'] }, ['DN001']],
    [{ units: ['033.PKĐK LONG KHÁNH'] }, ['DN002']],
    [{ groups: ['001'] }, ['DN001']],
    [{ employees: ['DN002'] }, ['DN002']],
    [{ routes: ['CL'] }, ['DN001']],
    [{ priorities: ['H.A*'] }, ['DN001']],
    [{ priorities: ['H.A*', 'H.B'] }, ['DN001', 'DN002']],
  ]) {
    const result = breakdown.buildBreakdown({ ...base, filters });
    assert.deepEqual(result.rows.map((row) => row.key), expected, JSON.stringify(filters));
  }
});

test('chọn CỘT cần xuất: chỉ cột được chọn xuất hiện, hai dòng tổng tính trên cột đã chọn', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A')] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee', filters: { columns: ['c41', 'c43', 'c44'] },
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 105_000_000)],
  });
  assert.deepEqual(result.columns.map((column) => column.key), ['c41', 'c43', 'c44']);
  const row = result.rows[0];
  assert.equal(row.spentWithC44NoVat, (1 + 1.5 + 0.5) / 100 * 100_000_000);
  assert.equal(row.spentTowardC47NoVat, (1 + 1.5) / 100 * 100_000_000);
});

test('thiếu % cột nào ở cặp nào ⇒ cặp đó KHÔNG góp vào cột đó và bị ĐẾM, không suy 0', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [
    rateRow('001.BVĐK ĐỒNG NAI', 'G1.A'),
    rateRow('001.BVĐK ĐỒNG NAI', 'G1.B', { ...RATES, c43: null }),
  ] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee',
    revenueRowsOf: () => [
      revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 105_000),
      revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.B', 105_000),
    ],
  });
  const row = result.rows[0];
  assert.equal(row.columns.c43.missingPairs, 1);
  assert.equal(row.columns.c43.noVat, 1.5 / 100 * 100_000, 'chỉ cặp có % mới góp tiền');
  assert.equal(row.columns.c41.missingPairs, 0);
});

test('kỳ chưa đồng bộ nằm trong missingPeriods — không lặng lẽ xuất thiếu tháng', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A')] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-07', '2026-08'], store, groupBy: 'employee',
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 105_000)],
  });
  assert.deepEqual(result.missingPeriods, ['2026-07']);
  assert.equal(result.rows.length, 1);
});

test('cặp không tra được nhà thầu/tuyến/ưu tiên vẫn HIỆN với "—", không biến mất', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A')] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'contractor',
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 105_000)],
  });
  assert.deepEqual(result.rows.map((row) => row.key), ['—']);
});

test('periodRange dựng dải kỳ đúng, kể cả vắt qua năm, chặn trần 24 kỳ', () => {
  assert.deepEqual(breakdown.periodRange('2026-05', '2026-08'), ['2026-05', '2026-06', '2026-07', '2026-08']);
  assert.deepEqual(breakdown.periodRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(breakdown.periodRange('2020-01', '2030-01').length, 24);
  assert.deepEqual(breakdown.periodRange('xx', '2026-08'), []);
});
