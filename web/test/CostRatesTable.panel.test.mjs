import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('bảng % đọc từ KHO CỤC BỘ — route table không gọi getForSession/DataHub', () => {
  const at = routes.indexOf("router.get('/catalog-management/cost-rates/table'");
  assert.ok(at >= 0);
  const body = routes.slice(at, routes.indexOf("router.get('/catalog-management/cost-rates/table.xlsx'", at));
  assert.match(body, /costRatesTable\.buildTable/);
  assert.doesNotMatch(body, /getForSession|fetchRawEmployeeCost/, 'bảng phải sống được khi DataHub chết');
});

test('mũi dò chạy nhân tiện trong local-status — không dựng scheduler mới', () => {
  const at = routes.indexOf("router.get('/catalog-management/cost-rates/local-status'");
  const body = routes.slice(at, routes.indexOf('}));', at));
  assert.match(body, /costRatesTable\.probeSource/);
  assert.match(body, /tự giãn|≥30 phút/);
});

test('panel nói thật hai trạng thái đặc biệt: chưa đồng bộ · chưa được cấp cột', () => {
  assert.match(page, /CHUA_DONG_BO/);
  assert.match(page, /chưa được cấp cột % nào/);
  assert.match(page, /Đồng bộ % chi phí" một lần khi DataHub đang sống|bấm "Đồng bộ % chi phí"/);
});

test('mỗi bảng đều mang căn cước bản số: đồng bộ lúc nào, bởi ai', () => {
  assert.match(page, /Bản đồng bộ <b>\{formatDateTime\(data\.fetchedAt\)\}<\/b> bởi <b>\{data\.fetchedBy\}<\/b>/);
  const xlsxAt = routes.indexOf('BẢNG % CHI PHÍ KỲ');
  assert.ok(xlsxAt >= 0, 'file Excel phải có dòng căn cước');
  assert.match(routes.slice(xlsxAt, xlsxAt + 200), /đồng bộ \$\{result\.fetchedAt\} bởi \$\{result\.fetchedBy\}/);
});

test('ô % dùng CostRateCell ⇒ đi qua rèm che; export qua backend theo quyền người tải', () => {
  const panelAt = page.indexOf('function CostRatesTablePanel');
  const panel = page.slice(panelAt, page.indexOf('function CostRatesSyncCard'));
  assert.match(panel, /<CostRateCell key=\{column\.key\} value=\{row\.rates\[column\.key\]\} \/>/);
  assert.match(api, /downloadCostRatesTable/);
  const xlsxLine = routes.slice(routes.indexOf("router.get('/catalog-management/cost-rates/table.xlsx'"));
  assert.match(xlsxLine.slice(0, 120), /auth\.requireAuth/);
});

test('bảng hiện tối đa 300 dòng + chỉ đường lấy đủ — không âm thầm cắt', () => {
  assert.match(page, /rows\.slice\(0, 300\)/);
  assert.match(page, /Hiện 300\/\{rows\.length/);
});

test('hai NV trùng đơn vị × sản phẩm vẫn có React key riêng theo employeeCode', () => {
  assert.match(page, /key=\{`\$\{row\.employeeCode\}\|\$\{row\.unitCode\}\|\$\{row\.productCode\}`\}/);
  assert.doesNotMatch(page, /key=\{`\$\{row\.unitCode\}\|\$\{row\.productCode\}`\}/,
    'key thiếu employeeCode sẽ làm hai dòng CEO va nhau khi cùng cặp');
});
