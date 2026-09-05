import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshnessDate, partitionFreshnessWarning } from '../src/revenuePartitionFreshness.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('partition freshness warning is visible only when dates differ and uses full Vietnamese dates', () => {
  const warning = partitionFreshnessWarning({ APP_WEB: { dataThrough: '2026-09-05' }, DEBTS_DONA_AFP: { dataThrough: '2026-09-03' } });
  assert.equal(freshnessDate('2026-09-03'), '03/09/2026');
  assert.match(warning.text, /DONA\+AFP còn cũ, mới đến 03\/09\/2026/);
  assert.match(warning.text, /APP_WEB đến 05\/09\/2026/);
  assert.equal(partitionFreshnessWarning({ APP_WEB: { dataThrough: '2026-09-05' }, DEBTS_DONA_AFP: { dataThrough: '2026-09-05' } }), null);
  for (const file of ['web/src/pages/Overview.jsx', 'web/src/pages/Revenue.jsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /catalog-alert error partition-freshness-warning/);
    assert.match(source, /role="alert"/);
  }
});
