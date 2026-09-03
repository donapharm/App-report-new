'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs');
const guard = require('../src/revenueSingleWriterGuard');

test('generic uploads cannot become a T09+ revenue writer', () => {
  assert.equal(guard.assertGenericCommitAllowed({ ky: '08.2026' }), true);
  assert.throws(() => guard.assertGenericCommitAllowed({ ky: '09.2026' }), { code: 'REVENUE_SINGLE_WRITER_GENERIC_UPLOAD_BLOCKED' });
});

test('T09+ activation accepts only CRM plus App Web truth slots', () => {
  assert.equal(guard.assertActivationAllowed({ slot: { ky: '09.2026', source: 'CRM_MISA_PLUS_APP_WEB' } }), true);
  assert.throws(() => guard.assertActivationAllowed({ slot: { ky: '09.2026', source: 'DEBTS_ONLY_GROUP_DONA',
    selectorPolicy: 'GROUP_DONA_DEBTS_FROM_2026_09' } }), { code: 'REVENUE_SINGLE_WRITER_ACTIVATION_BLOCKED' });
});

test('generic upload commit and activation are wired through the single-writer guard', () => {
  const source = fs.readFileSync(require.resolve('../src/upload'), 'utf8');
  const routes = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(source, /commitSlotLocked[\s\S]*?singleWriter\.assertGenericCommitAllowed\(\{ ky \}\)/);
  assert.match(source, /activateSlotLocked[\s\S]*?singleWriter\.assertActivationAllowed\(\{ slot: target \}\)/);
  assert.match(routes, /upload\/commit[\s\S]*?Number\.isInteger\(e\?\.status\) \? e\.status : 400/);
  assert.match(routes, /upload\/activate[\s\S]*?Number\.isInteger\(e\?\.status\) \? e\.status : 400/);
});
