import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');

test('CP Total 52 is rendered only inside the existing CEO identity branch', () => {
  assert.match(page, /\{isCeo && <Catalog52ControlPlane period=\{period\} \/>\}/);
  assert.match(page, /CP Total 52 cột \(CEO\)/);
});

test('full-52 browser view is paginated and exposes no export action', () => {
  const block = page.slice(page.indexOf('function Catalog52ControlPlane'), page.indexOf('/**\n * MÀN CHI TIẾT QUYỀN'));
  assert.match(block, /loadPage\(pageNumber - 1\)/);
  assert.match(block, /loadPage\(pageNumber \+ 1\)/);
  assert.match(block, /page\.total/);
  assert.doesNotMatch(block, /api\.[A-Za-z0-9]*(?:Export|Download)|onClick=\{[^}]*\b(?:export|download)/i);
});

test('control-plane API stays on the dedicated admin namespace', () => {
  for (const action of ['status', 'rows', 'sync-preview', 'activate', 'rollback']) {
    assert.match(api, new RegExp(`/admin/catalog-management/cp-total-52/${action}`));
  }
});
