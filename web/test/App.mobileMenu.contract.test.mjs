import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const drillNav = fs.readFileSync(new URL('../src/drillNav.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('mobile bottom bar keeps 4 common tabs and a menu sheet', () => {
  assert.match(app, /const MOBILE_PRIMARY_TAB_KEYS = \['overview', 'revenue', 'employeeCost', 'target'\]/);
  assert.match(app, /<nav className="nav nav-mobile-primary" aria-label="Điều hướng nhanh App Report">/);
  assert.match(app, /<span>Menu<\/span>/);
  assert.match(app, /role="dialog" aria-modal="true" aria-labelledby="mobile-nav-sheet-title"/);
  assert.match(app, /placeholder="Tìm mục báo cáo\.\.\."/);
  assert.match(app, /mobile-nav-tile-state/);
});

test('authorized tab filtering and current-tab highlighting stay intact', () => {
  assert.match(app, /const visibleTabs = tabs\.filter\(\(t\) => !t\.hidden\);/);
  assert.match(app, /\(!t\.adminOnly \|\| me\.isAdmin\)/);
  assert.match(app, /\(!t\.ceoEmployeeOnly \|\| canonicalCeo \|\| !me\.isAdmin\)/);
  assert.match(app, /\(!t\.employeeCostControlled \|\| me\.isAdmin \|\| !me\.employeeCostDisabled\)/);
  assert.match(app, /className=\{`mobile-nav-tile\$\{tab === t\.key \? ' active' : ''\}`\}/);
});

test('header refresh reuses reloadTick and exposes loading state hooks', () => {
  assert.match(app, /window\.dispatchEvent\(new CustomEvent\('app:reload-active-tab', \{ detail: \{ tab, ts: Date\.now\(\) \} \}\)\)/);
  assert.match(app, /<RefreshButton loading=\{headerReloadBusy\} onClick=\{triggerHeaderReload\} \/>/);
  assert.match(drillNav, /window\.addEventListener\('app:reload-active-tab', onReload\)/);
  assert.match(api, /window\.dispatchEvent\(new CustomEvent\('app:request-state'/);
  assert.match(app, /const RELOAD_TICK_TAB_KEYS = new Set/);
  assert.match(app, /setFallbackReloadTick\(\(tick\) => tick \+ 1\)/);
  assert.match(app, /headerReloadBusyRef\.current = true/);
});

test('mobile sheet styling includes backdrop, grid and body lock', () => {
  assert.match(styles, /body\.nav-sheet-open \{ overflow: hidden; \}/);
  assert.match(styles, /\.mobile-nav-sheet-backdrop/);
  assert.match(styles, /\.mobile-nav-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 10px; \}/);
  assert.match(styles, /\.refresh-button\.is-loading \.refresh-button-ic \{ animation: refresh-spin/);
  assert.match(styles, /\.nav-mobile-primary button \{ font-size: 8\.5px; gap: 2px; \}/);
});

test('menu search is Vietnamese accent-insensitive and active items expose aria-current', () => {
  assert.match(app, /normalize\('NFD'\)\.replace\(\/\[\\u0300-\\u036f\]\/g, ''\)/);
  assert.match(app, /aria-current=\{tab === t\.key \? 'page' : undefined\}/);
});
