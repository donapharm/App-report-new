'use strict';
/**
 * SỔ GHI NHẬN THANH TOÁN LẦN 2 / LẦN 3 — GĐ2 (SPEC_THANH_TOAN_CP_SELFVIEW.md §8)
 *
 * App Salary KHÔNG có lần 2/3 ⇒ App Report là NƠI GHI NHẬN. Vì đây là tiền thật:
 *   - Chỉ NGƯỜI CÓ QUYỀN được ghi. NV chỉ xem.
 *   - KHÔNG tự đánh dấu, không auto-assume: chưa ai ghi thì mãi là "kế hoạch".
 *   - MỌI thay đổi đều có nhật ký: ai · khi nào · số cũ → số mới. Không ghi đè lặng.
 *
 * Ghi nhận đã trả Lần 2 cũng chính là chốt số Lần 2 (số THẬT đã chuyển), nên Lần 3
 * tự tính lại = Tổng − Lần 1 − Lần 2. Nhờ vậy bất biến Σ(các lần) == Tổng luôn giữ.
 */

const persist = require('./persist');

const FILE = 'payment_ledger';
const EDITABLE_KEYS = new Set(['second', 'final']);
const AUDIT_LIMIT_PER_ENTRY = 200;

const keyOf = (empCode, period) => `${String(empCode || '').trim().toUpperCase()}|${String(period || '').trim()}`;

function moneyOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function isDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }

