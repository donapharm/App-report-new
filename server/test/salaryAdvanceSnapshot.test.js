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

// CEO chốt 04/08: "App Salary đã chốt số ứng lần 1 rồi là không đổi lại được nữa"
// ⇒ số bất biến ⇒ không hỏi lại lần nào. Chỉ kỳ CHƯA chốt mới cần làm tươi.
test('kỳ đã chốt: số bất biến ⇒ không gọi lại App Salary lần nào', () => {
  const store = memStore();
  const t0 = Date.parse('2026-08-04T00:00:00Z');
  snap.write('DN001', '2026-07', projection(), { store, now: () => t0 });
  const record = snap.read('DN001', '2026-07', { store });
  assert.equal(record.final, true);
  // Màn hình KHÔNG phải chờ mạng — có số là trả ngay.
  assert.equal(snap.mustFetch(record), false);
  assert.equal(snap.shouldRevalidate(record, { now: () => t0 + 2 * 3600_000 }), false);
  // Một năm sau vẫn không cần hỏi lại — số đã chốt thì không đổi.
  assert.equal(snap.shouldRevalidate(record, { now: () => t0 + 365 * 86_400_000 }), false);
  // Nhưng vẫn còn đường về ngay khi cần: nút Làm mới / webhook.
  assert.equal(snap.mustFetch(record, { force: true }), true);
});

test('kỳ đang mở: dùng số trong kho ngay, làm tươi ngầm sau 10 phút', () => {
  const store = memStore();
  const t0 = Date.parse('2026-08-04T00:00:00Z');
  snap.write('DN001', '2026-08', projection({ period: '2026-08', locked: false, status: 'draft' }), { store, now: () => t0 });
  const record = snap.read('DN001', '2026-08', { store });
  assert.equal(record.final, false);
  assert.equal(snap.mustFetch(record), false, 'có số thì trả ngay, không bắt màn chờ');
  assert.equal(snap.shouldRevalidate(record, { now: () => t0 + 60_000 }), false, 'mới lấy xong thì thôi');
  assert.equal(snap.shouldRevalidate(record, { now: () => t0 + 20 * 60_000 }), true, 'quá 10 phút thì làm tươi ngầm');
});

