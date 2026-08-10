'use strict';
/**
 * BẢN NHỚ CỦA persist.js — gốc rễ vụ "màn Chi phí rùa bò 3 ngày" (10/08/2026),
 * cộng BA CA BOT AUDIT TÁI HIỆN ĐƯỢC ở bản vá đầu (và đã sửa):
 *
 *   ① thay file CÙNG CỠ rồi trả lại `mtime` cũ  → bản đầu vẫn trả số cũ
 *   ② sửa kết quả `load()` mà không `save()`     → bản đầu rò sang lượt đọc sau
 *   ③ trần bộ nhớ đếm độ dài chuỗi               → lệch với byte thật
 *
 * Cách sửa: tách hai cửa đọc. `load()` giữ nguyên hành vi gốc (đọc lại mỗi lần) nên
 * mọi chỗ đang dùng không đổi ngữ nghĩa; chỉ `loadShared()` mới có nhớ, và chỉ đường
 * đọc thuần được phép gọi. Dấu vân tay file thêm `ino` + `ctime`. Trần đếm `stat.size`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Nạp lại module với env riêng rồi TRẢ LẠI env như cũ — kể cả biến phụ, tránh rò
// giữa các ca (lỗi này đã làm ca đo tốc độ hỏng oan một lần).
function freshPersist(dir, env = {}) {
  const saved = { AUTH_DATA_DIR: process.env.AUTH_DATA_DIR };
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  process.env.AUTH_DATA_DIR = dir;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  delete require.cache[require.resolve('../src/persist')];
  const mod = require('../src/persist');
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return mod;
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'persist-cache-'));

/* ── HAI CỬA TÁCH BẠCH ────────────────────────────────────────────────────── */

test('load() giữ nguyên hành vi gốc: đọc lại từ đĩa MỖI LẦN, không nhớ gì', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('kho', { a: 1 });
  const first = persist.load('kho', null);
  const second = persist.load('kho', null);
  assert.notEqual(first, second, 'phải là hai đối tượng KHÁC nhau — không dùng chung');
  assert.deepEqual(second, { a: 1 });
  assert.equal(persist.cacheStats().entries, 0, 'load() tuyệt đối không đụng bản nhớ');
});

// ② Ca bot tái hiện được ở bản đầu.
test('② sửa kết quả load() mà không save() KHÔNG được rò sang lượt đọc sau', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('rates', { '2026-07': { employees: { DN001: { rows: [1] } } } });

  const rows = persist.load('rates', {});
  rows['2026-08'] = { employees: { HACKED: { rows: [999] } } }; // sửa mà KHÔNG ghi
  delete rows['2026-07'];

  const again = persist.load('rates', {});
  assert.deepEqual(Object.keys(again), ['2026-07'], 'lượt đọc sau phải sạch, y như trên đĩa');
  assert.equal(again['2026-08'], undefined, 'số bịa không được lọt sang lượt sau');
});

test('loadShared() có nhớ: lượt hai KHÔNG phân tích lại', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('kho', { a: 1 });
  const first = persist.loadShared('kho', null);
  const second = persist.loadShared('kho', null);
  assert.equal(first, second, 'cùng một đối tượng ⇒ không parse lại');
  assert.equal(persist.cacheStats().entries, 1);
});

/* ── BẢN NHỚ KHÔNG BAO GIỜ ĐƯỢC PHỤC VỤ SỐ CŨ ─────────────────────────────── */

// ① Ca bot tái hiện được ở bản đầu: cùng cỡ + trả lại mtime.
test('① thay file CÙNG CỠ rồi TRẢ LẠI mtime cũ vẫn phải đọc lại', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  const p = path.join(dir, 'kho.json');

  fs.writeFileSync(p, JSON.stringify({ v: 'AAAA' }));
  assert.deepEqual(persist.loadShared('kho', null), { v: 'AAAA' });
  const before = fs.statSync(p);

  // Nội dung khác, ĐỘ DÀI Y HỆT, rồi ép mtime về đúng như cũ.
  fs.writeFileSync(p, JSON.stringify({ v: 'BBBB' }));
  fs.utimesSync(p, before.atime, before.mtime);
  const after = fs.statSync(p);
  assert.equal(after.size, before.size, 'ca này chỉ có nghĩa khi cỡ file bằng nhau');
  // `utimes` làm tròn nên không khôi phục được tới từng nano giây — sai số dưới 1ms
  // là đã đủ để bẫy sập một bản nhớ chỉ nhìn `mtime` + `size`.
  assert.ok(Math.abs(after.mtimeMs - before.mtimeMs) <= 1,
    `mtime phải đã bị trả về gần như cũ (lệch ${Math.abs(after.mtimeMs - before.mtimeMs)}ms)`);

  assert.deepEqual(persist.loadShared('kho', null), { v: 'BBBB' },
    'ctime vẫn nhảy khi đặt lại mtime ⇒ bản nhớ phải hết hiệu lực');
});

test('ghi đè bình thường ⇒ đọc lại; xoá file ⇒ về mặc định ngay', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('kho', { v: 'cũ' });
  assert.deepEqual(persist.loadShared('kho', null), { v: 'cũ' });

  fs.writeFileSync(path.join(dir, 'kho.json'), JSON.stringify({ v: 'mới hoàn toàn' }));
  assert.deepEqual(persist.loadShared('kho', null), { v: 'mới hoàn toàn' });

  fs.unlinkSync(path.join(dir, 'kho.json'));
  assert.equal(persist.loadShared('kho', null), null);
  assert.equal(persist.cacheStats().entries, 0);
});

