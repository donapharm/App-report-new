/**
 * Huy hiệu nguồn danh mục: SỐ HIỆU BẢN + NGÀY hiện thẳng ra mặt, kèm nút đồng bộ lại.
 * CEO 09/08/2026: "chỗ 'Data Hub đã kết nối' thêm vào đó bản Version bao nhiêu, kèm
 * ngày tháng năm… để nhìn vào biết ngay" + "có thêm nút nhấn đồng bộ lại từ app datahub".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');
const badge = page.slice(page.indexOf('function SourceStatus'), page.indexOf('function CatalogSearch'));
// Vài luật dưới đây soi thứ CHẠY THẬT, nên phải bỏ chú thích trước khi soi — bản thân
// chú thích có quyền nhắc "V31.4" hay tên cách viết cũ để giải thích vì sao cấm.
const codeOnly = page
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

/* ── Số hiệu bản ─────────────────────────────────────────────────────────────── */

test('version hiện RA MẶT huy hiệu, không chỉ nằm trong tooltip', () => {
  // Bản cũ chỉ có `title={... Version ...}`: phải rê chuột mới thấy, điện thoại chịu.
  // Nay số hiện ra mặt là `sourceVersion || gateVersion` (xem test hai-hệ-đánh-số).
  assert.match(badge, /const gateVersion = catalogVersionLabel\(meta\.version\)/);
  assert.match(badge, /const version = sourceVersion \|\| gateVersion/);
  assert.match(badge, /className=\{`catalog-source-version\$\{sourceVersion \? '' : ' is-gate'\}`\}/);
});

test('Data Hub không gửi version thì NÓI "chưa rõ" — cấm bịa số hiệu bản', () => {
  // remoteSnapshot điền 'unknown' khi payload thiếu version. Suy ra một số cho đẹp
  // màn hình là dựng số liệu giả, đúng thứ đã gây nghi ngờ mất dữ liệu hôm 09/08.
  assert.match(badge, /is-unknown[^>]*>bản: chưa rõ</);
  assert.match(page, /CATALOG_VERSION_UNKNOWN = new Set\(\['', 'unknown', 'null', 'undefined', 'n\/a', '—', '-'\]\)/);
  assert.doesNotMatch(codeOnly, /V3\d\.\d/, 'không được viết cứng số hiệu bản nào vào code');
});

test('chuẩn hoá số hiệu: "31.4" → V31.4, "v31.4" → V31.4, dạng lạ giữ nguyên', () => {
  const at = page.indexOf('function catalogVersionLabel');
  const fn = page.slice(at, page.indexOf('\n}', at));
  assert.match(fn, /if \(\/\^\\d\+\(\\\.\\d\+\)\*\$\/\.test\(value\)\) return `V\$\{value\}`;/);
  assert.match(fn, /if \(\/\^v\\d\/i\.test\(value\)\) return `V\$\{value\.slice\(1\)\}`;/);
  assert.match(fn, /return value;/);
});

test('ngày tháng năm đi kèm — và phân biệt "bản ngày nào" với "kéo về lúc nào"', () => {
  assert.match(badge, /bản ngày \{dateText\(meta\.updatedAt\)\}/);
  assert.match(badge, /Kéo về máy: \{dateText\(meta\.lastSyncAt\)\}/);
});

test('‼ ngày giờ theo GMT+7, KHÔNG theo múi giờ máy người dùng', () => {
  // Bản cũ: new Date(iso).toLocaleString('vi-VN') → lấy múi giờ MÁY.
  assert.match(page, /const dateText = \(iso\) => formatDateTime\(iso, 'Chưa đồng bộ'\)/);
  // Chỉ cấm với NGÀY GIỜ; số lượng/tiền dùng toLocaleString('vi-VN') là đúng.
  assert.doesNotMatch(codeOnly, /new Date\([^)]*\)\.toLocaleString/);
});

test('nguồn đang là bản tốt gần nhất thì nói thẳng, không đề "Đã kết nối"', () => {
  assert.match(badge, /meta\.stale \? 'Bản tốt gần nhất'/);
});

/* ── Nút đồng bộ lại ─────────────────────────────────────────────────────────── */

test('nút "Đồng bộ lại" có trên huy hiệu, khoá lại khi đang chạy', () => {
  assert.match(badge, /catalog-source-refresh/);
  assert.match(badge, /disabled=\{busy\}/);
  assert.match(badge, /busy \? 'Đang hỏi lại…' : '⟳ Đồng bộ lại'/);
});

test('bấm xong PHẢI tải lại danh mục, không chỉ đổi mỗi huy hiệu', () => {
  assert.match(page, /const result = await api\.catalogManagementRefresh\(uiToHub\(period\)\);/);
  assert.match(page, /await load\(period, \{ fresh: true \}\);/);
  // Bấm "Đồng bộ lại" phải BỎ bản nhớ trong phiên, nếu không vẫn thấy bản cũ.
  assert.match(page, /catalogSessionCache\.delete\(uiToHub\(period\)\)/);
  // Gọi refresh trước, tải lại sau — đổi thứ tự là bảng vẫn là bản cũ.
  const at = page.indexOf('catalogManagementRefresh(uiToHub(period))');
  assert.ok(at > 0 && page.indexOf('await load(period, { fresh: true });', at) > at);
});

test('đồng bộ lại hỏng thì báo tại chỗ, không nuốt lỗi', () => {
  assert.match(badge, /catch \(e\) \{ setError\(e\.message \|\| 'Đồng bộ lại không thành công'\); \}/);
  assert.match(badge, /catalog-source-error/);
});

