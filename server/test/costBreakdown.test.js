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
// ‼ C44 là cột PHÁI SINH: tiền C44 = %C44 × TIỀN C43, không phải × doanh thu
// (CEO 09/08). Nên "tổng chi có C44" KHÔNG còn là một % thuần của doanh thu.
const SPENT_C47_PCT = Object.values(RATES).reduce((a, b) => a + b, 0) - RATES.c44;  // 8,0 — 13 cột
const c44MoneyOf = (revenueNoVat) => revenueNoVat * RATES.c43 / 100 * RATES.c44 / 100;
const spentC47Of = (revenueNoVat) => SPENT_C47_PCT / 100 * revenueNoVat;
const spentAllOf = (revenueNoVat) => spentC47Of(revenueNoVat) + c44MoneyOf(revenueNoVat);

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
  assert.equal(row.spentTowardC47NoVat, spentC47Of(100_000_000));  // 8.000.000 = 8% doanh thu
  assert.equal(row.spentWithC44NoVat, spentAllOf(100_000_000));    // 8.000.000 + C44 (tính trên C43)
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
  assert.equal(row.spentTowardC47NoVat, (1 + 1.5) / 100 * 100_000_000, 'c41 + c43 trên doanh thu');
  // c44 = 0,5% CỦA tiền c43 (1,5% × 100tr = 1.500.000) ⇒ 7.500đ, không phải 500.000đ.
  assert.equal(row.spentWithC44NoVat, (1 + 1.5) / 100 * 100_000_000 + c44MoneyOf(100_000_000));
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

/* ── BA CÔNG CỤ QUẢN TRỊ (Claude tư vấn 09/08, CEO chốt "làm tiếp") ──────────── */

test('chi trên mỗi đồng doanh thu — chỉ số DUY NHẤT so được NV to với NV nhỏ', async () => {
  const store = memStore();
  await seed(store, '2026-08', {
    DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A')],
    DN002: [rateRow('033.PKĐK LONG KHÁNH', 'G1.B')],
  });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee',
    // DN001 bán GẤP 10 LẦN DN002 nhưng cùng bộ %, nên tỷ lệ chi phải BẰNG NHAU.
    revenueRowsOf: (emp) => (emp === 'DN001'
      ? [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 1_050_000_000)]
      : [revRow('DN002', '033.PKĐK LONG KHÁNH', 'G1.B', 105_000_000)]),
  });
  const [dn001, dn002] = result.rows;
  const expected = breakdown.costRatio(spentAllOf(1_000_000_000), 1_000_000_000);
  assert.equal(dn001.costRatio, expected, 'tỷ lệ chi trên doanh thu');
  assert.equal(dn002.costRatio, expected);
  assert.equal(dn001.costRatio, dn002.costRatio, 'người bán nhiều/ít phải so sánh được với nhau');
  assert.equal(result.totals.costRatio, expected);
});

test('‼ doanh thu 0 ⇒ tỷ lệ null, KHÔNG phải 0% (0% đọc thành "không tốn đồng nào")', () => {
  assert.equal(breakdown.costRatio(8_000_000, 0), null);
  assert.equal(breakdown.costRatio(8_000_000, null), null);
  assert.equal(breakdown.shareOf(2, 0), null);
  // Có số thật thì vẫn phải tính đúng.
  assert.equal(breakdown.costRatio(8_000_000, 100_000_000), 8);
  assert.equal(breakdown.shareOf(2, 8), 25);
});

test('tỷ trọng từng cột trên tổng chi — biết cột nào ăn phần lớn nhất', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A')] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee',
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 105_000_000)],
  });
  // c44 = tiền của c44 chia tổng chi có c44 (c44 tính trên TIỀN c43).
  assert.equal(result.totals.share.c44,
    breakdown.shareOf(c44MoneyOf(100_000_000), spentAllOf(100_000_000)));
  // Cộng mọi tỷ trọng phải ra 100%.
  const sum = Object.values(result.totals.share).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.01, `tổng tỷ trọng phải là 100%, đang là ${sum}`);
});

