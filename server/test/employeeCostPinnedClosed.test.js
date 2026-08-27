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
  fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period, columns: COLS, rows: [{ unit_code: '120.HTNT', c5: 'G1.A', c16: 'Thuốc A', c25: 'Viên', c36: 1 }] }] } }),
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

test('kho KHÔNG có kỳ chốt ⇒ chưa chốt và tuyệt đối không hỏi nguồn sống', async () => {
  const store = memStore();
  let networkCalls = 0;
  const result = await employeeCost.fetchEmployeeCost('DN001', {
    from: CLOSED, to: CLOSED, rateSnapshotStore: store,
    fetchImpl: async () => { networkCalls += 1; throw new Error('không được ra mạng'); },
  });
  assert.equal(networkCalls, 0);
  assert.equal(result.outcome, 'closed_unfinalized');
  assert.equal(result.payload.rateSource, 'closed_unfinalized');
  assert.equal(result.payload.note, employeeCost.CLOSED_UNFINALIZED_NOTE);
});

test('kỳ chốt chưa có pin không enrich doanh thu thành tổng tạm', async () => {
  const store = memStore();
  let networkCalls = 0;
  const subject = { session: { emp_code: 'DN001', role: 'admin' }, scope: { empCode: 'DN001' }, requestedEmp: 'DN001' };
  const report = await employeeCost.getForSession(subject, {
    from: CLOSED, to: CLOSED, rateSnapshotStore: store,
    revenueRowsByPeriod: { [CLOSED]: [{ emp_code: 'DN001', revenue: 999999 }] },
    catalogRowsByPeriod: { [CLOSED]: [] }, auditImpl: () => {},
    fetchImpl: async () => { networkCalls += 1; throw new Error('không được gọi'); },
    reconciliationShadow: { loadSnapshotImpl: async () => { networkCalls += 1; throw new Error('không được gọi'); } },
  });
  assert.equal(networkCalls, 0);
  assert.equal(report.sourceOutcome, 'closed_unfinalized');
  assert.equal((report.periods[0].rows || []).length, 0);
  assert.equal(report.summary, undefined);
});

test('kỳ chốt dùng pin bỏ qua reconciliation network và bất biến qua nhiều lượt', async () => {
  const store = memStore();
  await seed(store, CLOSED);
  let networkCalls = 0;
  const options = {
    from: CLOSED, to: CLOSED, rateSnapshotStore: store,
    revenueRowsByPeriod: { [CLOSED]: [] }, catalogRowsByPeriod: { [CLOSED]: [] },
    reconciliationShadow: { loadSnapshotImpl: async () => { networkCalls += 1; throw new Error('không được ra mạng'); } },
    auditImpl: () => {},
  };
  const subject = { session: { emp_code: 'DN001', role: 'admin' }, scope: { empCode: 'DN001' }, requestedEmp: 'DN001' };
  const first = await employeeCost.getForSession(subject, options);
  const second = await employeeCost.getForSession(subject, options);
  assert.equal(networkCalls, 0, 'display kỳ chốt phải zero-network');
  assert.deepEqual(first, second);
  assert.equal(first.rateSource, 'local_pinned');
});

test('‼ local-only BẬT + kho thiếu ⇒ fail-closed đúng thông điệp và tuyệt đối không gọi mạng', async (t) => {
  const before = process.env.APP_REPORT_COST_LOCAL_ONLY;
  process.env.APP_REPORT_COST_LOCAL_ONLY = '1';
  t.after(() => { if (before == null) delete process.env.APP_REPORT_COST_LOCAL_ONLY; else process.env.APP_REPORT_COST_LOCAL_ONLY = before; });
  const store = memStore();
  let networkCalls = 0;
  const result = await employeeCost.fetchEmployeeCost('DN021', {
    from: '2026-08', to: '2026-08', rateSnapshotStore: store,
    fetchImpl: async () => { networkCalls += 1; throw new Error('không được ra mạng'); },
  });
  assert.equal(networkCalls, 0);
  assert.equal(result.outcome, 'local_only_missing');
  assert.equal(result.attempts, 0);
  assert.equal(result.payload.rateSource, 'local_only_missing');
  assert.equal(result.payload.note, employeeCost.LOCAL_ONLY_MISSING_NOTE);
  assert.equal(result.payload.periods[0].note, 'Kỳ này chưa đồng bộ % chi phí — bấm Đồng bộ % chi phí');
  assert.deepEqual(result.payload.periods[0].rows, []);
});

test('‼ local-only BẬT + kho đủ ⇒ dùng kho và tuyệt đối không gọi mạng', async (t) => {
  const before = process.env.APP_REPORT_COST_LOCAL_ONLY;
  process.env.APP_REPORT_COST_LOCAL_ONLY = '1';
  t.after(() => { if (before == null) delete process.env.APP_REPORT_COST_LOCAL_ONLY; else process.env.APP_REPORT_COST_LOCAL_ONLY = before; });
  const store = memStore();
  await seed(store, '2026-08');
  let networkCalls = 0;
  const result = await employeeCost.fetchEmployeeCost('DN001', {
    from: '2026-08', to: '2026-08', rateSnapshotStore: store,
    fetchImpl: async () => { networkCalls += 1; throw new Error('không được ra mạng'); },
  });
  assert.equal(networkCalls, 0);
  assert.equal(result.outcome, 'ok');
  assert.equal(result.payload.rateSource, 'local_sync');
});

