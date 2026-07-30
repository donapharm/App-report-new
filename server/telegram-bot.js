/**
 * telegram-bot.js — WORKER Telegram cho đăng nhập App Report (SPEC_LOGIN_V2).
 *
 * Nhiệm vụ: nhận mã RP-XXXXXX từ NV → HỎI LẠI bằng nút "✅ Xác nhận" (chống
 * device-code phishing) → khi NV bấm ✅ mới gọi backend /api/auth/telegram/confirm
 * (kèm secret_bot = TELEGRAM_BOT_SECRET). Backend map telegram_id ↔ emp_code (admin duyệt).
 *
 * CHẠY ĐỘC LẬP (PM2 riêng), long-poll Bot API. CẦN BOT TOKEN RIÊNG:
 *   - KHÔNG dùng chung token với bot OpenClaw đang chạy (getUpdates sẽ giành update của nhau).
 *   - Tạo bot riêng qua @BotFather → lấy token.
 *
 * ENV bắt buộc:
 *   TELEGRAM_BOT_TOKEN   token bot (từ BotFather)
 *   TELEGRAM_BOT_SECRET  chuỗi bí mật dùng chung với backend (giống .env app)
 * ENV tùy chọn:
 *   APP_BASE_URL         mặc định http://localhost:${PORT||3873}
 *   PORT                 cổng backend app (nếu không đặt APP_BASE_URL)
 *   DIGEST_TIMES         lịch bản tin theo giờ VN (GMT+7), mặc định "07:30,18:00"
 *   DIGEST_CRON          tương thích cũ: 1 mốc dạng "30 7 * * *" nếu DIGEST_TIMES chưa đặt
 *   APP_PUBLIC_URL       link mở app trong bản tin, mặc định https://report.donapharm.asia
 */
// Múi giờ GMT+7 (Việt Nam) cho mọi mốc thời gian/lịch của bot. Cho phép env override.
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
const fs = require('fs');
const path = require('path');

// Nạp .env cạnh repo (app không tự đọc dotenv; worker tự parse cho tiện chạy tay).
(function loadEnv() {
  try {
    const p = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ignore */ }
})();

const persist = require('./src/persist');
const store = require('./src/store');
const auth = require('./src/auth');
const A = require('./src/analytics');
const smart = require('./src/smart');
const targetNotify = require('./src/targetNotify');
const notifyChannels = require('./src/notifyChannels');
const salesReport = require('./src/salesReport');
const { salesReportSchedulePolicy } = require('./src/salesReportSchedulePolicy');
const bonusNotify = require('./src/bonusNotify');
const employeeCostNotify = require('./src/employeeCostNotify');
const syncAlert = require('./src/syncAlert');
// Ngày khoá sổ kỳ (ngày 8 tháng sau) chỉ có MỘT nguồn: employeeCost.
const employeeCost = require('./src/employeeCost');
const employeeBonus = require('./src/employeeBonus');

