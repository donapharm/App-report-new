/**
 * notifyChannels.js — kênh gửi thông báo: Telegram + Email (Gmail/Google Workspace SMTP).
 * Gửi CHỦ ĐỘNG từ app (CEO bấm) và cả worker dùng lại được.
 *
 * ENV Email (nhờ bot cấp — Gmail/Workspace):
 *   SMTP_HOST=smtp.gmail.com  SMTP_PORT=587  SMTP_USER=<gmail gửi>  SMTP_PASS=<app password 16 ký tự>
 *   SMTP_FROM="DONAPHARM App Report <no-reply@donapharm...>" (tùy chọn, mặc định = SMTP_USER)
 * Danh sách email NV: server/data/nv_emails.json  { "DN001": "a@gmail.com", ... }  (bot điền, gitignored).
 */
const fs = require('fs');
const path = require('path');
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const EMAILS_FILE = path.join(__dirname, '..', 'data', 'nv_emails.json');

// Ảnh nhúng INLINE cho email HTML (logo + QR Zalo OA). Gmail chặn ảnh data-URI nên
// phải đính kèm kiểu CID; html tham chiếu src="cid:dnpharma-logo"/"cid:dnpharma-zalo".
const ASSET_DIR = path.join(__dirname, '..', '..', 'web', 'public');
const INLINE_IMAGES = [
  { filename: 'logo-dnpharma.png', path: path.join(ASSET_DIR, 'logo-dnpharma.png'), cid: 'dnpharma-logo' },
  { filename: 'zalo-oa-qr.png', path: path.join(ASSET_DIR, 'zalo-oa-qr.png'), cid: 'dnpharma-zalo' },
];
function inlineAttachments() {
  return INLINE_IMAGES.filter((x) => { try { return fs.existsSync(x.path); } catch { return false; } });
}

let _transport = null, _transportTried = false;
function emailReady() { return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS); }
function transport() {
  if (_transportTried) return _transport;
  _transportTried = true;
  if (!emailReady()) return null;
  try {
    const nodemailer = require('nodemailer');
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } catch (e) { console.error('SMTP init lỗi:', e.message); _transport = null; }
  return _transport;
}
// Email của 1 NV: ưu tiên file nv_emails.json (bot điền), fallback tham số userEmail (từ user record).
let _emailMap = null, _emailMtime = -1;
function emailMap() {
  try {
    const st = fs.statSync(EMAILS_FILE);
    if (!_emailMap || st.mtimeMs !== _emailMtime) {
      const j = JSON.parse(fs.readFileSync(EMAILS_FILE, 'utf8')) || {};
      _emailMap = Object.fromEntries(Object.entries(j.emails || j).map(([k, v]) => [String(k).trim().toUpperCase(), String(v || '').trim()]));
      _emailMtime = st.mtimeMs;
    }
  } catch { if (!_emailMap) _emailMap = {}; }
  return _emailMap;
}
function emailFor(emp, userEmail) {
  const ok = (e) => (/.+@.+\..+/.test(String(e || '').trim()) ? String(e).trim() : '');
  return ok(emailMap()[String(emp || '').trim().toUpperCase()]) || ok(userEmail);
}
async function sendEmail(to, subject, text, html) {
  const t = transport();
  if (!t) return { ok: false, description: 'Email chưa cấu hình (thiếu SMTP_HOST/USER/PASS).' };
  if (!to) return { ok: false, description: 'NV chưa có email.' };
  try {
    const msg = { from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject: subject || 'DONAPHARM App Report', text: String(text || '') };
    if (html) { msg.html = String(html); msg.attachments = inlineAttachments(); } // ảnh inline chỉ khi gửi HTML
    await t.sendMail(msg);
    return { ok: true };
  } catch (e) { return { ok: false, description: e.message }; }
}

async function sendTelegram(chatId, text) {
  if (!TG_TOKEN) return { ok: false, description: 'App chưa có TELEGRAM_BOT_TOKEN trong env.' };
  if (!chatId) return { ok: false, description: 'Thiếu chat_id (NV chưa liên kết Telegram).' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(chatId), text: String(text || '').slice(0, 3900) }),
    });
    const j = await r.json().catch(() => ({}));
    return j && j.ok ? { ok: true } : { ok: false, description: j?.description || 'telegram_send_failed' };
  } catch (e) { return { ok: false, description: e.message }; }
}

function telegramReady() { return !!TG_TOKEN; }
function anyReady() { return telegramReady() || emailReady(); }

// Gửi 1 tin tới NV qua MỌI kênh có sẵn (Telegram + Email). ok = có ít nhất 1 kênh gửi được.
async function deliver({ telegramId, email, subject, text, html }) {
  const out = { channels: [] };
  if (telegramId) { out.telegram = await sendTelegram(telegramId, text); if (out.telegram.ok) out.channels.push('telegram'); }
  if (email) { out.email = await sendEmail(email, subject, text, html); if (out.email.ok) out.channels.push('email'); }
  out.ok = out.channels.length > 0;
  return out;
}

module.exports = { sendTelegram, telegramReady, sendEmail, emailReady, emailFor, anyReady, deliver };
