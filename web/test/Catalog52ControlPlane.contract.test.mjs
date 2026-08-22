import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');

test('CP Total 52 stays completely dark unless backend says the CEO flag is enabled', () => {
  assert.match(page, /\{isCeo && me\?\.catalog52Enabled === true && <Catalog52ControlPlane period=\{period\} \/>\}/);
  assert.match(page, /CP Total 52 cột \(CEO · giải mã tại máy này\)/);
  const controlPlane = page.slice(page.indexOf('function Catalog52ControlPlane'), page.indexOf('/**\n * MÀN CHI TIẾT QUYỀN'));
  assert.match(controlPlane, /useEffect\(\(\) => \{ load\(\); \}, \[hubPeriod\]\)/,
    'API chỉ được gọi sau khi component đã được render bởi cờ backend');
});

test('full-52 browser view is paginated and exposes no export action', () => {
  const block = page.slice(page.indexOf('function Catalog52ControlPlane'), page.indexOf('/**\n * MÀN CHI TIẾT QUYỀN'));
  assert.match(block, /loadPage\(pageNumber - 1\)/);
  assert.match(block, /loadPage\(pageNumber \+ 1\)/);
  assert.match(block, /manifest\.pageCount/);
  assert.match(block, /tối đa 50 dòng\/trang/);
  assert.match(block, /Cột thưa để trống, không suy thành 0/);
  assert.doesNotMatch(block, /api\.[A-Za-z0-9]*(?:Export|Download)|onClick=\{[^}]*\b(?:export|download)/i);
});

test('encrypted viewer API stays on the dedicated admin namespace', () => {
  for (const action of ['device', 'encrypted-manifest', 'encrypted-page']) {
    assert.match(api, new RegExp(`/admin/catalog-management/cp-total-52/${action}`));
  }
});

test('CEO sees mandatory as-of and browser-only device controls', () => {
  const block = page.slice(page.indexOf('function Catalog52ControlPlane'), page.indexOf('/**\n * MÀN CHI TIẾT QUYỀN'));
  assert.match(block, /Số liệu tính đến/);
  assert.match(block, /Đăng ký máy này/);
  assert.match(block, /Quên thiết bị này/);
  assert.match(block, /IndexedDB/);
});
