import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');

test('CP Total 52 stays completely dark unless backend says the CEO flag is enabled', () => {
  assert.match(page, /\{isCeo && me\?\.catalog52Enabled === true && <Catalog52ControlPlane period=\{period\} \/>\}/);
  assert.match(page, /CP Total 52 cột \(CEO\)/);
  const controlPlane = page.slice(page.indexOf('function Catalog52ControlPlane'), page.indexOf('/**\n * MÀN CHI TIẾT QUYỀN'));
  assert.match(controlPlane, /useEffect\(\(\) => \{ load\(\); \}, \[hubPeriod\]\)/,
    'API chỉ được gọi sau khi component đã được render bởi cờ backend');
});

test('full-52 browser view is paginated and exposes no export action', () => {
  const block = page.slice(page.indexOf('function Catalog52ControlPlane'), page.indexOf('/**\n * MÀN CHI TIẾT QUYỀN'));
  assert.match(block, /loadPage\(pageNumber - 1\)/);
  assert.match(block, /loadPage\(pageNumber \+ 1\)/);
  assert.match(block, /page\.total/);
  assert.doesNotMatch(block, /api\.[A-Za-z0-9]*(?:Export|Download)|onClick=\{[^}]*\b(?:export|download)/i);
});

test('control-plane API stays on the dedicated admin namespace', () => {
  for (const action of ['status', 'history', 'rows', 'sync-preview', 'activate', 'rollback']) {
    assert.match(api, new RegExp(`/admin/catalog-management/cp-total-52/${action}`));
  }
});

test('CEO can inspect immutable version receipts without exporting full rows', () => {
  const block = page.slice(page.indexOf('function Catalog52ControlPlane'), page.indexOf('/**\n * MÀN CHI TIẾT QUYỀN'));
  assert.match(block, /Lịch sử bản niêm phong/);
  assert.match(block, /sourceIntegrityChecksum/);
  assert.match(block, /syncedAtGmt7/);
  assert.match(block, /syncedBy/);
});
