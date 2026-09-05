import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
test('Overview and Revenue disclose APP_WEB and atomic DONA+AFP freshness separately', () => {
  for (const file of ['web/src/pages/Overview.jsx', 'web/src/pages/Revenue.jsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /partitionGenerations\.APP_WEB/);
    assert.match(source, /partitionGenerations\.DEBTS_DONA_AFP/);
    assert.match(source, /APP_WEB đến/);
    assert.match(source, /DONA\+AFP đến/);
  }
  assert.match(fs.readFileSync(path.join(root, 'server/src/store.js'), 'utf8'), /partitionGenerations: s\.partitionGenerations/);
});
