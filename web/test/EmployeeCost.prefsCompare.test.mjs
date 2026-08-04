import test from 'node:test';
import assert from 'node:assert/strict';
import {
  employeeCostDelta, formatDeltaLabel, readEmployeeCostPrefs, writeEmployeeCostPrefs,
} from '../src/employeeCostModel.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), map };
}

test('nhớ lựa chọn: ghi rồi đọc lại đúng NV, kỳ và cờ so sánh', () => {
  const storage = fakeStorage();
  writeEmployeeCostPrefs(storage, { emp: 'DN009', from: '2026-07', to: '2026-07', compare: true });
  assert.deepEqual(readEmployeeCostPrefs(storage), {
    emp: 'DN009', range: { from: '2026-07', to: '2026-07' }, compare: true,
  });
});

test('‼ rác trong storage KHÔNG được biến thành tham số truy vấn', () => {
  for (const bad of [
    '{"emp":"../../etc","from":"2026-07","to":"2026-07"}',
    '{"emp":"DN009","from":"2026-13","to":"2026-13"}',
    '{"emp":"DN009","from":"2026-08","to":"2026-07"}',
    'không phải json',
  ]) {
    const prefs = readEmployeeCostPrefs(fakeStorage({ 'app-report:employee-cost:prefs:v1': bad }));
    assert.ok(prefs.emp === '' || /^(ALL|[A-Z0-9_-]{2,20})$/.test(prefs.emp), `mã NV bẩn lọt: ${prefs.emp}`);
    if (prefs.range) assert.ok(prefs.range.from <= prefs.range.to);
  }
});

test('storage bị chặn thì không làm hỏng màn hình', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readEmployeeCostPrefs(blocked), { emp: '', range: null, compare: false });
  writeEmployeeCostPrefs(blocked, { emp: 'DN001' });
});

test('so kỳ trước: thiếu một đầu thì trả null, KHÔNG coi là 0', () => {
  assert.equal(employeeCostDelta(null, 100), null);
  assert.equal(employeeCostDelta(100, null), null);
  assert.equal(formatDeltaLabel(null), '');
  assert.deepEqual(employeeCostDelta(120, 100), { diff: 20, pct: 20 });
  assert.deepEqual(employeeCostDelta(80, 100), { diff: -20, pct: -20 });
  // Kỳ trước bằng 0 thì không có % để chia — vẫn nêu số tuyệt đối.
  assert.deepEqual(employeeCostDelta(50, 0), { diff: 50, pct: null });
});

test('nhãn chênh lệch đọc được, có mũi tên và dấu', () => {
  assert.match(formatDeltaLabel(employeeCostDelta(120_000_000, 100_000_000)), /▲ 20%.*\+20\.000\.000đ.*so kỳ trước/);
  assert.match(formatDeltaLabel(employeeCostDelta(80_000_000, 100_000_000)), /▼ 20%.*-20\.000\.000đ/);
});
