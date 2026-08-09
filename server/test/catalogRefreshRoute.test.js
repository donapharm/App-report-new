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
  const getAt = block.indexOf('catalogManagement.getSnapshot(period, { forceRemote: true })');
  assert.ok(invalidateAt > 0 && getAt > invalidateAt, 'invalidateSnapshot phải chạy trước getSnapshot');
});

/* ── ĐỌC BẢN TRÊN MÁY TRƯỚC — không gọi DataHub mỗi lần mở màn (CEO 09/08) ──────
 * CEO: "danh mục đã kéo về hẳn bên App Report rồi, sao mỗi lần refresh nó cứ báo
 * đang đồng bộ và gọi từ DataHub — tao nghĩ mày đang thiết kế sai." Đúng: bản cũ
 * remote-first, LKG chỉ là dự phòng lúc hỏng. Nay local-first, remote chỉ khi
 * forceRemote (nút Đồng bộ lại) hoặc máy chưa có kỳ đó.                        */

const cmSource = fs.readFileSync(path.join(__dirname, '../src/catalogManagement.js'), 'utf8');

test('‼ loadSnapshot đọc LKG TRƯỚC khi nghĩ đến DataHub (trừ khi forceRemote)', () => {
  const fn = cmSource.slice(cmSource.indexOf('async function loadSnapshot'), cmSource.indexOf('function invalidateSnapshot'));
  const localFirst = fn.indexOf('if (!forceRemote)');
  const remoteCall = fn.indexOf('await remoteSnapshot(period)');
  assert.ok(localFirst >= 0, 'phải có nhánh local-first');
  assert.ok(remoteCall > localFirst, 'đọc local phải ĐỨNG TRƯỚC lệnh gọi DataHub');
  // Bản local là bản sao y thường ngày — không được dán nhãn stale/readOnly oan.
  assert.match(fn, /source: 'data-hub-local', servedFrom: 'local'/);
});

test('nút "Đồng bộ lại" là chỗ duy nhất forceRemote — đúng nghĩa cái nút', () => {
  assert.match(block, /getSnapshot\(period, \{ forceRemote: true \}\)/);
  // Các đường đọc khác không được lén forceRemote.
  const others = routes.replace(block, '');
  assert.equal(/forceRemote: true/.test(others), false, 'ngoài nút Đồng bộ lại không ai được ép gọi DataHub');
});

/* Test cũ ở đây đòi PHẢI CÓ lượt làm tươi ngầm (có tiết chế). Bot chặn Gate 1 đúng:
   đường đọc không được có tác dụng phụ, dù có tiết chế đi nữa. Luật mới nằm ở test
   "ĐƯỜNG ĐỌC KHÔNG CÓ TÁC DỤNG PHỤ" phía dưới — cấm hẳn, không còn tiết chế nữa. */

test('bảng "đơn vị → nhóm" nói ra khi bị cắt trần, không để phần đuôi "0 nhóm" oan', () => {
  const at = routes.indexOf("router.post('/catalog-management/cost-columns/unit-groups'");
  const body = routes.slice(at, at + 1600);
  assert.match(body, /const truncated = distinct\.length > units\.length/);
  assert.match(body, /truncated, total: distinct\.length, resolved: units\.length/);
});

test('‼ ĐƯỜNG ĐỌC KHÔNG CÓ TÁC DỤNG PHỤ: GET không được lén gọi DataHub/ghi cache', () => {
  // Bot chặn Gate 1 đúng (09/08): "GET thường đang âm thầm kéo DataHub và ghi cache
  // nền". CEO bảo đừng gọi DataHub khi xem — gọi ngầm vẫn là gọi, chỉ khác là không
  // ai thấy; mà DataHub từng tự restart vì bị đọc dồn.
  assert.equal(cmSource.includes('scheduleBackgroundRefresh'), false, 'không được có lượt làm tươi ngầm');
  assert.equal(cmSource.includes('CATALOG_BACKGROUND_REFRESH_MS'), false);
  const fn = cmSource.slice(cmSource.indexOf('async function loadSnapshot'), cmSource.indexOf('function invalidateSnapshot'));
  const localBranch = fn.slice(fn.indexOf('if (!forceRemote)'), fn.indexOf('if (!configured())'));
  assert.equal(localBranch.includes('remoteSnapshot'), false, 'nhánh đọc bản local tuyệt đối không gọi nguồn');
});
