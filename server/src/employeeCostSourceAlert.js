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
const accessPolicy = require('./accessPolicy');
const targetNotify = require('./targetNotify');
const store = require('./store');

const STATE_FILE = 'employee_cost_source_alert_state';
const REMIND_MS = 6 * 60 * 60 * 1000; // còn lỗi thì nhắc lại mỗi 6 giờ

/* ── CHỐNG RUNG + CHỐNG SPAM (CEO báo gấp 09/08/2026) ─────────────────────────
 * CEO: *"phần chi phí của các ô KPI khi thì kết nối đủ, khi thì báo thiếu… nên bot
 * cứ báo tin nhắn về cho các NV là chưa có đủ dữ liệu. Anh rất bực."*
 *
 * Bằng chứng từ chính hai tin bot gửi đêm 09/08:
 *   00:32 — 13 NV: DN002 DN008 DN009 DN010 DN011 DN012 DN017 DN018 DN019 DN021 DN023 DN024 VP004
 *   02:03 — 15 NV: DN001 DN002 DN003 DN004 DN008 DN009 DN010 DN011 DN012 DN016 DN018 DN019 DN021 DN022 VP004
 * Hai danh sách KHÁC NHAU ⇒ `changed` luôn đúng ⇒ dedup theo chữ ký vô hiệu ⇒ gửi
 * mỗi vòng warm. Tệ hơn: mỗi lần đổi, `newlyAffected` lại có người "mới" (lượt 2 là
 * DN001 DN003 DN004 DN016 DN022) nên CHÍNH NV bị nhắn lặp đi lặp lại — rồi khi danh
 * sách xoay lại, nhóm kia lại thành "mới" và lại bị nhắn.
 *
 * Gốc rễ (fast-path 2s vứt kết quả self-heal) do bot sửa ở Cổng 1. Nhưng dedup theo
 * "danh sách có đổi không" là SAI NGAY CẢ KHI nguồn lành: nguồn mạng luôn chập chờn
 * ở rìa. Ba lớp chặn dưới đây độc lập với lỗi kia.
 */
// 1) Phải thấy lỗi ở HAI vòng kiểm liên tiếp mới coi là lỗi thật (và hai vòng sạch
//    liên tiếp mới coi là đã khôi phục). Một cú timeout lẻ không đủ để đi báo người.
const CONFIRM_ROUNDS = 2;
// 2) Tin cho CEO/ADMIN: tối thiểu cách nhau ngần này, KỂ CẢ khi danh sách đổi.
const MIN_ALERT_GAP_MS = 60 * 60 * 1000;
// 3) Tin mềm cho CHÍNH NV: mỗi người tối đa 1 lần trong ngần này, bất kể danh sách
//    xoay vòng ra sao. Đây là lớp chặn spam quan trọng nhất — NV không phải người đi
//    sửa lỗi nguồn, nhắn nhiều lần chỉ gây hoang mang.
const EMPLOYEE_QUIET_MS = 24 * 60 * 60 * 1000;
// Cửa sổ xét "nguồn đang chập chờn" để NÓI RA trong tin, thay vì liệt kê danh sách
// như thể đó là sự thật cố định.
const FLAP_WINDOW_MS = 2 * 60 * 60 * 1000;
const FLAP_MIN_CHANGES = 3;

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

