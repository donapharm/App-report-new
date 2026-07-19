'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDormantDigest } = require('../src/dormantDigest');

test('builds Telegram/email preview with escalation and no real sending', () => {
  const data = {
    as_of: '2026-07-19',
    summary: { dormant: 12, not_activated: 3, red_7_days: 2, management_14_days: 1, reactivated: 4 },
    items: [{ key: 'DN016|U|Q', emp_code: 'DN016', iit_code: 'QLNB-A', unit_name: 'BV A <test>', days_idle: 81, attention: { level: 'management' } }],
  };
  const out = buildDormantDigest(data);
  assert.match(out.telegram_text, /Đưa quản lý\/CEO: 1/);
  assert.match(out.telegram_text, /DN016/);
  assert.match(out.email_html, /BV A &lt;test&gt;/);
  assert.equal(out.send_enabled, false);
  assert.equal(out.fingerprint.length, 20);
  assert.deepEqual(out, buildDormantDigest(data), 'same digest must have stable anti-duplicate fingerprint');
});
