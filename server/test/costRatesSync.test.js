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
const row = (unit, c5, rates) => ({ unit_code: unit, c5, c16: `Hàng ${c5}`, ...rates });
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

test('ALL-OR-NOTHING: hụt MỘT người ⇒ không ghi gì, bản tốt đang có còn nguyên', async () => {
  const store = memStore();
  await sync.syncPeriod({ period: '2026-08', empCodes: ['DN001', 'DN002'], actor: 'CEO', fetchImpl: okFetch(TEAM), store, now: NOW });
  const broken = { DN001: TEAM.DN001 }; // DN002 chết nguồn
  const result = await sync.syncPeriod({
    period: '2026-08', empCodes: ['DN001', 'DN002'], actor: 'CEO',
    fetchImpl: okFetch(broken), store, now: () => '2026-08-09T09:00:00.000+07:00',
  });
  assert.equal(result.ok, false);
  assert.equal(result.written, false);
  assert.deepEqual(result.failures, [{ empCode: 'DN002', outcome: 'upstream_503' }]);
  // Bản cũ còn nguyên, mốc giờ KHÔNG đổi.
  assert.equal(sync.statusOf('2026-08', { store }).fetchedAt, NOW());
  // Lần thất bại vẫn vào audit — thất bại không được biến mất lặng lẽ.
  const audit = sync.listAudit({ store });
  assert.equal(audit[0].ok, false);
  assert.equal(audit[1].ok, true);
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
      return { outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: [{ key: 'c41' }], rows: [{ unit_code: 'U1', c5: 'P1', c41: 1 }] }] } };
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
    fetchImpl: async () => ({ outcome: 'ok', payload: { periods: [{ period: '2026-08', columns: [{ key: 'c41' }], rows: [{ unit_code: 'U1', c5: 'P1', c41: 1 }] }] } }),
  });
  assert.equal(slept, 0);
});
