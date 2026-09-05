'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const persist = require('../src/persist');
const notify = require('../src/notifyChannels');
const salesReport = require('../src/salesReport');

test('email success never suppresses an independently failed Telegram retry', async (t) => {
  const original = { load: persist.load, save: persist.save, telegram: notify.sendTelegram, email: notify.sendEmail };
  t.after(() => { persist.load = original.load; persist.save = original.save; notify.sendTelegram = original.telegram; notify.sendEmail = original.email; });
  let log = []; let telegramCalls = 0; let emailCalls = 0;
  persist.load = () => log;
  persist.save = (_name, value) => { log = value; };
  notify.sendTelegram = async () => ({ ok: ++telegramCalls > 1, description: 'fetch failed' });
  notify.sendEmail = async () => { emailCalls += 1; return { ok: true }; };
  const ranges = salesReport.defaultRanges('2026-09-04');
  const args = { kind: 'day', ranges, code: 'CEO', telegramId: 'ceo', email: 'ceo@example.invalid', subject: 's', text: 't', html: '<p>t</p>' };
  const first = await salesReport.deliverMissingChannels(args);
  assert.equal(first.ok, false); assert.deepEqual(first.failedChannels, ['telegram']);
  const second = await salesReport.deliverMissingChannels(args);
  assert.equal(second.ok, true); assert.equal(telegramCalls, 2); assert.equal(emailCalls, 1);
  assert.equal(salesReport.alreadySentChannel('day', ranges, 'CEO', 'telegram'), true);
  assert.equal(salesReport.alreadySentChannel('day', ranges, 'CEO', 'email'), true);
});
