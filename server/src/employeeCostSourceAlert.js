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
 * - KHÔNG gửi số tiền/%/PII — chỉ mã NV, số cặp, kỳ. Người nhận chỉ CEO/ADMIN.
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
async function checkAndNotify(payload = {}, ky = '', { now = Date.now(), sendImpl = send } = {}) {
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

    if (!employees.length) {
      // Đã khôi phục: chỉ báo nếu lần trước đang có lỗi.
      if (!previous.signature) return { skipped: 'no_issue' };
      const result = await sendImpl(buildMessage({ employees, pairs, ky, recovered: true }));
      persist.save(STATE_FILE, { ...state, [ky]: { signature: '', at: now } });
      return { recovered: true, ...result };
    }

    const changed = previous.signature !== signature;
    const stale = now - Number(previous.at || 0) >= REMIND_MS;
    if (!changed && !stale) return { skipped: 'deduped' };

    const result = await sendImpl(buildMessage({ employees, pairs, ky, recovered: false }));
    persist.save(STATE_FILE, { ...state, [ky]: { signature, at: now } });
    return { alerted: true, employees, pairs, ...result };
  } catch (error) {
    // Cảnh báo hỏng KHÔNG được làm hỏng luồng warm/nghiệp vụ.
    console.warn('[employee-cost-alert] check thất bại', { message: error.message });
    return { skipped: 'error', message: error.message };
  }
}

module.exports = { STATE_FILE, REMIND_MS, checkAndNotify, buildMessage, signatureOf, adminRecipients };
