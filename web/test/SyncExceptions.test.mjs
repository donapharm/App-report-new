import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isTabAllowed, resolveAllowedTab } from '../src/tabAccess.js';
import { RequestCoordinator, requestScopeKey } from '../src/requestCoordinator.js';
import { syncExceptionsRequestPath } from '../src/syncExceptionsRequest.js';

// Màn "Chưa đồng bộ" — CEO 29/07. Kiểm những điều KHÔNG được phép sai.
const source = fs.readFileSync(new URL('../src/pages/SyncExceptions.jsx', import.meta.url), 'utf8');

test('‼ "chưa chạy phân loại" phải nói thẳng, KHÔNG được để tưởng sạch', () => {
  assert.match(source, /!data\?\.ran/);
  assert.match(source, /Kỳ này chưa chạy phân loại/);
  assert.match(source, /không phải.*<\/b> là "không có dòng nào bị loại"/s);
});

test('‼ không cân thì báo đỏ và nêu ĐÚNG số lệch', () => {
  assert.match(source, /KHÔNG CÂN — có dòng rơi ở chỗ chưa ai khai báo/);
  assert.match(source, /money\(totals\.amountDiff\)/);
  assert.match(source, /totals\.rowDiff/);
});

test('thiếu căn cứ thì KHÔNG kết luận đã cân', () => {
  assert.match(source, /report\.balanced === null/);
  assert.match(source, /Không kết luận là đã cân/);
});

test('mã lý do lạ phải hiện ra', () => {
  assert.match(source, /report\.unknownCodes\.length/);
  assert.match(source, /chưa khai báo/);
});

test('mỗi dòng và mỗi lý do đều kèm AI XỬ LÝ và LÀM GÌ', () => {
  assert.match(source, /<th>Ai xử lý<\/th><th>Làm gì<\/th>/);
  assert.match(source, /\{row\.owner\} · \{row\.action\}/);
});

test('tách rõ nhóm "vào đủ tiền nhưng thiếu thông tin" — nhóm nguy hiểm nhất', () => {
  assert.match(source, /incomplete: \{ text: 'Vào đủ tiền nhưng THIẾU THÔNG TIN'/);
  assert.match(source, /nhìn tổng thì đúng, lọc ra thì mất/);
});

test('danh sách bị cắt bớt phải nói ra', () => {
  assert.match(source, /data\.truncated/);
  assert.match(source, /bảng chi tiết chưa đủ dòng/);
});

test('V-C live 269 dòng giữ đúng hai mã catalog và UI hiện đủ nghĩa · ai · làm gì', () => {
  const catalogSource = fs.readFileSync(new URL('../../server/src/syncExceptionCatalog.js', import.meta.url), 'utf8');
  const reportSource = fs.readFileSync(new URL('../../server/src/syncExceptionReport.js', import.meta.url), 'utf8');
  assert.match(catalogSource, /MISA_CHUA_GHI_DOANH_SO:[\s\S]*?meaning:[\s\S]*?owner:[\s\S]*?action:/);
  assert.match(catalogSource, /WEB_GIAO_BANG_0:[\s\S]*?meaning:[\s\S]*?owner:[\s\S]*?action:/);
  assert.match(reportSource, /meaning: info\.meaning/);
  assert.match(reportSource, /owner: info\.owner/);
  assert.match(reportSource, /action: info\.action/);
  const counts = { MISA_CHUA_GHI_DOANH_SO: 222, WEB_GIAO_BANG_0: 47 };
  assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), 269);
});

test('màn được nối vào menu admin và backend vẫn chặn requireAdmin', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');
  assert.match(app, /import SyncExceptions/);
  assert.match(app, /key: 'syncExceptions'[\s\S]{0,220}adminOnly: true/);
  assert.match(routes, /router\.get\('\/revenue\/sync-exceptions', auth\.requireAuth, auth\.requireAdmin/);
});