test('‼ local-only BẬT: applyEffectiveRates gặp kỳ trống cũng zero-fetch và trả local_only_missing', async (t) => {
  const before = process.env.APP_REPORT_COST_LOCAL_ONLY;
  process.env.APP_REPORT_COST_LOCAL_ONLY = '1';
  t.after(() => { if (before == null) delete process.env.APP_REPORT_COST_LOCAL_ONLY; else process.env.APP_REPORT_COST_LOCAL_ONLY = before; });
  let fetchCalls = 0;
  const payload = { periods: [{ period: '2026-08', columns: [], rows: [] }] };
  const result = await employeeCost.applyEffectiveRates(payload, 'DN021', {}, async () => {
    fetchCalls += 1;
    return { outcome: 'ok', payload: { rows: [{ c41: 1 }] }, sourceRange: { from: '2026-07', to: '2026-07' } };
  });
  assert.equal(fetchCalls, 0, 'local-only cấm gọi fallback latest');
  assert.equal(result.rateSource, 'local_only_missing');
  assert.equal(result.ratePolicy.state, 'local_only_missing');
  assert.equal(result.periods[0].rateSource, 'local_only_missing');
  assert.equal(result.periods[0].note, employeeCost.LOCAL_ONLY_MISSING_NOTE);
});

/* ‼ LUẬT ĐỔI 10/08/2026 — CEO ra lệnh lần thứ hai: *"Tao đã yêu cầu lấy bên này
 * không lấy bên DataHub về % chi phí nữa để không bị lỗi."* Bằng chứng CEO đưa:
 * cùng kỳ T07, 23:05 màn hiện 359/359 dòng, 00:20 hiện 1.332/1.332 dòng — doanh thu
 * nhảy vì màn ALL chỉ dựng được dòng của NV lấy được % từ DataHub. Nên kỳ ĐANG CHẠY
 * cũng phải đọc kho đã đồng bộ, không hỏi nguồn tươi mỗi lượt xem.               */

test('‼ kỳ ĐANG CHẠY cũng đọc KHO đã đồng bộ — không hỏi DataHub mỗi lượt xem', async () => {
  const store = memStore();
  await seed(store, '2026-08');
  const pinned = employeeCost.pinnedClosedPayload('DN001', { from: '2026-08', to: '2026-08', rateSnapshotStore: store });
  assert.ok(pinned, 'kho có kỳ này thì phải phục vụ từ kho');
  // Nhãn phân biệt hai nghĩa: kỳ đang chạy là "bản đồng bộ gần nhất", KHÔNG phải
  // "đã chốt đóng băng vĩnh viễn".
  assert.equal(pinned.rateSource, 'local_sync');
  assert.equal(pinned.periods.length, 1);
  assert.ok(pinned.ratePinnedAt, 'phải kèm mốc giờ lần đồng bộ để truy được');
});

test('kho CHƯA có kỳ đang chạy ⇒ vẫn phải ra nguồn, không bịa bản rỗng', async () => {
  const store = memStore();
  await seed(store, CLOSED);
  const pinned = employeeCost.pinnedClosedPayload('DN001', { from: '2026-08', to: '2026-08', rateSnapshotStore: store });
  assert.equal(pinned, null);
});

test('cờ APP_REPORT_COST_LOCAL_FIRST=0 đưa hành vi về như cũ (chỉ kỳ đã chốt)', () => {
  // Đường lui để đối chiếu với nguồn khi cần; mặc định là BẬT.
  const source = require('fs').readFileSync(require.resolve('../src/employeeCost'), 'utf8');
  assert.match(source, /const COST_LOCAL_FIRST = String\(process\.env\.APP_REPORT_COST_LOCAL_FIRST \?\? '1'\) !== '0'/);
  assert.match(source, /if \(!closed && !COST_LOCAL_FIRST\) return null;/);
});

test('dải kỳ TRỘN (chốt + đang chạy) ⇒ nhãn lấy mức YẾU HƠN, không hứa quá', async () => {
  // Cả hai kỳ đều có trong kho nên phục vụ được, nhưng KHÔNG được gắn nhãn
  // 'local_pinned' cho cả dải — trong đó có kỳ chưa chốt, số vẫn đổi khi đồng bộ lại.
  const store = memStore();
  await seed(store, CLOSED);
  await seed(store, '2026-08');
  const mixed = employeeCost.pinnedClosedPayload('DN001', { from: CLOSED, to: '2026-08', rateSnapshotStore: store });
  assert.ok(mixed);
  assert.equal(mixed.rateSource, 'local_sync');
  assert.equal(mixed.periods.length, 2);
});

test('kho thiếu MỘT kỳ trong dải ⇒ không phục vụ nửa vời', async () => {
  const store = memStore();
  await seed(store, CLOSED);
  const pinned = employeeCost.pinnedClosedPayload('DN001', { from: CLOSED, to: '2026-08', rateSnapshotStore: store });
  assert.equal(pinned, null);
});

test('NV không có trong kho kỳ đó ⇒ không ghim cho NV đó', async () => {
  const store = memStore();
  await seed(store, CLOSED);
  assert.equal(employeeCost.pinnedClosedPayload('DN999', { from: CLOSED, to: CLOSED, rateSnapshotStore: store }), null);
});
