/**
 * KHO % CỤC BỘ + ĐỒNG BỘ CHỦ ĐỘNG (SPEC_COST_RATES_LOCAL_SYNC · CEO chốt 08/08)
 * Ba luật phải khoá: all-or-nothing theo kỳ · số có căn cước · đếm đúng cặp đổi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const sync = require('../src/costRatesSync');
const rateSnapshot = require('../src/employeeCostRateSnapshot');

const memStore = () => {
  const data = {};
  return { data, load: (n, d) => data[n] ?? d, save: (n, v) => { data[n] = v; } };
};
const NOW = () => '2026-08-08T15:00:00.000+07:00';
const row = (unit, c5, rates) => ({ unit_code: unit, c5, c16: `Hàng ${c5}`, c25: 'Viên', ...rates });
const COLS = [{ key: 'c41', label: 'C41' }, { key: 'c43', label: 'C43' }];
const okFetch = (byEmp) => async (empCode) => {
  const rows = byEmp[empCode];
  if (!rows) return { outcome: 'upstream_503', payload: { periods: [{ period: '2026-08', columns: [], rows: [] }] } };
  return { outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: COLS, rows }] } };
};

const TEAM = {
  DN001: [row('120.HTNT', 'G1.A', { c41: 1, c43: 3 }), row('021.TTYT', 'G1.B', { c41: 2, c43: 5 })],
  DN002: [row('033.BVDK', 'G1.C', { c41: 0.5, c43: 4 })],
};

test('kéo đủ cả đội ⇒ một lần ghi atomic; reader dùng thẳng kho chủ động kể cả sau 45 ngày', async () => {
  const store = memStore();
  let passiveWrites = 0;
  const save = store.save;
  store.save = (name, value) => {
    if (name === rateSnapshot.FILE) {
      passiveWrites += 1;
      throw new Error('không được bridge từng NV sang kho phụ');
    }
    save(name, value);
  };

  const result = await sync.syncPeriod({ period: '2026-08', empCodes: ['DN001', 'DN002'], actor: 'CEO', fetchImpl: okFetch(TEAM), store, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.written, true);
  assert.equal(result.pairCount, 3);
  assert.equal(passiveWrites, 0);
  const status = sync.statusOf('2026-08', { store });
  assert.equal(status.fetchedAt, NOW());
  assert.equal(status.fetchedBy, 'CEO');
  assert.equal(status.employeeCount, 2);

  // Đường production reader đọc trực tiếp bản all-or-nothing, không phụ thuộc
  // bridge từng NV và không làm mất số sau TTL 45 ngày của snapshot bị động.
  const kept = rateSnapshot.read('dn001', '2026-08', {
    store,
    now: () => Date.parse('2027-08-08T15:00:00.000+07:00'),
  });
  assert.equal(kept.source, 'local_sync');
  assert.equal(kept.payload.rows.length, 2);
  assert.equal(kept.fetchedAt, NOW());
  assert.equal(rateSnapshot.covers('DN002', ['2026-08'], { store }), true);

  const payload = { periods: [{ period: '2026-08', columns: [], rows: [] }] };
  assert.equal(rateSnapshot.restore('DN001', payload, { store }), 1);
  assert.equal(payload.periods[0].rows.length, 2);
  assert.equal(payload.periods[0].rateFetchedAt, NOW());
});

test('‼ GÓP DẦN: hụt vài người thì GHI phần lấy được, nêu đích danh ai còn thiếu', async () => {
  /* Luật cũ all-or-nothing khoá CEO lại: cửa chi phí hỏng 19/21 NV nên mọi lượt bấm
     đều ghi 0 byte, kho vĩnh viễn rỗng, kỳ đã chốt vẫn phải hỏi DataHub mỗi lượt xem.
     Thứ cần bảo vệ không phải "ghi tất cả hoặc không gì" mà là KHÔNG trình bày phần
     thiếu như đã đủ. */
  const store = memStore();
  const result = await sync.syncPeriod({
    period: '2026-07', empCodes: ['DN001', 'DN002', 'DN003'], actor: 'CEO', store,
    now: () => '2026-08-10T09:30:00.000+07:00',
    fetchImpl: async (emp) => (emp === 'DN003'
      ? { outcome: 'upstream_unavailable', payload: null }
      : { outcome: 'ok', payload: { periods: [{ period: '2026-07', columns: COLS, rows: [row('120.HTNT', 'G1.A', { c41: 1, c43: 3 })] }] } }),
  });
  assert.equal(result.ok, true, 'lấy được ai thì phải ghi người đó');
  assert.equal(result.written, true);
  assert.equal(result.fetched, 2);
  assert.equal(result.stored, 2);
  assert.deepEqual(result.missing, ['DN003'], 'phải nêu ĐÍCH DANH người còn thiếu');
  assert.equal(result.complete, false, 'chưa đủ thì KHÔNG được báo đủ');
  // Kho có đúng hai người, không có DN003 — không bịa bản rỗng cho họ.
  assert.deepEqual(sync.statusOf('2026-07', { store }).employees, ['DN001', 'DN002']);
});

