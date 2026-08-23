import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(here, '../src/App.jsx'), 'utf8');
const catalog = fs.readFileSync(path.join(here, '../src/pages/CatalogManagement.jsx'), 'utf8');
const paymentSchedule = fs.readFileSync(path.join(here, '../src/pages/PaymentSchedule.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(here, '../src/styles.css'), 'utf8');
const handbook = fs.readFileSync(path.join(here, '../../CLAUDE.md'), 'utf8');

test('desktop pages use the CEO-approved 96 percent content frame', () => {
  assert.match(styles, /\.page-desktop \{[^}]*max-width:\s*96%[^}]*\}/);
  assert.doesNotMatch(styles, /\.page-desktop \{[^}]*max-width:\s*1600px[^}]*\}/);
  assert.match(handbook, /`\.page-desktop` \*\*~96% chiều ngang\*\*/);
});

test('desktop width is applied once and Payment Schedule does not nest the frame', () => {
  assert.equal((app.match(/page-desktop/g) || []).length, 2); // class + page-desktop-wide modifier
  assert.doesNotMatch(paymentSchedule, /page-desktop/);
  assert.match(paymentSchedule, /return <div className="payment-schedule-page">/);
});

test('both catalog views paginate at no more than 50 rows', () => {
  assert.match(catalog, /const PAGE_SIZE = 50;/);
  assert.equal((catalog.match(/Math\.ceil\(rows\.length \/ PAGE_SIZE\)/g) || []).length, 2);
  assert.equal((catalog.match(/rows\.slice\(\(safePage - 1\) \* PAGE_SIZE, safePage \* PAGE_SIZE\)/g) || []).length, 2);
});

test('wide catalog tables scroll horizontally instead of clipping cost columns', () => {
  const wide = styles.match(/@media \(min-width:1500px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  // 23/08: overflow-y đổi hidden -> auto + max-height để tiêu đề bảng ghim được
  // khi cuộn (CEO 19:46). Kéo ngang giữ nguyên, cấm clip cột vẫn giữ nguyên.
  assert.match(wide, /\.catalog-table-card \.table-scroll \{[^}]*max-width:100%;[^}]*overflow-x:auto;[^}]*overflow-y:auto;[^}]*max-height:calc\(100vh - 150px\);[^}]*\}/);
  assert.match(wide, /scrollbar-gutter:stable/);
  assert.match(wide, /\.catalog-table-card \.table-scroll::\-webkit-scrollbar \{ height:12px; \}/);
  assert.match(wide, /\.catalog-table-products thead th \{ position:sticky; top:0; \}/);
  assert.doesNotMatch(wide, /overflow-x:clip/);
});