test('nút Làm mới / webhook App Salary duyệt: ép gọi lại được', () => {
  const store = memStore();
  snap.write('DN001', '2026-07', projection(), { store });
  const record = snap.read('DN001', '2026-07', { store });
  assert.equal(snap.mustFetch(record, { force: true }), true, 'ép làm mới thì CHỜ số mới');
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

test('không đóng băng cái rỗng: LỖI NGUỒN thì không lưu', () => {
  const store = memStore();
  for (const bad of [
    // `available: false` = GỌI KHÔNG ĐƯỢC. Lưu cái này là mai nguồn khoẻ lại vẫn
    // đọc ra "không có số" — đúng kiểu mất số lặng lẽ.
    projection({ available: false, applicable: null, amount: null, status: 'unavailable' }),
    projection({ available: false, applicable: null, amount: null, reason: 'upstream_timeout' }),
    projection({ amount: null }),
    null,
  ]) {
    assert.equal(snap.write('DN001', '2026-09', bad, { store }), null);
    assert.equal(snap.read('DN001', '2026-09', { store }), null);
  }
  assert.equal(snap.mustFetch(null), true, 'chưa có gì trong kho thì phải gọi');
});

// ‼ SỬA 04/08 19:45 — CEO báo bảng toàn đội trống trơn. Truy ra: App Salary trả
// lời RÕ "người này không có ứng lần 1" (`not_eligible`…) nhưng kho KHÔNG lưu, nên
// bảng đội đọc kho ra rỗng rồi xếp họ vào "thiếu nguồn". Câu trả lời thật khác hẳn
// với gọi-không-được; phải lưu.
test('‼ App Salary TRẢ LỜI "không có ứng" là câu trả lời THẬT — phải lưu', () => {
  for (const reason of ['not_eligible', 'employee_not_found', 'period_not_found']) {
    const store = memStore();
    // Phải khai đúng kỳ đang ghi: `read()` chặn bản ghi lệch kỳ (đúng thiết kế).
    const answered = projection({ period: '2026-09', available: true, applicable: false, amount: null, reason });
    assert.notEqual(snap.write('DN001', '2026-09', answered, { store }), null, `${reason} phải được lưu`);
    const record = snap.read('DN001', '2026-09', { store });
    assert.ok(record, `${reason} phải đọc lại được`);
    assert.equal(record.projection.reason, reason);
    assert.equal(record.projection.amount, null, 'lưu đúng "không có số", KHÔNG bịa thành 0');
    assert.equal(snap.mustFetch(record), false, 'đã có câu trả lời thì thôi hỏi lại App Salary mỗi lần mở màn');
  }
});

test('‼ phân biệt tuyệt đối: "không có ứng" LƯU, "gọi không được" KHÔNG lưu', () => {
  const store = memStore();
  assert.equal(snap.isStorable(projection({ available: true, applicable: false, amount: null, reason: 'not_eligible' })), true);
  assert.equal(snap.isStorable(projection({ available: false, applicable: null, amount: null, reason: 'upstream_timeout' })), false);
  assert.equal(snap.isStorable(projection({ available: false, applicable: null, amount: null, reason: 'not_eligible' })), false,
    'nguồn hỏng thì dù mã lý do trông giống cũng KHÔNG được lưu');
  void store;
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

// ‼ Ca CEO nêu 04/08: sửa số ứng lần 1 BÊN APP SALARY thì App Report phải tự cập
// nhật. Bản đầu của Claude đóng băng vĩnh viễn kỳ đã chốt ⇒ sửa xong không bao giờ
// thấy. Test này chứng minh số mới về được mà không ai phải bấm gì.
const salaryAdvance = require('../src/salaryAdvance');

test('kỳ CHƯA chốt: sửa số bên App Salary ⇒ App Report tự cập nhật, không ai phải bấm gì', async () => {
  const store = memStore();
  const t0 = Date.parse('2026-08-04T00:00:00Z');
  const draft = (over = {}) => projection({ locked: false, status: 'draft', ...over });
  let upstream = draft({ amount: 50_000_000 });
  const get = async () => upstream;

  const first = await salaryAdvance.safeGetFirstAdvance('2026-07', 'DN001', get, { snapshotStore: store, now: () => t0 });
  assert.equal(first.amount, 50_000_000);

  // Kế toán sửa số bên App Salary (kỳ chưa chốt nên còn sửa được).
  upstream = draft({ amount: 55_000_000 });

  // Ngay sau đó: vẫn trả số cũ tức thì (màn không chờ) — đúng thiết kế.
  const soon = await salaryAdvance.safeGetFirstAdvance('2026-07', 'DN001', get, { snapshotStore: store, now: () => t0 + 60_000 });
  assert.equal(soon.amount, 50_000_000);
  assert.ok(soon.fetchedAt, 'phải kèm mốc "số tại lúc …"');

  // Quá ngưỡng làm tươi ⇒ tự lấy số mới, KHÔNG cần ai bấm.
  const later = await salaryAdvance.safeGetFirstAdvance('2026-07', 'DN001', get, {
    snapshotStore: store, now: () => t0 + 20 * 60_000, awaitRevalidate: true,
  });
  assert.equal(later.amount, 55_000_000, 'số sửa bên App Salary phải tự về');
});

test('nút "Làm mới" lấy số mới ngay lập tức', async () => {
  const store = memStore();
  let upstream = projection({ amount: 10_000_000 });
  await salaryAdvance.safeGetFirstAdvance('2026-07', 'DN001', async () => upstream, { snapshotStore: store });
  upstream = projection({ amount: 12_000_000 });
  const forced = await salaryAdvance.safeGetFirstAdvance('2026-07', 'DN001', async () => upstream, { snapshotStore: store, force: true });
  assert.equal(forced.amount, 12_000_000);
});
