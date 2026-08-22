'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const acceptance = require('../src/reportdevAcceptance');

test('machine principal emits only approved counters and audit label', async () => {
  let event;
  const out = await acceptance.runAcceptance({ period: '2026-08' }, {
    loadCounters: async () => ({ catalogRows: 28006, employeeCount: 19, balanced: true,
      c32: 'must-not-leak', person: 'must-not-leak' }),
    audit: (value) => { event = value; },
  });
  assert.deepEqual(Object.keys(out), acceptance.OUTPUT_FIELDS);
  assert.equal(out.principal, 'reportdev_acceptance_bot_v1');
  assert.equal(JSON.stringify(out).includes('c32'), false);
  assert.equal(JSON.stringify(out).includes('person'), false);
  assert.equal(event.kind, 'machine_acceptance');
});

test('period outside allowlist and request field outside schema fail closed', async () => {
  await assert.rejects(() => acceptance.runAcceptance({ period: '2026-06' }, { loadCounters: async () => ({}) }),
    (error) => error.code === 'ACCEPTANCE_PERIOD_FORBIDDEN');
  await assert.rejects(() => acceptance.runAcceptance({ period: '2026-08', c32: true }, { loadCounters: async () => ({}) }),
    (error) => error.code === 'ACCEPTANCE_REQUEST_FIELD_FORBIDDEN');
});

test('principal has no UI/password/OTP capability surface', () => {
  const source = require('fs').readFileSync(require.resolve('../src/reportdevAcceptance'), 'utf8');
  assert.doesNotMatch(source, /express|router|password|otp|session|cookie|fetch\s*\(/i);
});
