'use strict';

const crypto = require('crypto');

const STORE_NAME = 'dormant_qlnb_feedback';
const FEEDBACK_TYPES = Object.freeze(['approved', 'revise', 'priority', 'continue_follow_up', 'close_tracking', 'other']);
const ACK_TYPES = Object.freeze(['read', 'updated']);
const MAX_NOTE_LENGTH = 240;
const DEFAULT_PUBLIC_URL = 'https://report.donapharm.asia/';
const TELEGRAM_HARD_EXCLUDED = new Set(['DN021', 'DN023', 'VP004', 'VP018']);

const text = (v) => String(v == null ? '' : v).trim();
const upper = (v) => text(v).toUpperCase();
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sensitiveText(value) {
  const note = text(value);
  return /\d|[%₫$€£¥]|\b(?:cp(?:\s*total|[\s._-]*\d+)?|remain[\s_-]*amount|bid[\s_-]*price|margin|profit|costs?|price|vnd|usd|eur|revenue)\b|giá(?:\s*(?:vốn|bán|trị))?|chi\s*phí|doanh\s*(?:thu|số)|lợi\s*nhuận|phần\s*trăm|tiền|đồng|triệu|tỷ|nghìn/iu.test(note);
}

function sensitivePreviewText(value) {
  // Deep-link query parameters are percent-encoded and contain numeric QLNB
  // identifiers. They are generated from a strict whitelist, not free text.
  const message = text(value).replace(/https?:\/\/\S+/giu, '');
  return /[%₫$€£¥]|\b(?:cp(?:\s*total|[\s._-]*\d+)?|remain[\s_-]*amount|bid[\s_-]*price|margin|profit|costs?|price|vnd|usd|eur|revenue)\b|giá(?:\s*(?:vốn|bán|trị))?|chi\s*phí|doanh\s*(?:thu|số)|lợi\s*nhuận|phần\s*trăm|tiền|đồng|triệu|tỷ|nghìn/iu.test(message);
}