function readAll(store) {
  const rows = store.load(FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

/**
 * QUY TRÌNH ĐỀ NGHỊ — CEO chốt 04/08/2026 21:30.
 *
 * Lần 1 do App Salary chi. TỪ LẦN 2 trở đi đi qua đúng bốn nấc:
 *
 *     kế hoạch ──(NV bấm đề nghị)──▶ đã đề nghị ──(CEO duyệt)──▶ đã duyệt ──▶ đã trả
 *         ▲                                │
 *         └──────── CEO từ chối ───────────┘   (quay về kế hoạch, NV đề nghị LẠI được)
 *
 * Chưa tới mốc thì NV KHÔNG bấm đề nghị thẳng được — phải **xin mở khoá sớm**, CEO
 * đồng ý thì mới mở. CEO chốt: *"một số trường hợp có thể được phép đề nghị sớm hơn,
 * nhưng phải có đường để NV gửi yêu cầu mở khoá"*.
 *
 * ‼ NV KHÔNG BAO GIỜ nhập số tiền — chỉ bấm đề nghị. Số vẫn do backend tính.
 * ‼ Duyệt / từ chối / ghi đã trả: CHỈ CEO.
 */
const FLOW_STATES = Object.freeze(['plan', 'unlock_requested', 'unlocked', 'requested', 'approved']);
const NOTE_MAX_LENGTH = 300;

function sanitizeNote(value, { required = false } = {}) {
  const note = String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (note.length > NOTE_MAX_LENGTH) {
    throw Object.assign(new Error(`Ghi chú tối đa ${NOTE_MAX_LENGTH} ký tự`), { status: 400, code: 'PAYMENT_NOTE_TOO_LONG' });
  }
  if (required && !note) {
    throw Object.assign(new Error('Vui lòng nhập ghi chú'), { status: 400, code: 'PAYMENT_NOTE_REQUIRED' });
  }
  return note;
}

function sanitizeRequestId(value) {
  const requestId = String(value == null ? '' : value).trim();
  if (requestId && !/^[A-Za-z0-9._:-]{8,100}$/.test(requestId)) {
    throw Object.assign(new Error('Mã chống gửi trùng không hợp lệ'), { status: 400, code: 'PAYMENT_REQUEST_ID_INVALID' });
  }
  return requestId;
}

function idempotencyRecord(entry, requestId, actor) {
  if (!requestId) return null;
  return entry.audit.find((record) => record.requestId === requestId && record.by === actor) || null;
}

function assertSameRetry(record, expected) {
  if (!record) return false;
  const same = Object.entries(expected).every(([key, value]) => record[key] === value);
  if (!same) {
    throw Object.assign(new Error('Mã chống gửi trùng đã được dùng cho nội dung khác'), { status: 409, code: 'PAYMENT_IDEMPOTENCY_CONFLICT' });
  }
  return true;
}

function emptyEntry() {
  return { secondOverride: null, paid: {}, flow: {}, audit: [] };
}

function normalizeFlow(raw) {
  const flow = {};
  for (const key of EDITABLE_KEYS) {
    const item = raw?.[key];
    if (!item || typeof item !== 'object') continue;
    const state = String(item.state || '');
    if (!FLOW_STATES.includes(state)) continue;
    flow[key] = {
      state,
      by: String(item.by || ''),
      at: String(item.at || ''),
      note: String(item.note || '').slice(0, 300),
      unlockedBy: String(item.unlockedBy || ''),
      approvedBy: String(item.approvedBy || ''),
    };
  }
  return flow;
}

function readEntry(empCode, period, { store = persist } = {}) {
  const row = readAll(store)[keyOf(empCode, period)];
  if (!row || typeof row !== 'object') return emptyEntry();
  const paid = {};
  for (const key of EDITABLE_KEYS) {
    const item = row.paid?.[key];
    const amount = moneyOrNull(item?.amount);
    if (amount != null && isDate(item?.paidAt)) {
      paid[key] = { amount, paidAt: String(item.paidAt), by: String(item.by || ''), at: String(item.at || '') };
    }
  }
  return {
    secondOverride: moneyOrNull(row.secondOverride),
    paid,
    flow: normalizeFlow(row.flow),
    audit: Array.isArray(row.audit) ? row.audit.slice(-AUDIT_LIMIT_PER_ENTRY) : [],
  };
}

function listEntries({ store = persist } = {}) {
  return Object.entries(readAll(store)).map(([identity]) => {
    const split = identity.indexOf('|');
    const empCode = split < 0 ? '' : identity.slice(0, split);
    const period = split < 0 ? '' : identity.slice(split + 1);
    return { empCode, period, ...readEntry(empCode, period, { store }) };
  }).filter((entry) => entry.empCode && entry.period);
}

function writeEntry(empCode, period, entry, store) {
  const rows = readAll(store);
  rows[keyOf(empCode, period)] = entry;
  store.save(FILE, rows);
  return entry;
}

function appendAudit(entry, record) {
  entry.audit = [...(entry.audit || []), record].slice(-AUDIT_LIMIT_PER_ENTRY);
}

/**
 * Chốt số Lần 2 (chưa trả, chỉ sửa kế hoạch). Lần 3 tự tính lại ở `paymentSchedule`.
 * `actor` bắt buộc — không có người chịu trách nhiệm thì không ghi.
 */
function setSecondOverride(empCode, period, amount, { actor, now = () => new Date().toISOString(), store = persist } = {}) {
  const who = String(actor || '').trim().toUpperCase();
  if (!who) throw Object.assign(new Error('Thiếu người thực hiện'), { status: 400, code: 'PAYMENT_ACTOR_REQUIRED' });
  const next = moneyOrNull(amount);
  if (next == null) throw Object.assign(new Error('Số tiền không hợp lệ'), { status: 400, code: 'PAYMENT_AMOUNT_INVALID' });
  const entry = readEntry(empCode, period, { store });
  const previous = entry.secondOverride;
  if (previous === next) return entry;
  entry.secondOverride = next;
  appendAudit(entry, { at: now(), by: who, action: 'set_second', from: previous, to: next });
  return writeEntry(empCode, period, entry, store);
}

/**
 * Ghi nhận ĐÃ TRẢ một lần (số tiền THẬT đã chuyển + ngày chuyển).
 * Ghi nhận Lần 2 đồng thời chốt luôn số Lần 2 — số thật thắng số kế hoạch.
 */
function recordPayment(empCode, period, key, { amount, paidAt, actor, now = () => new Date().toISOString(), store = persist } = {}) {
  const who = String(actor || '').trim().toUpperCase();
  if (!who) throw Object.assign(new Error('Thiếu người thực hiện'), { status: 400, code: 'PAYMENT_ACTOR_REQUIRED' });
  if (!EDITABLE_KEYS.has(String(key))) {
    // Lần 1 là số App Salary — App Report KHÔNG được ghi đè.
    throw Object.assign(new Error('Chỉ ghi nhận được Lần 2 hoặc Lần 3'), { status: 400, code: 'PAYMENT_KEY_INVALID' });
  }
  const value = moneyOrNull(amount);
  if (value == null) throw Object.assign(new Error('Số tiền không hợp lệ'), { status: 400, code: 'PAYMENT_AMOUNT_INVALID' });
  if (!isDate(paidAt)) throw Object.assign(new Error('Ngày chuyển không hợp lệ'), { status: 400, code: 'PAYMENT_DATE_INVALID' });

  const entry = readEntry(empCode, period, { store });
  const previous = entry.paid[key] || null;
  entry.paid[key] = { amount: value, paidAt: String(paidAt), by: who, at: now() };
  appendAudit(entry, {
    at: entry.paid[key].at, by: who, action: `pay_${key}`,
    from: previous ? previous.amount : null, to: value, paidAt: String(paidAt),
  });
  // Số THẬT đã chuyển của Lần 2 trở thành số chốt ⇒ Lần 3 tự co lại, tổng vẫn khớp.
  if (key === 'second' && entry.secondOverride !== value) {
    appendAudit(entry, { at: entry.paid[key].at, by: who, action: 'set_second', from: entry.secondOverride, to: value, cause: 'pay_second' });
    entry.secondOverride = value;
  }
  return writeEntry(empCode, period, entry, store);
}

// Gỡ ghi nhận (ghi nhầm). Vẫn để lại vết trong nhật ký, không xoá lịch sử.
function undoPayment(empCode, period, key, { actor, now = () => new Date().toISOString(), store = persist } = {}) {
  const who = String(actor || '').trim().toUpperCase();
  if (!who) throw Object.assign(new Error('Thiếu người thực hiện'), { status: 400, code: 'PAYMENT_ACTOR_REQUIRED' });
  if (!EDITABLE_KEYS.has(String(key))) throw Object.assign(new Error('Lần không hợp lệ'), { status: 400, code: 'PAYMENT_KEY_INVALID' });
  const entry = readEntry(empCode, period, { store });
  const previous = entry.paid[key];
  if (!previous) return entry;
  delete entry.paid[key];
  appendAudit(entry, { at: now(), by: who, action: `undo_${key}`, from: previous.amount, to: null });
  return writeEntry(empCode, period, entry, store);
}

function requireActor(actor) {
  const who = String(actor || '').trim().toUpperCase();
  if (!who) throw Object.assign(new Error('Thiếu người thực hiện'), { status: 400, code: 'PAYMENT_ACTOR_REQUIRED' });
  return who;
}

function requireKey(key) {
  if (!EDITABLE_KEYS.has(String(key))) {
    throw Object.assign(new Error('Chỉ thao tác được Lần 2 hoặc Lần 3'), { status: 400, code: 'PAYMENT_KEY_INVALID' });
  }
  return String(key);
}

const flowError = (message, code) => Object.assign(new Error(message), { status: 409, code });

/**
 * Chuyển một nấc trong quy trình. `expect` là các nấc được phép đứng trước.
 * Đứng sai nấc thì TỪ CHỐI kèm nấc hiện tại — không im lặng ghi đè.
 */
function moveFlow(empCode, period, key, nextState, {
  actor, expect, note = '', noteRequired = false, requestId = '', extra = {}, now = () => new Date().toISOString(), store = persist,
} = {}) {
  const who = requireActor(actor);
  const safeKey = requireKey(key);
  const entry = readEntry(empCode, period, { store });
  const safeRequestId = sanitizeRequestId(requestId);
  const retry = idempotencyRecord(entry, safeRequestId, who);
  if (retry) {
    const retryNote = sanitizeNote(note, { required: noteRequired });
    if (assertSameRetry(retry, { action: `flow_${safeKey}`, to: nextState, note: retryNote })) return entry;
  }
  // Trạng thái nghiệp vụ được ưu tiên hơn lỗi payload mới: sau khi đã trả thì luôn báo
  // sổ đã đóng, nhưng một retry chính xác ở trên vẫn trả thành công idempotent.
  if (entry.paid[safeKey]) throw flowError('Lần này đã ghi nhận trả — không đổi trạng thái nữa', 'PAYMENT_ALREADY_PAID');
  const current = entry.flow[safeKey]?.state || 'plan';
  if (Array.isArray(expect) && !expect.includes(current)) {
    throw flowError(`Đang ở nấc "${current}", không chuyển sang "${nextState}" được`, 'PAYMENT_FLOW_CONFLICT');
  }
  const safeNote = sanitizeNote(note, { required: noteRequired });
  const at = now();
  entry.flow[safeKey] = {
    ...(entry.flow[safeKey] || {}),
    state: nextState, by: who, at, note: safeNote,
    ...extra,
  };
  appendAudit(entry, { at, by: who, action: `flow_${safeKey}`, from: current, to: nextState, note: safeNote, ...(safeRequestId ? { requestId: safeRequestId } : {}) });
  return writeEntry(empCode, period, entry, store);
}

// NV bấm "Đề nghị nhận". Chỉ từ kế hoạch (đã tới mốc) hoặc đã được mở khoá sớm.
const requestPayment = (empCode, period, key, options = {}) =>
  moveFlow(empCode, period, key, 'requested', { ...options, expect: ['plan', 'unlocked'] });

// NV xin mở khoá để đề nghị SỚM hơn mốc.
const requestUnlock = (empCode, period, key, options = {}) =>
  moveFlow(empCode, period, key, 'unlock_requested', { ...options, expect: ['plan'], noteRequired: true });

// NV gửi nội dung có cấu trúc nhưng không đổi nấc quy trình. Ledger audit là nguồn
// bền vững; requestId giúp retry mạng không tạo hai thông báo giống nhau.
function addNote(empCode, period, key, { actor, note, requestId = '', now = () => new Date().toISOString(), store = persist } = {}) {
  const who = requireActor(actor);
  const safeKey = requireKey(key);
  const safeNote = sanitizeNote(note, { required: true });
  const safeRequestId = sanitizeRequestId(requestId);
  const entry = readEntry(empCode, period, { store });
  const retry = idempotencyRecord(entry, safeRequestId, who);
  if (assertSameRetry(retry, { action: `note_${safeKey}`, note: safeNote })) return entry;
  appendAudit(entry, { at: now(), by: who, action: `note_${safeKey}`, note: safeNote, ...(safeRequestId ? { requestId: safeRequestId } : {}) });
  return writeEntry(empCode, period, entry, store);
}

// CEO đồng ý cho đề nghị sớm. NV vẫn phải tự bấm đề nghị sau đó.
const grantUnlock = (empCode, period, key, options = {}) =>
  moveFlow(empCode, period, key, 'unlocked', { ...options, expect: ['unlock_requested'], extra: { unlockedBy: String(options.actor || '').toUpperCase() } });

// CEO duyệt đề nghị. Duyệt ≠ đã trả — vẫn phải bấm "Đã trả" khi chuyển tiền xong.
const approvePayment = (empCode, period, key, options = {}) =>
  moveFlow(empCode, period, key, 'approved', { ...options, expect: ['requested'], extra: { approvedBy: String(options.actor || '').toUpperCase() } });

// CEO từ chối ⇒ QUAY VỀ KẾ HOẠCH để NV đề nghị lại (CEO chốt 04/08).
// Lý do bắt buộc ở backend để NV luôn biết vì sao và có thể đề nghị lại đúng nội dung.
const rejectPayment = (empCode, period, key, options = {}) =>
  moveFlow(empCode, period, key, 'plan', {
    ...options,
    expect: ['requested', 'unlock_requested', 'unlocked', 'approved'],
    noteRequired: true,
  });

module.exports = {
  FILE, EDITABLE_KEYS, FLOW_STATES, AUDIT_LIMIT_PER_ENTRY, NOTE_MAX_LENGTH, keyOf, readEntry, listEntries, sanitizeNote, sanitizeRequestId,
  setSecondOverride, recordPayment, undoPayment,
  moveFlow, requestPayment, requestUnlock, addNote, grantUnlock, approvePayment, rejectPayment,
};
