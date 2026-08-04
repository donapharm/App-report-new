'use strict';
/**
 * NHẮC THANH TOÁN LẦN 2 / LẦN 3 — GĐ2 (SPEC_THANH_TOAN_CP_SELFVIEW.md §6)
 *
 * Hai loại tin, gửi NV có khoản + CEO:
 *   1. MỞ CỬA SỔ  — tới ngày nhận Lần 2/Lần 3: "…đ đã có thể nhận, hạn tới …".
 *   2. QUÁ HẠN    — cảnh báo đỏ: "quá N ngày chưa nhận".
 *
 * ‼ Nguyên tắc:
 *   - Đây là CẢNH BÁO VẬN HÀNH ⇒ không lọc theo optout (giống sync/high-value).
 *   - KHÔNG spam: mỗi (NV · kỳ · lần · loại tin) chỉ nhắn MỘT lần. Đã ghi nhận trả
 *     thì thôi nhắc lần đó vĩnh viễn.
 *   - Không tự suy: chỉ nhắc dựa trên sổ backend đã dựng, không tự tính lại tiền.
 *   - Dùng lại `notifyChannels` sẵn có, KHÔNG dựng kênh mới.
 */

const persist = require('./persist');

const STATE_FILE = 'payment_notify_state';
const OPEN_WINDOW_DAYS = 0;   // đúng ngày tới hạn thì mở cửa sổ
const STATE_LIMIT = 5000;

const money = (value) => Number(value || 0).toLocaleString('vi-VN');
const dmy = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value).split('-').reverse().join('/') : '—');
const stateKey = (empCode, period, installmentKey, kind) => `${String(empCode).toUpperCase()}|${period}|${installmentKey}|${kind}`;

function readState(store = persist) {
  const rows = store.load(STATE_FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

function markSent(keys, { store = persist, now = () => new Date().toISOString() } = {}) {
  if (!keys.length) return;
  const rows = readState(store);
  const at = now();
  for (const key of keys) rows[key] = at;
  const all = Object.keys(rows);
  if (all.length > STATE_LIMIT) {
    all.sort((a, b) => String(rows[a]).localeCompare(String(rows[b])));
    for (const stale of all.slice(0, all.length - STATE_LIMIT)) delete rows[stale];
  }
  store.save(STATE_FILE, rows);
}

/**
 * Quyết định cần nhắn gì cho MỘT sổ. Thuần tính toán — không gửi, không ghi.
 * `schedule` là kết quả `buildPaymentSchedule` (đã có `daysFromToday`, `status`).
 */
function planNotices(schedule, { empCode, employeeName = '', sent = {} } = {}) {
  if (!schedule?.available) return [];
  const notices = [];
  for (const item of schedule.installments) {
    // Lần 1 do App Salary chi, không nhắc ở đây. Đã trả rồi thì thôi nhắc.
    if (item.key === 'advance' || item.status === 'paid') continue;
    const days = item.daysFromToday;
    if (days == null) continue;

    const who = employeeName ? `${empCode} · ${employeeName}` : String(empCode);
    if (days < 0) {
      const key = stateKey(empCode, schedule.period, item.key, 'overdue');
      if (!sent[key]) {
        notices.push({
          key, kind: 'overdue', empCode, installmentKey: item.key,
          text: `🔴 QUÁ HẠN — ${who}\n${item.label} kỳ ${schedule.period}: ${money(item.amount)}đ\nHạn ${dmy(item.dueDate)}, đã quá ${Math.abs(days)} ngày chưa nhận.\nSổ còn nợ: ${money(schedule.outstanding)}đ.`,
        });
      }
    } else if (days <= OPEN_WINDOW_DAYS) {
      const key = stateKey(empCode, schedule.period, item.key, 'open');
      if (!sent[key]) {
        notices.push({
          key, kind: 'open', empCode, installmentKey: item.key,
          text: `💰 ${who}\n${item.label} kỳ ${schedule.period}: ${money(item.amount)}đ đã có thể nhận.\nHạn ${dmy(item.dueDate)}.\nSổ còn nợ sau lần này: ${money(Math.max(0, schedule.outstanding - item.amount))}đ.`,
        });
      }
    }
  }
  return notices;
}

/**
 * Chạy cho cả đội. `schedules` = [{ empCode, employeeName, schedule }].
 * `send(text, empCode)` do nơi gọi cung cấp (bọc notifyChannels) — module này
 * không tự chọn kênh, để dễ test và không dựng kênh mới.
 */
async function runPaymentNotices(schedules = [], { send, store = persist, now, dryRun = false } = {}) {
  const sent = readState(store);
  const planned = [];
  for (const item of Array.isArray(schedules) ? schedules : []) {
    planned.push(...planNotices(item?.schedule, { empCode: item?.empCode, employeeName: item?.employeeName, sent }));
  }
  if (dryRun || typeof send !== 'function') return { planned, delivered: [] };

  const delivered = [];
  for (const notice of planned) {
    try {
      await send(notice.text, notice.empCode, notice.kind);
      delivered.push(notice.key);
    } catch (error) {
      // Gửi hỏng thì KHÔNG đánh dấu đã gửi ⇒ lần sau nhắc lại, không nuốt mất tin.
      console.warn('[payment-notify] gửi lỗi', { empCode: notice.empCode, kind: notice.kind, message: error.message });
    }
  }
  markSent(delivered, { store, now });
  return { planned, delivered };
}

module.exports = { STATE_FILE, OPEN_WINDOW_DAYS, stateKey, readState, markSent, planNotices, runPaymentNotices };
