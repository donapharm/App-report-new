/**
 * KHO % CỤC BỘ + ĐỒNG BỘ CHỦ ĐỘNG (SPEC_COST_RATES_LOCAL_SYNC · CEO chốt 08/08)
 * Ba luật phải khoá: all-or-nothing theo kỳ · số có căn cước · đếm đúng cặp đổi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const sync = require('../src/costRatesSync');

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

test('kéo đủ cả đội ⇒ ghi kho + căn cước đầy đủ + nạp cầu nối sang kho bị động', async () => {
  const store = memStore();
  const result = await sync.syncPeriod({ period: '2026-08', empCodes: ['DN001', 'DN002'], actor: 'CEO', fetchImpl: okFetch(TEAM), store, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.written, true);
  assert.equal(result.pairCount, 3);
  const status = sync.statusOf('2026-08', { store });
  assert.equal(status.fetchedAt, NOW());
  assert.equal(status.fetchedBy, 'CEO');
  assert.equal(status.employeeCount, 2);
  // Cầu nối: kho bị động (employee_cost_rate_snapshot) cũng có luôn bản này.
  assert.ok(store.data.employee_cost_rate_snapshot, 'phải nạp sang kho bị động để fallback hiện hành hưởng ngay');
  // Đọc lại được cho tầng đọc.
  const kept = sync.readEmployee('2026-08', 'dn001', { store });
  assert.equal(kept.rows.length, 2);
  assert.equal(kept.fetchedAt, NOW());
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