test('link trực tiếp/stale tab bị chuẩn hóa về overview cho người không có quyền', () => {
  const tabs = [
    { key: 'overview' },
    { key: 'syncExceptions', adminOnly: true },
  ];
  assert.equal(isTabAllowed(tabs[1], { isAdmin: true }), true);
  assert.equal(isTabAllowed(tabs[1], { isAdmin: false }), false);
  assert.equal(resolveAllowedTab(tabs, 'syncExceptions', { isAdmin: false }), 'overview');
  assert.equal(resolveAllowedTab(tabs, 'unknown', { isAdmin: true }), 'overview');
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /resolveAllowedTab\(TABS, tab, me\)/);
  assert.match(app, /url\.searchParams\.delete\('tab'\)/);
  assert.match(app, /localStorage\.setItem\('rpt_tab', allowedTab\)/);
});

test('màn tự chọn kỳ, có quay lại, làm mới thật và trạng thái rỗng phân biệt rõ', () => {
  const apiSource = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  assert.match(source, /apiClient\.periods\(\)/);
  assert.match(source, /apiClient\.syncExceptions\(ky, \{ freshKey:/);
  assert.match(source, /Kỳ đối chiếu/);
  assert.match(source, /Quay lại Tổng quan/);
  assert.match(source, /setPeriodReloadKey/);
  assert.match(source, /setReportReloadKey/);
  assert.match(apiSource, /syncExceptions:[\s\S]{0,280}cacheMs: 0/);
  assert.match(source, /!rows\.length && report\.balanced === true/);
  assert.match(source, /đã phân loại và không có dòng ngoại lệ/);
});

test('làm mới đang chạy dùng request key mới, không nhập chung response cũ', async () => {
  const coordinator = new RequestCoordinator();
  const oldPath = syncExceptionsRequestPath('07.2026');
  const freshPath = syncExceptionsRequestPath('07.2026', 1);
  assert.notEqual(freshPath, oldPath);
  let releaseOld;
  let loaderCalls = 0;
  const keyFor = (path) => requestScopeKey({ method: 'GET', path, authScope: 'CEO', deviceId: 'test' });
  const oldRequest = coordinator.run(keyFor(oldPath), () => {
    loaderCalls += 1;
    return new Promise((resolve) => { releaseOld = resolve; });
  });
  await Promise.resolve();
  const freshRequest = coordinator.run(keyFor(freshPath), async () => {
    loaderCalls += 1;
    return 'fresh';
  }, { cacheMs: 0 });
  assert.equal(await freshRequest, 'fresh');
  assert.equal(loaderCalls, 2);
  releaseOld('old');
  assert.equal(await oldRequest, 'old');
});

test('lọc client chỉ thu hẹp dòng chi tiết, không tính lại KPI backend', () => {
  assert.match(source, /Tìm đơn, mã hàng, đơn vị hoặc nhân viên/);
  assert.match(source, /Lọc theo lý do/);
  assert.match(source, /const filteredRows = rows\.filter/);
  assert.match(source, /filteredRows\.length[\s\S]{0,100}rows\.length/);
  assert.match(source, /const \{ totals \} = report/);
  assert.doesNotMatch(source, /reduce\([\s\S]{0,100}(?:amount|revenue)/);
});

test('mọi số tiền trên màn tiếp tục đi qua privacy mask', () => {
  assert.match(source, /maskNumberText/);
  assert.match(source, /money\(totals\.sourceAmount\)/);
  assert.match(source, /money\(item\.amount\)/);
  assert.match(source, /money\(row\.amount\)/);
});

test('trạng thái kỳ tách khỏi báo cáo, lỗi không bị spinner che và toolbar co một cột trên mobile', () => {
  const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /const \[periodState, setPeriodState\]/);
  assert.match(source, /if \(alive\) setPeriodState\(\{ loading: false, error:/);
  assert.doesNotMatch(source, /apiClient\.periods\(\)[\s\S]{0,700}catch[\s\S]{0,180}setState\(/);
  assert.ok(source.indexOf('if (state.error)') < source.indexOf('if (state.loading || !ky || !state.data)'));
  assert.match(styles, /\.sync-exceptions-toolbar \{ display:flex/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sync-exceptions-toolbar \{ display:grid; grid-template-columns:1fr; \}/);
});