function safeShortNote(value) {
  const note = text(value);
  if (!note) return '';
  if (note.length > MAX_NOTE_LENGTH) throw new Error(`Nội dung phản hồi tối đa ${MAX_NOTE_LENGTH} ký tự`);
  if (sensitiveText(note)) {
    const err = new Error('Nội dung phản hồi có số hoặc thông tin tài chính nhạy cảm');
    err.code = 'SENSITIVE_FEEDBACK';
    throw err;
  }
  return note.replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseStore(raw) {
  if (!raw || typeof raw !== 'object') return { version: 1, feedback: [], acknowledgements: [] };
  return {
    version: 1,
    feedback: Array.isArray(raw.feedback) ? raw.feedback : [],
    acknowledgements: Array.isArray(raw.acknowledgements) ? raw.acknowledgements : [],
  };
}

function maskTelegramId(value) {
  const tid = text(value);
  if (!tid) return null;
  return tid.length <= 4 ? '*'.repeat(tid.length) : `${'*'.repeat(Math.max(4, tid.length - 4))}${tid.slice(-4)}`;
}

function publicDeepLink(item, publicUrl = DEFAULT_PUBLIC_URL) {
  const base = new URL(publicUrl || DEFAULT_PUBLIC_URL);
  base.searchParams.set('tab', 'dormantReports');
  base.searchParams.set('focus_key', text(item.key));
  base.searchParams.set('unit_code', text(item.unit_code));
  return base.toString();
}

function feedbackLabel(type) {
  return ({
    approved: 'Đã duyệt kế hoạch',
    revise: 'Cần điều chỉnh kế hoạch',
    priority: 'Ưu tiên xử lý',
    continue_follow_up: 'Tiếp tục theo dõi',
    close_tracking: 'Đóng theo dõi',
    other: 'Ý kiến khác',
  })[type] || 'Phản hồi của CEO';
}

function telegramManifest(preview = {}) {
  return {
    version: preview.version,
    channel: preview.channel,
    feedback_id: preview.feedback_id,
    idempotency_event: preview.idempotency_event,
    emp_code: preview.emp_code,
    recipient_digest: preview.recipient_digest,
    deep_link: preview.deep_link,
    message: preview.message,
    send_enabled: preview.send_enabled,
    provider_called: preview.provider_called,
    status: preview.status,
    blocked_reason: preview.blocked_reason,
  };
}

function telegramManifestDigest(preview) {
  return sha256(canonical(telegramManifest(preview)));
}

function verifyTelegramManifest(preview) {
  const actual = text(preview?.manifest_digest);
  const expected = telegramManifestDigest(preview || {});
  const validShape = /^[a-f0-9]{64}$/.test(actual);
  const matches = validShape && crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  if (!matches || preview?.send_enabled !== false || preview?.provider_called !== false) {
    const err = new Error('Telegram preview manifest không toàn vẹn');
    err.code = 'TELEGRAM_MANIFEST_INTEGRITY_FAILED';
    throw err;
  }
  return telegramManifest(preview);
}

function createDormantFeedbackStore({ persist, notificationStore, listTelegramMap = () => [], clock = () => Date.now(), publicUrl = process.env.APP_REPORT_PUBLIC_URL || DEFAULT_PUBLIC_URL } = {}) {
  if (!persist?.load || !persist?.save) throw new Error('persist store is required');
  if (!notificationStore?.add || !notificationStore?.acknowledge) throw new Error('notification store is required');
  const load = () => parseStore(persist.load(STORE_NAME, null));
  const save = (state) => persist.save(STORE_NAME, state);

  function telegramRecipient(empCode) {
    const emp = upper(empCode);
    if (TELEGRAM_HARD_EXCLUDED.has(emp)) return { ok: false, reason: 'employee_hard_excluded' };
    const matches = (listTelegramMap() || []).filter((row) => upper(row?.emp_code) === emp && text(row?.telegram_id));
    if (!matches.length) return { ok: false, reason: 'telegram_mapping_missing' };
    if (matches.length !== 1) return { ok: false, reason: 'telegram_mapping_ambiguous' };
    return { ok: true, telegram_id: text(matches[0].telegram_id) };
  }

  function buildTelegramPreview({ feedback, item }) {
    const recipient = telegramRecipient(feedback.emp_code);
    const label = feedbackLabel(feedback.type);
    const productLabel = text(item.product_name) && !sensitivePreviewText(item.product_name) ? text(item.product_name) : `QLNB ${feedback.iit_code}`;
    const unitLabel = text(item.unit_name) && !sensitivePreviewText(item.unit_name) ? text(item.unit_name) : `mã đơn vị ${feedback.unit_code}`;
    const prose = [
      '🔔 App Report — Phản hồi QLNB',
      label,
      `${productLabel} tại ${unitLabel}`,
      feedback.note ? `Ý kiến: ${feedback.note}` : null,
      'Mở App Report để xem và xác nhận.',
    ].filter(Boolean).join('\n');
    if (sensitivePreviewText(prose)) throw new Error('Telegram preview contains sensitive content');
    const message = `${prose}\n${feedback.deep_link}`;
    const manifest = {
      version: 1,
      channel: 'telegram',
      feedback_id: feedback.id,
      idempotency_event: `ceo_feedback:${feedback.id}`,
      emp_code: feedback.emp_code,
      recipient_digest: recipient.ok ? sha256(`${feedback.emp_code}:${recipient.telegram_id}`) : null,
      deep_link: feedback.deep_link,
      message,
      send_enabled: false,
      provider_called: false,
      status: recipient.ok ? 'preview_only' : 'blocked',
      blocked_reason: recipient.ok ? null : recipient.reason,
    };
    return {
      ...manifest,
      recipient_masked: recipient.ok ? maskTelegramId(recipient.telegram_id) : null,
      manifest_digest: telegramManifestDigest(manifest),
    };
  }

  function create({ item, type, note, actionCycle, actor, requestId } = {}) {
    const key = text(item?.key);
    const empCode = upper(item?.emp_code);
    const unitCode = text(item?.unit_code);
    const iitCode = text(item?.iit_code);
    const cycle = Number(actionCycle);
    const feedbackType = text(type);
    const idempotencyKey = text(requestId);
    if (!key || !empCode || !unitCode || !iitCode) throw new Error('Thiếu khóa nhân viên–đơn vị–QLNB');
    if (!Number.isInteger(cycle) || cycle <= 0) throw new Error('Chu kỳ xử lý không hợp lệ');
    if (!FEEDBACK_TYPES.includes(feedbackType)) throw new Error('Loại phản hồi CEO không hợp lệ');
    if (idempotencyKey.length < 8 || idempotencyKey.length > 120) throw new Error('request_id không hợp lệ');
    const safeNote = safeShortNote(note);
    const state = load();
    const duplicate = state.feedback.find((entry) => entry.request_id === idempotencyKey);
    if (duplicate) {
      if (duplicate.item_key !== key || duplicate.action_cycle !== cycle || duplicate.type !== feedbackType || duplicate.note !== safeNote) {
        const err = new Error('request_id đã được dùng cho phản hồi khác');
        err.code = 'IDEMPOTENCY_CONFLICT';
        throw err;
      }
      // Reconcile a notification if a prior process stopped after persisting.
      notificationStore.add({
        id: duplicate.notification_id,
        audience: 'employee', type: 'ceo_feedback', severity: feedbackType === 'priority' || feedbackType === 'revise' ? 'warning' : 'info',
        emp_code: duplicate.emp_code, unit_code: duplicate.unit_code, unit_name: duplicate.unit_name,
        qlnb_codes: [duplicate.iit_code], item_keys: [duplicate.item_key], count: 1,
        cycle: duplicate.dormant_cycle, action_cycle: duplicate.action_cycle, feedback_id: duplicate.id,
        ref_date: duplicate.created_at.slice(0, 10), title: 'CEO vừa phản hồi kế hoạch QLNB',
        message: `${feedbackLabel(duplicate.type)} — ${duplicate.product_name || duplicate.iit_code}.`,
        target: { tab: 'dormantReports', item_key: duplicate.item_key, unit_code: duplicate.unit_code }, at: duplicate.created_at,
      });
      return { ...duplicate, duplicate: true };
    }

    const createdAt = new Date(clock()).toISOString();
    const id = `fb_${sha256(canonical([key, cycle, idempotencyKey])).slice(0, 24)}`;
    const notificationId = `nf_${sha256(`employee:feedback:${id}`).slice(0, 24)}`;
    const feedback = {
      id,
      request_id: idempotencyKey,
      item_key: key,
      emp_code: empCode,
      employee_name: text(item.employee_name),
      unit_code: unitCode,
      unit_name: text(item.unit_name),
      iit_code: iitCode,
      product_name: text(item.product_name),
      dormant_cycle: Math.max(0, Number(item.dormant_cycle || 0)),
      action_cycle: cycle,
      type: feedbackType,
      label: feedbackLabel(feedbackType),
      note: safeNote,
      created_at: createdAt,
      created_by: upper(actor) || 'CEO',
      deep_link: publicDeepLink(item, publicUrl),
      notification_id: notificationId,
    };
    feedback.telegram_preview = buildTelegramPreview({ feedback, item });
    // Immutable append-only log: there is deliberately no update/delete API.
    state.feedback.push(feedback);
    save(state);
    notificationStore.add({
      id: notificationId,
      audience: 'employee', type: 'ceo_feedback', severity: feedbackType === 'priority' || feedbackType === 'revise' ? 'warning' : 'info',
      emp_code: empCode, unit_code: unitCode, unit_name: feedback.unit_name,
      qlnb_codes: [iitCode], item_keys: [key], count: 1,
      cycle: feedback.dormant_cycle, action_cycle: cycle, feedback_id: id,
      ref_date: createdAt.slice(0, 10), title: 'CEO vừa phản hồi kế hoạch QLNB',
      message: `${feedback.label} — ${feedback.product_name || iitCode}.`,
      target: { tab: 'dormantReports', item_key: key, unit_code: unitCode }, at: createdAt,
    });
    return { ...feedback, duplicate: false };
  }

  function listForItem(itemKey, { empCode } = {}) {
    const key = text(itemKey);
    const emp = upper(empCode);
    const state = load();
    return state.feedback.filter((entry) => entry.item_key === key && (!emp || entry.emp_code === emp)).map((entry) => {
      const acks = state.acknowledgements.filter((ack) => ack.feedback_id === entry.id);
      return {
        id: entry.id,
        item_key: entry.item_key,
        emp_code: entry.emp_code,
        unit_code: entry.unit_code,
        iit_code: entry.iit_code,
        action_cycle: entry.action_cycle,
        type: entry.type,
        label: entry.label,
        note: entry.note,
        created_at: entry.created_at,
        deep_link: entry.deep_link,
        acknowledgements: acks.map((ack) => ({ id: ack.id, kind: ack.kind, at: ack.at })),
      };
    });
  }

  function acknowledge({ feedbackId, empCode, kind, requestId } = {}) {
    const id = text(feedbackId);
    const emp = upper(empCode);
    const ackKind = text(kind);
    const idempotencyKey = text(requestId);
    if (!ACK_TYPES.includes(ackKind)) throw new Error('Trạng thái xác nhận không hợp lệ');
    if (idempotencyKey.length < 8 || idempotencyKey.length > 120) throw new Error('request_id không hợp lệ');
    const state = load();
    const feedback = state.feedback.find((entry) => entry.id === id && entry.emp_code === emp);
    if (!feedback) {
      const err = new Error('Không tìm thấy phản hồi trong phạm vi nhân viên');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const duplicate = state.acknowledgements.find((ack) => ack.request_id === idempotencyKey);
    if (duplicate) {
      if (duplicate.feedback_id !== id || duplicate.emp_code !== emp || duplicate.kind !== ackKind) {
        const err = new Error('request_id đã được dùng cho xác nhận khác');
        err.code = 'IDEMPOTENCY_CONFLICT';
        throw err;
      }
      // Reconcile derived notification state after an interrupted prior call.
      notificationStore.acknowledge({ ids: [feedback.notification_id], empCode: emp, kind: ackKind });
      return { ...duplicate, duplicate: true };
    }
    const acknowledgement = {
      id: `ack_${sha256(canonical([id, emp, ackKind, idempotencyKey])).slice(0, 24)}`,
      request_id: idempotencyKey,
      feedback_id: id,
      item_key: feedback.item_key,
      emp_code: emp,
      action_cycle: feedback.action_cycle,
      kind: ackKind,
      at: new Date(clock()).toISOString(),
    };
    state.acknowledgements.push(acknowledgement);
    save(state);
    notificationStore.acknowledge({ ids: [feedback.notification_id], empCode: emp, kind: ackKind });
    return { ...acknowledgement, duplicate: false };
  }

  function telegramPreview(feedbackId) {
    const id = text(feedbackId);
    const feedback = load().feedback.find((entry) => entry.id === id);
    if (!feedback) {
      const err = new Error('Không tìm thấy phản hồi');
      err.code = 'NOT_FOUND';
      throw err;
    }
    verifyTelegramManifest(feedback.telegram_preview);
    return { feedback_id: id, ...feedback.telegram_preview };
  }

  return { create, listForItem, acknowledge, telegramPreview };
}

module.exports = {
  STORE_NAME,
  FEEDBACK_TYPES,
  ACK_TYPES,
  TELEGRAM_HARD_EXCLUDED,
  MAX_NOTE_LENGTH,
  canonical,
  sensitiveText,
  sensitivePreviewText,
  safeShortNote,
  publicDeepLink,
  telegramManifest,
  telegramManifestDigest,
  verifyTelegramManifest,
  createDormantFeedbackStore,
};
