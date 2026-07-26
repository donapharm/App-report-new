'use strict';

/**
 * employeeCostSourceAlert.js — CẢNH BÁO CHỦ ĐỘNG khi nguồn chi phí DataHub thiếu dữ liệu.
 *
 * Lý do tồn tại (CEO chốt 2026-07-26): trước đây khi DataHub không trả dữ liệu chi
 * phí của một NV, số trên app bị lệch âm thầm và CEO phải TỰ phát hiện rồi bắt các
 * bên đi truy. Module này để HỆ THỐNG TỰ BÁO: phát hiện lúc warm cache định kỳ →
 * nhắn Telegram cho CEO/ADMIN, nêu ĐÍCH DANH nhân viên + số cặp ảnh hưởng.
 *
 * Nguyên tắc:
 * - Chỉ gửi khi TRẠNG THÁI ĐỔI (danh sách NV lỗi khác lần trước) hoặc quá hạn nhắc
 *   lại → không spam mỗi vòng warm.
 * - Báo cả khi ĐÃ KHÔI PHỤC để CEO biết chuyện đã xong, không phải tự đi kiểm.
 * - KHÔNG gửi số tiền/%/PII — chỉ mã NV, số cặp, kỳ. Tin VẬN HÀNH gửi CEO/ADMIN.
 * - (CEO chốt 2026-07-26) NGOÀI RA gửi CHÍNH NV bị ảnh hưởng 1 tin MỀM, trấn an
 *   (không số, không lộ NV khác, không quy trách nhiệm), chỉ khi NV có Telegram và
 *   chỉ khi MỚI bị ảnh hưởng (không spam mỗi 6h). Khôi phục thì báo NV "đã đủ".
 * - Không bao giờ ném lỗi ra ngoài: cảnh báo hỏng thì cũng không được làm hỏng warm.
 */

const persist = require('./persist');
const notifyChannels = require('./notifyChannels');
const auth = require('./auth');
const store = require('./store');

const STATE_FILE = 'employee_cost_source_alert_state';
const REMIND_MS = 6 * 60 * 60 * 1000; // còn lỗi thì nhắc lại mỗi 6 giờ

function adminRecipients() {
  // Chỉ CEO/ADMIN đã liên kết Telegram. NV thường không nhận cảnh báo vận hành này.
  const admins = new Set();
  try {
    for (const user of store.listUsers()) {
      const role = String(user?.role || '').toLowerCase();
      if (role === 'ceo' || role === 'admin') admins.add(String(user.emp_code || '').toUpperCase());
    }
  } catch { return []; }
  try {
    return auth.listTelegramMap()
      .filter((entry) => admins.has(String(entry.emp_code || '').toUpperCase()))
      .map((entry) => ({ chatId: String(entry.telegram_id), empCode: String(entry.emp_code || '').toUpperCase() }))
      .filter((entry) => entry.chatId);
  } catch { return []; }
}

function readState() {
  const value = persist.load(STATE_FILE, {});
  return value && typeof value === 'object' ? value : {};
}

function signatureOf(employees = []) {
  return [...employees].map((code) => String(code).toUpperCase()).sort().join(',');
}

function buildMessage({ employees, pairs, ky, recovered }) {
  if (recovered) {
    return [
      '✅ App Report — nguồn chi phí đã khôi phục',
      `Kỳ ${ky}: đã lấy được dữ liệu chi phí của tất cả nhân viên.`,
      'Các số "tạm tính" trên màn "Chi phí của tôi" giờ đã đầy đủ.',
    ].join('\n');
  }
  return [
    '⚠️ App Report — THIẾU DỮ LIỆU CHI PHÍ',
    `Kỳ ${ky}: chưa lấy được dữ liệu chi phí của ${employees.length} nhân viên: ${employees.join(', ')}`,
    `Ảnh hưởng ${Number(pairs || 0).toLocaleString('vi-VN')} cặp (đơn vị × mặt hàng).`,
    '',
    'Hệ quả: tổng chi phí trên app đang là TẠM TÍNH (thiếu phần của các NV này).',
    'Đây KHÔNG phải "mã thiếu % catalog" — mà là nguồn chi phí DataHub chưa trả dữ liệu.',
    'Đề nghị báo DataHub kiểm tra endpoint employee-cost cho các mã NV trên.',
  ].join('\n');
}

