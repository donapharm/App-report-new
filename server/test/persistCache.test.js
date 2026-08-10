'use strict';
/**
 * BẢN NHỚ CỦA persist.js — gốc rễ vụ "màn Chi phí rùa bò 3 ngày" (10/08/2026).
 *
 * `load()` cũ đọc đĩa + `JSON.parse` NGUYÊN FILE mỗi lần gọi. `readLocalSync` gọi nó
 * một lần cho MỖI nhân viên ⇒ màn "Tất cả nhân viên" (21 người) phân tích lại file
 * 17,9 MB hai mươi mốt lần, ĐỒNG BỘ, khoá cứng vòng lặp sự kiện ⇒ hết hạn 25 giây
 * sau ~5 người ⇒ 16 người bị đóng dấu "Chưa lấy kịp trong hạn".
 *
 * Bộ test này khoá lại: nhớ đúng, đọc lại khi file đổi, và không bao giờ trả số cũ.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Nạp lại module với env riêng, rồi TRẢ LẠI env như cũ — kể cả các biến phụ.
// (Lần đầu viết chỉ trả lại AUTH_DATA_DIR nên trần bộ nhớ của ca này rò sang ca sau
//  và làm ca đo tốc độ hỏng oan. Rò env giữa các ca là lỗi kinh điển của test.)
function freshPersist(dir, env = {}) {
  const saved = { AUTH_DATA_DIR: process.env.AUTH_DATA_DIR };
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  process.env.AUTH_DATA_DIR = dir;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  delete require.cache[require.resolve('../src/persist')];
  const mod = require('../src/persist');
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return mod;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'persist-cache-'));
}

test('đọc lần hai KHÔNG phân tích lại — trả đúng bản đã nhớ', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('kho', { a: 1 });

  const first = persist.load('kho', null);
  const second = persist.load('kho', null);
  assert.equal(first, second, 'phải là CÙNG một đối tượng ⇒ không parse lại');
  assert.deepEqual(second, { a: 1 });
  assert.equal(persist.cacheStats().entries, 1);
});

test('file đổi trên đĩa ⇒ PHẢI đọc lại, tuyệt đối không trả số cũ', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('kho', { v: 'cũ' });
  assert.deepEqual(persist.load('kho', null), { v: 'cũ' });

  // Tiến trình khác ghi đè (đổi cả nội dung lẫn cỡ file).
  fs.writeFileSync(path.join(dir, 'kho.json'), JSON.stringify({ v: 'mới hoàn toàn' }));
  const future = Date.now() / 1000 + 5;
  fs.utimesSync(path.join(dir, 'kho.json'), future, future);

  assert.deepEqual(persist.load('kho', null), { v: 'mới hoàn toàn' }, 'số cũ mà còn trả ra là hỏng cả app');
});

test('lối dùng quen thuộc "đọc → sửa → ghi" vẫn đúng sau khi có bản nhớ', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('rates', { '2026-07': { employees: { DN001: { rows: [1] } } } });

  const rows = persist.load('rates', {});
  rows['2026-08'] = { employees: { DN002: { rows: [2] } } };
  persist.save('rates', rows);

  // Đọc lại từ ĐĨA (bỏ bản nhớ) phải thấy đủ cả hai kỳ.
  persist.invalidate();
  assert.deepEqual(Object.keys(persist.load('rates', {})).sort(), ['2026-07', '2026-08']);
});

test('file không tồn tại / hỏng ⇒ trả mặc định, không giữ bản nhớ sai', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  assert.deepEqual(persist.load('chua-co', { mac: 'dinh' }), { mac: 'dinh' });
  assert.equal(persist.cacheStats().entries, 0, 'không nhớ thứ không đọc được');

  persist.save('hong', { ok: 1 });
  assert.deepEqual(persist.load('hong', null), { ok: 1 });
  fs.writeFileSync(path.join(dir, 'hong.json'), '{ đây không phải JSON');
  const future = Date.now() / 1000 + 5;
  fs.utimesSync(path.join(dir, 'hong.json'), future, future);
  assert.deepEqual(persist.load('hong', { mac: 'dinh' }), { mac: 'dinh' }, 'hỏng thì trả mặc định');
  assert.equal(persist.cacheStats().entries, 0, 'và PHẢI quên bản cũ, không phục vụ số cũ nữa');
});

test('xoá file ⇒ quay về mặc định ngay, không phục vụ bản nhớ', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  persist.save('tam', { x: 1 });
  assert.deepEqual(persist.load('tam', null), { x: 1 });
  fs.unlinkSync(path.join(dir, 'tam.json'));
  assert.equal(persist.load('tam', null), null);
  assert.equal(persist.cacheStats().entries, 0);
});

test('có trần bộ nhớ: vượt thì bỏ bản lâu không dùng nhất', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir, { APP_REPORT_PERSIST_CACHE_BYTES: '4000' });
  const chunk = (n) => ({ pad: 'x'.repeat(n) });
  persist.save('a', chunk(1200));
  persist.save('b', chunk(1200));
  persist.save('c', chunk(1200));
  persist.save('d', chunk(1200));
  const stats = persist.cacheStats();
  assert.ok(stats.bytes <= stats.maxBytes, `giữ trong trần (${stats.bytes} ≤ ${stats.maxBytes})`);
  assert.ok(stats.entries < 4, 'phải có bản bị bỏ đi');
  // Bỏ khỏi bộ nhớ KHÔNG được làm mất dữ liệu: đọc lại từ đĩa vẫn đúng.
  assert.deepEqual(persist.load('a', null), chunk(1200));
});

test('ĐO THẬT: 21 lượt đọc file lớn phải nhanh hơn hẳn cách cũ', () => {
  const dir = tmpDir();
  const persist = freshPersist(dir);
  // Dựng kho tỷ lệ cỡ thật: 21 NV × 1.400 dòng.
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
  assert.ok(bytes > 5 * 1024 * 1024, `file thử phải đủ lớn mới có ý nghĩa (${bytes} byte)`);

  // Cách cũ: mỗi NV một lượt đọc+parse nguyên file.
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 21; i += 1) JSON.parse(fs.readFileSync(path.join(dir, 'rates_big.json'), 'utf8'));
  const cũ = Number(process.hrtime.bigint() - t0) / 1e6;

  // Cách mới: 21 lượt qua load(), chỉ lượt đầu chạm đĩa.
  persist.invalidate();
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 21; i += 1) persist.load('rates_big', null);
  const mới = Number(process.hrtime.bigint() - t1) / 1e6;

  assert.ok(mới * 3 < cũ, `phải nhanh hơn ít nhất 3 lần (cũ ${cũ.toFixed(0)}ms → mới ${mới.toFixed(0)}ms)`);
});
