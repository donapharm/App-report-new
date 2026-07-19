'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  APPROVED_EMP_CODES, TELEGRAM_APPROVED_EMP_CODES, EXCLUDED_EMP_CODES, assertSafeReport, createFilteredEmployeeDeliveryService,
} = require('../src/filteredEmployeeDelivery');

function reportFor(empCode) {
  return {
    period: '2026-07', period_ui: '07.2026', filters: { period: '2026-07', emp_codes: [empCode] },
    summary: { emp_code: empCode, emp_name: `NV ${empCode}`, row_count: 1, unit_count: 1, qlnb_count: 1 },
    rows: [{ emp_code: empCode, unit_code: `UNIT-${empCode}`, qlnb_code: `QLNB-${empCode}`, cst_initial: 100, cst_remaining: 20 }],
  };
}
function fixture(options = {}) {
  let now = new Date('2026-07-19T10:00:00.000Z');
  let tgMissing = new Set(['DN004', 'DN012', 'DN022']);
  const users = Object.fromEntries(APPROVED_EMP_CODES.map((code) => [code, { emp_code: code, name: `NV ${code}`, email: `${code.toLowerCase()}@donapharm.test` }]));
  const state = options.state || {};
  const calls = [];
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtered-delivery-test-'));
  const persist = {
    load: (name, fallback) => state[name] ? structuredClone(state[name]) : structuredClone(fallback),
    save: (name, value) => { state[name] = structuredClone(value); },
  };
  const filteredEmployeeReport = {
    preview: async (payload) => ({
      preview_id: 'report-preview', period: '2026-07', period_ui: '07.2026',
      filters: { period: '2026-07', emp_codes: payload.emp_codes }, filter_text: 'Kỳ 07.2026',
    }),
    summaryReport: async (payload) => ({
      period: '2026-07', period_ui: '07.2026', reports: payload.emp_codes.map(reportFor),
    }),
    excelBuffer: async (report) => Buffer.from(`xlsx-private-${report.summary.emp_code}`),
  };
  const store = { findUserByCode: (code) => users[code] || null };
  const listTelegramMap = () => APPROVED_EMP_CODES.filter((code) => !tgMissing.has(code)).map((code) => ({ emp_code: code, telegram_id: `tg-${code}` }));
  const notifyChannels = {
    emailFor: (code, email) => email,
    emailReady: () => options.emailReady !== false,
    telegramReady: () => options.telegramReady !== false,
    sendEmail: async (to, subject, body, html, attachments) => {
      calls.push({ channel: 'email', to, subject, body, html, attachments });
      if (options.emailResult) return options.emailResult(to, calls);
      return { ok: true };
    },
    sendDocument: async (to, filePath, caption) => {
      calls.push({ channel: 'telegram', to, filePath, caption });
      if (options.telegramResult) return options.telegramResult(to, calls);
      return { ok: true };
    },
  };
  const build = (overrides = {}) => createFilteredEmployeeDeliveryService({
    filteredEmployeeReport, store, listTelegramMap, notifyChannels, persist,
    clock: () => new Date(now), outputDir,
    sendEnabled: () => overrides.sendEnabled ?? options.sendEnabled ?? false,
    previewTtlMs: overrides.previewTtlMs || 60 * 60 * 1000,
  });
  return {
    build, state, calls, outputDir,
    advance: (ms) => { now = new Date(now.getTime() + ms); },
    changeTelegram: (missing) => { tgMissing = new Set(missing); },
    cleanup: () => fs.rmSync(outputDir, { recursive: true, force: true }),
  };
}

function confirm(preview) {
  return { preview_id: preview.preview_id, manifest_digest: preview.manifest_digest, confirm_text: 'GUI_BAO_CAO_CA_NHAN' };
}
function secondApprove(service, preview, actor = 'admin-A') {
  return service.approve(preview.preview_id, { manifest_digest: preview.manifest_digest, confirm_text: 'DUYET_GUI_BAO_CAO_CA_NHAN' }, actor);
}

