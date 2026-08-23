'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/debtsShadowService');

test('Debts shadow is OFF by default and never changes selector', async () => {
  await assert.rejects(service.preview({ period: '2026-08', env: {} }), { code: 'DEBTS_SHADOW_DISABLED' });
  assert.equal(service.enabled({}), false);
});

test('T06 is hard blocked before any source request', async () => {
  let calls = 0;
  await assert.rejects(service.preview({
    period: '2026-06',
    env: { APP_REPORT_DEBTS_SHADOW_ENABLED: '1' },
    fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
  }), { code: 'DEBTS_PERIOD_HARD_BLOCKED' });
  assert.equal(calls, 0);
});

test('mapping file is confined to App Report data and selector flags stay separate', () => {
  assert.throws(() => service.safeMappingFile('/tmp/mapping.json'), { code: 'DEBTS_MAPPING_FILE_INVALID' });
  const cfg = service.config({ APP_REPORT_DEBTS_SHADOW_ENABLED: '1' });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.allowWrite, false);
  assert.match(cfg.dataDir, /revenue-shadow\/debts$/);
});

test('route is CEO-only shadow preview and does not wire live selector', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  assert.match(routes, /\/admin\/debts-shadow\/preview', auth\.requireAuth, auth\.requireCeo/);
  assert.doesNotMatch(routes, /getRows\s*=.*debts|activeSlots\s*=.*debts/);
});