test('dải kỳ liền trước cùng ĐỘ DÀI — chọn 4 kỳ thì so với 4 kỳ, không phải 1 kỳ', () => {
  assert.deepEqual(breakdown.previousRange(['2026-05', '2026-06', '2026-07', '2026-08']),
    ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.deepEqual(breakdown.previousRange(['2026-01']), ['2025-12']);
  assert.deepEqual(breakdown.previousRange(['2026-02', '2026-03']), ['2025-12', '2026-01']);
  assert.deepEqual(breakdown.previousRange([]), []);
});

test('so kỳ trước xếp theo TIỀN TUYỆT ĐỐI, không theo % — cột to tăng ít vẫn lên đầu', () => {
  const bandOf = (columns, totals) => ({ columns, totals, periods: ['2026-07'], missingPeriods: [] });
  const cols = [{ key: 'c43', label: 'C43' }, { key: 'c36', label: 'C36' }];
  const current = bandOf(cols, {
    columns: { c43: { noVat: 2_240_000_000 }, c36: { noVat: 15_000_000 } },
    spentWithC44NoVat: 2_255_000_000, revenueNoVat: 30_000_000_000, costRatio: 7.5,
  });
  const previous = bandOf(cols, {
    columns: { c43: { noVat: 2_000_000_000 }, c36: { noVat: 5_000_000 } },
    spentWithC44NoVat: 2_005_000_000, revenueNoVat: 28_000_000_000, costRatio: 7.16,
  });
  const compare = breakdown.compareBreakdowns(current, previous);
  assert.equal(compare.comparable, true);
  // C43 +240tr (12%) phải đứng TRƯỚC C36 +10tr (200%).
  assert.deepEqual(compare.columns.map((c) => c.key), ['c43', 'c36']);
  assert.equal(compare.columns[0].delta, 240_000_000);
  assert.equal(compare.columns[1].deltaPct, 200);
  assert.equal(compare.spentDelta, 250_000_000);
});

test('kỳ trước chưa đồng bộ ⇒ KHÔNG so nửa vời, nói rõ thiếu kỳ nào', () => {
  const compare = breakdown.compareBreakdowns(
    { columns: [], totals: {}, periods: ['2026-08'], missingPeriods: [] },
    { columns: [], totals: {}, periods: ['2026-07'], missingPeriods: ['2026-07'] },
  );
  assert.equal(compare.comparable, false);
  assert.equal(compare.reason, 'KY_TRUOC_CHUA_DONG_BO');
  assert.deepEqual(compare.missingPeriods, ['2026-07']);
});

test('cột chỉ có ở MỘT kỳ vẫn được liệt kê — "kỳ trước 0đ, kỳ này 300tr" là thứ cần thấy nhất', () => {
  const compare = breakdown.compareBreakdowns(
    { columns: [{ key: 'c39', label: 'C39' }], totals: { columns: { c39: { noVat: 300_000_000 } }, spentWithC44NoVat: 300_000_000, revenueNoVat: 1 }, periods: ['2026-08'], missingPeriods: [] },
    { columns: [], totals: { columns: {}, spentWithC44NoVat: 0, revenueNoVat: 1 }, periods: ['2026-07'], missingPeriods: [] },
  );
  assert.equal(compare.columns[0].key, 'c39');
  assert.equal(compare.columns[0].before, 0);
  assert.equal(compare.columns[0].delta, 300_000_000);
  assert.equal(compare.columns[0].deltaPct, null, 'chia cho 0 ⇒ null, không bịa %');
});

/* ── ‼ C44 tính trên TIỀN của C43, KHÔNG phải trên doanh thu (CEO 09/08) ─────── */

test('ví dụ CEO nguyên văn: C43 ra 100.000đ thì C44 = 100.000 × 5% = 5.000đ', async () => {
  // CEO: "cột C44 chỉ lấy phần tiền của cột C43 để tính × 5%… chứ không phải cột
  // C44 lấy doanh thu × 5% là sai bét." Luật này có sẵn ở derivedBases {c44:'c43'}
  // và màn "Chi phí của tôi" vẫn dùng đúng; menu này bản đầu quên áp.
  const store = memStore();
  // Doanh thu chưa VAT 1.000.000đ · C43 = 10% ⇒ 100.000đ · C44 = 5% CỦA C43 ⇒ 5.000đ.
  const rates = { ...RATES, c43: 10, c44: 5 };
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A', rates)] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee',
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 1_050_000)],
  });
  const row = result.rows[0];
  assert.equal(row.revenueNoVat, 1_000_000);
  assert.equal(row.columns.c43.noVat, 100_000, 'C43 = 10% doanh thu');
  assert.equal(row.columns.c44.noVat, 5_000, 'C44 = 5% CỦA C43, không phải 5% doanh thu');
  // Nếu tính sai (5% doanh thu) sẽ ra 50.000đ — gấp 10 lần.
  assert.notEqual(row.columns.c44.noVat, 50_000);
});

