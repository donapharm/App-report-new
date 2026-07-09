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
 *   APP_BASE_URL         mặc định http://localhost:${PORT||3860}
 *   PORT                 cổng backend app (nếu không đặt APP_BASE_URL)
 *   DIGEST_CRON          lịch bản tin theo giờ VN (GMT+7), mặc định "0 0 * * *" (nửa đêm)
 *   APP_PUBLIC_URL       link mở app trong bản tin, mặc định https://reportnew.donapharm.asia
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

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SECRET = process.env.TELEGRAM_BOT_SECRET || '';
const BASE = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3860}`;
const PUBLIC_URL = process.env.APP_PUBLIC_URL || process.env.PUBLIC_BASE_URL || 'https://reportnew.donapharm.asia';
const DIGEST_CRON = process.env.DIGEST_CRON || '0 0 * * *'; // mặc định NỬA ĐÊM giờ VN (CEO chốt)
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
async function runMorningDigest() {
  const maps = auth.listTelegramMap();
  let sent = 0, skipped = 0, failed = 0;
  for (const m of maps) {
    try {
      const r = await sendDigestToMap(m);
      if (r.ok) sent += 1; else skipped += 1;
    } catch (e) { failed += 1; console.error('digest send error:', m.emp_code, e.message); }
  }
  console.log(`✔ Digest morning done: sent=${sent}, skipped=${skipped}, failed=${failed}`);
}
function parseDailyCron(expr) {
  const m = String(expr || '').trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!m) return { minute: 30, hour: 7 };
  return { minute: Math.min(59, Math.max(0, Number(m[1]))), hour: Math.min(23, Math.max(0, Number(m[2]))) };
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
    const answer = await smart.answerQuestion({ text: txt, scope: auth.scopeOf(session), session });
    return tg('sendMessage', { chat_id: msg.chat.id, text: formatAnswerForTelegram(answer) });
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
  const sent = [];
  for (const e of events) {
    const user = store.findUserByCode(e.emp_code);
    if (!user || user.no_auto_notify) continue;
    const tid = tidByEmp[e.emp_code];
    const email = notifyChannels.emailFor(e.emp_code, user?.email);
    // Telegram cần đã map + không opt-out; email gửi nếu có địa chỉ.
    const telegramId = (tid && prefEnabled(tid)) ? tid : null;
    if (!telegramId && !email) continue; // chưa có kênh nào -> để dành
    try {
      const r = await notifyChannels.deliver({ telegramId, email, subject: 'DNPHARMA — Nhắc target', text: targetNotify.messageFor(e), html: targetNotify.emailHtmlFor(e) });
      if (r.ok) sent.push(e);
    } catch (err) { console.error('milestone send error:', e.emp_code, err.message); }
  }
  targetNotify.markSent(sent);
  const digest = targetNotify.ceoDigest({});
  for (const m of maps) {
    const u = store.findUserByCode(m.emp_code);
    if (u && isAdminUser(u) && prefEnabled(String(m.telegram_id))) {
      try { await notifyChannels.deliver({ telegramId: String(m.telegram_id), email: notifyChannels.emailFor(u.emp_code, u.email), subject: 'DNPHARMA — Tổng hợp target', text: digest, html: targetNotify.ceoDigestHtml({}) }); } catch (err) { console.error('ceo digest error:', err.message); }
    }
  }
  console.log(`✔ Target milestones: gửi ${sent.length} tin NV + CEO digest.`);
}
function startMilestoneScheduler() {
  if (process.env.TARGET_NOTIFY !== '1') { console.log('ℹ Target milestone notify: TẮT (đặt TARGET_NOTIFY=1 để bật).'); return; }
  const hoursVN = String(process.env.TARGET_NOTIFY_HOURS || '8,20').split(',').map((h) => Number(String(h).trim())).filter((h) => h >= 0 && h <= 23);
  let lastKey = '';
  console.log(`✔ Target milestone scheduler: giờ VN ${hoursVN.join(', ')}`);
  setInterval(() => {
    const d = vnDate(); // getUTCHours() của vnDate = giờ VN
    if (hoursVN.includes(d.getUTCHours()) && d.getUTCMinutes() === 0) {
      const key = `${d.toISOString().slice(0, 13)}`;
      if (lastKey !== key) { lastKey = key; runTargetMilestones().catch((e) => console.error('milestone scheduler error:', e.message)); }
    }
  }, 30 * 1000);
}

function startSalesReportScheduler() {
  if (process.env.SALES_REPORT_NOTIFY === '0') { console.log('ℹ SalesReport scheduler: TẮT (SALES_REPORT_NOTIFY=0).'); return; }
  let lastWeeklyKey = '';
  let lastMonthlyKey = '';
  console.log('✔ SalesReport scheduler armed: tuần Thứ 7 13:00 giờ VN; tháng 18:30 giờ VN nếu là ngày cuối tháng. TZ=' + process.env.TZ);
  setInterval(() => {
    const d = vnDate(); // giống digest scheduler: getUTC* của vnDate chính là giờ/phút/ngày VN; KHÔNG trừ thêm 7.
    const day = d.toISOString().slice(0, 10);
    const hh = d.getUTCHours();
    const mm = d.getUTCMinutes();
    if (d.getUTCDay() === 6 && hh === 13 && mm === 0) {
      const ranges = salesReport.defaultRanges(day);
      const key = salesReport.salesReportPeriodKey('week', ranges);
      if (lastWeeklyKey !== key) {
        lastWeeklyKey = key;
        if (salesReport.alreadySent('week', ranges)) console.log(`ℹ SalesReport week skip duplicate: ${key}`);
        else salesReport.sendAll({ kind: 'week', ranges }).then((r) => console.log(`✔ SalesReport week done: sent=${r.sent?.length || 0}, failed=${r.failed?.length || 0}, ceo=${r.ceoResult?.ok ? 'ok' : 'fail'}, key=${key}`)).catch((e) => console.error('salesReport week scheduler error:', e.message));
      }
    }
    if (hh === 18 && mm === 30) {
      const ranges = salesReport.defaultRanges(day);
      if (!salesReport.isMonthEnd(ranges.asOf)) return;
      const key = salesReport.salesReportPeriodKey('month', ranges);
      if (lastMonthlyKey !== key) {
        lastMonthlyKey = key;
        if (salesReport.alreadySent('month', ranges)) console.log(`ℹ SalesReport month skip duplicate: ${key}`);
        else salesReport.sendAll({ kind: 'month', ranges }).then((r) => console.log(`✔ SalesReport month done: sent=${r.sent?.length || 0}, failed=${r.failed?.length || 0}, ceo=${r.ceoResult?.ok ? 'ok' : 'fail'}, key=${key}`)).catch((e) => console.error('salesReport month scheduler error:', e.message));
      }
    }
  }, 30 * 1000);
}

function startDigestScheduler() {
  const cron = parseDailyCron(DIGEST_CRON);
  // DIGEST_CRON theo giờ VN. vnDate().getUTCHours()/getUTCMinutes() CHÍNH LÀ giờ:phút VN,
  // nên so THẲNG với cron.hour/minute (bản cũ trừ thêm 7 -> bắn sớm 7 tiếng = lỗi 1h30).
  let lastRunKey = '';
  console.log(`✔ Telegram digest scheduler: ${String(cron.hour).padStart(2, '0')}:${String(cron.minute).padStart(2, '0')} giờ VN (GMT+7)`);
  setInterval(() => {
    const d = vnDate();
    const key = `${d.toISOString().slice(0, 10)} ${cron.hour}:${cron.minute}`;
    if (d.getUTCHours() === cron.hour && d.getUTCMinutes() === cron.minute && lastRunKey !== key) {
      lastRunKey = key;
      runMorningDigest().catch((e) => console.error('digest scheduler error:', e.message));
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
    const r = await fetch(`${BASE}/api/auth/telegram/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login_code: code, telegram_id, secret_bot: SECRET }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) text = `✅ Đã xác nhận. Quay lại trình duyệt — bạn sẽ được đăng nhập tự động.`;
    else if (r.status === 404) text = d.message || 'Tài khoản Telegram của bạn chưa được cấp quyền App Report. Vui lòng liên hệ quản trị.';
    else if (r.status === 410) text = '⌛ Mã đã hết hạn. Hãy tạo mã mới trên trình duyệt.';
    else if (r.status === 409) text = 'Mã này đã được xác nhận rồi.';
    else text = d.error || 'Không xác nhận được, thử lại.';
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
