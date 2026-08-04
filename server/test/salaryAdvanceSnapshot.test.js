'use strict';
// CEO 04/08: "khi có số ứng lần 1 rồi thì lấy số về luôn, chỉ khi thay đổi số ứng
// lần 1 thì mới đổi số" — không được gọi App Salary mỗi lần NV mở màn.
const test = require('node:test');
const assert = require('node:assert/strict');
const snap = require('../src/salaryAdvanceSnapshot');

const memStore = () => ({ data: {}, load(n, d) { return this.data[n] ?? d; }, save(n, v) { this.data[n] = v; } });
const projection = (over = {}) => ({
  ok: true, available: true, applicable: true, amount: 50_000_000, currency: 'VND',
  emp_code: 'DN001', locked: true, period: '2026-07', reason: null, status: 'locked', ...over,
});

test('kỳ ĐÃ CHỐT thì không bao giờ gọi lại App Salary', () => {
  const store = memStore();
  snap.write('DN001', '2026-07', projection(), { store });
  const record = snap.read('DN001', '2026-07', { store });
  assert.equal(record.final, true);
  assert.equal(snap.needsRefresh(record), false);
  // Kể cả một năm sau vẫn không cần gọi lại.
  assert.equal(snap.needsRefresh(record, { now: () => Date.now() + 365 * 86_400_000 }), false);
});

test('kỳ đang mở: dùng số trong kho, chỉ gọi lại khi quá hạn', () => {
  const store = memStore();
  const t0 = Date.parse('2026-08-04T00:00:00Z');
  snap.write('DN001', '2026-08', projection({ period: '2026-08', locked: false, status: 'draft' }), { store, now: () => t0 });
  const record = snap.read('DN001', '2026-08', { store });
  assert.equal(record.final, false);
  assert.equal(snap.needsRefresh(record, { now: () => t0 + 60_000 }), false, 'mới lấy xong thì thôi gọi');
  assert.equal(snap.needsRefresh(record, { now: () => t0 + 5 * 3600_000 }), false, 'trong 6 giờ vẫn dùng số cũ');
  assert.equal(snap.needsRefresh(record, { now: () => t0 + 7 * 3600_000 }), true, 'quá hạn thì làm tươi');
});

test('nút Làm mới / webhook App Salary duyệt: ép gọi lại được', () => {
  const store = memStore();
  snap.write('DN001', '2026-07', projection(), { store });
  const record = snap.read('DN001', '2026-07', { store });
  assert.equal(snap.needsRefresh(record, { force: true }), true);
  assert.equal(snap.invalidate('DN001', '2026-07', { store }), true);
  assert.equal(snap.read('DN001', '2026-07', { store }), null);
});

test('‼ chỉ lưu 10 khoá hợp đồng — dữ liệu lương không được vào kho', () => {
  const store = memStore();
  snap.write('DN001', '2026-07', { ...projection(), net: 90_000_000, bhxh: 1 }, { store });
  const { projection: saved } = snap.read('DN001', '2026-07', { store });
  assert.deepEqual(Object.keys(saved).sort(), snap.CONTRACT_KEYS);
  assert.equal('net' in saved, false);
  assert.equal('bhxh' in saved, false);
});

test('không đóng băng cái rỗng: chưa có số / lỗi nguồn thì không lưu', () => {
  const store = memStore();
  for (const bad of [
    projection({ available: false, applicable: null, amount: null, status: 'unavailable' }),
    projection({ applicable: false, amount: null, reason: 'not_eligible' }),
    projection({ amount: null }),
    null,
  ]) {
    assert.equal(snap.write('DN001', '2026-09', bad, { store }), null);
    assert.equal(snap.read('DN001', '2026-09', { store }), null);
  }
  assert.equal(snap.needsRefresh(null), true, 'chưa có gì trong kho thì phải gọi');
});

test('‼ kho hỏng/bị sửa tay KHÔNG được trả nhầm số của người khác hoặc kỳ khác', () => {
  const store = memStore();
  store.save(snap.FILE, {
    [snap.keyOf('DN001', '2026-07')]: { projection: projection({ emp_code: 'DN999' }), fetchedAt: new Date().toISOString() },
    [snap.keyOf('DN002', '2026-07')]: { projection: projection({ emp_code: 'DN002', period: '2026-06' }), fetchedAt: new Date().toISOString() },
  });
  assert.equal(snap.read('DN001', '2026-07', { store }), null, 'lệch mã NV ⇒ bỏ');
  assert.equal(snap.read('DN002', '2026-07', { store }), null, 'lệch kỳ ⇒ bỏ');
});

test('kho không phình vô hạn', () => {
  const store = memStore();
  for (let i = 0; i < snap.MAX_RECORDS + 25; i += 1) {
    snap.write(`DN${i}`, '2026-07', projection({ emp_code: `DN${i}` }), { store, now: () => 1_700_000_000_000 + i * 1000 });
  }
  assert.equal(Object.keys(store.load(snap.FILE, {})).length, snap.MAX_RECORDS);
});
