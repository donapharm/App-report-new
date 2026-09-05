'use strict';

const persist = require('./persist');
const notifyChannels = require('./notifyChannels');
const salesReport = require('./salesReport');

const STATE = 'revenue_sync_incident_state';
const SAFE_CODE = /^[A-Z0-9_:-]{1,120}$/;

function safeCode(value) {
  const code = String(value || 'REVENUE_SYNC_FAILED').toUpperCase();
  return SAFE_CODE.test(code) ? code : 'REVENUE_SYNC_FAILED';
}

function messageFor(event = {}) {
  const sources = event.sources || {};
  const failed = ['APP_WEB', 'DEBTS_DONA', 'DEBTS_AFP'].filter((key) => sources[key]?.status === 'failed');
  const pending = ['APP_WEB', 'DEBTS_DONA', 'DEBTS_AFP'].filter((key) => !sources[key] || sources[key].status === 'pending');
  const severity = failed.length > 1 || event.kind === 'stale' ? '🔴' : '🟠';
  const lines = [
    `${severity} App Report chưa cập nhật doanh thu kỳ ${event.period || 'hiện tại'}.`,
    `Lượt ${event.slot || 'không xác định'} · mã ${safeCode(event.code)}.`,
    `Nguồn lỗi: ${failed.length ? failed.join(', ') : 'chưa xác định'}${pending.length ? ` · chưa hoàn tất: ${pending.join(', ')}` : ''}.`,
    `Dữ liệu đang hiển thị đến: ${event.activeDataThrough || 'chưa xác định'}. Giữ slot cũ; không fallback CRM/MISA.`,
  ];
  if (event.nextRetryAt) lines.push(`Tự thử lại lúc ${event.nextRetryAt} (GMT+7).`);
  else lines.push('Đã hết lượt retry tự động; cần kiểm tra nguồn/mapping.');
  return lines.join('\n');
}

function stateKey(event) { return `${event.period || ''}|${event.slot || ''}|${event.kind || 'failure'}|${safeCode(event.code)}`; }

async function notifyCeo(event, { notify = notifyChannels, recipient = salesReport.ceoRecipient, store = persist } = {}) {
  const key = stateKey(event);
  const state = store.load(STATE, {});
  const prior = state[key] || {};
  const ceo = recipient();
  const text = messageFor(event);
  const email = notify.emailFor ? notify.emailFor('CEO', ceo?.user?.email || ceo?.email) : ceo?.email || '';
  const telegram = prior.telegramSentAt ? { ok: true, skipped: 'already_sent' }
    : ceo?.telegramId ? await notify.sendTelegram(ceo.telegramId, text) : { ok: false, description: 'CEO_TELEGRAM_MISSING' };
  const emailResult = prior.emailSentAt ? { ok: true, skipped: 'already_sent' }
    : email ? await notify.sendEmail(email, `[CẢNH BÁO] App Report chưa cập nhật doanh thu ${event.period || ''}`, text) : { ok: false, description: 'CEO_EMAIL_MISSING' };
  state[key] = {
    period: event.period || '', slot: event.slot || '', kind: event.kind || 'failure', code: safeCode(event.code),
    attempts: Number(prior.attempts || 0) + 1, lastAttemptAt: new Date().toISOString(),
    telegramSentAt: telegram.ok ? new Date().toISOString() : prior.telegramSentAt || null,
    telegramError: telegram.ok ? null : safeCode(telegram.description || 'TELEGRAM_SEND_FAILED'),
    emailSentAt: emailResult.ok ? new Date().toISOString() : prior.emailSentAt || null,
    emailError: emailResult.ok ? null : safeCode(emailResult.description || 'EMAIL_SEND_FAILED'),
  };
  store.save(STATE, state);
  return { ok: telegram.ok === true || emailResult.ok === true, telegram, email: emailResult, key };
}

module.exports = { STATE, safeCode, messageFor, stateKey, notifyCeo };