test('bấm lượt sau gom TIẾP người còn thiếu, không xoá người đã có', async () => {
  const store = memStore();
  const base = { outcome: 'ok', payload: { periods: [{ period: '2026-07', columns: COLS, rows: [row('120.HTNT', 'G1.A', { c41: 1, c43: 3 })] }] } };
  await sync.syncPeriod({
    period: '2026-07', empCodes: ['DN001', 'DN002', 'DN003'], actor: 'CEO', store,
    now: () => '2026-08-10T09:30:00.000+07:00',
    fetchImpl: async (emp) => (emp === 'DN003' ? { outcome: 'upstream_unavailable', payload: null } : base),
  });
  // Lượt hai: nguồn khoẻ lại, chỉ DN003 là mới.
  const second = await sync.syncPeriod({
    period: '2026-07', empCodes: ['DN001', 'DN002', 'DN003'], actor: 'CEO', store,
    now: () => '2026-08-10T09:40:00.000+07:00',
    fetchImpl: async () => base,
  });
  assert.equal(second.complete, true, 'gom đủ thì mới được báo đủ');
  assert.deepEqual(second.missing, []);
  assert.equal(second.stored, 3);
  assert.equal(second.gained, 1, 'đếm đúng số người MỚI góp được lượt này');
});

test('‼ lượt không lấy được AI thì KHÔNG đụng kho — giữ nguyên bản đang có', async () => {
  const store = memStore();
  const base = { outcome: 'ok', payload: { periods: [{ period: '2026-07', columns: COLS, rows: [row('120.HTNT', 'G1.A', { c41: 1, c43: 3 })] }] } };
  await sync.syncPeriod({
    period: '2026-07', empCodes: ['DN001'], actor: 'CEO', store,
    now: () => '2026-08-10T09:30:00.000+07:00', fetchImpl: async () => base,
  });
  const dead = await sync.syncPeriod({
    period: '2026-07', empCodes: ['DN001', 'DN002'], actor: 'CEO', store,
    now: () => '2026-08-10T09:50:00.000+07:00',
    fetchImpl: async () => ({ outcome: 'upstream_unavailable', payload: null }),
  });
  assert.equal(dead.ok, false);
  assert.equal(dead.written, false);
  assert.equal(dead.stored, 1, 'kho cũ còn nguyên');
  assert.deepEqual(sync.statusOf('2026-07', { store }).employees, ['DN001']);
});

test('đếm đúng "đổi bao nhiêu cặp" giữa hai lần đồng bộ — kể cả khi bản số không đổi tên', async () => {
  const store = memStore();
  await sync.syncPeriod({ period: '2026-08', empCodes: ['DN001', 'DN002'], actor: 'CEO', fetchImpl: okFetch(TEAM), store, now: NOW });
  const edited = {
    DN001: [row('120.HTNT', 'G1.A', { c41: 1.5, c43: 3 }), row('021.TTYT', 'G1.B', { c41: 2, c43: 5 })], // đổi 1 cặp
    DN002: [row('033.BVDK', 'G1.C', { c41: 0.5, c43: 4 }), row('033.BVDK', 'G1.D', { c41: 9, c43: 9 })], // thêm 1 cặp
  };
  const result = await sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001', 'DN002'], actor: 'CEO',
    fetchImpl: okFetch(edited), store, now: () => '2026-08-09T09:00:00.000+07:00',
  });
  assert.deepEqual(result.diff, { changed: 1, added: 1, removed: 0 });
});

