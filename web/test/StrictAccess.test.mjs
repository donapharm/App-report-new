import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isTabAllowed, resolveAllowedTab } from '../src/tabAccess.js';

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const revenue = fs.readFileSync(new URL('../src/pages/Revenue.jsx', import.meta.url), 'utf8');
const revenueFull = fs.readFileSync(new URL('../src/pages/RevenueFull.jsx', import.meta.url), 'utf8');

const tabs = [
  { key: 'overview' }, { key: 'revenue' }, { key: 'revenueFull' },
  { key: 'products' }, { key: 'employeeCost' }, { key: 'target' },
];
const vp018 = { emp_code: 'VP018', role: 'sale', access_profile: 'revenue_only' };

test('VP018 chỉ thấy Doanh thu và DT đầy đủ; deep link trái phép quay về Doanh thu', () => {
  assert.deepEqual(tabs.filter((tab) => isTabAllowed(tab, vp018)).map((tab) => tab.key), ['revenue', 'revenueFull']);
  assert.equal(resolveAllowedTab(tabs, 'revenue', vp018), 'revenue');
  assert.equal(resolveAllowedTab(tabs, 'revenueFull', vp018), 'revenueFull');
  assert.equal(resolveAllowedTab(tabs, 'employeeCost', vp018), 'revenue');
  assert.equal(resolveAllowedTab(tabs, 'overview', vp018), 'revenue');
});

test('frontend khóa đường vòng, mở đúng export và giấu privacy eye cho revenue-only', () => {
  assert.match(app, /const revenueOnly = me\.access_profile === 'revenue_only'/);
  assert.match(app, /resolveAllowedTab\(TABS, targetTab, me, revenueOnly \? 'revenue' : 'overview'\)/);
  assert.match(app, /me\?\.access_profile !== 'revenue_only'.*setPrivacyHidden\(false\)/s);
  assert.equal((app.match(/!revenueOnly && <PrivacyEyeButton/g) || []).length, 2, 'desktop + mobile đều giấu eye');
  assert.match(app, /!revenueOnly && <CeoNotificationBell/);
  assert.match(app, /!revenueOnly && <DormantGate/);
  assert.match(revenue, /const companyRevenue = me\.isAdmin \|\| me\.access_profile === 'revenue_only'/);
  assert.match(revenue, /<button className="btn ghost" disabled=\{busy\} onClick=\{doExport\}>⬇ Excel<\/button>/);
  assert.match(revenueFull, /<div className="revenue-export-tools">/);
  assert.match(revenueFull, /me\.access_profile !== 'revenue_only' && <option value="csv"/);
  assert.match(revenueFull, /me\.access_profile !== 'revenue_only' && <option value="pptx"/);
});

test('tài khoản chuẩn giữ nguyên quyền tab hiện hữu', () => {
  const normal = { emp_code: 'DN006', role: 'sale', access_profile: 'standard', isAdmin: false };
  assert.equal(isTabAllowed({ key: 'overview' }, normal), true);
  assert.equal(isTabAllowed({ key: 'revenue' }, normal), true);
  assert.equal(isTabAllowed({ key: 'upload', adminOnly: true }, normal), false);
});
