'use strict';

process.env.TZ = 'Asia/Ho_Chi_Minh';
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-report-auth-'));
process.env.AUTH_DATA_DIR = authDir;
const deckReport = require('../src/report/deckReport');
const scheduler = require('../src/report/deckScheduler');

test.after(() => fs.rmSync(authDir, { recursive: true, force: true }));

function date(y, m, d, h, min = 0) { return new Date(y, m - 1, d, h, min, 0, 0); }

test('scheduler is fail-closed and follows Saturday/month-end schedule', async () => {
  assert.deepEqual(scheduler.dueKinds(date(2026, 7, 25, 12, 59)), []);
  assert.deepEqual(scheduler.dueKinds(date(2026, 7, 25, 13, 0)), ['week']);
  assert.deepEqual(scheduler.dueKinds(date(2026, 7, 31, 17, 59)), []);
  assert.deepEqual(scheduler.dueKinds(date(2026, 7, 31, 18, 0)), ['month']);
  assert.deepEqual(scheduler.dueKinds(date(2026, 10, 31, 18, 0)), ['week', 'month']);

  const calls = [];
  const fakeReport = {
    build: async ({ kind, draft }) => { calls.push(['build', kind, draft]); return { kind, draft, key: `deck:${kind}:x`, data: { scope: 'CEO' } }; },
    sendCeo: async (built, options) => { calls.push(['send', built.kind, options.approved]); return { ok: true }; },
  };
  const disabled = await scheduler.runDue({ now: date(2026, 7, 25, 13), env: {}, report: fakeReport });
  assert.equal(disabled.skipped, 'scheduler-disabled');
  const unapproved = await scheduler.runDue({ now: date(2026, 7, 25, 13), env: { REPORT_DECK_SCHEDULER_ENABLED: 'true' }, report: fakeReport });
  assert.equal(unapproved.skipped, 'ceo-approval-not-enabled');
  assert.deepEqual(calls, []);

  const sent = await scheduler.runDue({
    now: date(2026, 10, 31, 18),
    env: { REPORT_DECK_SCHEDULER_ENABLED: 'true', REPORT_DECK_SCHEDULER_APPROVED: 'true' },
    report: fakeReport,
  });
  assert.equal(sent.ok, true);
  assert.deepEqual(calls, [
    ['build', 'week', false], ['send', 'week', true],
    ['build', 'month', false], ['send', 'month', true],
  ]);
});

test('CLI defaults to draft and requires an explicit official flag', () => {
  assert.deepEqual(deckReport.parseArgs(['--kind=month']), { kind: 'month', send: '', approved: false, force: false, draft: true });
  assert.equal(deckReport.parseArgs(['--official']).draft, false);
  assert.equal(deckReport.parseArgs(['--draft=false']).draft, false);
});

test('CEO delivery resumes partial channels without sending duplicates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-delivery-'));
  const htmlPath = path.join(dir, 'deck.html');
  const pptxPath = path.join(dir, 'deck.pptx');
  fs.writeFileSync(htmlPath, '<html></html>');
  fs.writeFileSync(pptxPath, 'pptx');
  const data = { scope: 'CEO', range: { from: '2026-07-01', to: '2026-07-25' } };
  const built = { kind: 'week', draft: true, key: deckReport.deliveryKey('week', data, { draft: true }), data, htmlPath, pptxPath, pdfPath: null };
  const calls = [];
  let failPptx = true;
  const notify = {
    emailFor: () => 'ceo@example.test',
    sendEmail: async (to, subject, text, html, attachments) => {
      calls.push(['email', to, attachments.map((x) => path.basename(x.path))]);
      return { ok: true, provider_message_id: 'email-1' };
    },
    sendDocument: async (chatId, file, caption) => {
      calls.push(['telegram', chatId, path.basename(file), caption.includes('[DRAFT')]);
      if (file.endsWith('.pptx') && failPptx) return { ok: false, description: 'test failure' };
      return { ok: true, provider_message_id: path.basename(file) };
    },
  };
  const recipientProvider = () => ({ code: 'CEO', telegramId: '1748199545', user: { email: 'ceo@example.test' } });

  const first = await deckReport.sendCeo(built, { approved: true, notifyChannels: notify, recipientProvider });
  assert.equal(first.ok, false);
  assert.equal(calls.filter((x) => x[0] === 'email').length, 1);
  assert.equal(calls.filter((x) => x[0] === 'telegram').length, 2);

  failPptx = false;
  const second = await deckReport.sendCeo(built, { approved: true, notifyChannels: notify, recipientProvider });
  assert.equal(second.ok, true);
  assert.equal(calls.filter((x) => x[0] === 'email').length, 1, 'email must not be duplicated on resume');
  assert.equal(calls.filter((x) => x[0] === 'telegram' && x[2] === 'deck.html').length, 1, 'HTML Telegram document must not be duplicated');
  assert.equal(calls.filter((x) => x[0] === 'telegram' && x[2] === 'deck.pptx').length, 2, 'only failed PPTX is retried');
  assert.equal(deckReport.alreadySent('week', data, { draft: true }), true);
  assert.equal(deckReport.alreadySent('week', data, { draft: false }), false, 'DRAFT must not block the official period key');

  await assert.rejects(
    () => deckReport.sendCeo({ ...built, key: 'another' }, { approved: true, force: true, notifyChannels: notify, recipientProvider: () => ({ code: 'DN001' }) }),
    /chỉ được giao cho mã CEO/i,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