test('C44 vẫn phải tính đúng khi CEO KHÔNG chọn hiển thị cột C43', async () => {
  // Cột gốc phải được tính ngầm để làm nền, dù không hiện trong bảng.
  const store = memStore();
  const rates = { ...RATES, c43: 10, c44: 5 };
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A', rates)] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee', filters: { columns: ['c44'] },
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 1_050_000)],
  });
  assert.deepEqual(result.columns.map((c) => c.key), ['c44']);
  assert.equal(result.rows[0].columns.c44.noVat, 5_000, 'vẫn phải là 5% của C43, không rơi về 5% doanh thu');
});

test('thiếu % cột GỐC ⇒ cột phái sinh cũng không tính được, bị đếm thiếu', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A', { ...RATES, c43: null, c44: 5 })] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee',
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 1_050_000)],
  });
  const row = result.rows[0];
  assert.equal(row.columns.c43.missingPairs, 1);
  assert.equal(row.columns.c44.missingPairs, 1, 'mất nền thì KHÔNG được suy về doanh thu');
  assert.equal(row.columns.c44.noVat, 0);
});

test('luật phái sinh lấy TỪ TEMPLATE, không chép tay vào menu này', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '../src/costBreakdown.js'), 'utf8');
  assert.match(source, /employeeCostTemplates\.resolveTemplate\(empCode\)\.derivedBases/);
  // Không được viết cứng cặp c44→c43 trong file này.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  assert.doesNotMatch(code, /c44['"]?\s*:\s*['"]c43/, 'không viết cứng cặp phái sinh vào file này');
});

/* ── Mỗi cột hiện CẢ % LẪN TIỀN (CEO xin 09/08) ─────────────────────────────── */

test('‼ % của C44 là % CỦA TIỀN C43 (5%), không phải % doanh thu (0,075%)', async () => {
  // Chia trên doanh thu cho cả hai loại cột thì C44 ra 0,075% — đọc thành "C44 gần
  // như bằng 0", sai hẳn nghĩa. Mỗi cột phải chia trên NỀN của chính nó.
  const store = memStore();
  const rates = { ...RATES, c43: 10, c44: 5 };
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A', rates)] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee',
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 1_050_000)],
  });
  const row = result.rows[0];
  assert.equal(row.pct.c43, 10, 'C43 = 10% doanh thu');
  assert.equal(row.pct.c44, 5, 'C44 = 5% CỦA C43');
  assert.notEqual(row.pct.c44, 0.5, 'không được chia trên doanh thu');
  assert.equal(result.totals.pct.c44, 5);
});

test('nhãn nền nói rõ "% của cái gì", lấy từ derivedBases THẬT', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [rateRow('001.BVĐK ĐỒNG NAI', 'G1.A')] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee',
    revenueRowsOf: () => [revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 1_050_000)],
  });
  const byKey = Object.fromEntries(result.columns.map((c) => [c.key, c.pctBaseLabel]));
  assert.equal(byKey.c43, 'doanh thu');
  assert.equal(byKey.c44, 'tiền C43');
  assert.equal(byKey.c41, 'doanh thu');
});

test('% hiệu dụng là bình quân CÓ TRỌNG SỐ khi gộp nhiều cặp lệch %', async () => {
  const store = memStore();
  await seed(store, '2026-08', { DN001: [
    rateRow('001.BVĐK ĐỒNG NAI', 'G1.A', { ...RATES, c41: 2 }),
    rateRow('001.BVĐK ĐỒNG NAI', 'G1.B', { ...RATES, c41: 4 }),
  ] });
  const result = breakdown.buildBreakdown({
    periods: ['2026-08'], store, groupBy: 'employee',
    revenueRowsOf: () => [
      revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.A', 1_050_000),   // 1tr chưa VAT, 2%
      revRow('DN001', '001.BVĐK ĐỒNG NAI', 'G1.B', 3_150_000),   // 3tr chưa VAT, 4%
    ],
  });
  // (1tr×2% + 3tr×4%) / 4tr = (20.000 + 120.000)/4.000.000 = 3,5%
  assert.equal(result.rows[0].pct.c41, 3.5);
});