test('file hỏng ⇒ trả mặc định và QUÊN bản cũ, không phục vụ số cũ nữa', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('hong', { ok: 1 });
  assert.deepEqual(persist.loadShared('hong', null), { ok: 1 });
  fs.writeFileSync(path.join(dir, 'hong.json'), '{ đây không phải JSON');
  assert.deepEqual(persist.loadShared('hong', { mac: 'dinh' }), { mac: 'dinh' });
  assert.equal(persist.cacheStats().entries, 0);
});

test('save() xoá bản nhớ — người gọi còn giữ tham chiếu cũng không làm bẩn được', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('kho', { n: 1 });
  const shared = persist.loadShared('kho', null);
  persist.save('kho', { n: 2 });
  shared.n = 999; // người gọi cũ nghịch vào bản đã cũ
  assert.deepEqual(persist.loadShared('kho', null), { n: 2 }, 'phải đọc lại từ đĩa');
});

/* ── TRẦN BỘ NHỚ ─────────────────────────────────────────────────────────── */

// ③ Ca bot nêu: trần phải đếm byte thật của file.
test('③ trần đếm ĐÚNG BYTE của file, không phải độ dài chuỗi', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  // Tiếng Việt có dấu: mỗi chữ 1 đơn vị UTF-16 nhưng 2–3 byte UTF-8.
  persist.save('vn', { ghiChu: 'đơn vị đồng ý nộp phạt kỳ này'.repeat(200) });
  const real = fs.statSync(path.join(dir, 'vn.json')).size;
  persist.loadShared('vn', null);
  assert.equal(persist.cacheStats().bytes, real, `phải khớp cỡ file thật (${real} byte)`);
});

test('vượt trần thì bỏ bản lâu không dùng nhất, và KHÔNG mất dữ liệu', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir, { APP_REPORT_PERSIST_CACHE_BYTES: '4000' });
  const chunk = (n) => ({ pad: 'x'.repeat(n) });
  for (const name of ['a', 'b', 'c', 'd']) persist.save(name, chunk(1200));
  for (const name of ['a', 'b', 'c', 'd']) persist.loadShared(name, null);
  const stats = persist.cacheStats();
  assert.ok(stats.bytes <= stats.maxBytes, `giữ trong trần (${stats.bytes} ≤ ${stats.maxBytes})`);
  assert.ok(stats.entries < 4, 'phải có bản bị bỏ đi');
  assert.deepEqual(persist.loadShared('a', null), chunk(1200), 'bỏ khỏi bộ nhớ ≠ mất dữ liệu');
});

/* ── ĐO THẬT ─────────────────────────────────────────────────────────────── */

test('ĐO THẬT: 21 lượt đọc kho lớn phải nhanh hơn hẳn cách cũ', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  const employees = {};
  for (let i = 1; i <= 21; i += 1) {
    const rows = [];
    for (let r = 0; r < 1400; r += 1) {
      rows.push({ unit: `DV${r}`, product: `QLNB${r}`, c41: 0.012, c43: 0.031, note: 'x'.repeat(60) });
    }
    employees[`DN${String(i).padStart(3, '0')}`] = {
      columns: Array.from({ length: 14 }, (_, k) => ({ key: `c${k}`, label: `cot ${k}` })),
      rows,
    };
  }
  persist.save('rates_big', { '2026-07': { employees }, '2026-08': { employees } });
  const bytes = fs.statSync(path.join(dir, 'rates_big.json')).size;
  assert.ok(bytes > 5 * 1024 * 1024, `file thử phải đủ lớn mới có nghĩa (${bytes} byte)`);

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 21; i += 1) persist.load('rates_big', null);   // cách cũ
  const cũ = Number(process.hrtime.bigint() - t0) / 1e6;

  persist.invalidate();
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 21; i += 1) persist.loadShared('rates_big', null); // cách mới
  const mới = Number(process.hrtime.bigint() - t1) / 1e6;

  assert.ok(mới * 3 < cũ, `phải nhanh hơn ít nhất 3 lần (cũ ${cũ.toFixed(0)}ms → mới ${mới.toFixed(0)}ms)`);
});

/* ── ĐƯỜNG NÓNG THẬT SỰ ──────────────────────────────────────────────────── */

test('readLocalSync dùng bản nhớ, và KHÔNG giao mảng dùng chung ra ngoài', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  const snapshot = require('../src/employeeCostRateSnapshot');
  persist.save('cost_rates_local', {
    '2026-07': {
      period: '2026-07',
      fetchedAt: '2026-08-10T02:17:00.000Z',
      employees: {
        DN001: { columns: [{ key: 'c41' }], rows: [{ unit: 'DV1', c41: 0.01 }, { unit: 'DV2', c41: 0.02 }] },
      },
    },
  });

  const a = snapshot.readLocalSync('DN001', '2026-07', { store: persist });
  assert.equal(a.payload.rows.length, 2);
  assert.ok(persist.cacheStats().entries >= 1, 'đường nóng phải đi qua bản nhớ');

  // Tầng trên sắp xếp/cắt trang tại chỗ — không được chạm vào bản gốc trong bộ nhớ.
  a.payload.rows.reverse();
  a.payload.rows.pop();
  a.payload.columns.length = 0;

  const b = snapshot.readLocalSync('DN001', '2026-07', { store: persist });
  assert.equal(b.payload.rows.length, 2, 'kho trong bộ nhớ phải còn nguyên 2 dòng');
  assert.equal(b.payload.columns.length, 1, 'và còn nguyên cột');
  assert.equal(b.payload.rows[0].unit, 'DV1', 'và đúng thứ tự cũ');
});
