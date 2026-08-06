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
// CEO chốt 04/08: *"có ngày cứng để nhắc tin nhắn telegram là ngày 15/09, nhưng sau
// đó có thể nhắc lại bổ sung trong vòng 15 ngày, nếu ngày đó chưa thực hiện ứng lần 2."*
// ⇒ tin cứng đúng ngày mốc, rồi nhắc lại ở 3 mốc này trong biên độ. Không nhắn mỗi ngày.
const REMIND_ROUNDS = [5, 10, 15];
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
    const openKey = stateKey(empCode, schedule.period, item.key, 'open');
    const graceLeft = item.daysFromGrace;

    // ① QUÁ BIÊN ĐỘ ⇒ cảnh báo đỏ. Chỉ tới đây mới được gọi là "quá hạn".
    if (graceLeft != null && graceLeft < 0) {
      const key = stateKey(empCode, schedule.period, item.key, 'overdue');
      if (!sent[key]) {
        notices.push({
          key, kind: 'overdue', empCode, installmentKey: item.key,
          text: `🔴 QUÁ HẠN — ${who}\n${item.label} kỳ ${schedule.period}: ${money(item.amount)}đ\nMốc ${dmy(item.dueDate)}, hết biên độ ${dmy(item.graceDate)} — đã quá ${Math.abs(graceLeft)} ngày.\nSổ còn nợ: ${money(schedule.outstanding)}đ.`,
        });
      }
      continue;
    }

    if (days > OPEN_WINDOW_DAYS) continue;   // chưa tới mốc thì chưa nhắn gì

    // ② ĐÚNG NGÀY MỐC ⇒ tin CỨNG. Nếu lịch chạy lỡ mất ngày đó thì lần chạy sau
    //    vẫn phải gửi — tin này không được rơi mất chỉ vì cron chết một hôm.
    if (!sent[openKey]) {
      notices.push({
        key: openKey, kind: 'open', empCode, installmentKey: item.key,
        text: `💰 ${who}\n${item.label} kỳ ${schedule.period}: ${money(item.amount)}đ đã có thể nhận.\nMốc ${dmy(item.dueDate)} · còn nhận được tới ${dmy(item.graceDate)}.\nSổ còn nợ sau lần này: ${money(Math.max(0, schedule.outstanding - item.amount))}đ.`,
      });
      continue;
    }

    // ③ TRONG BIÊN ĐỘ 15 NGÀY mà vẫn chưa nhận ⇒ NHẮC LẠI BỔ SUNG (CEO chốt 04/08).
    //    Chỉ 3 mốc 5·10·15 ngày, và mỗi lần chạy chỉ lấy MỐC CAO NHẤT đã tới ⇒ tối đa
    //    3 tin cho cả biên độ, không phải ngày nào cũng nhắn.
    const elapsed = -days;
    const round = REMIND_ROUNDS.filter((day) => day <= elapsed).pop();
    if (round == null) continue;
    const key = stateKey(empCode, schedule.period, item.key, `remind${round}`);
    if (sent[key]) continue;
    notices.push({
      key, kind: 'remind', empCode, installmentKey: item.key,
      text: `⏳ NHẮC LẠI — ${who}\n${item.label} kỳ ${schedule.period}: ${money(item.amount)}đ vẫn chưa nhận.\nMốc ${dmy(item.dueDate)} · đã ${elapsed} ngày · còn ${graceLeft ?? '—'} ngày trong biên độ (hết ${dmy(item.graceDate)}).`,
    });
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
      // Giữ object notice ở tham số thứ tư cho adapter bền vững theo audience.
      await send(notice.text, notice.empCode, notice.kind, notice);
      delivered.push(notice.key);
    } catch (error) {
      // Gửi hỏng thì KHÔNG đánh dấu đã gửi ⇒ lần sau nhắc lại, không nuốt mất tin.
      console.warn('[payment-notify] gửi lỗi', { empCode: notice.empCode, kind: notice.kind, message: error.message });
    }
  }
  markSent(delivered, { store, now });
  return { planned, delivered };
}

module.exports = { STATE_FILE, OPEN_WINDOW_DAYS, REMIND_ROUNDS, stateKey, readState, markSent, planNotices, runPaymentNotices };
