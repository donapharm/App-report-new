'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDormantDigest } = require('../src/dormantDigest');

test('builds 14-day Telegram/email preview with escalation and no real sending', () => {
  const data = {
    as_of: '2026-07-19',
    summary: { dormant: 12, unplanned: 3, in_progress: 5, due_review: 2, overdue_review: 1, reactivated: 4 },
    items: [{ key: 'DN016|U|Q', emp_code: 'DN016', iit_code: 'QLNB-A', unit_name: 'BV A <test>', action: { cycle: 2 }, attention: { level: 'management', status: 'overdue' } }],
  };
  const out = buildDormantDigest(data);
  assert.match(out.telegram_text, /Quá hạn review: 1/);
  assert.match(out.telegram_text, /chu kỳ 2/);
  assert.match(out.email_html, /BV A &lt;test&gt;/);
  assert.equal(out.send_enabled, false);
  assert.equal(out.fingerprint.length, 20);
  assert.deepEqual(out, buildDormantDigest(data), 'same digest must have stable anti-duplicate fingerprint');
});
