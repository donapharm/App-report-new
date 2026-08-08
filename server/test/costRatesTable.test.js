/**
 * BẢNG % ĐẦY ĐỦ TỪ KHO CỤC BỘ + MŨI DÒ (Đợt 2 — SPEC_COST_RATES_LOCAL_SYNC)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const table = require('../src/costRatesTable');
const sync = require('../src/costRatesSync');
const grants = require('../src/catalogCostColumnGrants');

const memStore = () => {
  const data = {};
  return { data, load: (n, d) => data[n] ?? d, save: (n, v) => { data[n] = v; } };
};
const row = (unit, c5, rates) => ({ unit_code: unit, c5, c16: `Hàng ${c5}`, ...rates });
const COLS = [{ key: 'c41' }, { key: 'c43' }, { key: 'c47' }]; // c47 phải bị chặn
const seed = async (store) => sync.syncPeriod({
  period: '2026-08', empCodes: ['DN001', 'DN002'], actor: 'CEO',
  fetchImpl: async (emp) => ({
    outcome: 'ok',
    payload: {
      periods: [{
        period: '2026-08', columns: COLS,
        rows: emp === 'DN001'
          ? [row('120.HTNT', 'G1.A', { c41: 1, c43: 3, c47: 999 }), row('021.TTYT', 'G1.B', { c41: 2, c43: null })]
          : [row('033.BVDK', 'G1.C', { c41: 0.5, c43: 4 })],
      }],
    },
  }),
  store, now: () => '2026-08-08T16:00:00.000+07:00',
});

const CEO = { emp_code: 'CEO', isCeo: true };

test('chưa đồng bộ ⇒ nói CHUA_DONG_BO, không bịa bảng rỗng như thể có dữ liệu', () => {
  const store = memStore();
  const result = table.buildTable({ period: '2026-08', session: CEO, store });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'CHUA_DONG_BO');
});

test('CEO thấy đủ cặp + căn cước; C47 bị chặn khỏi cột dù nguồn có trả', async () => {
  const store = memStore();
  await seed(store);
  const result = table.buildTable({ period: '2026-08', session: CEO, store });
  assert.equal(result.available, true);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.columns.map((c) => c.key), ['c41', 'c43'], 'c47 phải bị whitelist chặn');
  assert.equal(result.fetchedAt, '2026-08-08T16:00:00.000+07:00');
  // Thiếu % ⇒ null, không suy 0.
  const pairB = result.rows.find((r) => r.productCode === 'G1.B');
  assert.equal(pairB.rates.c43, null);
});

test('NV chỉ thấy: cột được cấp × đơn vị trong phạm vi × dòng CÓ MÌNH', async () => {
  const store = memStore();
  await seed(store);
  const dn001 = { emp_code: 'DN001', isCeo: false };
  // Chưa cấp gì ⇒ không có cột.
  assert.equal(table.buildTable({ period: '2026-08', session: dn001, store }).available, false);
  // Cấp c41 giới hạn 1 đơn vị.
  grants.setGrant('DN001', { columns: ['c41'], units: ['120.HTNT'] }, { actor: 'CEO', store });
  const result = table.buildTable({ period: '2026-08', session: dn001, store });
  assert.deepEqual(result.columns.map((c) => c.key), ['c41']);
  assert.deepEqual(result.rows.map((r) => r.unitCode), ['120.HTNT'], 'đơn vị ngoài phạm vi và dòng của DN002 phải biến mất');
});

test('hai NV trùng đơn vị × sản phẩm không ghi đè/lộ tỷ lệ hoặc mã NV qua API/XLSX builder', async () => {
  const store = memStore();
  await sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001', 'DN002'], actor: 'CEO',
    fetchImpl: async (emp) => ({
      outcome: 'ok',
      payload: { periods: [{
        period: '2026-08', columns: COLS,
        rows: [row('120.HTNT', 'G1.TRUNG', { c41: emp === 'DN001' ? 1 : 9, c43: 3 })],
      }] },
    }),
    store, now: () => '2026-08-08T16:00:00.000+07:00',
  });
  grants.setGrant('DN001', { columns: { c41: ['HTNT'] } }, { actor: 'CEO', store });
  grants.setGrant('DN002', { columns: { c41: ['HTNT'] } }, { actor: 'CEO', store });

  const dn001 = table.buildTable({ period: '2026-08', session: { emp_code: 'DN001', isCeo: false }, store });
  assert.equal(dn001.rows.length, 1);
  assert.equal(dn001.rows[0].rates.c41, 1, 'DN001 phải giữ tỷ lệ của chính DN001, không bị DN002 ghi đè');
  assert.equal(dn001.rows[0].employeeCode, 'DN001');
  assert.deepEqual(dn001.rows[0].employees, ['DN001'], 'payload NV chỉ được trả chính mã đang đăng nhập');

  const dn002 = table.buildTable({ period: '2026-08', session: { emp_code: 'DN002', isCeo: false }, store });
  assert.equal(dn002.rows.length, 1);
  assert.equal(dn002.rows[0].rates.c41, 9);
  assert.deepEqual(dn002.rows[0].employees, ['DN002']);

  const ceo = table.buildTable({ period: '2026-08', session: CEO, store });
  assert.equal(ceo.rows.length, 2, 'CEO thấy hai partition NV riêng, không gộp mơ hồ một cặp');
  assert.deepEqual(ceo.rows.map((item) => [item.employeeCode, item.rates.c41]), [['DN001', 1], ['DN002', 9]]);
});

test('mũi dò: nguồn đổi % ⇒ differs=true; nguồn chết ⇒ GIỮ kết luận cũ, không xoá huy hiệu', async () => {
  const store = memStore();
  await seed(store);
  let clock = 1_000_000;
  const probeOpts = { period: '2026-08', empCodes: ['DN001'], store, now: () => clock, minIntervalMs: 10 };
  // Nguồn sống, % đã đổi (c41: 1 → 1.5).
  const changed = await table.probeSource({
    ...probeOpts,
    fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: COLS, rows: [row('120.HTNT', 'G1.A', { c41: 1.5, c43: 3 }), row('021.TTYT', 'G1.B', { c41: 2, c43: null })] }] } }),
  });
  assert.equal(changed.differs, true);
  // Nguồn chết ngay sau đó ⇒ vẫn differs=true (giữ cảnh báo).
  clock += 20;
  const dead = await table.probeSource({ ...probeOpts, fetchImpl: async () => ({ outcome: 'upstream_503', payload: { periods: [] } }) });
  assert.equal(dead.outcome, 'nguon_khong_phan_hoi');
  assert.equal(dead.differs, true, 'nguồn chết không được xoá huy hiệu cảnh báo');
});

test('mũi dò tự giãn ≥ khoảng tối thiểu — mở màn hình liên tục không thành tấn công nguồn', async () => {
  const store = memStore();
  await seed(store);
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: COLS, rows: [row('120.HTNT', 'G1.A', { c41: 1, c43: 3 })] }] } }; };
  let clock = 1_000_000;
  const opts = { period: '2026-08', empCodes: ['DN001'], store, fetchImpl, now: () => clock, minIntervalMs: 1000 };
  await table.probeSource(opts);
  await table.probeSource(opts); // trong khoảng giãn ⇒ không gọi nguồn
  assert.equal(calls, 1);
  clock += 1001;
  await table.probeSource(opts);
  assert.equal(calls, 2);
});

test('V2: hai cột hai phạm vi nhóm khác nhau ⇒ che TỪNG Ô, không lộ ô ngoài nhóm', async () => {
  const store = memStore();
  await seed(store);
  // DN001 có 120.HTNT (nhóm HTNT) và 021.TTYT (nhóm TTYT).
  // c41 chỉ nhóm HTNT · c43 chỉ nhóm TTYT ⇒ mỗi dòng chỉ hở đúng một ô.
  grants.setGrant('DN001', { columns: { c41: ['HTNT'], c43: ['TTYT'] } }, { actor: 'CEO', store });
  const result = table.buildTable({ period: '2026-08', session: { emp_code: 'DN001', isCeo: false }, store });
  assert.deepEqual(result.columns.map((c) => c.key), ['c41', 'c43']);
  const htnt = result.rows.find((r) => r.unitCode === '120.HTNT');
  const ttyt = result.rows.find((r) => r.unitCode === '021.TTYT');
  assert.equal(htnt.rates.c41, 1, 'HTNT được cấp c41 nên thấy số');
  assert.equal(htnt.rates.c43, null, 'HTNT KHÔNG được cấp c43 — ô phải bị che');
  assert.equal(ttyt.rates.c41, null, 'TTYT KHÔNG được cấp c41 — ô phải bị che');
  // c43 của G1.B vốn thiếu % ở nguồn ⇒ vẫn null, và NV không phân biệt được với ô bị che.
  assert.equal(ttyt.rates.c43, null);
});

test('nguồn mở thêm cột ngoài HỢP ĐỒNG ⇒ KHÔNG tự hiện ra bảng (CEO chưa duyệt)', async () => {
  const store = memStore();
  // DataHub trả thêm c34/c39 — nằm trong dải C33–C46 nhưng KHÔNG có trong hợp đồng.
  await sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001'], actor: 'CEO',
    fetchImpl: async () => ({
      outcome: 'ok',
      payload: { periods: [{
        period: '2026-08',
        columns: [{ key: 'c41' }, { key: 'c34' }, { key: 'c39' }],
        rows: [row('120.HTNT', 'G1.A', { c41: 1, c34: 7, c39: 8 })],
      }] },
    }),
    store, now: () => '2026-08-08T16:00:00.000+07:00',
  });
  const result = table.buildTable({ period: '2026-08', session: CEO, store });
  assert.deepEqual(result.columns.map((c) => c.key), ['c41'],
    'c34/c39 chưa khai hợp đồng thì không được tự xuất hiện dù nguồn có trả');
  assert.equal(result.rows[0].rates.c34, undefined);
});
