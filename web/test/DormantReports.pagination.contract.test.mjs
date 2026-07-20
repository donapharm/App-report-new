import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../src/pages/DormantReports.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(here, '../src/styles.css'), 'utf8');

test('QLNB preview uses the shared DONAPHARM pager above and below the table', () => {
  assert.match(source, /import \{ Pager, usePager \} from '\.\.\/components\.jsx'/);
  assert.match(source, /const REPORT_PAGE_SIZE = 50/);
  assert.equal((source.match(/<Pager className="dr-report-pager is-/g) || []).length, 2);
  assert.match(source, /className="dr-report-pager is-top"/);
  assert.match(source, /className="dr-report-pager is-bottom"/);
  assert.match(source, /ariaLabel="Phân trang báo cáo QLNB phía trên"/);
  assert.match(source, /ariaLabel="Phân trang báo cáo QLNB phía dưới"/);
  assert.match(source, /pager\.pageItems\.map/);
  assert.match(source, /pager\.startIndex \+ index \+ 1/);
});

test('top pager and desktop table heading remain visible while their list scrolls', () => {
  assert.match(styles, /\.dr-report-pager\.is-top \{ position:sticky;/);
  assert.match(styles, /\.dr-table thead th \{ position:sticky;/);
  assert.match(styles, /\.dr-table-wrap \{ position:sticky; top:calc\(var\(--desktop-topbar-h\) \+ 42px\)/);
  assert.match(styles, /top:calc\(var\(--desktop-topbar-h\) \+ 42px\)/);
  assert.match(styles, /top:calc\(var\(--hdr-h\) \+ env\(safe-area-inset-top\)\)/);
  assert.match(styles, /top:calc\(var\(--hdr-h\) \+ env\(safe-area-inset-top\) \+ 42px\)/);
  assert.match(styles, /\.page:has\(\.catalog-management\), \.page:has\(\.dr-page\) \{ overflow-x: clip; \}/);
  assert.match(styles, /\.dr-table \{ min-width:0; table-layout:fixed; \}/);
});

test('QLNB pager uses prominent DONAPHARM blue, orange and warm page colors', () => {
  assert.match(styles, /--dr-pager-shadow:0 8px 22px/);
  assert.match(styles, /linear-gradient\(135deg,#087aca 0%,#004b8d 100%\)/);
  assert.match(styles, /linear-gradient\(135deg,#ffb52e 0%,#e97700 100%\)/);
  assert.match(styles, /linear-gradient\(180deg,#fff9dd 0%,#ffe3a0 100%\)/);
  assert.match(styles, /\.dr-report-pager \.pager-info b \{ color:#003e70; font-size:15\.5px; \}/);
});

test('QLNB table menu heading uses a prominent DONAPHARM background', () => {
  assert.match(styles, /\.dr-table th \{ padding:9px 8px; background:linear-gradient\(180deg,#0b70b5 0%,#004f8d 100%\); color:#fff;/);
  assert.match(styles, /box-shadow:inset 0 -3px 0 #f5a11e/);
  assert.match(styles, /\.dr-table th\.dr-row-index \{ color:#fff; \}/);
});

test('QLNB pagination resets with report data and opens a focused row on its containing page', () => {
  assert.match(source, /usePager\(rows, REPORT_PAGE_SIZE, report\)/);
  assert.match(source, /rows\.findIndex\(\(row\) => row\.key === focusKey\)/);
  assert.match(source, /Math\.floor\(focusIndex \/ REPORT_PAGE_SIZE\) \+ 1/);
});

test('summary and empty-state continue to use the full filtered report', () => {
  assert.match(source, /report\?\.total \?\? rows\.length/);
  assert.match(source, /!rows\.length \? <div className="dr-empty"/);
});
