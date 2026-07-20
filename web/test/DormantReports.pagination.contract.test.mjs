import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../src/pages/DormantReports.jsx'), 'utf8');

test('QLNB preview uses the shared DONAPHARM pager above and below the table', () => {
  assert.match(source, /import \{ Pager, usePager \} from '\.\.\/components\.jsx'/);
  assert.match(source, /const REPORT_PAGE_SIZE = 50/);
  assert.equal((source.match(/<Pager className="dr-report-pager"/g) || []).length, 2);
  assert.match(source, /ariaLabel="Phân trang báo cáo QLNB phía trên"/);
  assert.match(source, /ariaLabel="Phân trang báo cáo QLNB phía dưới"/);
  assert.match(source, /pager\.pageItems\.map/);
  assert.match(source, /pager\.startIndex \+ index \+ 1/);
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