test('fixed recipient policy has exactly 18 approved and hard-excludes four codes', () => {
  assert.equal(APPROVED_EMP_CODES.length, 18);
  assert.equal(new Set(APPROVED_EMP_CODES).size, 18);
  assert.equal(TELEGRAM_APPROVED_EMP_CODES.length, 15);
  assert.deepEqual(APPROVED_EMP_CODES.filter((code) => !TELEGRAM_APPROVED_EMP_CODES.includes(code)), ['DN004', 'DN012', 'DN022']);
  assert.deepEqual(EXCLUDED_EMP_CODES, ['DN021', 'DN023', 'VP004', 'VP018']);
  for (const code of EXCLUDED_EMP_CODES) assert.equal(APPROVED_EMP_CODES.includes(code), false);
});

test('preview creates 18 isolated files, 18 email plans and 15 Telegram plans without sending', async (t) => {
  const f = fixture(); t.after(f.cleanup);
  const service = f.build();
  const preview = await service.preview({ emp_codes: [...APPROVED_EMP_CODES, ...EXCLUDED_EMP_CODES], channels: { email: true, telegram: true } }, 'admin-session');
  assert.equal(preview.summary.recipients, 18);
  assert.equal(preview.summary.files, 18);
  assert.equal(preview.summary.email, 18);
  assert.equal(preview.summary.telegram, 15);
  assert.deepEqual(preview.summary.missing_telegram, ['DN004', 'DN012', 'DN022']);
  assert.deepEqual(preview.blocked_requested, EXCLUDED_EMP_CODES);
  assert.equal(preview.send_enabled, false);
  assert.equal(f.calls.length, 0);
  assert.equal(preview.recipients.every((item) => item.file.emp_code === item.emp_code && !('file_path' in item.file)), true);
  assert.equal(new Set(preview.recipients.map((item) => item.file.file_name)).size, 18);
});

test('selected provider must be ready before delivery preview', async (t) => {
  const f = fixture({ emailReady: false }); t.after(f.cleanup);
  const service = f.build();
  await assert.rejects(() => service.preview({ emp_codes: ['DN004'], channels: { email: true, telegram: false } }, 'admin-A'), (error) => error.code === 'FILTERED_DELIVERY_EMAIL_UNAVAILABLE');
});

test('scope and sensitive-field guards fail closed', () => {
  assert.throws(() => assertSafeReport(reportFor('DN001'), 'DN021'), (error) => error.code === 'FILTERED_DELIVERY_EMPLOYEE_BLOCKED');
  assert.throws(() => assertSafeReport({ ...reportFor('DN001'), rows: [{ emp_code: 'DN002' }] }, 'DN001'), (error) => error.code === 'FILTERED_DELIVERY_SCOPE_MISMATCH');
  assert.throws(() => assertSafeReport({ ...reportFor('DN001'), rows: [{ emp_code: 'DN001', cp_total: 1 }] }, 'DN001'), (error) => error.code === 'FILTERED_DELIVERY_SENSITIVE_FIELD');
  assert.throws(() => assertSafeReport({ ...reportFor('DN001'), rows: [{ emp_code: 'DN001', private: { profitMargin: 1 } }] }, 'DN001'), (error) => error.code === 'FILTERED_DELIVERY_SENSITIVE_FIELD');
});

test('preview is actor-bound, expires, and sending is disabled until second approval', async (t) => {
  const f = fixture(); t.after(f.cleanup);
  const service = f.build();
  const preview = await service.preview({ emp_codes: ['DN001'] }, 'admin-A');
  assert.throws(() => service.status(preview.preview_id, 'admin-B'), (error) => error.code === 'FILTERED_DELIVERY_PREVIEW_REQUIRED');
  await assert.rejects(() => service.send(confirm(preview), 'admin-A'), (error) => error.code === 'FILTERED_DELIVERY_DISABLED');
  f.advance(60 * 60 * 1000 + 1);
  assert.throws(() => service.status(preview.preview_id, 'admin-A'), (error) => error.code === 'FILTERED_DELIVERY_PREVIEW_EXPIRED');
});