test('nút chỉ hiện với admin/CEO — và backend chặn độc lập bằng requireAdmin', () => {
  assert.match(page, /canRefresh=\{isAdmin\}/);
  assert.match(badge, /\{canRefresh && <button/);
  const at = routes.indexOf("router.post('/catalog-management/refresh'");
  assert.ok(at > 0, 'phải có endpoint /catalog-management/refresh');
  assert.match(routes.slice(at, routes.indexOf('\n', at)), /auth\.requireAuth, auth\.requireAdmin/);
});

test('client API trỏ đúng endpoint đồng bộ lại', () => {
  assert.match(api, /catalogManagementRefresh: \(period\) => req\('POST', '\/catalog-management\/refresh'/);
});

/* ── Trình bày ───────────────────────────────────────────────────────────────── */

test('trên điện thoại vẫn thấy số hiệu bản — chỉ giấu dòng "kéo về máy"', () => {
  // Luật cũ ẩn nguyên dòng <b> trên mobile, làm mất luôn số hiệu bản mới thêm.
  assert.doesNotMatch(css, /\.catalog-source-inline b \{ display:none; \}/);
  assert.match(css, /\.catalog-source-inline \.catalog-source-sync \{ display:none; \}/);
});

test('nhãn version có màu riêng cho bản cũ, và kiểu nhạt cho "chưa rõ"', () => {
  assert.match(css, /\.catalog-source-inline\.is-stale \.catalog-source-version/);
  assert.match(css, /\.catalog-source-version\.is-unknown/);
});

/* ── HAI HỆ ĐÁNH SỐ: "V3.10" (cửa danh mục) ≠ "V31.4" (file CP_TOTAL) ─────────
 * CEO hỏi đi hỏi lại vì huy hiệu ghi V3.10 trong khi file nguồn đã là V31.4.
 * App Report chép nguyên số nguồn gửi và KHÔNG BAO GIỜ tự đặt số — nhưng phải
 * NÓI RÕ con số đang hiện là số của cái gì, nếu không người đọc tự suy sai.   */

test('có sourceVersion thì hiện SỐ FILE NGUỒN; không có thì hiện số CỬA + gắn nhãn "(cửa)"', () => {
  assert.match(page, /const sourceVersion = catalogVersionLabel\(meta\.sourceVersion\)/);
  assert.match(page, /const gateVersion = catalogVersionLabel\(meta\.version\)/);
  assert.match(page, /const version = sourceVersion \|\| gateVersion/);
  assert.match(page, /\{version\}\{sourceVersion \? '' : ' \(cửa\)'\}/);
});

test('‼ nói thẳng số cửa KHÔNG phải số file CP_TOTAL — không để người đọc tự suy', () => {
  assert.match(page, /là số hiệu CỬA DANH MỤC của Data Hub, KHÔNG phải số hiệu file CP_TOTAL/);
  assert.match(page, /Data Hub CHƯA gửi số hiệu file CP_TOTAL/);
});

test('backend chuyển tiếp sourceVersion nếu nguồn gửi, KHÔNG tự bịa số', () => {
  const server = fs.readFileSync(new URL('../../server/src/catalogManagement.js', import.meta.url), 'utf8');
  assert.match(server, /payload\.sourceVersion \|\| payload\.source_version/);
  assert.match(server, /meta: \{ source: 'data-hub', version, sourceVersion,/);
  // Không có chỗ nào gán cứng một số hiệu.
  assert.doesNotMatch(server, /sourceVersion = '31\.4'|version = '31\.4'/);
});

/* ── Bấm "Đồng bộ lại" phải nói NỘI DUNG CÓ ĐỔI KHÔNG (CEO chỉnh 09/08/2026) ─── */

test('‼ nội dung KHÔNG đổi ⇒ nói thẳng "bản sửa CHƯA sang tới đây", chỉ đúng việc phải làm', () => {
  // Đây là câu trả lời cho đúng nỗi nghi của CEO: đã sửa file mà app vẫn số cũ.
  assert.match(badge, /NỘI DUNG KHÔNG ĐỔI<\/b> \(băm nội dung y hệt bản cũ\)/);
  assert.match(badge, /<b>bản sửa CHƯA sang tới đây<\/b>/);
  assert.match(badge, /báo Data Hub nạp lại file nguồn/);
  assert.match(badge, /bấm nút này thêm lần nữa cũng ra kết quả này/);
});

test('nội dung CÓ đổi mà số dòng y nguyên vẫn phải nói rõ — không im lặng', () => {
  assert.match(badge, /NỘI DUNG CÓ ĐỔI<\/b>/);
  assert.match(badge, /số dòng như cũ, nội dung bên trong khác/);
});

test('‼ chưa có bản cũ để so ⇒ NÓI KHÔNG BIẾT, cấm suy thành "không đổi"', () => {
  assert.match(badge, /máy chưa có bản cũ để so/);
  assert.match(badge, /refreshed\.changed === false/);
  assert.match(badge, /refreshed\.changed === true/);
});

test('nút trả kết quả về cho huy hiệu hiển thị — không nuốt mất', () => {
  assert.match(page, /return result; \/\/ huy hiệu cần kết quả này để nói nội dung có đổi không/);
  assert.match(badge, /setRefreshed\(await onRefresh\?\.\(\) \?\? null\)/);
});
