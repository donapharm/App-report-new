import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const overview = fs.readFileSync(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const revenueFilters = fs.readFileSync(new URL('../src/pages/revenueFilters.jsx', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('Tổng quan có đủ bộ lọc đã duyệt', () => {
  for (const label of ['Nhân viên', 'Tuyến', 'Nhóm công ty', 'Nhóm đơn vị', 'Đơn vị trong nhóm']) {
    assert.match(overview, new RegExp(label));
  }
  assert.match(overview, /Gõ 033 hoặc 033/);
  assert.match(overview, /acceptTrailingDot/);
  assert.match(revenueFilters, /acceptTrailingDot[\s\S]*replace\(\/\\\.\$\//);
  assert.match(revenueFilters, /e\.key === 'Enter'[\s\S]*commitExact/);
  assert.match(routes, /Group-Dona \(DONA \+ AFP\)/);
  assert.match(routes, /Group-Đối tác/);
});

test('tham số lọc được truyền xuyên suốt các API Tổng quan', () => {
  assert.match(overview, /api\.overview\(overviewParams\)/);
  assert.match(overview, /api\.trend\(overviewParams\)/);
  assert.match(overview, /api\.alerts\(\{ \.\.\.overviewParams/);
  assert.match(overview, /api\.analysis\(\{ \.\.\.overviewParams/);
  assert.match(overview, /api\.revenue\('unit', null, overviewParams\)/);
  assert.match(api, /trend: \(params = \{\}\).*URLSearchParams\(params\)/);
});

test('UI không hiển thị tỷ lệ target sai khi lọc lát cắt không có target', () => {
  assert.match(overview, /targetComparable/);
  assert.match(overview, /Không tính % target theo lát cắt/);
  assert.match(overview, /Target hiện được giao theo nhân viên/);
});

test('bộ lọc responsive trên PC, tablet và mobile', () => {
  assert.match(styles, /\.overview-filter-grid[^}]*repeat\(5/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.overview-filter-grid[^}]*repeat\(3/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.overview-filter-grid[^}]*grid-template-columns: 1fr/);
});
