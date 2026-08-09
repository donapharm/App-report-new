/**
 * Nút "Đồng bộ lại" danh mục từ Data Hub (CEO yêu cầu 09/08/2026).
 * Snapshot được nhớ tạm 2 phút; nút này vứt bản nhớ tạm rồi hỏi lại nguồn ngay.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalogManagement = require('../src/catalogManagement');

const routes = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
const block = routes.slice(
  routes.indexOf("router.post('/catalog-management/refresh'"),
  routes.indexOf('/* ---------- Phân quyền cột % chi phí'),
);

test('invalidateSnapshot nhận cả hai cách viết kỳ và báo lại kỳ đã chuẩn hoá', () => {
  assert.deepEqual(catalogManagement.invalidateSnapshot('07.2026').period, '2026-07');
  assert.deepEqual(catalogManagement.invalidateSnapshot('2026-07').period, '2026-07');
  assert.throws(() => catalogManagement.invalidateSnapshot('7/2026'), /Kỳ phải/);
});

test('kỳ chưa từng nhớ thì xoá là chuyện bình thường, không nổ lỗi', () => {
  const result = catalogManagement.invalidateSnapshot('2019-01');
  assert.equal(result.had, false);
});

test('‼ CHỈ xoá bộ nhớ tạm trong tiến trình — KHÔNG được đụng bản LKG trên đĩa', () => {
  // Mất LKG là Data Hub chết kéo theo màn danh mục trắng, đúng thứ LKG sinh ra để chặn.
  const source = fs.readFileSync(path.join(__dirname, '../src/catalogManagement.js'), 'utf8');
  const fn = source.slice(source.indexOf('function invalidateSnapshot'), source.indexOf('async function getSnapshot'));
  assert.match(fn, /snapshotCache\.delete\(period\)/);
  for (const forbidden of ['unlink', 'rm(', 'rmSync', 'writeCacheAtomic', 'CACHE_FILE']) {
    assert.equal(fn.includes(forbidden), false, `invalidateSnapshot không được gọi ${forbidden}`);
  }
});

test('endpoint chặn ở backend bằng requireAdmin, không tin vào việc ẩn nút', () => {
  const line = routes.slice(routes.indexOf("router.post('/catalog-management/refresh'"));
  assert.match(line.slice(0, line.indexOf('\n')), /auth\.requireAuth, auth\.requireAdmin/);
});

test('có khoảng nghỉ để một người bấm liên tục không thành đòn nện vào Data Hub', () => {
  assert.match(block, /CATALOG_REFRESH_COOLDOWN_MS/);
  assert.match(block, /res\.status\(429\)/);
  // Báo còn phải chờ bao lâu, không chỉ nói "thử lại sau".
  assert.match(block, /chờ thêm \$\{seconds\} giây/);
});

test('bảng đếm thời điểm bấm không phình vô hạn theo kỳ người dùng gõ', () => {
  assert.match(block, /while \(catalogRefreshLastAt\.size > 12\) catalogRefreshLastAt\.delete/);
});

test('trả nguyên meta — Data Hub chết thì màn hình PHẢI thấy stale, không được che', () => {
  assert.match(block, /meta: snapshot\.meta/);
  // Không tự đặt stale:false hay bịa version cho "đẹp".
  assert.equal(block.includes('stale: false'), false);
  assert.equal(/version:\s*'/.test(block), false);
});

test('xoá bộ nhớ tạm TRƯỚC khi đọc lại, nếu không thì bấm nút chỉ trả lại bản cũ', () => {
  const invalidateAt = block.indexOf('catalogManagement.invalidateSnapshot(period)');
  const getAt = block.indexOf('catalogManagement.getSnapshot(period)');
  assert.ok(invalidateAt > 0 && getAt > invalidateAt, 'invalidateSnapshot phải chạy trước getSnapshot');
});
