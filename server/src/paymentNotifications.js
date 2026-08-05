'use strict';

/**
 * In-app payment feed derived from the durable payment ledger audit.
 * The ledger remains the source of truth; this module only persists per-audience read markers.
 */
const crypto = require('crypto');
const defaultPersist = require('./persist');
const paymentLedgerStore = require('./paymentLedgerStore');

const READ_FILE = 'payment_notification_reads';
const MAX_READ_IDS = 5000;
const CEO_ACTIONS = new Set(['flow_second', 'flow_final', 'note_second', 'note_final']);
const EMPLOYEE_ACTIONS = new Set(['flow_second', 'flow_final', 'pay_second', 'pay_final', 'undo_second', 'undo_final']);

const text = (value) => String(value == null ? '' : value).trim();
const upper = (value) => text(value).toUpperCase();
const stableId = (parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
const audienceKey = ({ ceo = false, empCode = '' } = {}) => ceo ? 'CEO' : `EMP:${upper(empCode)}`;

function readState(store) {
  const value = store.load(READ_FILE, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function eventFor(empCode, period, audit, index, { ceo }) {
  const action = text(audit?.action);
  const key = action.endsWith('_final') ? 'final' : 'second';
  const step = key === 'final' ? 'Lần 3' : 'Lần 2';
  const from = text(audit?.from);
  const to = text(audit?.to);
  const note = text(audit?.note).slice(0, 300);
  let title = '';
  let message = '';
  let type = action;

  if (ceo) {
    if (action.startsWith('note_')) {
      title = `${upper(empCode)} gửi nội dung khác · ${step}`;
      message = note;
      type = 'payment_note';
    } else if (to === 'requested') {
      title = `${upper(empCode)} đề nghị nhận ${step}`;
      message = note || 'Nhân viên đã gửi đề nghị nhận.';
      type = 'payment_requested';
    } else if (to === 'unlock_requested') {
      title = `${upper(empCode)} xin nhận sớm ${step}`;
      message = note;
      type = 'payment_unlock_requested';
    } else return null;
  } else {
    if (action.startsWith('pay_')) {
      title = `${step} đã được ghi nhận trả`;
      message = audit?.paidAt ? `Ngày ghi nhận: ${text(audit.paidAt).split('-').reverse().join('/')}.` : 'Khoản thanh toán đã được cập nhật.';
      type = 'payment_paid';
    } else if (action.startsWith('undo_')) {
      title = `Đã gỡ ghi nhận trả ${step}`;
      message = 'Sổ thanh toán cá nhân đã được cập nhật.';
      type = 'payment_undone';
    } else if (action.startsWith('flow_') && to === 'unlocked') {
      title = `${step} đã được mở để đề nghị sớm`;
      message = note || 'Bạn có thể mở sổ và gửi đề nghị nhận.';
      type = 'payment_unlocked';
    } else if (action.startsWith('flow_') && to === 'approved') {
      title = `Đề nghị ${step} đã được duyệt`;
      message = note || 'Đã duyệt đề nghị; chờ ghi nhận chuyển tiền.';
      type = 'payment_approved';
    } else if (action.startsWith('flow_') && to === 'plan' && ['requested', 'unlock_requested', 'unlocked', 'approved'].includes(from)) {
      title = `Đề nghị ${step} chưa được duyệt`;
      message = note || 'Bạn có thể xem lại và gửi đề nghị mới.';
      type = 'payment_rejected';
    } else return null;
  }

  const at = text(audit?.at);
  const requestId = text(audit?.requestId);
  return {
    id: stableId([upper(empCode), period, action, at, upper(audit?.by), from, to, note, requestId]),
    type,
    emp_code: upper(empCode),
    period,
    key,
    title,
    message,
    ...(ceo && note ? { note } : {}),
    // Amount is intentionally projected only into the CEO feed.
    ...(ceo && Number.isSafeInteger(audit?.to) && action.startsWith('pay_') ? { amount: audit.to } : {}),
    at,
    target: { tab: 'paymentSchedule', emp_code: upper(empCode), period, key },
  };
}

function createPaymentNotificationFeed({ persist = defaultPersist, ledger = paymentLedgerStore } = {}) {
  function feed({ ceo = false, empCode = '' } = {}) {
    const own = upper(empCode);
    if (!ceo && !own) throw Object.assign(new Error('Thiếu phạm vi nhân viên'), { status: 403, code: 'PAYMENT_NOTIFICATION_SCOPE_REQUIRED' });
    const wanted = ceo ? CEO_ACTIONS : EMPLOYEE_ACTIONS;
    const events = [];
    const entries = ledger.listEntries ? ledger.listEntries() : [];
    for (const entry of entries) {
      if (!ceo && entry.empCode !== own) continue;
      (entry.audit || []).forEach((audit, index) => {
        if (!wanted.has(text(audit?.action))) return;
        const event = eventFor(entry.empCode, entry.period, audit, index, { ceo });
        if (event) events.push(event);
      });
    }
    const state = readState(persist);
    const readIds = new Set(Array.isArray(state[audienceKey({ ceo, empCode: own })]) ? state[audienceKey({ ceo, empCode: own })] : []);
    const projected = events
      .sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id.localeCompare(a.id))
      .slice(0, 200)
      .map((event) => ({ ...event, read_at: readIds.has(event.id) ? true : null }));
    return { unread_count: projected.filter((event) => !event.read_at).length, events: projected };
  }

  function markRead({ ceo = false, empCode = '', ids = [], all = false } = {}) {
    const current = feed({ ceo, empCode });
    const visible = new Set(current.events.map((event) => event.id));
    const requested = new Set((Array.isArray(ids) ? ids : []).slice(0, 500).map(text).filter(Boolean));
    const selected = current.events.filter((event) => !event.read_at && (all || requested.has(event.id))).map((event) => event.id);
    // Never accept IDs outside the authenticated audience's current feed.
    const safe = selected.filter((id) => visible.has(id));
    const state = readState(persist);
    const key = audienceKey({ ceo, empCode });
    state[key] = [...new Set([...(Array.isArray(state[key]) ? state[key] : []), ...safe])].slice(-MAX_READ_IDS);
    if (safe.length) persist.save(READ_FILE, state);
    return { ok: true, changed: safe.length, unread_count: Math.max(0, current.unread_count - safe.length) };
  }

  return { feed, markRead };
}

module.exports = { READ_FILE, MAX_READ_IDS, stableId, createPaymentNotificationFeed };
