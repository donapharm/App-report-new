/**
 * ‼ KỲ ĐÃ CHỐT SỔ = ĐÓNG BĂNG (CEO yêu cầu lần 2, 09/08/2026)
 *
 * CEO: *"T07.2026 đã chốt sổ rồi mà số liệu nó vẫn chạy tùm lum… dữ liệu nhảy
 * lambada mệt lắm rồi."* Gốc: kỳ đã chốt nhưng mỗi lần mở màn vẫn hỏi DataHub
 * trực tiếp — nguồn chập chờn thì số nhảy theo. Nay kỳ chốt + kho cục bộ có bản
 * ⇒ phục vụ thẳng từ kho, KHÔNG ra mạng: số bất biến, DataHub sống chết kệ.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const employeeCost = require('../src/employeeCost');
const sync = require('../src/costRatesSync');

const memStore = () => {
  const data = {};
  return { data, load: (n, d) => data[n] ?? d, save: (n, v) => { data[n] = v; } };
};
const COLS = [{ key: 'c36', label: 'CP ctv/khác (%)' }];
const seed = async (store, period) => sync.syncPeriod({
  period, empCodes: ['DN001'], actor: 'CEO',
  fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period, columns: COLS, rows: [{ unit_code: '120.HTNT', c5: 'G1.A', c36: 1 }] }] } }),
  store, now: () => '2026-08-09T20:06:00.000+07:00',
});

// T07.2026 khoá sổ hết 05/08 ⇒ hôm nay (09/08, giờ VN) đã chốt chắc chắn.
const CLOSED = '2026-07';

test('‼ kỳ ĐÃ CHỐT + kho có bản ⇒ trả thẳng từ kho, KHÔNG đụng mạng', async () => {
  const store = memStore();
  await seed(store, CLOSED);
  let networkCalls = 0;
  const boom = async () => { networkCalls += 1; throw new Error('không được ra mạng'); };
  const result = await employeeCost.fetchEmployeeCost('DN001', {
    from: CLOSED, to: CLOSED, rateSnapshotStore: store, fetchImpl: boom, fetchOneImpl: boom,
  });
  assert.equal(result.outcome, 'ok');
  assert.equal(result.pinned, true);
  assert.equal(networkCalls, 0, 'kỳ chốt tuyệt đối không gọi nguồn');
  assert.equal(result.payload.rateSource, 'local_pinned');
  assert.equal(result.payload.ratePinnedAt, '2026-08-09T20:06:00.000+07:00');
  assert.equal(result.payload.periods[0].rows.length, 1);
});

test('‼ BẤT BIẾN: hai lượt đọc cách nhau ra Y HỆT nhau — hết lambada', async () => {
  const store = memStore();
  await seed(store, CLOSED);
  const read = () => employeeCost.fetchEmployeeCost('DN001', { from: CLOSED, to: CLOSED, rateSnapshotStore: store });
  const a = await read();
  const b = await read();
  assert.deepEqual(a.payload.periods, b.payload.periods);
  assert.equal(a.outcome, b.outcome);
});

test('kho KHÔNG có kỳ chốt ⇒ rơi về đường cũ (vẫn hỏi nguồn), không chặn', async () => {
  const store = memStore();
  const result = await employeeCost.fetchEmployeeCost('DN001', {
    from: CLOSED, to: CLOSED, rateSnapshotStore: store,
    fetchImpl: async () => ({ outcome: 'ok', payload: { empCode: 'DN001', from: CLOSED, to: CLOSED, periods: [{ period: CLOSED, columns: COLS, rows: [] }] } }),
  });
  assert.notEqual(result.pinned, true);
});

test('‼ kỳ ĐANG CHẠY không bao giờ bị ghim — vẫn hỏi nguồn tươi', () => {
  // pinnedClosedPayload là cửa duy nhất quyết định ghim; kỳ chưa chốt phải trả null
  // kể cả khi kho có bản (T08 đã đồng bộ nhưng vẫn là kỳ đang chạy).
  const store = memStore();
  return seed(store, '2026-08').then(() => {
    const pinned = employeeCost.pinnedClosedPayload('DN001', { from: '2026-08', to: '2026-08', rateSnapshotStore: store });
    assert.equal(pinned, null);
  });
});

test('dải kỳ TRỘN (chốt + đang chạy) ⇒ không ghim — không trộn hai chế độ trong một payload', async () => {
  const store = memStore();
  await seed(store, CLOSED);
  await seed(store, '2026-08');
  const pinned = employeeCost.pinnedClosedPayload('DN001', { from: CLOSED, to: '2026-08', rateSnapshotStore: store });
  assert.equal(pinned, null);
});

test('NV không có trong kho kỳ đó ⇒ không ghim cho NV đó', async () => {
  const store = memStore();
  await seed(store, CLOSED);
  assert.equal(employeeCost.pinnedClosedPayload('DN999', { from: CLOSED, to: CLOSED, rateSnapshotStore: store }), null);
});