test('cùng cặp mà hai NV mang % khác nhau ⇒ ghi XUNG_DOT, không im lặng lấy bừa một bên', () => {
  const employees = {
    DN001: { rows: [row('120.HTNT', 'G1.A', { c41: 1, c43: 3 })] },
    DN002: { rows: [row('120.HTNT', 'G1.A', { c41: 2, c43: 3 })] },
  };
  const signatures = sync.pairSignatures(employees, ['c41', 'c43']);
  assert.equal(Object.values(signatures)[0], 'XUNG_DOT');
});

test('thiếu % trong dòng ⇒ chữ ký ghi "—", không suy 0', () => {
  const employees = { DN001: { rows: [row('120.HTNT', 'G1.A', { c41: null, c43: 3 })] } };
  const signatures = sync.pairSignatures(employees, ['c41', 'c43']);
  assert.match(Object.values(signatures)[0], /^—/);
});

test('17 thuốc cùng đơn vị + QLNB vẫn là 17 dòng chữ ký DataHub, không bị gộp thành một', () => {
  const employees = { DN005: { rows: Array.from({ length: 17 }, (_, index) => row('002.NT', 'QL01', { c16: `Thuốc ${index + 1}`, c25: 'Hộp', c41: index })) } };
  assert.equal(Object.keys(sync.lineSignatures(employees, ['c41'])).length, 17);
});

test('dòng thiếu định danh bị loại riêng và không biến mất lặng lẽ khỏi chữ ký', () => {
  const result = sync.collectLineSignatures({ DN005: { rows: [
    { c7: '002.NT', c5: 'QL01', c16: 'Đủ', c25: 'Viên', c41: 1 },
    { c7: '002.NT', c5: 'QL02', c41: 2 },
  ] } }, ['c41']);
  assert.equal(Object.keys(result.signatures).length, 1);
  assert.equal(result.sourceRows, 2);
  assert.equal(result.includedRows, 1);
  assert.deepEqual(result.exclusions, [{
    code: 'COST_SYNC_LINE_IDENTITY_MISSING', reason: 'missing_line_identity', empCode: 'DN005', rowIndex: 1,
    missingFields: ['productName', 'uom'],
  }]);
});

test('sync loại riêng <=1% dòng hỏng, vẫn ghi kho và audit đủ nguồn = đưa vào + loại', async () => {
  const store = memStore();
  const rows = Array.from({ length: 101 }, (_, index) => row('120.HTNT', `G1.${index}`, {
    c16: `Thuốc ${index}`, c25: 'Viên', c41: index,
  }));
  delete rows[100].c16;
  const result = await sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001'], actor: 'CEO', store, pauseMs: 0,
    fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: [{ key: 'c41' }], rows }] } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.lineIdentity.sourceRows, 101);
  assert.equal(result.lineIdentity.includedRows, 100);
  assert.equal(result.lineIdentity.excludedRows, 1);
  assert.equal(result.lineIdentity.sourceRows, result.lineIdentity.includedRows + result.lineIdentity.excludedRows);
  assert.equal(result.lineIdentity.exceptions[0].code, 'COST_SYNC_LINE_IDENTITY_MISSING');
  assert.equal(store.data.cost_rates_sync_audit[0].lineIdentity.exceptions.length, 1);
});

test('sync fail-closed toàn lượt khi dòng hỏng vượt 1% và giữ nguyên kho', async () => {
  const store = memStore();
  const before = { '2026-08': { marker: 'GOOD' } };
  store.data.cost_rates_local = before;
  const rows = [
    row('120.HTNT', 'G1.OK', { c16: 'Đủ', c25: 'Viên', c41: 1 }),
    { c7: '120.HTNT', c5: 'G1.BAD', c41: 2 },
  ];
  await assert.rejects(() => sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001'], actor: 'CEO', store, pauseMs: 0,
    fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: [{ key: 'c41' }], rows }] } }),
  }), (error) => error.code === 'COST_SYNC_LINE_EXCLUSION_RATE_EXCEEDED' && error.exclusionRate === 0.5);
  assert.deepEqual(store.data.cost_rates_local, before);
  assert.equal(store.data.cost_rates_sync_audit[0].ok, false);
});

