/**
 * Trang "Tổng hợp chi phí C33–C46" (CEO 09/08/2026) — con mắt che số + bộ lọc 6
 * chiều + C44 nêu rõ + xuất Excel theo đúng bộ lọc.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CostBreakdown.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const access = fs.readFileSync(new URL('../src/tabAccess.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('‼ CON MẮT che số phủ MỌI ô tiền: mọi ô .catalog-money đều mang data-sensitive', () => {
  // CEO: "tất cả đều có tính năng con mắt mở/đóng các con số, các %, nó rất nhạy cảm."
  // Soi Ô DỮ LIỆU <td> — tiêu đề <th> là chữ, không phải số, không cần che.
  const tdMoney = page.match(/<td [^>]*catalog-money[^>]*>/g) || [];
  assert.ok(tdMoney.length >= 5, 'phải có ô tiền trong bảng');
  for (const cell of tdMoney) assert.match(cell, /data-sensitive/, `td tiền thiếu con mắt: ${cell}`);
});

test('bộ lọc đủ 6 chiều CEO chốt: nhà thầu · đơn vị · nhóm mã · NV · tuyến · ưu tiên', () => {
  for (const label of ['Nhà thầu', 'Mã đơn vị', 'Nhóm mã', 'Nhân viên', 'Tuyến', 'Ưu tiên']) {
    assert.match(page, new RegExp(`label="${label}"`), `thiếu bộ lọc ${label}`);
  }
  assert.match(page, /label="Cột xuất"/, 'phải chọn được cột cần xuất');
});

test('C44 vẫn tính nhưng NÊU RÕ: cột đánh dấu *, chú thích NGOÀI C47, hai dòng tổng tách bạch', () => {
  assert.match(page, /column\.outsideC47 \? '\*' : ''/);
  assert.match(page, /cost-breakdown-outside/);
  assert.match(page, /Tổng chi CÓ C44/);
  assert.match(page, /Trừ vào C47 \(không C44\)/);
  assert.match(page, /\{data\.c44Note\}/);
});

test('xuất Excel mang ĐÚNG bộ lọc đang chọn — không xuất một đằng nhìn một nẻo', () => {
  assert.match(page, /downloadCostBreakdown\(params\)/);
  assert.match(page, /Xuất Excel \(đúng bộ lọc đang chọn\)/);
  assert.match(api, /costBreakdown: \(params = \{\}\) => req\('GET', '\/catalog-management\/cost-breakdown\?'/);
  assert.match(api, /cost-breakdown\.xlsx/);
});

test('kỳ chưa đồng bộ được NÓI RA trên màn — không lặng lẽ thiếu tháng', () => {
  assert.match(page, /CHƯA đồng bộ %/);
  assert.match(page, /KHÔNG<\/b> gồm các kỳ đó/);
});

test('cột thiếu % hiện cảnh báo ⚠ kèm số cặp — tổng thiếu không giả làm tổng thật', () => {
  assert.match(page, /cặp thiếu % cột này — số dưới là tổng THIẾU/);
  assert.match(page, /⚠\{cell\.missingPairs\}/);
});

test('tab CHỈ CEO: cờ ceoOnly ở App + tabAccess, backend chặn độc lập bằng requireCeo', () => {
  assert.match(app, /key: 'costBreakdown'.*ceoOnly: true/);
  assert.match(access, /!tab\.ceoOnly \|\| canonicalCeo/);
  for (const route of ["'/catalog-management/cost-breakdown'", "'/catalog-management/cost-breakdown.xlsx'"]) {
    const at = routes.indexOf(`router.get(${route}`);
    assert.ok(at > 0, `thiếu route ${route}`);
    assert.match(routes.slice(at, routes.indexOf('\n', at)), /auth\.requireCeo/, `${route} phải requireCeo`);
  }
});

test('menu Thành tiền C32·C47 VẪN RIÊNG — trang mới không thay thế nó (CEO chốt)', () => {
  assert.match(app, /key: 'costAmounts'/);
  assert.match(app, /key: 'costBreakdown'/);
  assert.doesNotMatch(page, /c32NoVat|c47NoVat/, 'trang tổng hợp không nhúng số C32/C47 của menu kia');
});