const PENDING_TG_GRANTS_FILE = path.join(__dirname, 'data', 'auth', 'telegram_pending_grants.json');
function loadPendingTelegramGrants() {
  try {
    const v = JSON.parse(fs.readFileSync(PENDING_TG_GRANTS_FILE, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function savePendingTelegramGrants(list) {
  try {
    fs.mkdirSync(path.dirname(PENDING_TG_GRANTS_FILE), { recursive: true });
    fs.writeFileSync(PENDING_TG_GRANTS_FILE, JSON.stringify(list.slice(-100), null, 2));
  } catch (e) { console.error('pending telegram grants save error:', e.message); }
}
function claimPendingTelegramGrant(telegramId, from) {
  const now = Date.now();
  const grants = loadPendingTelegramGrants();
  const idx = grants.findIndex((g) => g && g.status !== 'claimed' && (!g.expires_at || Date.parse(g.expires_at) > now));
  if (idx < 0) return null;
  const g = grants[idx];
  const code = String(g.emp_code || '').toUpperCase();
  if (!store.findUserByCode(code)) return null;
  auth.addTelegramMap(String(telegramId), code, g.added_by || 'CEO-pending-grant');
  grants[idx] = { ...g, status: 'claimed', telegram_id: String(telegramId), telegram_name: [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || '', claimed_at: new Date().toISOString() };
  savePendingTelegramGrants(grants);
  return { emp_code: code, name: store.findUserByCode(code)?.name || code };
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SECRET = process.env.TELEGRAM_BOT_SECRET || '';
const BASE = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3873}`;
const PUBLIC_URL = process.env.APP_PUBLIC_URL || process.env.PUBLIC_BASE_URL || 'https://report.donapharm.asia';
// CEO chốt: bản tin/báo cáo bán hàng chỉ gửi 07:30 và 18:00 GMT+7.
const DIGEST_CRON = process.env.DIGEST_CRON || '';
const DIGEST_TIMES = process.env.DIGEST_TIMES || '';
const API = `https://api.telegram.org/bot${TOKEN}`;
const CODE_RE = /\bRP-[A-Z0-9]{6}\b/i;

if (!TOKEN || !SECRET) {
  console.error('❌ Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_BOT_SECRET trong env/.env — worker không chạy.');
  process.exit(1);
}

async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}
const hhmm = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });

/* ===================== DIGEST TELEGRAM CHỦ ĐỘNG ===================== */
let digestPrefs = persist.load('telegram_digest_prefs', []); // { telegram_id, enabled, updated_at }
let digestLog = persist.load('telegram_digest_log', []);     // { key, telegram_id, emp_code, kind, day, sent_at }
const saveDigestPrefs = () => persist.save('telegram_digest_prefs', digestPrefs);
const saveDigestLog = () => persist.save('telegram_digest_log', digestLog);
const roleOf = (u) => String(u?.role || '').toLowerCase();
const isAdminUser = (u) => ['ceo', 'admin', 'full'].includes(roleOf(u));
const isSaleUser = (u) => roleOf(u) === 'sale';
const vnDate = (d = new Date()) => new Date(d.getTime() + 7 * 60 * 60 * 1000);
const vnDayKey = () => vnDate().toISOString().slice(0, 10);
const moneyShort = (n) => `${Math.round(Number(n || 0)).toLocaleString('vi-VN')}đ`;
const pctText = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`);
function prefEnabled(telegramId) {
  const p = digestPrefs.find((x) => String(x.telegram_id) === String(telegramId));
  return p ? p.enabled !== false : true;
}
function setDigestPref(telegramId, enabled) {
  const tid = String(telegramId);
  let p = digestPrefs.find((x) => String(x.telegram_id) === tid);
  if (!p) { p = { telegram_id: tid }; digestPrefs.push(p); }
  p.enabled = !!enabled;
  p.updated_at = new Date().toISOString();
  saveDigestPrefs();
}
function alreadySent(telegramId, kind, day = vnDayKey()) {
  const key = `${day}:${kind}:${telegramId}`;
  return digestLog.some((x) => x.key === key);
}
function markSent(telegramId, empCode, kind, day = vnDayKey()) {
  const key = `${day}:${kind}:${telegramId}`;
  if (!digestLog.some((x) => x.key === key)) digestLog.push({ key, telegram_id: String(telegramId), emp_code: empCode, kind, day, sent_at: new Date().toISOString() });
  if (digestLog.length > 5000) digestLog = digestLog.slice(-5000);
  saveDigestLog();
}
function userIsActiveForDigest(user, latestKy) {
  if (!user) return false;
  // Guardrail CEO chốt 2026-07-02: CTV ngoài vẫn đăng nhập/xem dữ liệu (pull),
  // nhưng tuyệt đối không được nhận bản tin/nhắc target chủ động (push) nếu CEO
  // chưa yêu cầu cụ thể + duyệt riêng. Áp cho DN021/DN022/DN023/VP004 qua master.
  if (user.no_auto_notify) return false;
  const st = String(user.status || user.trang_thai || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (st && /(nghi|da nghi|inactive|disabled|khoa)/.test(st)) return false;
  if (isAdminUser(user)) return true;
  const hasRows = store.getRows({ ky: latestKy, scope: { empCode: user.emp_code } }).length > 0;
  const markedActive = st && /(chinh thuc|cong tac|thu viec|active|dang lam)/.test(st);
  return hasRows || markedActive;
}
function digestTextFor(user) {
  const latestKy = store.latestKy();
  const scope = isAdminUser(user) ? { empCode: null } : { empCode: user.emp_code };
  const k = A.overviewKpis({ ky: latestKy, scope, label: latestKy });
  const alerts = smart.buildAlerts({ ky: latestKy, scope });
  if (isAdminUser(user)) {
    const dir = k.momPct == null ? '' : (k.momPct >= 0 ? `▲ ${pctText(k.momPct)}` : `▼ ${pctText(Math.abs(k.momPct))}`);
    return `📊 DNPHARMA — Kỳ ${latestKy}: DT ${moneyShort(k.revenue)}${dir ? ` (${dir} so kỳ trước)` : ''}.\n`
      + `⚠ ${alerts.summary.emp_below_target || 0} NV chưa đạt · ${alerts.summary.cst_low || 0} cơ số sắp cạn · ${alerts.summary.units_down || 0} đơn vị giảm mạnh.\n`
      + `Mở app: ${PUBLIC_URL}`;
  }
  const name = (user.name || user.emp_code).split(/\s+/).slice(-1)[0];
  const note = k.pctTarget != null && k.pctTarget < 80 ? '\n⚠ Anh/Chị đang dưới 80% target, cần chú ý đẩy doanh thu trong kỳ.' : '';
  return `Chào ${name}. Kỳ ${latestKy}: DT của bạn ${moneyShort(k.revenue)} · đạt ${pctText(k.pctTarget)} target.${note}\nMở app: ${PUBLIC_URL}`;
}
async function sendDigestToMap(m, { force = false, kind = 'morning' } = {}) {
  const tid = String(m.telegram_id);
  const user = store.findUserByCode(String(m.emp_code || '').toUpperCase());
  const latestKy = store.latestKy();
  if (!user || !userIsActiveForDigest(user, latestKy)) return { skipped: 'inactive_or_missing' };
  if (!isAdminUser(user) && !isSaleUser(user)) return { skipped: 'unsupported_role' };
  if (!force && !prefEnabled(tid)) return { skipped: 'opted_out' };
  const sendKind = isAdminUser(user) ? `${kind}:admin` : `${kind}:sale`;
  if (!force && alreadySent(tid, sendKind)) return { skipped: 'duplicate' };
  const r = await tg('sendMessage', { chat_id: tid, text: digestTextFor(user) });
  if (r.ok === false) return { error: r.description || 'telegram_send_failed' };
  if (!force) markSent(tid, user.emp_code, sendKind);
  return { ok: true, emp_code: user.emp_code };
}
async function runMorningDigest({ kind = 'digest' } = {}) {
  const maps = auth.listTelegramMap();
  let sent = 0, skipped = 0, failed = 0;
  for (const m of maps) {
    try {
      const r = await sendDigestToMap(m, { kind });
      if (r.ok) sent += 1; else skipped += 1;
    } catch (e) { failed += 1; console.error('digest send error:', m.emp_code, e.message); }
  }
  console.log(`✔ Digest done (${kind}): sent=${sent}, skipped=${skipped}, failed=${failed}`);
}
function parseDailyCron(expr) {
  const m = String(expr || '').trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!m) return null;
  return { minute: Math.min(59, Math.max(0, Number(m[1]))), hour: Math.min(23, Math.max(0, Number(m[2]))) };
}
function parseTimeList(value, fallback = '07:30,18:00') {
  const source = String(value || fallback || '').split(',');
  const slots = [];
  for (const raw of source) {
    const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const hour = Number(m[1]); const minute = Number(m[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
    const key = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (!slots.some((s) => s.key === key)) slots.push({ hour, minute, key });
  }
  return slots.length ? slots : parseTimeList(fallback, '07:30,18:00');
}
function digestScheduleSlots() {
  if (DIGEST_TIMES) return parseTimeList(DIGEST_TIMES, '07:30,18:00');
  const legacy = parseDailyCron(DIGEST_CRON);
  return legacy ? [{ ...legacy, key: `${String(legacy.hour).padStart(2, '0')}:${String(legacy.minute).padStart(2, '0')}` }] : parseTimeList('07:30,18:00');
}
// CEO chốt: digest/target chỉ gửi 18:00 hằng ngày + 13:00 thứ 7 (GMT+7).
// CEO chốt 2026-07-27: tin HẰNG NGÀY dời 18:00 -> 07:30. Khung thứ 7 13:00 giữ nguyên.
// Báo cáo THÁNG cố tình KHÔNG dời sang sáng (dời thì chốt sổ khi tháng chưa xong).
function approvedDigestTargetSlots() {
  return [
    { type: 'daily', hour: 7, minute: 30, key: 'daily-07:30', label: '07:30 hằng ngày' },
    { type: 'weekly', dow: 6, hour: 13, minute: 0, key: 'sat-13:00', label: '13:00 thứ 7' },
  ];
}
// Các mốc cố định khác (giờ VN) — khai tường minh để test khoá được, không rải số trong code.
const COST_WEEKLY_SLOT = { dow: 6, hour: 12, minute: 30, label: '12:30 thứ 7' };
// CEO chốt 2026-07-29: dời KHỐI CUỐI THÁNG từ chiều sang tối. Lý do CEO nêu —
// "lúc 17h30 là chưa xử lý số liệu xong" — đúng cho CẢ BA tin cuối tháng, nên dời
// cả ba và GIỮ NGUYÊN thứ tự: chi phí -> thưởng -> báo cáo doanh thu tháng.
const COST_MONTH_END_SLOT = { hour: 20, minute: 0, label: '20:00 ngày cuối tháng' };
const BONUS_MONTH_END_SLOT = { hour: 20, minute: 10, label: '20:10 ngày cuối tháng' };
const SALES_MONTH_END_SLOT = { hour: 20, minute: 30, label: '20:30 ngày cuối tháng' };
const SALES_DAILY_SLOT = { hour: 7, minute: 30, label: '07:30 hằng ngày' };
// Cảnh báo đồng bộ mức 2 đi cùng khung 07:30 (spec SPEC_REVENUE_SYNC_EXCEPTIONS mục 8.2).
const SYNC_ALERT_SLOT = { hour: 7, minute: 30, label: '07:30 hằng ngày (cảnh báo đồng bộ)' };
// ‼ CEO chốt 2026-07-30: tin 20:00 cuối tháng VẪN GỬI nhưng là số DỰ KIẾN (doanh thu
// còn cập nhật đến hết ngày khoá sổ). Số CHỐT gửi ở lượt riêng, NGÀY SAU ngày khoá
// sổ — lấy ngày từ employeeCost.PERIOD_CLOSE_DAY để chỉ có MỘT nguồn biết ngày 8.
const MONTH_CLOSE_DAY = employeeCost.PERIOD_CLOSE_DAY + 1;
const COST_MONTH_FINAL_SLOT = { hour: 20, minute: 0, label: `20:00 ngày ${MONTH_CLOSE_DAY} (sau khoá sổ)` };
const BONUS_MONTH_FINAL_SLOT = { hour: 20, minute: 10, label: `20:10 ngày ${MONTH_CLOSE_DAY} (sau khoá sổ)` };
function slotDue(slot, d) {
  if (d.getUTCHours() !== slot.hour || d.getUTCMinutes() !== slot.minute) return false;
  if (slot.type === 'weekly') return d.getUTCDay() === slot.dow;
  return true;
}
// Telegram gửi text thô -> bỏ ký hiệu markdown (**đậm**, *nghiêng*, # tiêu đề, `code`)
// để không hiện ra dấu sao/thăng thô như "**Tên NV**".
function stripMd(s) {
  return String(s || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(^|\s)\*(?!\s)(.*?)\*/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ');
}
function formatAnswerForTelegram(answer) {
  const head = stripMd(String(answer?.text || '').trim());
  const lines = (Array.isArray(answer?.lines) ? answer.lines.filter(Boolean) : []).map(stripMd);
  const out = [head, ...lines].filter(Boolean).join('\n');
  return out.length > 3900 ? `${out.slice(0, 3890)}…` : out;
}
const pendingClarify = new Map();
const CLARIFY_TTL_MS = 2 * 60 * 1000;
function normClarify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
}
function clarifyKey(msg) { return `${msg.chat.id}:${msg.from?.id || ''}`; }
function rememberClarify(msg, originalText, answerText) {
  if (!/Anh\/Chị muốn hỏi mã nào\?|Em thấy nhiều .* khớp/.test(answerText)) return;
  const options = [];
  for (const line of answerText.split(/\n/)) {
    const m = line.match(/^\s*•\s*([^:]+):\s*(.+?)\s*$/);
    if (m) options.push({ key: m[1].trim(), label: m[2].trim() });
  }
  if (options.length) pendingClarify.set(clarifyKey(msg), { originalText, options, expires: Date.now() + CLARIFY_TTL_MS });
}
function applyPendingClarify(msg, txt) {
  const k = clarifyKey(msg);
  const p = pendingClarify.get(k);
  if (!p) return txt;
  if (Date.now() > p.expires) { pendingClarify.delete(k); return txt; }
  const nq = normClarify(txt);
  const pick = p.options.find((o) => {
    const ko = normClarify(o.key), lo = normClarify(o.label), both = normClarify(`${o.key} ${o.label}`);
    return nq === ko || nq === lo || both.includes(nq) || nq.includes(ko);
  });
  if (!pick) return txt;
  pendingClarify.delete(k);
  return String(p.originalText || txt).replace(/(đơn vị|don vi|ở|o|tại|tai|của|cua|trong|bên|ben)\s+.+$/i, `$1 ${pick.key}`);
}
async function answerNaturalQuestion(msg, txt) {
  const map = auth.resolveTelegram(msg.from.id);
  if (!map) {
    return tg('sendMessage', { chat_id: msg.chat.id,
      text: [
        'Tài khoản Telegram của bạn CHƯA được liên kết với App Report nên mình chưa trả lời câu hỏi được.',
        `• Mã Telegram của bạn: ${msg.from.id}`,
        '• Gửi mã này cho quản trị (CEO) để liên kết, hoặc vào web App Report bấm “Đăng nhập bằng Telegram”.',
        'Sau khi liên kết xong, bạn hỏi lại là mình trả lời ngay (VD: “Doanh thu tháng 6?”, “Top sản phẩm”).',
      ].join('\n') });
  }
  const user = store.findUserByCode(String(map.emp_code || '').toUpperCase());
  const session = auth.sessionForUser(user);
  if (!session) {
    return tg('sendMessage', { chat_id: msg.chat.id,
      text: 'Tài khoản Telegram của bạn chưa được cấp quyền App Report. Vui lòng liên hệ quản trị.' });
  }
  try {
    const originalTxt = txt;
    txt = applyPendingClarify(msg, txt);
    const answer = await smart.answerQuestion({ text: txt, scope: auth.scopeOf(session), session });
    const out = formatAnswerForTelegram(answer);
    rememberClarify(msg, originalTxt, out);
    return tg('sendMessage', { chat_id: msg.chat.id, text: out });
  } catch (e) {
    console.error('telegram nlq error:', session.emp_code, e.message);
    return tg('sendMessage', { chat_id: msg.chat.id,
      text: 'Em chưa trả lời được câu này. Anh/Chị thử hỏi: “Doanh thu tháng 6?”, “Top sản phẩm”, “Tôi đạt bao nhiêu % target?”' });
  }
}
// Thông báo target chủ động (mốc 50/90/100 + chậm nhịp) + bản tổng cho CEO.
// TẮT mặc định; bật bằng env TARGET_NOTIFY=1 (để CEO xem preview rồi mới bật gửi thật).
async function runTargetMilestones() {
  if (process.env.TARGET_NOTIFY !== '1') return;
  const { events } = targetNotify.pendingEvents({});
  const maps = auth.listTelegramMap();
  const tidByEmp = {};
  for (const m of maps) tidByEmp[String(m.emp_code || '').toUpperCase()] = String(m.telegram_id);
  // Mốc THƯỞNG (CEO chốt 2026-07-27) chạy cùng nhịp và GỘP CHUNG 1 tin/người,
  // để NV không nhận 2-3 tin liền trong cùng một phút.
  // Ngưỡng đọc từ cấu hình thật (90 = P1 bắt đầu, 101 = P2 bắt đầu…), không hardcode.
  let bonusEvents = [];
  if (process.env.BONUS_NOTIFY === '1') {
    try {
      const ev = targetNotify.evaluate({});
      bonusEvents = bonusNotify.pendingEvents({
        ky: ev.ky, rows: ev.rows, config: employeeBonus.loadConfig(), isMuted: targetNotify.isMuted,
      }).events;
    } catch (err) { console.error('bonus milestone build error:', err.message); }
  }

  const byEmp = new Map();
  const push = (emp, item) => {
    if (!byEmp.has(emp)) byEmp.set(emp, { target: [], bonus: [], lines: [] });
    byEmp.get(emp)[item.bucket].push(item.event);
    byEmp.get(emp).lines.push(item.line);
  };
  for (const e of events) push(e.emp_code, { bucket: 'target', event: e, line: targetNotify.messageFor(e) });
  for (const e of bonusEvents) push(e.emp_code, { bucket: 'bonus', event: e, line: bonusNotify.messageFor(e) });

  const sent = [];
  const bonusSent = [];
  for (const [empCode, group] of byEmp) {
    const user = store.findUserByCode(empCode);
    if (!user || user.no_auto_notify) continue;
    const tid = tidByEmp[empCode];
    const email = notifyChannels.emailFor(empCode, user?.email);
    // Telegram cần đã map + không opt-out; email gửi nếu có địa chỉ.
    const telegramId = (tid && prefEnabled(tid)) ? tid : null;
    if (!telegramId && !email) continue; // chưa có kênh nào -> để dành
    try {
      // Email giữ mẫu HTML đẹp của sự kiện target đầu tiên; khi chỉ có tin thưởng
      // thì dựng HTML gọn từ chính nội dung text (không để trống thân thư).
      const firstTarget = group.target[0];
      const text = group.lines.filter(Boolean).join('\n\n');
      if (!text) continue;
      const r = await notifyChannels.deliver({
        telegramId, email,
        subject: 'DNPHARMA — Nhắc target',
        text,
        html: firstTarget && group.lines.length === 1 ? targetNotify.emailHtmlFor(firstTarget) : employeeCostNotify.htmlFor(text),
      });
      if (r.ok) { sent.push(...group.target); bonusSent.push(...group.bonus); }
    } catch (err) { console.error('milestone send error:', empCode, err.message); }
  }
  targetNotify.markSent(sent);
  bonusNotify.markSent(bonusSent);
  const digest = targetNotify.ceoDigest({});
  for (const m of maps) {
    const u = store.findUserByCode(m.emp_code);
    if (u && isAdminUser(u) && prefEnabled(String(m.telegram_id))) {
      try { await notifyChannels.deliver({ telegramId: String(m.telegram_id), email: notifyChannels.emailFor(u.emp_code, u.email), subject: 'DNPHARMA — Tổng hợp target', text: digest, html: targetNotify.ceoDigestHtml({}) }); } catch (err) { console.error('ceo digest error:', err.message); }
    }
  }
  // Đếm RIÊNG mốc target và mốc thưởng. Bản trước chỉ in `sent.length` (chỉ mốc
  // target) nên tin thưởng gửi hay không đều vô hình — không cách nào kiểm chứng.
  console.log(`✔ Mốc 07:30: ${byEmp.size} NV nhận tin — mốc target ${sent.length}, mốc thưởng ${bonusSent.length}`
    + `${process.env.BONUS_NOTIFY === '1' ? '' : ' (BONUS_NOTIFY đang TẮT)'}. Kèm CEO digest.`);
}
// ── Người nhận chung cho các tin tự động (self-scoped) ──────────────────────
// Lọc đúng 4 tầng chặn: chưa liên kết kênh nào · mã trong notify_optout.json ·
// cờ no_auto_notify trên hồ sơ · NV tự tắt trong Telegram.
function autoNotifyRecipients() {
  const tidByEmp = {};
  for (const m of auth.listTelegramMap()) tidByEmp[String(m.emp_code || '').toUpperCase()] = String(m.telegram_id);
  const out = [];
  for (const u of store.targetRoster({ scope: {} })) {
    const code = String(u.emp_code || '').toUpperCase();
    if (!code || targetNotify.isMuted(code)) continue;
    // Chặn thông báo dùng ĐÚNG MỘT nguồn: targetNotify.isMuted
    // (= notify_optout.json + cờ no_auto_notify trên hồ sơ).
    // ‼ KHÔNG dùng diemXu.EXCLUDE ở đây: đó là danh sách "không tính ĐIỂM XU",
    //   khác mục đích. Nó có DN022 — người CEO chốt 28/07 là PHẢI nhận thông báo
    //   như NV chính thức. Trộn hai danh sách là chặn nhầm người.
    const tid = tidByEmp[code];
    const telegramId = (tid && prefEnabled(tid)) ? tid : null;
    const email = notifyChannels.emailFor(code, u.email);
    if (!telegramId && !email) continue;
    out.push({ emp_code: code, name: u.name || code, telegramId, email });
  }
  return out;
}

// routes.js nạp muộn: tránh vòng require lúc khởi động bot.
function notifyServices() {
  try { return require('./src/routes').notifyServices || null; }
  catch (e) { console.error('notifyServices unavailable:', e.message); return null; }
}

const isoDay = (d) => d.toISOString().slice(0, 10);
// Ngày liền trước theo lịch (chuỗi 'YYYY-MM-DD'), dùng cho bản tin buổi sáng.
function previousDay(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const startOfMonthIso = (day) => `${String(day).slice(0, 7)}-01`;

// ── TỔNG CHI PHÍ NV TỰ NHẬN (CEO chốt: T7 12:30 lũy kế · cuối tháng 17:30 trọn tháng)
// Fail-closed: cờ phải đúng "1". Số do DataHub tính; còn tạm tính thì BẮT BUỘC gắn nhãn.
async function runEmployeeCostNotify({ kind, asOfDay, stage = 'provisional' }) {
  if (process.env.EMP_COST_NOTIFY !== '1') return;
  const svc = notifyServices();
  if (!svc) return;
  const monthKey = String(asOfDay).slice(0, 7);
  const from = monthKey;
  const to = monthKey;
  const periodKey = `${kind}|${kind === 'month' ? monthKey : asOfDay}${kind === 'month' ? `|${stage}` : ''}`;
  const ky = `${monthKey.slice(5, 7)}.${monthKey.slice(0, 4)}`;
  let sent = 0; let skipped = 0; let failed = 0;
  for (const r of autoNotifyRecipients()) {
    if (employeeCostNotify.alreadySent(kind, periodKey, r.emp_code)) { skipped += 1; continue; }
    try {
      const row = { emp_code: r.emp_code, name: r.name, ky, from: kind === 'month' ? startOfMonthIso(asOfDay) : startOfMonthIso(asOfDay), to: asOfDay };
      const res = await svc.employeeCostSummaryForNotify(r.emp_code, { from, to });
      // Lý do bỏ qua phải HIỆN RA log, không im lặng nuốt.
      if (res?.skipped) { skipped += 1; console.log(`  ↷ ${r.emp_code} bỏ qua chi phí: ${res.skipped}`); continue; }
      let text;
      if (!res || res.sourceAvailable === false) {
        text = employeeCostNotify.unavailableMessageFor(row);
      } else {
        const total = employeeCostNotify.totalFromSummary(res.summary);
        // Không có số dùng được -> im lặng, KHÔNG gửi "0đ" gây hoang mang.
        if (!total) { skipped += 1; continue; }
        // Số dòng còn chờ gán % = tổng dòng − dòng đã khớp (đúng nghĩa "cặp", không phải "mã gộp").
        const totalRows = Number(res.match?.totalRows);
        const matchedRows = Number(res.match?.matchedRows);
        const pairs = Number.isFinite(totalRows) && Number.isFinite(matchedRows) ? totalRows - matchedRows : null;
        // Số tạm giữ cuối năm chỉ đi kèm tin CUỐI THÁNG (CEO chốt).
        const annual = kind === 'month' ? employeeCostNotify.annualFromSummary(res.summary) : null;
        text = employeeCostNotify.messageFor({
          kind, row, total, gaps: { pairs }, annual,
          stage, closeNote: employeeCost.periodCloseNote(monthKey),
        });
      }
      if (!text) { skipped += 1; continue; }
      const out = await notifyChannels.deliver({
        telegramId: r.telegramId, email: r.email,
        subject: employeeCostNotify.subjectFor(kind, row),
        text, html: employeeCostNotify.htmlFor(text),
      });
      if (out.ok) { employeeCostNotify.markSent(kind, periodKey, r.emp_code); sent += 1; } else failed += 1;
    } catch (e) { failed += 1; console.error('emp-cost notify error:', r.emp_code, e.message); }
  }
  console.log(`✔ Chi phí NV (${kind}) ${periodKey}: gửi ${sent}, bỏ qua ${skipped}, lỗi ${failed}.`);
}

// ── TỔNG THƯỞNG CUỐI THÁNG (CEO chốt 17:40 ngày cuối tháng) ─────────────────
/**
 * CẢNH BÁO ĐỒNG BỘ DOANH THU (CEO chốt 29/07, yêu cầu làm ngay 30/07).
 * "Không có người canh cửa nên hậu quả là chạy lòng vòng đi tìm."
 *
 * KHÔNG lọc người nhận qua optout/isMuted — danh sách riêng ở
 * config/sync_alert_recipients.json. VP018 nằm trong optout nhưng PHẢI nhận.
 * Không có mục MỚI ⇒ không gửi gì.
 */
async function runSyncAlert({ urgent = null } = {}) {
  if (process.env.SYNC_ALERT_NOTIFY === '0') { console.log('ℹ Cảnh báo đồng bộ: TẮT (SYNC_ALERT_NOTIFY=0).'); return; }
  const who = syncAlert.recipients();
  if (!who.ok) { console.error(`❌ Cảnh báo đồng bộ: không đọc được danh sách người nhận (${who.reason}).`); return; }
  // Nguồn ngoại lệ: cảnh báo chất lượng dữ liệu của slot đang active (thiếu ngày
  // doanh thu…). Bổ sung nguồn khác thì nối vào mảng này, KHÔNG sửa syncAlert.
  const items = store.activeDataQualityWarnings({}).map((item) => ({
    ...item, reason: item.issue || item.reason,
  }));
  const pendingUrgent = urgent || persist.load('sync_alert_urgent', null);
  const state = syncAlert.loadState(persist);
  const ky = items[0]?.ky || store.latestKy();
  const messages = syncAlert.buildMessages({ ky, items, state, recipientList: who.list, urgent: pendingUrgent });
  if (!messages.length) { console.log(`ℹ Cảnh báo đồng bộ ${ky}: không có mục mới -> không gửi.`); return; }
  const tidByEmp = {};
  for (const m of auth.listTelegramMap()) tidByEmp[String(m.emp_code || '').toUpperCase()] = String(m.telegram_id);
  let sent = 0; let failed = 0;
  for (const message of messages) {
    const user = store.findUserByCode(message.empCode);
    const out = await notifyChannels.deliver({
      telegramId: tidByEmp[message.empCode] || null,
      email: notifyChannels.emailFor(message.empCode, user?.email),
      subject: `DONAPHARM — Cảnh báo đồng bộ doanh thu ${ky}`,
      text: message.text, html: employeeCostNotify.htmlFor(message.text),
    });
    if (out.ok) sent += 1; else { failed += 1; console.error(`  ✗ cảnh báo đồng bộ ${message.empCode}: ${out.error || 'không gửi được'}`); }
  }
  // Chỉ ghi đã-nhắn khi CÓ tin đi được; gửi lỗi hết mà ghi state là mất cảnh báo vĩnh viễn.
  if (sent > 0) syncAlert.saveState(syncAlert.markState({ items, state }), persist);
  if (pendingUrgent && sent > 0) persist.save('sync_alert_urgent', null);
  console.log(`✔ Cảnh báo đồng bộ ${ky}: gửi ${sent}, lỗi ${failed}${pendingUrgent ? ' (MỨC KHẨN)' : ''}.`);
}

async function runBonusMonthEnd({ asOfDay, stage = 'provisional' }) {
  if (process.env.BONUS_NOTIFY !== '1') return;
  const svc = notifyServices();
  if (!svc) return;
  const monthKey = String(asOfDay).slice(0, 7);
  const ky = `${monthKey.slice(5, 7)}.${monthKey.slice(0, 4)}`;
  const ev = targetNotify.evaluate({ ky });
  const byEmp = new Map(ev.rows.map((r) => [r.emp_code, r]));
  // periodKey mang theo stage: lượt dự kiến và lượt chốt là HAI tin khác nhau,
  // không được coi lượt chốt là 'đã gửi rồi' vì cuối tháng đã gửi bản dự kiến.
  const periodKey = `bonus_month|${monthKey}|${stage}`;
  let sent = 0; let skipped = 0; let failed = 0;
  for (const r of autoNotifyRecipients()) {
    const row = byEmp.get(r.emp_code);
    if (!row) { skipped += 1; continue; }                       // chưa giao target -> không nhắc
    if (employeeCostNotify.alreadySent('bonus_month', periodKey, r.emp_code)) { skipped += 1; continue; }
    try {
      const res = await svc.employeeBonusSummaryForNotify(r.emp_code, ky);
      if (res?.skipped) { skipped += 1; console.log(`  ↷ ${r.emp_code} bỏ qua thưởng: ${res.skipped}`); continue; }
      if (!res || res.sourceAvailable === false) { skipped += 1; continue; }  // thiếu nguồn -> không hứa tiền
      const text = bonusNotify.monthEndMessage({ ...row, ky }, res.bonus, {
        stage, closeNote: employeeCost.periodCloseNote(monthKey),
      });
      if (!text) { skipped += 1; continue; }
      const out = await notifyChannels.deliver({
        telegramId: r.telegramId, email: r.email,
        subject: `DONAPHARM — Thưởng dự kiến tháng ${ky.split('.')[0]} (${r.emp_code})`,
        text, html: employeeCostNotify.htmlFor(text),
      });
      if (out.ok) { employeeCostNotify.markSent('bonus_month', periodKey, r.emp_code); sent += 1; } else failed += 1;
    } catch (e) { failed += 1; console.error('bonus month-end error:', r.emp_code, e.message); }
  }
  console.log(`✔ Thưởng cuối tháng ${monthKey}: gửi ${sent}, bỏ qua ${skipped}, lỗi ${failed}.`);
}

// ── LỊCH: chi phí T7 12:30 · chi phí cuối tháng 17:30 · thưởng cuối tháng 17:40 ──
function startCostBonusScheduler() {
  const costOn = process.env.EMP_COST_NOTIFY === '1';
  const bonusOn = process.env.BONUS_NOTIFY === '1';
  if (!costOn && !bonusOn) {
    console.log('ℹ Chi phí/Thưởng notify: TẮT (đặt EMP_COST_NOTIFY=1 và/hoặc BONUS_NOTIFY=1).');
    return;
  }
  // Log phải nêu ĐỦ CẢ LƯỢT SỐ CHỐT, nếu không thì không ai chứng minh được lượt đó
  // đã lên lịch — mà đây chính là lượt quyết định NV nhận số cuối cùng.
  console.log(`✔ Chi phí/Thưởng scheduler: chi phí ${costOn ? `${COST_WEEKLY_SLOT.label} + ${COST_MONTH_END_SLOT.label} (dự kiến) + ${COST_MONTH_FINAL_SLOT.label} (số chốt)` : 'TẮT'}; `
    + `thưởng tháng ${bonusOn ? `${BONUS_MONTH_END_SLOT.label} (dự kiến) + ${BONUS_MONTH_FINAL_SLOT.label} (số chốt)` : 'TẮT'}; `
    + `cảnh báo đồng bộ ${process.env.SYNC_ALERT_NOTIFY === '0' ? 'TẮT' : `${SYNC_ALERT_SLOT.label} + quét KHẨN mỗi 5 phút`} GMT+7`);
  let lastWeekly = ''; let lastCostMonth = ''; let lastBonusMonth = '';
  let lastCostFinal = ''; let lastBonusFinal = '';
  let lastSyncAlert = ''; let lastSyncUrgent = '';
  setInterval(() => {
    const d = vnDate();               // getUTC* của vnDate CHÍNH LÀ giờ VN
    const day = isoDay(d);
    const hh = d.getUTCHours();
    const mm = d.getUTCMinutes();
    const monthEnd = salesReport.isMonthEnd(day);

    if (costOn && d.getUTCDay() === COST_WEEKLY_SLOT.dow && hh === COST_WEEKLY_SLOT.hour && mm === COST_WEEKLY_SLOT.minute) {
      if (lastWeekly !== day) { lastWeekly = day; runEmployeeCostNotify({ kind: 'week', asOfDay: day }).catch((e) => console.error('cost weekly error:', e.message)); }
    }
    if (costOn && monthEnd && hh === COST_MONTH_END_SLOT.hour && mm === COST_MONTH_END_SLOT.minute) {
      if (lastCostMonth !== day) { lastCostMonth = day; runEmployeeCostNotify({ kind: 'month', asOfDay: day }).catch((e) => console.error('cost month error:', e.message)); }
    }
    if (bonusOn && monthEnd && hh === BONUS_MONTH_END_SLOT.hour && mm === BONUS_MONTH_END_SLOT.minute) {
      if (lastBonusMonth !== day) { lastBonusMonth = day; runBonusMonthEnd({ asOfDay: day }).catch((e) => console.error('bonus month error:', e.message)); }
    }
    // Cảnh báo đồng bộ MỨC 2: 07:30 hằng ngày (spec mục 8.2).
    if (hh === SYNC_ALERT_SLOT.hour && mm === SYNC_ALERT_SLOT.minute) {
      if (lastSyncAlert !== day) { lastSyncAlert = day; runSyncAlert().catch((e) => console.error('sync alert error:', e.message)); }
    }
    // MỨC 1 KHẨN: bất biến vỡ thì KHÔNG đợi khung giờ. Quét mỗi 5 phút để tin đi
    // trong vòng vài phút kể từ lúc script materialize ghi cờ khẩn.
    if (mm % 5 === 0 && persist.load('sync_alert_urgent', null)) {
      const urgentKey = `${day} ${hh}:${mm}`;
      if (lastSyncUrgent !== urgentKey) { lastSyncUrgent = urgentKey; runSyncAlert().catch((e) => console.error('sync alert urgent error:', e.message)); }
    }
    // LƯỢT SỐ CHỐT: chạy ngày MONTH_CLOSE_DAY, gửi cho kỳ VỪA KHOÁ = tháng TRƯỚC.
    // Dùng ngày cuối tháng trước làm asOfDay để mọi hàm bên dưới lấy đúng kỳ đó.
    const isCloseDay = d.getUTCDate() === MONTH_CLOSE_DAY;
    const closedPeriodAsOf = isCloseDay ? isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))) : '';
    if (costOn && isCloseDay && hh === COST_MONTH_FINAL_SLOT.hour && mm === COST_MONTH_FINAL_SLOT.minute) {
      if (lastCostFinal !== day) { lastCostFinal = day; runEmployeeCostNotify({ kind: 'month', asOfDay: closedPeriodAsOf, stage: 'final' }).catch((e) => console.error('cost month final error:', e.message)); }
    }
    if (bonusOn && isCloseDay && hh === BONUS_MONTH_FINAL_SLOT.hour && mm === BONUS_MONTH_FINAL_SLOT.minute) {
      if (lastBonusFinal !== day) { lastBonusFinal = day; runBonusMonthEnd({ asOfDay: closedPeriodAsOf, stage: 'final' }).catch((e) => console.error('bonus month final error:', e.message)); }
    }
  }, 30 * 1000);
}

function startMilestoneScheduler() {
  if (process.env.TARGET_NOTIFY !== '1') { console.log('ℹ Target milestone notify: TẮT (đặt TARGET_NOTIFY=1 để bật).'); return; }
  const slots = approvedDigestTargetSlots();
  let lastKey = '';
  console.log(`✔ Target milestone scheduler: ${slots.map((s) => s.label).join('; ')} GMT+7`);
  setInterval(() => {
    const d = vnDate(); // getUTCHours() của vnDate = giờ VN
    const slot = slots.find((s) => slotDue(s, d));
    if (slot) {
      const key = `${d.toISOString().slice(0, 10)} ${slot.key}`;
      if (lastKey !== key) { lastKey = key; runTargetMilestones().catch((e) => console.error('milestone scheduler error:', e.message)); }
    }
  }, 30 * 1000);
}

// Log phải phân biệt "bỏ qua vì không có dữ liệu" với "gửi CEO THẤT BẠI".
// Bản cũ in `ceo=fail` cho cả hai, nên lần chạy đúng-theo-thiết-kế cũng đọc
// như hỏng hóc — mất cả buổi đi truy một thứ không sai.
function salesReportDoneLine(kind, r = {}, key = '') {
  if (r.skipped === 'no_data') {
    const n = r.skippedRecipients?.length || 0;
    return `✔ SalesReport ${kind}: KHÔNG GỬI — kỳ này chưa có dữ liệu (${n} NV bỏ qua). Đúng thiết kế, không phải lỗi. key=${key}`;
  }
  if (r.skipped === 'duplicate') return `ℹ SalesReport ${kind}: bỏ qua vì đã gửi kỳ này rồi. key=${key}`;
  return `✔ SalesReport ${kind} done: sent=${r.sent?.length || 0}, failed=${r.failed?.length || 0}, `
    + `ceo=${r.ceoResult?.ok ? 'ok' : 'fail'}, key=${key}`;
}

function startSalesReportScheduler() {
  // Fail closed: thiếu biến hoặc giá trị khác chính xác \"1\" đều phải TẮT.
  // Daily là cờ riêng để không vô tình bật gửi hằng ngày khi chỉ duyệt tuần/tháng.
  const policy = salesReportSchedulePolicy(process.env);
  if (!policy.masterEnabled) { console.log('ℹ SalesReport scheduler: TẮT (chỉ bật khi SALES_REPORT_NOTIFY=1).'); return; }
  const dailyEnabled = policy.dailyEnabled;
  let lastWeeklyKey = '';
  let lastMonthlyKey = '';
  let lastDailyKey = '';
  console.log(`✔ SalesReport scheduler armed: ngày ${dailyEnabled ? SALES_DAILY_SLOT.label : 'TẮT'}; tuần Thứ 7 13:00; tháng 18:00 ngày cuối tháng. TZ=${process.env.TZ}`);
  setInterval(() => {
    const d = vnDate(); // giống digest scheduler: getUTC* của vnDate chính là giờ/phút/ngày VN; KHÔNG trừ thêm 7.
    const day = d.toISOString().slice(0, 10);
    const hh = d.getUTCHours();
    const mm = d.getUTCMinutes();
    if (dailyEnabled && hh === SALES_DAILY_SLOT.hour && mm === SALES_DAILY_SLOT.minute) {
      // ‼ Bản tin buổi sáng phải báo số của NGÀY HÔM QUA.
      //   Trước đây lấy `day` = hôm nay: chạy lúc 07:30 thì ngày đó chưa có đơn
      //   nào, báo cáo luôn rỗng -> với chốt "không có dữ liệu thì không gửi",
      //   luồng này sẽ CÂM VĨNH VIỄN. Đúng bản chất là chốt sổ ngày đã qua.
      const ranges = salesReport.defaultRanges(previousDay(day));
      const key = salesReport.salesReportPeriodKey('day', ranges);
      if (lastDailyKey !== key) {
        lastDailyKey = key;
        if (salesReport.alreadySent('day', ranges)) console.log(`ℹ SalesReport day skip duplicate: ${key}`);
        else salesReport.sendAll({ kind: 'day', ranges }).then((r) => console.log(salesReportDoneLine('day', r, key))).catch((e) => console.error('salesReport day scheduler error:', e.message));
      }
    }
    if (d.getUTCDay() === 6 && hh === 13 && mm === 0) {
      const ranges = salesReport.defaultRanges(day);
      const key = salesReport.salesReportPeriodKey('week', ranges);
      if (lastWeeklyKey !== key) {
        lastWeeklyKey = key;
        if (salesReport.alreadySent('week', ranges)) console.log(`ℹ SalesReport week skip duplicate: ${key}`);
        else salesReport.sendAll({ kind: 'week', ranges }).then((r) => console.log(salesReportDoneLine('week', r, key))).catch((e) => console.error('salesReport week scheduler error:', e.message));
      }
    }
    if (hh === SALES_MONTH_END_SLOT.hour && mm === SALES_MONTH_END_SLOT.minute) {
      const ranges = salesReport.defaultRanges(day);
      if (!salesReport.isMonthEnd(ranges.asOf)) return;
      const key = salesReport.salesReportPeriodKey('month', ranges);
      if (lastMonthlyKey !== key) {
        lastMonthlyKey = key;
        if (salesReport.alreadySent('month', ranges)) console.log(`ℹ SalesReport month skip duplicate: ${key}`);
        else salesReport.sendAll({ kind: 'month', ranges }).then((r) => console.log(salesReportDoneLine('month', r, key))).catch((e) => console.error('salesReport month scheduler error:', e.message));
      }
    }
  }, 30 * 1000);
}

function startDigestScheduler() {
  if (process.env.DIGEST_NOTIFY === '0') { console.log('ℹ Telegram digest scheduler: TẮT (DIGEST_NOTIFY=0).'); return; }
  const slots = approvedDigestTargetSlots();
  // DIGEST_TIMES/DIGEST_CRON theo giờ VN. vnDate().getUTCHours()/getUTCMinutes() CHÍNH LÀ giờ:phút VN,
  // nên so THẲNG với cron.hour/minute (bản cũ trừ thêm 7 -> bắn sớm 7 tiếng = lỗi 1h30).
  let lastRunKey = '';
  console.log(`✔ Telegram digest scheduler: ${slots.map((s) => s.label).join('; ')} GMT+7`);
  setInterval(() => {
    const d = vnDate();
    const slot = slots.find((s) => slotDue(s, d));
    if (!slot) return;
    const key = `${d.toISOString().slice(0, 10)} ${slot.key}`;
    if (lastRunKey !== key) {
      lastRunKey = key;
      runMorningDigest({ kind: `digest:${slot.key}` }).catch((e) => console.error('digest scheduler error:', e.message));
    }
  }, 30 * 1000);
}

// Gửi thẻ xác nhận có nút ✅ / ❌ (KHÔNG tự confirm — chờ NV bấm).
async function askConfirm(chatId, code) {
  const t = hhmm();
  await tg('sendMessage', {
    chat_id: chatId,
    text: `🔐 *Đăng nhập App Report*\nMã: \`${code}\`\nThời điểm: ${t}\n\n`
      + `Nếu *chính bạn* đang đăng nhập trên trình duyệt, hãy bấm ✅ bên dưới.\n\n`
      + `⚠️ *Không* bấm xác nhận nếu người khác nhờ bạn nhập/đọc mã này — đó là dấu hiệu lừa đảo.`,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [
      [{ text: `✅ Xác nhận đăng nhập App Report lúc ${t}`, callback_data: `ok:${code}` }],
      [{ text: '❌ Không phải tôi', callback_data: `no:${code}` }],
    ] },
  });
}

