'use strict';
// Vụ 01/08: DataHub kẹt vì khoá mồ côi ⇒ 21 NV hiện 0đ. Khoá tự lành sửa ở DataHub;
// phía App Report thì KHÔNG ĐƯỢC MẤT SỐ chỉ vì nguồn kẹt vài giây.
const test = require('node:test');
const assert = require('node:assert/strict');
const snap = require('../src/employeeCostRateSnapshot');
const employeeCost = require('../src/employeeCost');

const memStore = () => ({ data: {}, load(n, d) { return this.data[n] ?? d; }, save(n, v) { this.data[n] = v; } });
const COLUMNS = [{ key: 'c36', pos: 36, label: 'CP (%)' }];
const ROWS = [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc A', c25: 'Viên', c36: 8 }];
const credentials = {
  baseUrl: 'http://hub.test', assignmentKey: 'assignment-key-1234',
  employeeCostKeys: 'DN001=employee-cost-key-1234', backoffMs: [],
};

test('‼ nguồn kẹt mà đã có bản lưu ⇒ VẪN CÓ SỐ, gắn nhãn số cũ', async () => {
  const store = memStore();
  const good = { ok: true, status: 200, json: async () => ({ empCode: 'DN001', from: '2026-07', to: '2026-07', columns: COLUMNS, rows: ROWS }) };
  const okResult = await employeeCost.fetchEmployeeCost('DN001', {
    from: '2026-07', to: '2026-07', ...credentials, rateSnapshotStore: store, fetchImpl: async () => good,
  });
  assert.equal(okResult.payload.periods[0].rows.length, 1);

  // Nguồn kẹt y như vụ khoá mồ côi.
  const stalled = await employeeCost.fetchEmployeeCost('DN001', {
    from: '2026-07', to: '2026-07', ...credentials, rateSnapshotStore: store,
    fetchImpl: async () => { throw Object.assign(new Error('timeout'), { name: 'AbortError' }); },
  });
  assert.equal(stalled.payload.periods[0].rows.length, 1, 'KHÔNG được mất số');
  assert.equal(stalled.payload.periods[0].rateStale, true, 'phải gắn cờ số cũ');
  assert.ok(stalled.payload.periods[0].rateFetchedAt, 'phải kèm mốc lấy số');
  assert.equal(stalled.outcome, 'ok_stale_rates', 'trạng thái nói rõ đang dùng số cũ');
  assert.match(stalled.payload.rateStaleNote, /Nguồn chi phí đang kẹt/);
});

test('kho chủ động all-or-nothing là đường đọc thật và không hết hạn sau 45 ngày', async () => {
  const store = memStore();
  store.data[snap.LOCAL_SYNC_FILE] = {
    '2026-07': {
      period: '2026-07',
      fetchedAt: '2025-01-01T00:00:00.000Z',
      fetchedBy: 'CEO',
      employees: { DN001: { columns: COLUMNS, rows: ROWS } },
    },
  };

  let networkCalls = 0;
  const stalled = await employeeCost.fetchEmployeeCost('DN001', {
    from: '2026-07', to: '2026-07', ...credentials, rateSnapshotStore: store,
    fetchImpl: async () => { networkCalls += 1; throw Object.assign(new Error('timeout'), { name: 'AbortError' }); },
    awaitBackgroundRefresh: true,
  });
  // 2026-07 là KỲ ĐÃ CHỐT SỔ ⇒ từ 09/08 kho chủ động được GHIM: trả 'ok' thẳng từ
  // kho và KHÔNG gọi nguồn — mạnh hơn cả 'ok_stale_rates' mà test này từng đòi
  // (chủ đích "kho chủ động là đường đọc thật, không hết hạn" được thoả tuyệt đối).
  assert.equal(stalled.outcome, 'ok');
  assert.equal(stalled.pinned, true);
  assert.equal(networkCalls, 0, 'kỳ chốt không đụng mạng — nguồn chết cũng kệ');
  assert.equal(stalled.payload.periods[0].rows.length, 1);
  assert.equal(stalled.payload.rateSource, 'local_pinned');
  assert.equal(store.data[snap.FILE], undefined, 'không cần bridge từng NV sang snapshot phụ');
});

test('‼ chưa từng có bản lưu ⇒ vẫn fail-closed như cũ, KHÔNG bịa số', async () => {
  const stalled = await employeeCost.fetchEmployeeCost('DN404', {
    from: '2026-07', to: '2026-07', baseUrl: 'http://hub.test', assignmentKey: 'assignment-key-1234',
    employeeCostKeys: 'DN404=employee-cost-key-1234', backoffMs: [], rateSnapshotStore: memStore(),
    fetchImpl: async () => { throw new Error('down'); },
  });
  assert.equal(stalled.payload.periods[0].rows.length, 0);
  assert.notEqual(stalled.outcome, 'ok_stale_rates');
});

test('bản lưu quá cũ thì thà không có còn hơn dùng tỷ lệ lỗi thời', () => {
  const store = memStore();
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  snap.write('DN001', '2026-07', { columns: COLUMNS, rows: ROWS, period: '2026-07' }, { store, now: () => t0 });
  assert.ok(snap.read('DN001', '2026-07', { store, now: () => t0 + 10 * 86_400_000 }));
  assert.equal(snap.read('DN001', '2026-07', { store, now: () => t0 + 60 * 86_400_000 }), null, 'quá 45 ngày thì bỏ');
});

test('không đóng băng cái rỗng', () => {
  const store = memStore();
  assert.equal(snap.write('DN001', '2026-07', { columns: [], rows: [] }, { store }), null);
  assert.equal(snap.write('DN001', '2026-07', null, { store }), null);
  assert.equal(snap.read('DN001', '2026-07', { store }), null);
});

test('kho không phình vô hạn', () => {
  const store = memStore();
  for (let i = 0; i < snap.MAX_RECORDS + 20; i += 1) {
    snap.write(`DN${i}`, '2026-07', { columns: COLUMNS, rows: ROWS }, { store, now: () => 1_700_000_000_000 + i * 1000 });
  }
  assert.equal(Object.keys(store.load(snap.FILE, {})).length, snap.MAX_RECORDS);
});

test('kỳ đã có số thật thì KHÔNG bị bản lưu đè lên', () => {
  const store = memStore();
  snap.write('DN001', '2026-07', { columns: COLUMNS, rows: [{ ...ROWS[0], c36: 99 }] }, { store });
  const payload = { periods: [{ period: '2026-07', columns: COLUMNS, rows: ROWS }] };
  assert.equal(snap.restore('DN001', payload, { store }), 0);
  assert.equal(payload.periods[0].rows[0].c36, 8, 'số thật phải thắng bản lưu');
  assert.equal(payload.rateStale, undefined);
});

// ‼ CEO 04/08: *"giải quyết sao cho KHÔNG MẤT SỐ và KHÔNG KẸT là việc của chúng mày."*
// "Không mất số" đã có ở các test trên. Đây là phần "không kẹt".
test('‼ đã có bản lưu ⇒ nguồn kẹt KHÔNG bắt người dùng chờ hết 25 giây', async () => {
  const store = memStore();
  const good = { ok: true, status: 200, json: async () => ({ empCode: 'DN001', from: '2026-07', to: '2026-07', columns: COLUMNS, rows: ROWS }) };
  await employeeCost.fetchEmployeeCost('DN001', {
    from: '2026-07', to: '2026-07', ...credentials, rateSnapshotStore: store, fetchImpl: async () => good,
  });

  // Nguồn kẹt: mỗi lượt gọi chỉ trả lời sau khi bị huỷ (giống khoá mồ côi).
  const waits = [];
  const stalledFetch = async (url, init) => new Promise((resolve, reject) => {
    const started = Date.now();
    init?.signal?.addEventListener('abort', () => {
      waits.push(Date.now() - started);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });

  const started = Date.now();
  const result = await employeeCost.fetchEmployeeCost('DN001', {
    from: '2026-07', to: '2026-07', ...credentials, rateSnapshotStore: store, fetchImpl: stalledFetch,
  });
  const elapsed = Date.now() - started;

  assert.equal(result.payload.periods[0].rows.length, 1, 'vẫn có số');
  assert.equal(result.outcome, 'ok_stale_rates');
  assert.equal(waits.length, 1, 'chỉ hỏi MỘT lần, không hỏi lại 3 lần');
  assert.ok(waits[0] <= employeeCost.FAST_TIMEOUT_MS + 500, `chờ ${waits[0]}ms — phải cắt ở ${employeeCost.FAST_TIMEOUT_MS}ms`);
  assert.ok(elapsed < 6000, `màn chờ ${elapsed}ms — phải nhanh hơn hẳn ngân sách 25 giây`);
});

test('chưa có bản lưu thì vẫn dùng ngân sách đầy đủ — không cắt ngắn cơ hội lấy số thật', async () => {
  const waits = [];
  const stalledFetch = async (url, init) => new Promise((resolve, reject) => {
    const started = Date.now();
    init?.signal?.addEventListener('abort', () => {
      waits.push(Date.now() - started);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
  await employeeCost.fetchEmployeeCost('DN777', {
    from: '2026-07', to: '2026-07', baseUrl: 'http://hub.test', assignmentKey: 'assignment-key-1234',
    employeeCostKeys: 'DN777=employee-cost-key-1234', backoffMs: [], timeoutMs: 300,
    rateSnapshotStore: memStore(), fetchImpl: stalledFetch,
  });
  assert.ok(waits[0] >= 250, 'không bị cắt xuống đường nhanh khi chưa có gì để dùng lại');
});