test('sync fail-closed khi không còn dòng nào đủ định danh', async () => {
  const store = memStore();
  await assert.rejects(() => sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001'], actor: 'CEO', store, pauseMs: 0,
    fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: [{ key: 'c41' }], rows: [{ c7: '120.HTNT', c5: 'G1.BAD', c41: 2 }] }] } }),
  }), (error) => error.code === 'COST_SYNC_NO_IDENTIFIED_LINES');
  assert.equal(store.data.cost_rates_local, undefined);
});

test('chặn đầu vào rác: kỳ sai, đội rỗng, thiếu người thao tác', async () => {
  const store = memStore();
  await assert.rejects(() => sync.syncPeriod({ period: '08.2026', empCodes: ['DN001'], actor: 'CEO', store }), /COST_SYNC_PERIOD_INVALID|Kỳ không hợp lệ/);
  await assert.rejects(() => sync.syncPeriod({ period: '2026-08', empCodes: ['CEO', 'ADMIN'], actor: 'CEO', store }), /COST_SYNC_NO_EMPLOYEES|Không có nhân viên nào/);
  await assert.rejects(() => sync.syncPeriod({ period: '2026-08', empCodes: ['DN001'], store }), /COST_SYNC_ACTOR_REQUIRED|Thiếu người thao tác/);
});

test('giữ tối đa 12 kỳ — kỳ cổ nhất tự rụng, không phình vô hạn', async () => {
  const store = memStore();
  for (let index = 0; index < 14; index += 1) {
    const month = String((index % 12) + 1).padStart(2, '0');
    const period = `${2025 + Math.floor(index / 12)}-${month}`;
    // eslint-disable-next-line no-await-in-loop
    await sync.syncPeriod({ period, empCodes: ['DN001'], actor: 'CEO', fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period, columns: COLS, rows: TEAM.DN001 }] } }), store, now: NOW });
  }
  assert.equal(sync.listStatus({ store }).length, 12);
});

test('nghỉ một nhịp giữa các lượt gọi — nguồn kịp thu hồi bộ nhớ (DataHub OOM 08/08)', async () => {
  const store = memStore();
  const gaps = [];
  let last = 0;
  let clock = 0;
  const result = await sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001', 'DN002', 'DN003'], actor: 'CEO',
    store, now: () => '2026-08-08T23:00:00.000+07:00',
    pauseMs: 250,
    // Đồng hồ giả: mỗi lần "ngủ" cộng thẳng vào clock, không chờ thật.
    sleep: async (ms) => { clock += ms; },
    fetchImpl: async () => {
      gaps.push(clock - last); last = clock;
      return { outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: [{ key: 'c41' }], rows: [{ unit_code: 'U1', c5: 'P1', c16: 'Thuốc 1', c25: 'Viên', c41: 1 }] }] } };
    },
  });
  assert.equal(result.ok, true);
  // Lượt đầu không phải chờ; hai lượt sau mỗi lượt cách nhau đúng một nhịp nghỉ.
  assert.deepEqual(gaps, [0, 250, 250]);
});

test('pauseMs = 0 thì không nghỉ — giữ đường chạy nhanh cho test và cho nguồn khoẻ', async () => {
  const store = memStore();
  let slept = 0;
  await sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001'], actor: 'CEO', store,
    now: () => '2026-08-08T23:00:00.000+07:00',
    pauseMs: 0,
    sleep: async () => { slept += 1; },
    fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: [{ key: 'c41' }], rows: [{ unit_code: 'U1', c5: 'P1', c16: 'Thuốc 1', c25: 'Viên', c41: 1 }] }] } }),
  });
  assert.equal(slept, 0);
});