// Bản đồ mã NV → chatId Telegram (mọi vai đã liên kết). Dùng để nhắn CHÍNH NV.
function employeeTelegramMap() {
  const map = new Map();
  try {
    for (const entry of auth.listTelegramMap()) {
      const code = String(entry.emp_code || '').toUpperCase();
      const chatId = String(entry.telegram_id || '');
      if (code && chatId) map.set(code, chatId);
    }
  } catch { return new Map(); }
  return map;
}

// Tin MỀM gửi cho CHÍNH nhân viên bị ảnh hưởng (CEO chốt 2026-07-26): thuần thông
// tin, TRẤN AN — KHÔNG kèm số tiền/%, KHÔNG lộ NV khác, KHÔNG quy trách nhiệm NV.
function buildEmployeeMessage({ ky, recovered }) {
  if (recovered) {
    return [
      '✅ App Report — chi phí của bạn đã cập nhật đủ',
      `Kỳ ${ky}: hệ thống đã lấy đủ dữ liệu. Số trên "Chi phí của tôi" giờ đã đầy đủ (không còn tạm tính).`,
    ].join('\n');
  }
  return [
    'ℹ️ App Report — chi phí của bạn đang TẠM TÍNH',
    `Kỳ ${ky}: hệ thống đang lấy lại dữ liệu chi phí từ nguồn, nên số trên "Chi phí của tôi" tạm thời chưa đầy đủ.`,
    'Bạn KHÔNG cần làm gì — số sẽ tự cập nhật khi có đủ dữ liệu.',
  ].join('\n');
}

// Gửi tin mềm cho các NV chỉ định (chỉ NV có Telegram; NV không liên kết thì bỏ qua,
// không ép). Không bao giờ ném lỗi ra ngoài.
async function notifyAffectedEmployees(empCodes = [], { ky, recovered }, sender) {
  const map = employeeTelegramMap();
  const text = buildEmployeeMessage({ ky, recovered });
  let targeted = 0; let sent = 0;
  for (const code of empCodes) {
    const chatId = map.get(String(code).toUpperCase());
    if (!chatId) continue;
    targeted += 1;
    try {
      const result = await sender(chatId, text);
      if (result?.ok) sent += 1;
    } catch (error) {
      console.warn('[employee-cost-alert] gửi tin NV thất bại', { empCode: code, message: error.message });
    }
  }
  return { targeted, sent };
}

async function send(text) {
  const recipients = adminRecipients();
  if (!recipients.length) return { sent: 0, reason: 'không có CEO/ADMIN nào liên kết Telegram' };
  let sent = 0;
  for (const recipient of recipients) {
    try {
      const result = await notifyChannels.sendTelegram(recipient.chatId, text);
      if (result?.ok) sent += 1;
      else console.warn('[employee-cost-alert] gửi Telegram thất bại', { empCode: recipient.empCode, description: result?.description });
    } catch (error) {
      console.warn('[employee-cost-alert] lỗi gửi Telegram', { empCode: recipient.empCode, message: error.message });
    }
  }
  return { sent, recipients: recipients.length };
}

/**
 * Kiểm tra payload ALL đã dựng và cảnh báo nếu cần.
 * @param {object} payload payload ALL (có periods[].match)
 * @param {string} ky nhãn kỳ để hiển thị
 */
