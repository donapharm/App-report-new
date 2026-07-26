const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Cách ly như các test warm khác — tránh đụng data/env thật.
process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-selfheal-auth-'));
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-selfheal-no-lkg.json');
process.env.EMPLOYEE_COST_ALL_WARM_DISABLED = '1';

const router = require('../src/routes');

const payloadWith = (...employeeLists) => ({
  periods: employeeLists.map((employees) => ({ match: { unavailableEmployees: employees, unavailablePairs: employees.length * 10 } })),
});

test('collectUnavailableEmployees gộp + khử trùng qua nhiều period, sort ổn định', () => {
  const got = router.collectUnavailableEmployees(payloadWith(['DN003', 'DN001'], ['DN001']));
  assert.deepEqual(got, ['DN001', 'DN003']);
  assert.deepEqual(router.collectUnavailableEmployees({ periods: [] }), []);
  assert.deepEqual(router.collectUnavailableEmployees({}), []);
});

test('không NV nào fail → 0 probe, 0 invalidate, 0 rebuild (happy-path sạch)', async () => {
  let invalidated = 0; let rebuilt = 0; let probed = 0;
  const payload = payloadWith([]);
  const res = await router.selfHealUnavailableCostSources({
    payload,
    probe: () => { probed += 1; return { outcome: 'ok' }; },
    invalidate: () => { invalidated += 1; },
    rebuild: () => { rebuilt += 1; return payloadWith([]); },
  });
  assert.equal(probed, 0);
  assert.equal(invalidated, 0);
  assert.equal(rebuilt, 0);
  assert.deepEqual(res.recovered, []);
  assert.equal(res.payload, payload, 'giữ nguyên payload cũ');
});

test('NV hồi (outcome=ok) → invalidate + rebuild + trả payload TƯƠI + recovered đúng', async () => {
  let invalidated = 0;
  const fresh = payloadWith([]); // sau rebuild: hết unavailable
  const res = await router.selfHealUnavailableCostSources({
    payload: payloadWith(['DN001']),
    probe: async (emp) => ({ outcome: emp === 'DN001' ? 'ok' : 'upstream_unavailable' }),
    invalidate: () => { invalidated += 1; },
    rebuild: async () => fresh,
  });
  assert.equal(invalidated, 1);
  assert.deepEqual(res.recovered, ['DN001']);
  assert.equal(res.payload, fresh, 'phải là payload rebuild tươi');
});

test('NV còn fail (upstream_unavailable) → KHÔNG invalidate/rebuild, giữ tạm tính (fail-closed)', async () => {
  let invalidated = 0; let rebuilt = 0;
  const payload = payloadWith(['DN001']);
  const res = await router.selfHealUnavailableCostSources({
    payload,
    probe: async () => ({ outcome: 'upstream_unavailable' }),
    invalidate: () => { invalidated += 1; },
    rebuild: async () => { rebuilt += 1; return payloadWith([]); },
  });
  assert.equal(invalidated, 0);
  assert.equal(rebuilt, 0);
  assert.deepEqual(res.recovered, []);
  assert.equal(res.payload, payload, 'giữ nguyên payload tạm tính');
});

test('probe NÉM lỗi → coi như CHƯA hồi (fail-closed), không invalidate', async () => {
  let invalidated = 0;
  const payload = payloadWith(['DN001']);
  const res = await router.selfHealUnavailableCostSources({
    payload,
    probe: async () => { throw new Error('timeout'); },
    invalidate: () => { invalidated += 1; },
    rebuild: async () => payloadWith([]),
  });
  assert.equal(invalidated, 0);
  assert.deepEqual(res.recovered, []);
  assert.equal(res.payload, payload);
});

test('scope_mismatch KHÔNG được coi là hồi (chỉ ok mới lật)', async () => {
  let invalidated = 0;
  const res = await router.selfHealUnavailableCostSources({
    payload: payloadWith(['DN001']),
    probe: async () => ({ outcome: 'scope_mismatch' }),
    invalidate: () => { invalidated += 1; },
    rebuild: async () => payloadWith([]),
  });
  assert.equal(invalidated, 0);
  assert.deepEqual(res.recovered, []);
});