test('send verifies manifest, sends exact one employee file per channel, and is idempotent', async (t) => {
  const f = fixture({ sendEnabled: true }); t.after(f.cleanup);
  const service = f.build();
  const preview = await service.preview({ emp_codes: ['DN001', 'DN004'] }, 'admin-A');
  await assert.rejects(() => service.send({ ...confirm(preview), manifest_digest: 'wrong' }, 'admin-A'), (error) => error.code === 'FILTERED_DELIVERY_MANIFEST_MISMATCH');
  await assert.rejects(() => service.send(confirm(preview), 'admin-A'), (error) => error.code === 'FILTERED_DELIVERY_SECOND_APPROVAL_REQUIRED');
  secondApprove(service, preview);
  const first = await service.send(confirm(preview), 'admin-A');
  assert.equal(first.status, 'sent');
  assert.equal(f.calls.length, 3); // DN001: email+Telegram; DN004: email only.
  for (const call of f.calls.filter((item) => item.channel === 'email')) {
    assert.equal(call.attachments.length, 1);
    const code = call.to.slice(0, 5).toUpperCase();
    assert.equal(call.attachments[0].content.toString(), `xlsx-private-${code}`);
  }
  await service.send(confirm(preview), 'admin-A');
  assert.equal(f.calls.length, 3);
});

test('recipient mapping changes after preview fail closed', async (t) => {
  const f = fixture({ sendEnabled: true }); t.after(f.cleanup);
  const service = f.build();
  const preview = await service.preview({ emp_codes: ['DN001'] }, 'admin-A');
  secondApprove(service, preview);
  f.changeTelegram(['DN001', 'DN004', 'DN012', 'DN022']);
  await assert.rejects(() => service.send(confirm(preview), 'admin-A'), (error) => error.code === 'FILTERED_DELIVERY_RECIPIENT_CHANGED');
  assert.equal(f.calls.length, 0);
});

test('retry sends only failed channels and does not resend successful channels', async (t) => {
  let failedOnce = false;
  const f = fixture({
    sendEnabled: true,
    emailResult: (to) => {
      if (to.startsWith('dn001') && !failedOnce) { failedOnce = true; return { ok: false, description: 'temporary smtp rejection' }; }
      return { ok: true };
    },
  });
  t.after(f.cleanup);
  const service = f.build();
  const preview = await service.preview({ emp_codes: ['DN001', 'DN004'] }, 'admin-A');
  secondApprove(service, preview);
  const first = await service.send(confirm(preview), 'admin-A');
  assert.equal(first.status, 'partial');
  assert.equal(f.calls.length, 3);
  await assert.rejects(() => service.retry(preview.preview_id, confirm(preview), 'admin-A'), (error) => error.code === 'FILTERED_DELIVERY_SECOND_APPROVAL_REQUIRED');
  secondApprove(service, preview);
  const retried = await service.retry(preview.preview_id, confirm(preview), 'admin-A');
  assert.equal(retried.status, 'sent');
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[3].channel, 'email');
  assert.equal(f.calls[3].to.startsWith('dn001'), true);
});

test('ambiguous provider outcome is marked unknown and never automatically retried', async (t) => {
  const f = fixture({ sendEnabled: true, emailResult: () => ({ ok: false, description: 'SMTP timeout after DATA' }) });
  t.after(f.cleanup);
  const service = f.build();
  const preview = await service.preview({ emp_codes: ['DN004'], channels: { telegram: false, email: true } }, 'admin-A');
  secondApprove(service, preview);
  const first = await service.send(confirm(preview), 'admin-A');
  assert.equal(first.status, 'partial');
  assert.equal(first.results[0].channels.email.status, 'unknown');
  secondApprove(service, preview);
  await service.retry(preview.preview_id, confirm(preview), 'admin-A');
  assert.equal(f.calls.length, 1);
});

