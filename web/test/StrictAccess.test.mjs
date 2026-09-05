import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isTabAllowed, resolveAllowedTab } from '../src/tabAccess.js';

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const revenue = fs.readFileSync(new URL('../src/pages/Revenue.jsx', import.meta.url), 'utf8');
const revenueFull = fs.readFileSync(new URL('../src/pages/RevenueFull.jsx', import.meta.url), 'utf8');
const tenderQuota = fs.readFileSync(new URL('../src/pages/TenderQuota.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const tabs = [
  { key: 'overview' }, { key: 'revenue' }, { key: 'revenueFull' }, { key: 'cst' },
  { key: 'products' }, { key: 'employeeCost' }, { key: 'target' },
];
const restrictedUsers = ['VP011', 'VP018', 'VP019'].map((emp_code) => ({ emp_code, role: 'sale', access_profile: 'revenue_only' }));

test('VP011/VP018/VP019 chỉ thấy đúng ba tab; mọi deep link trái phép quay về Doanh thu', () => {
  for (const user of restrictedUsers) {
    assert.deepEqual(tabs.filter((tab) => isTabAllowed(tab, user)).map((tab) => tab.key), ['revenue', 'revenueFull', 'cst'], user.emp_code);
    assert.equal(resolveAllowedTab(tabs, 'revenue', user), 'revenue');
    assert.equal(resolveAllowedTab(tabs, 'revenueFull', user), 'revenueFull');
    assert.equal(resolveAllowedTab(tabs, 'cst', user), 'cst');
    for (const forbidden of ['employeeCost', 'overview', 'products', 'target']) {
      assert.equal(resolveAllowedTab(tabs, forbidden, user), 'revenue', `${user.emp_code} ${forbidden}`);
    }
  }
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
  assert.match(tenderQuota, /me\.access_profile !== 'revenue_only' && <button className="btn ghost" disabled=\{busy\} onClick=\{doExport\}>⬇ Excel/);
  assert.match(tenderQuota, /className="cst-employee-badge"/);
  assert.match(tenderQuota, /className="cst-remaining-metric"/);
  assert.match(tenderQuota, /className=\{`cst-percent-metric \$\{pctTone\(pct\)\}`\}/);
  assert.match(styles, /\.detail-entity \.cst-employee-badge[^}]*font-weight:\s*800/);
  assert.match(styles, /\.cst-metrics \.cst-remaining-metric[^}]*font-weight:\s*800/);
});

test('tài khoản chuẩn giữ nguyên quyền tab hiện hữu', () => {
  const normal = { emp_code: 'DN006', role: 'sale', access_profile: 'standard', isAdmin: false };
  assert.equal(isTabAllowed({ key: 'overview' }, normal), true);
  assert.equal(isTabAllowed({ key: 'revenue' }, normal), true);
  assert.equal(isTabAllowed({ key: 'upload', adminOnly: true }, normal), false);
});