async function checkAndNotifyInner(payload = {}, ky = '', { now = Date.now(), sendImpl = send, sendEmployeeImpl = notifyChannels.sendTelegram } = {}) {
  try {
    if (!notifyChannels.telegramReady()) return { skipped: 'telegram_not_configured' };
    const periods = Array.isArray(payload.periods) ? payload.periods : [];
    const employees = [...new Set(periods.flatMap((period) => (
      Array.isArray(period?.match?.unavailableEmployees) ? period.match.unavailableEmployees.map(String) : []
    )))].sort();
    const pairs = periods.reduce((sum, period) => sum + Number(period?.match?.unavailablePairs || 0), 0);
    const signature = signatureOf(employees);
    const state = readState();
    const previous = state[ky] || { signature: '', at: 0 };
    // Danh sách NV lần trước suy trực tiếp từ signature (đã sort, nối ',').
    const prevEmployees = previous.signature ? previous.signature.split(',') : [];

    if (!employees.length) {
      // Đã khôi phục: chỉ báo nếu lần trước đang có lỗi.
      if (!previous.signature) return { skipped: 'no_issue' };
      const result = await sendImpl(buildMessage({ employees, pairs, ky, recovered: true }));
      // Báo cho CHÍNH các NV trước đó bị ảnh hưởng rằng số đã cập nhật đủ.
      const employeeNotified = await notifyAffectedEmployees(prevEmployees, { ky, recovered: true }, sendEmployeeImpl);
      persist.save(STATE_FILE, { ...state, [ky]: { signature: '', at: now } });
      return { recovered: true, employeeNotified, ...result };
    }

    const changed = previous.signature !== signature;
    const stale = now - Number(previous.at || 0) >= REMIND_MS;
    if (!changed && !stale) return { skipped: 'deduped' };

    const result = await sendImpl(buildMessage({ employees, pairs, ky, recovered: false }));
    // Tin mềm cho NV: CHỈ khi danh sách ĐỔI (NV MỚI bị ảnh hưởng) — không spam mỗi
    // 6h khi nhắc lại. NV đã báo lần trước thì không nhắc lại tin mềm.
    let employeeNotified = { targeted: 0, sent: 0 };
    if (changed) {
      const newlyAffected = employees.filter((code) => !prevEmployees.includes(code));
      employeeNotified = await notifyAffectedEmployees(newlyAffected, { ky, recovered: false }, sendEmployeeImpl);
    }
    persist.save(STATE_FILE, { ...state, [ky]: { signature, at: now } });
    return { alerted: true, employees, pairs, employeeNotified, ...result };
  } catch (error) {
    // Cảnh báo hỏng KHÔNG được làm hỏng luồng warm/nghiệp vụ.
    console.warn('[employee-cost-alert] check thất bại', { message: error.message });
    return { skipped: 'error', message: error.message };
  }
}

// Blocker#3 (bot review): read state → send → write state KHÔNG nguyên tử. Hai check
// khôi phục đồng thời cùng đọc state cũ rồi cùng gửi → gửi đúp. Tuần tự hóa THEO KỲ:
// các check cùng kỳ nối đuôi nhau, check sau đọc state SAU khi check trước đã ghi →
// dedup đúng, không gửi đúp. Khác kỳ vẫn chạy song song bình thường.
const checkInFlight = new Map();
function checkAndNotify(payload = {}, ky = '', opts = {}) {
  const prev = checkInFlight.get(ky) || Promise.resolve();
  const run = prev.then(
    () => checkAndNotifyInner(payload, ky, opts),
    () => checkAndNotifyInner(payload, ky, opts),
  );
  checkInFlight.set(ky, run);
  run.finally(() => { if (checkInFlight.get(ky) === run) checkInFlight.delete(ky); });
  return run;
}

module.exports = {
  STATE_FILE, REMIND_MS, checkAndNotify, checkAndNotifyInner, buildMessage, signatureOf, adminRecipients,
  buildEmployeeMessage, notifyAffectedEmployees, employeeTelegramMap,
};