test('unparseable Telegram response is unknown and never automatically retried', async (t) => {
  const f = fixture({ sendEnabled: true, telegramResult: () => ({ ok: false, description: 'telegram_document_failed' }) });
  t.after(f.cleanup);
  const service = f.build();
  const preview = await service.preview({ emp_codes: ['DN001'], channels: { telegram: true, email: false } }, 'admin-A');
  secondApprove(service, preview);
  const first = await service.send(confirm(preview), 'admin-A');
  assert.equal(first.results[0].channels.telegram.status, 'unknown');
  secondApprove(service, preview);
  await service.retry(preview.preview_id, confirm(preview), 'admin-A');
  assert.equal(f.calls.length, 1);
});

test('same content in a fresh preview is blocked by cross-preview idempotency', async (t) => {
  const f = fixture({ sendEnabled: true }); t.after(f.cleanup);
  const service = f.build();
  const firstPreview = await service.preview({ emp_codes: ['DN004'], channels: { telegram: false, email: true } }, 'admin-A');
  secondApprove(service, firstPreview);
  await service.send(confirm(firstPreview), 'admin-A');
  assert.equal(f.calls.length, 1);
  const secondPreview = await service.preview({ emp_codes: ['DN004'], channels: { telegram: false, email: true } }, 'admin-A');
  secondApprove(service, secondPreview);
  const second = await service.send(confirm(secondPreview), 'admin-A');
  assert.equal(f.calls.length, 1);
  assert.equal(second.results[0].channels.email.duplicate_blocked, true);
});

test('cross-process file lock prevents two service instances from sending concurrently', async (t) => {
  let releaseProvider;
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  const f = fixture({ sendEnabled: true, emailResult: async () => { await providerGate; return { ok: true }; } });
  t.after(f.cleanup);
  const serviceA = f.build();
  const serviceB = f.build();
  const preview = await serviceA.preview({ emp_codes: ['DN004'], channels: { telegram: false, email: true } }, 'admin-A');
  secondApprove(serviceA, preview);
  const firstSend = serviceA.send(confirm(preview), 'admin-A');
  await assert.rejects(() => serviceB.send(confirm(preview), 'admin-A'), (error) => error.code === 'FILTERED_DELIVERY_IN_PROGRESS');
  releaseProvider();
  await firstSend;
  assert.equal(f.calls.length, 1);
});

test('stale send lock is recovered fail-closed and revokes unused approval', async (t) => {
  const f = fixture({ sendEnabled: true }); t.after(f.cleanup);
  const service = f.build();
  const preview = await service.preview({ emp_codes: ['DN004'], channels: { telegram: false, email: true } }, 'admin-A');
  secondApprove(service, preview);
  const lockDir = path.join(f.outputDir, '.locks');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, 'send-global.lock');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, at: '2026-07-19T09:00:00.000Z' }));
  const old = new Date('2026-07-19T09:00:00.000Z'); fs.utimesSync(lockPath, old, old);
  await assert.rejects(() => service.send(confirm(preview), 'admin-A'), (error) => error.code === 'FILTERED_DELIVERY_INTERRUPTED_REVIEW_REQUIRED');
  assert.equal(service.status(preview.preview_id, 'admin-A').approval.status, 'revoked');
  secondApprove(service, preview);
  await service.send(confirm(preview), 'admin-A');
  assert.equal(f.calls.length, 1);
});

test('persisted preview can be recovered after service restart', async (t) => {
  const f = fixture(); t.after(f.cleanup);
  const firstService = f.build();
  const preview = await firstService.preview({ emp_codes: ['DN001'] }, 'admin-A');
  const restartedService = f.build();
  const recovered = restartedService.status(preview.preview_id, 'admin-A');
  assert.equal(recovered.manifest_digest, preview.manifest_digest);
  assert.equal(recovered.summary.recipients, 1);
});