function causeCounts(employees = [], unavailableReasons = {}) {
  const counts = { appDeadline: 0, dataHubEmpty: 0, unknown: 0 };
  for (const emp of employees) {
    const reason = String(unavailableReasons?.[String(emp).toUpperCase()] || '').toLowerCase();
    if (reason === 'deadline') counts.appDeadline += 1;
    else if (reason === 'source_empty') counts.dataHubEmpty += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function buildMessage({ employees, pairs, ky, recovered, flapping = false, causes = {} }) {
  if (recovered) {
    return [
      '✅ App Report — nguồn chi phí đã khôi phục',
      `Kỳ ${ky}: đã lấy được dữ liệu chi phí của tất cả nhân viên.`,
      'Các số "tạm tính" trên màn "Chi phí của tôi" giờ đã đầy đủ.',
    ].join('\n');
  }
  const lines = [
    '⚠️ App Report — THIẾU DỮ LIỆU CHI PHÍ',
    `Kỳ ${ky}: chưa lấy được dữ liệu chi phí của ${employees.length} nhân viên: ${employees.join(', ')}`,
    Number(pairs || 0) > 0
      ? `Ảnh hưởng ${Number(pairs).toLocaleString('vi-VN')} cặp (đơn vị × mặt hàng).`
      : 'Chưa xác định được số cặp ảnh hưởng.',
    '',
    'Hệ quả: tổng chi phí trên app đang là TẠM TÍNH (thiếu phần của các NV này).',
  ];
  const appDeadline = Number(causes.appDeadline || 0);
  const dataHubEmpty = Number(causes.dataHubEmpty || 0);
  const unknown = Number(causes.unknown || 0);
  if (appDeadline) lines.push(`${appDeadline} nhân viên chưa lấy kịp trong hạn (App Report).`);
  if (dataHubEmpty) lines.push(`${dataHubEmpty} nhân viên nguồn trả rỗng (DataHub).`);
  if (unknown || (!appDeadline && !dataHubEmpty)) {
    lines.push(`${unknown || employees.length} nhân viên chưa xác định nguyên nhân.`);
  }
  // ‼ Danh sách đổi xoành xoạch là MỘT TRIỆU CHỨNG KHÁC HẲN "13 NV hỏng cố định":
  // nó nói nguồn lúc được lúc không, chứ không phải mấy mã đó thiếu dữ liệu. Không
  // nói ra thì người đọc đi truy nhầm hướng — đúng việc đã xảy ra đêm 09/08.
  if (flapping) {
    lines.push(
      '',
      '🔁 LƯU Ý: danh sách này ĐANG ĐỔI LIÊN TỤC giữa các lần kiểm — dấu hiệu nguồn',
      'chập chờn (timeout/khôi phục xen kẽ), KHÔNG phải đúng các mã trên thiếu dữ liệu.',
      'Truy theo hướng độ trễ/timeout của nguồn trước, đừng truy từng mã NV.',
    );
  }
  return lines.join('\n');
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
/**
 * ‼ AI KHÔNG ĐƯỢC NHẬN TIN MỀM NÀY (phát hiện 09/08/2026 khi CEO hỏi rà DN021/
 * DN023/DN004/VP004/DN022/DN002).
 *
 * Bộ này trước đây gửi cho MỌI mã có liên kết Telegram, không lọc gì. Hai hậu quả:
 *  1. **Mã bị khoá đăng nhập** (DN021 · DN023 nằm trong 16 mã `accessPolicy`) vẫn
 *     nhận tin bảo "số trên màn Chi phí của tôi tạm thời chưa đầy đủ" — trong khi
 *     họ còn không mở được app để xem. Vô nghĩa với người nhận, và là rò rỉ tín
 *     hiệu vận hành ra ngoài phạm vi đã đóng.
 *  2. **Mã trong `config/notify_optout.json`** (DN021 · DN023 · VP004 · VP018) vẫn
 *     nhận, dù chính file đó ghi phạm vi chặn gồm "tổng chi phí".
 *
 * Cảnh báo gửi CEO/ADMIN thì KHÔNG lọc — người xử lý phải thấy đủ mọi mã thiếu dữ
 * liệu, kể cả mã đã khoá. Chỉ lọc ở tin gửi CHÍNH NV.
 *
 * KHÔNG dùng `isMonetaryNotifyBlocked` ở đây: đó là luật cho tin THƯỞNG/PHẠT BẰNG
 * TIỀN. Tin này không có tiền, và DN002/DN004/DN022 vẫn cần biết số của họ đang
 * tạm tính. Lấy danh sách của việc khác dùng cho việc này đúng là lỗi đã dính 28/07.
 */
function employeeNoticeBlocked(empCode) {
  const code = String(empCode || '').trim().toUpperCase();
  if (!code) return true;
  try { if (accessPolicy.isLoginBlocked(code)) return true; } catch { /* thiếu policy thì xét tiếp */ }
  try { return targetNotify.isMuted(code); } catch { return false; }
}

async function notifyAffectedEmployees(empCodes = [], { ky, recovered }, sender) {
  const map = employeeTelegramMap();
  const text = buildEmployeeMessage({ ky, recovered });
  let targeted = 0; let sent = 0; let blocked = 0;
  for (const code of empCodes) {
    if (employeeNoticeBlocked(code)) { blocked += 1; continue; }
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
  return { targeted, sent, blocked };
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
    const unavailableReasons = Object.assign({}, ...periods.map((period) => period?.match?.unavailableReasons || {}));
    const state = readState();
    const previous = state[ky] || { signature: '', at: 0 };
    const prevSeen = Array.isArray(previous.lastSeen) ? previous.lastSeen : [];
    // NV đã THỰC SỰ nhận tin mềm (mã → lúc gửi). Recovered chỉ báo cho đúng những
    // người này, không báo cho người chưa từng bị làm phiền.
    const notified = (previous.notified && typeof previous.notified === 'object') ? { ...previous.notified } : {};

    // Nguồn chập chờn: đếm số lần danh sách THÔ đổi trong cửa sổ gần đây.
    const rawChanged = signatureOf(employees) !== signatureOf(prevSeen);
    const flaps = [...(Array.isArray(previous.flaps) ? previous.flaps : []), ...(rawChanged ? [now] : [])]
      .filter((at) => now - Number(at || 0) < FLAP_WINDOW_MS);
    const flapping = flaps.length >= FLAP_MIN_CHANGES;
    // Nền state luôn được ghi lại kể cả khi không gửi gì — nếu không thì vòng sau
    // mất mốc so sánh và cơ chế xác nhận hai vòng không bao giờ chốt được.
    const carry = (patch) => persist.save(STATE_FILE, {
      ...state, [ky]: { signature: previous.signature || '', at: Number(previous.at || 0), lastSeen: employees, notified, flaps, ...patch },
    });

    // ‼ XÁC NHẬN HAI VÒNG: chỉ tính là lỗi thật khi NV đó hỏng ở CẢ lần này lẫn lần
    // trước. Một cú timeout lẻ (fast-path 2s) không đủ để đi báo người.
    const confirmed = CONFIRM_ROUNDS <= 1 ? employees : employees.filter((code) => prevSeen.includes(code));
    const signature = signatureOf(confirmed);

    if (!confirmed.length) {
      // Chỉ coi là khôi phục khi HAI vòng liên tiếp đều sạch — tránh cảnh "đã đủ /
      // lại thiếu" nhấp nháy mà CEO và NV phải đọc suốt đêm.
      const twoCleanRounds = !employees.length && !prevSeen.length;
      if (!previous.signature || !twoCleanRounds) {
        carry();
        return { skipped: previous.signature ? 'awaiting_confirm' : 'no_issue', flapping };
      }
      const result = await sendImpl(buildMessage({ employees, pairs, ky, recovered: true }));
      const employeeNotified = await notifyAffectedEmployees(Object.keys(notified), { ky, recovered: true }, sendEmployeeImpl);
      persist.save(STATE_FILE, { ...state, [ky]: { signature: '', at: now, lastSeen: [], notified: {}, flaps } });
      return { recovered: true, employeeNotified, ...result };
    }

    const changed = previous.signature !== signature;
    const stale = now - Number(previous.at || 0) >= REMIND_MS;
    // Giới hạn nhịp: danh sách đổi mấy lần cũng không được gửi dày hơn MIN_ALERT_GAP_MS.
    // Không có chốt này thì nguồn chập chờn = một tin mỗi vòng warm.
    const tooSoon = now - Number(previous.at || 0) < MIN_ALERT_GAP_MS;
    if ((!changed && !stale) || (changed && !stale && tooSoon)) {
      carry();
      return { skipped: changed ? 'rate_limited' : 'deduped', flapping };
    }

    const causes = causeCounts(confirmed, unavailableReasons);
    const result = await sendImpl(buildMessage({ employees: confirmed, pairs, ky, recovered: false, flapping, causes }));
    // ‼ Tin mềm cho NV tính theo TỪNG NGƯỜI, không theo "danh sách có đổi không".
    // Cách cũ: danh sách xoay vòng ⇒ cùng một người liên tục bị coi là "mới bị ảnh
    // hưởng" ⇒ nhắn lặp. Nay mỗi người tối đa 1 tin trong EMPLOYEE_QUIET_MS.
    const dueEmployees = confirmed.filter((code) => {
      const at = Number(notified[String(code).toUpperCase()] || 0);
      return !at || now - at >= EMPLOYEE_QUIET_MS;
    });
    const employeeNotified = await notifyAffectedEmployees(dueEmployees, { ky, recovered: false }, sendEmployeeImpl);
    for (const code of dueEmployees) notified[String(code).toUpperCase()] = now;
    persist.save(STATE_FILE, { ...state, [ky]: { signature, at: now, lastSeen: employees, notified, flaps } });
    return { alerted: true, employees: confirmed, pairs, causes, employeeNotified, flapping, ...result };
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
  STATE_FILE, REMIND_MS, CONFIRM_ROUNDS, MIN_ALERT_GAP_MS, EMPLOYEE_QUIET_MS, FLAP_WINDOW_MS, FLAP_MIN_CHANGES,
  checkAndNotify, checkAndNotifyInner, buildMessage, signatureOf, adminRecipients,
  buildEmployeeMessage, notifyAffectedEmployees, employeeTelegramMap, employeeNoticeBlocked, causeCounts,
};
