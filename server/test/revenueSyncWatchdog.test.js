'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../src/debtsRevenueSchedule');
const incident = require('../src/revenueSyncIncident');
const job = require('../src/debtsRevenueJob');

const enabled = {
  APP_REPORT_DEBTS_REVENUE_SCHEDULE_ENABLED: '1',
  APP_REPORT_DEBTS_SHADOW_ENABLED: '1',
  APP_REPORT_DEBTS_ENDPOINT: 'https://debts.invalid',
  APP_REPORT_DEBTS_TOKEN: 'test-only',
  APP_REPORT_DEBTS_SHADOW_WRITE_ENABLED: '1',
  APP_REPORT_DEBTS_RECEIPT_SIGNING_KEY: Buffer.alloc(32, 1).toString('base64'),
  APP_REPORT_DEBTS_RECEIPT_SIGNING_KEY_ID: 'test-key-id',
};

test('retry windows are 18:00 +5/+15/+30 and watchdog is 20:00', () => {
  for (const [iso, kind, offset] of [
    ['2026-09-04T11:00:00Z', 'scheduled', 0], ['2026-09-04T11:05:00Z', 'retry', 5],
    ['2026-09-04T11:15:00Z', 'retry', 15], ['2026-09-04T11:30:00Z', 'retry', 30],
    ['2026-09-04T13:00:00Z', 'watchdog', 120],
  ]) {
    const out = schedule.runWindow(new Date(iso), enabled);
    assert.equal(out.due, true); assert.equal(out.kind, kind); assert.equal(out.offset, offset);
  }
  assert.equal(schedule.runWindow(new Date('2026-09-04T11:06:00Z'), enabled).due, false);
});

test('incident message names failed partition, stale date, retry and never falls back', () => {
  const text = incident.messageFor({ period: '2026-09', slot: '2026-09-04-1800', code: 'DEBTS_REVENUE_PARTITION_NOT_ACCEPTABLE',
    sources: { DEBTS_DONA: { status: 'ok' }, DEBTS_AFP: { status: 'failed' }, APP_WEB: { status: 'pending' } },
    activeDataThrough: '2026-09-03', nextRetryAt: '18:05' });
  assert.match(text, /DEBTS_AFP/); assert.match(text, /APP_WEB/); assert.match(text, /2026-09-03/);
  assert.match(text, /18:05/); assert.match(text, /không fallback CRM\/MISA/);
});

test('partial publish alert tells the truth about the new slot and both partition dates', () => {
  const text = incident.messageFor({ period: '2026-09', slot: '2026-09-05-1300', partialPublished: true,
    code: 'DEBTS_REVENUE_PARTITION_NOT_ACCEPTABLE', sources: { APP_WEB: { status: 'ok' }, DEBTS_DONA: { status: 'failed' } },
    partitionGenerations: { APP_WEB: { dataThrough: '2026-09-05' }, DEBTS_DONA_AFP: { dataThrough: '2026-09-03' } } });
  assert.match(text, /đã publish slot doanh thu mới/);
  assert.match(text, /APP_WEB đến 2026-09-05/);
  assert.match(text, /DONA\+AFP vẫn là bản cũ đến 2026-09-03/);
  assert.match(text, /DEBTS_REVENUE_PARTITION_NOT_ACCEPTABLE/);
  assert.doesNotMatch(text, /Giữ slot cũ/);
});

test('Telegram failure is persisted as failure and is retried independently', async () => {
  let sends = 0; let state = {};
  const store = { load: () => state, save: (_name, value) => { state = value; } };
  const deps = { recipient: () => ({ telegramId: 'ceo' }), store,
    notify: { emailFor: () => '', sendTelegram: async () => ({ ok: ++sends > 1, description: 'fetch failed' }), sendEmail: async () => ({ ok: false }) } };
  const event = { period: '2026-09', slot: 's', code: 'SOURCE_FAILED', sources: {} };
  const first = await incident.notifyCeo(event, deps); assert.equal(first.ok, false);
  const second = await incident.notifyCeo(event, deps); assert.equal(second.ok, true);
  assert.equal(sends, 2); assert.equal(Object.values(state)[0].attempts, 2); assert.ok(Object.values(state)[0].telegramSentAt);
});

test('incident delivery tracks Telegram and email separately', async () => {
  let telegramCalls = 0; let emailCalls = 0; let state = {};
  const store = { load: () => state, save: (_name, value) => { state = value; } };
  const deps = { recipient: () => ({ telegramId: 'ceo', email: 'ceo@example.invalid' }), store,
    notify: { emailFor: () => 'ceo@example.invalid', sendTelegram: async () => ({ ok: ++telegramCalls > 1 }),
      sendEmail: async () => { emailCalls += 1; return { ok: true }; } } };
  const event = { period: '2026-09', slot: 's', code: 'SOURCE_FAILED', sources: {} };
  await incident.notifyCeo(event, deps); await incident.notifyCeo(event, deps);
  assert.equal(telegramCalls, 2); assert.equal(emailCalls, 1);
  const saved = Object.values(state)[0]; assert.ok(saved.telegramSentAt); assert.ok(saved.emailSentAt);
});

test('failed scheduled run alerts and later retry is not suppressed', async () => {
  job._state.handledWindows.clear(); job._state.lastSuccessSlot = ''; job._state.lastRun = null;
  let alerts = 0; let runs = 0;
  let monitor = {};
  const store = { load: () => monitor, save: (_name, value) => { monitor = value; } };
  const runOptions = { env: enabled, deps: { getCatalogSnapshot: async () => { runs += 1; const e = new Error('no'); e.code = 'DEBTS_REVENUE_PARTITION_NOT_ACCEPTABLE'; e.details = { legalEntity: 'AFP' }; throw e; } } };
  await job.tick(new Date('2026-09-04T11:00:00Z'), { env: enabled, store, runOptions, activeDataThrough: () => '2026-09-03', notifyIncident: async () => { alerts += 1; } });
  await job.tick(new Date('2026-09-04T11:05:00Z'), { env: enabled, store, runOptions, activeDataThrough: () => '2026-09-03', notifyIncident: async () => { alerts += 1; } });
  assert.equal(runs, 2); assert.equal(alerts, 2);
});

test('watchdog stays quiet after a successful slot persisted before restart', async () => {
  job._state.handledWindows.clear(); job._state.lastSuccessSlot = ''; job._state.lastRun = null;
  const store = { load: () => ({ lastSuccessSlot: '2026-09-04-1800' }), save: () => {} };
  let alerts = 0;
  await job.tick(new Date('2026-09-04T13:00:00Z'), { env: enabled, store, notifyIncident: async () => { alerts += 1; } });
  assert.equal(alerts, 0);
});