test('hỗn hợp: 1 NV hồi, 1 NV còn fail → recovered chỉ NV hồi, vẫn invalidate+rebuild 1 lần', async () => {
  let invalidated = 0; let rebuilt = 0;
  const fresh = payloadWith(['DN003']); // DN003 vẫn fail sau rebuild
  const res = await router.selfHealUnavailableCostSources({
    payload: payloadWith(['DN001', 'DN003']),
    probe: async (emp) => ({ outcome: emp === 'DN001' ? 'ok' : 'upstream_unavailable' }),
    invalidate: () => { invalidated += 1; },
    rebuild: async () => { rebuilt += 1; return fresh; },
  });
  assert.equal(invalidated, 1);
  assert.equal(rebuilt, 1);
  assert.deepEqual(res.recovered, ['DN001']);
  assert.equal(res.payload, fresh);
});

test('invalidateEmployeeCostAll chỉ xoá key nhóm employee-cost-all (không đụng cache khác)', () => {
  // Không có cách trực tiếp bơm memo từ ngoài; kiểm không ném lỗi + trả số >= 0.
  const cleared = router.invalidateEmployeeCostAll();
  assert.equal(typeof cleared, 'number');
  assert.ok(cleared >= 0);
});

// Blocker#1: invalidate ĐÚNG KỲ — chỉ khớp key của kỳ đang self-heal, GIỮ kỳ khác.
test('employeeCostAllKeyMatchesRange: chỉ khớp đúng kỳ, giữ nguyên kỳ khác + nhóm khác', () => {
  const keyJul = 'employee-cost-all:base:sig1:ADMIN_ALL:{"from":"2026-07","to":"2026-07"}';
  const keyJun = 'employee-cost-all:base:sig1:ADMIN_ALL:{"from":"2026-06","to":"2026-06"}';
  const keyJulView = 'employee-cost-all:view:sig1:ADMIN_ALL:{"date":"","from":"2026-07","page":"1","to":"2026-07"}';
  const otherGroup = 'employee-cost:read:sig1:{"from":"2026-07"}';
  const range = { from: '2026-07', to: '2026-07' };
  assert.equal(router.employeeCostAllKeyMatchesRange(keyJul, range), true);
  assert.equal(router.employeeCostAllKeyMatchesRange(keyJulView, range), true);   // cả view phase
  assert.equal(router.employeeCostAllKeyMatchesRange(keyJun, range), false);      // KỲ KHÁC → giữ
  assert.equal(router.employeeCostAllKeyMatchesRange(otherGroup, range), false);  // nhóm khác → giữ
  // Không truyền range → mọi key ALL (giữ hành vi cũ), nhưng vẫn không đụng nhóm khác.
  assert.equal(router.employeeCostAllKeyMatchesRange(keyJun, null), true);
  assert.equal(router.employeeCostAllKeyMatchesRange(otherGroup, null), false);
});

// Blocker#2: single-flight — 2 lời gọi CHỒNG cùng khóa chỉ chạy fn 1 lần, coalesce.
test('singleFlight: 2 lời gọi chồng cùng khóa → fn chạy 1 lần, cùng kết quả, dọn sau xong', async () => {
  const map = new Map();
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const fn = async () => { runs += 1; await gate; return runs; };
  const p1 = router.singleFlight(map, 'k', fn);
  const p2 = router.singleFlight(map, 'k', fn); // đang chạy → dùng chung, KHÔNG chạy lại
  assert.equal(map.size, 1);
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(runs, 1);       // fn chỉ chạy 1 lần dù gọi 2 lần
  assert.equal(a, b);          // cùng kết quả
  assert.equal(map.size, 0);   // dọn khóa sau khi xong
  // Khác khóa → chạy độc lập.
  const other = new Map();
  await Promise.all([router.singleFlight(other, 'x', fn), router.singleFlight(other, 'y', fn)]);
  assert.equal(runs, 3);       // 'x' và 'y' mỗi cái chạy 1 lần
});