async function doConfirm(cbq, code) {
  const telegram_id = cbq.from.id;
  let text;
  try {
    let r = await fetch(`${BASE}/api/auth/telegram/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login_code: code, telegram_id, secret_bot: SECRET }),
    });
    let d = await r.json().catch(() => ({}));
    if (r.status === 404) {
      const grant = claimPendingTelegramGrant(telegram_id, cbq.from);
      if (grant) {
        r = await fetch(`${BASE}/api/auth/telegram/confirm`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ login_code: code, telegram_id, secret_bot: SECRET }),
        });
        d = await r.json().catch(() => ({}));
        if (r.ok && d.ok) text = `✅ Đã cấp quyền ${grant.emp_code} — ${grant.name} và xác nhận đăng nhập. Quay lại trình duyệt — bạn sẽ được đăng nhập tự động.`;
      }
    }
    if (!text) {
      if (r.ok && d.ok) text = `✅ Đã xác nhận. Quay lại trình duyệt — bạn sẽ được đăng nhập tự động.`;
      else if (r.status === 404) text = (d.message || 'Tài khoản Telegram của bạn chưa được cấp quyền App Report. Vui lòng liên hệ quản trị.') + `
Mã Telegram của bạn: ${telegram_id}`;
      else if (r.status === 410) text = '⌛ Mã đã hết hạn. Hãy tạo mã mới trên trình duyệt.';
      else if (r.status === 409) text = 'Mã này đã được xác nhận rồi.';
      else text = d.error || 'Không xác nhận được, thử lại.';
    }
  } catch {
    text = 'Lỗi kết nối máy chủ App Report, thử lại sau.';
  }
  await tg('answerCallbackQuery', { callback_query_id: cbq.id });
  await tg('editMessageText', { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id, text });
}

async function handleUpdate(u) {
  try {
    if (u.message && u.message.text) {
      const txt = u.message.text.trim();
      if (/^\/tat(?:\s|$)/i.test(txt)) {
        setDigestPref(u.message.from.id, false);
        return tg('sendMessage', { chat_id: u.message.chat.id, text: 'Đã tắt bản tin App Report hằng ngày. Gõ /bat để bật lại.' });
      }
      if (/^\/bat(?:\s|$)/i.test(txt)) {
        setDigestPref(u.message.from.id, true);
        return tg('sendMessage', { chat_id: u.message.chat.id, text: 'Đã bật lại bản tin App Report hằng ngày.' });
      }
      if (/^\/digest_test(?:\s|$)/i.test(txt)) {
        const mAdmin = auth.resolveTelegram(u.message.from.id);
        const user = mAdmin && store.findUserByCode(mAdmin.emp_code);
        if (!user || !isAdminUser(user)) return tg('sendMessage', { chat_id: u.message.chat.id, text: 'Lệnh này chỉ dành cho CEO/admin.' });
        const r = await sendDigestToMap(mAdmin, { force: true, kind: 'test' });
        return tg('sendMessage', { chat_id: u.message.chat.id, text: r.ok ? 'Đã gửi bản tin test cho chính admin.' : `Không gửi được bản tin test: ${r.skipped || r.error || 'unknown'}` });
      }
      // Deep link /start RP-XXXXXX hoặc gõ/tán mã trực tiếp.
      const m = txt.match(CODE_RE);
      if (m) return askConfirm(u.message.chat.id, m[0].toUpperCase());
      if (/^\/start\b/.test(txt)) {
        return tg('sendMessage', { chat_id: u.message.chat.id,
          text: 'Chào bạn 👋 Để đăng nhập App Report, hãy bấm “Đăng nhập bằng Telegram” trên web rồi gửi mã RP-XXXXXX vào đây. Nếu tài khoản đã được cấp quyền, Anh/Chị có thể hỏi nhanh như: “Doanh thu tháng 6?”, “Top sản phẩm”, “Tôi đạt bao nhiêu % target?”' });
      }
      return answerNaturalQuestion(u.message, txt);
    }
    if (u.callback_query) {
      const data = u.callback_query.data || '';
      if (data.startsWith('ok:')) return doConfirm(u.callback_query, data.slice(3));
      if (data.startsWith('no:')) {
        await tg('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: 'Đã hủy.' });
        return tg('editMessageText', { chat_id: u.callback_query.message.chat.id, message_id: u.callback_query.message.message_id,
          text: '❌ Đã hủy yêu cầu đăng nhập. Nếu không phải bạn tạo mã, hãy bỏ qua.' });
      }
    }
  } catch (e) { console.error('handleUpdate error:', e.message); }
}

async function main() {
  const me = await tg('getMe', {});
  console.log(`✔ Telegram login bot: @${me.result?.username || '?'} → backend ${BASE}`);
  startDigestScheduler();
  startMilestoneScheduler();
  startSalesReportScheduler();
  startCostBonusScheduler();
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      for (const u of (r.result || [])) { offset = u.update_id + 1; await handleUpdate(u); }
    } catch (e) {
      console.error('getUpdates error:', e.message);
      await new Promise((res) => setTimeout(res, 3000));
    }
  }
}
main();
