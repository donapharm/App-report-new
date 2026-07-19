import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../src/pages/DormantReports.jsx'), 'utf8');

test('focused QLNB requests are sequenced so stale responses cannot overwrite current state', () => {
  assert.match(source, /const focusRequest = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+focusRequest\.current/);
  assert.match(source, /requestId !== focusRequest\.current/);
  assert.match(source, /requestId === focusRequest\.current/);
});

test('closing focused QLNB consumes persisted navigation state and URL focus parameters', () => {
  assert.match(source, /sessionStorage\.removeItem\('app_nav_payload'\)/);
  assert.match(source, /url\.searchParams\.delete\('focus_key'\)/);
  assert.match(source, /url\.searchParams\.delete\('unit_code'\)/);
  assert.match(source, /onClose=\{clearFocus\}/);
});
