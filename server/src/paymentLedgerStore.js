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

function emptyEntry() {
  return { secondOverride: null, paid: {}, audit: [] };
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
    audit: Array.isArray(row.audit) ? row.audit.slice(-AUDIT_LIMIT_PER_ENTRY) : [],
  };
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

module.exports = { FILE, EDITABLE_KEYS, AUDIT_LIMIT_PER_ENTRY, keyOf, readEntry, setSecondOverride, recordPayment, undoPayment };
