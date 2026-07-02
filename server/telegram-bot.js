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
 */
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

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SECRET = process.env.TELEGRAM_BOT_SECRET || '';
const BASE = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3860}`;
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
      // Deep link /start RP-XXXXXX hoặc gõ/tán mã trực tiếp.
      const m = txt.match(CODE_RE);
      if (m) return askConfirm(u.message.chat.id, m[0].toUpperCase());
      if (/^\/start\b/.test(txt)) {
        return tg('sendMessage', { chat_id: u.message.chat.id,
          text: 'Chào bạn 👋 Để đăng nhập App Report, hãy bấm “Đăng nhập bằng Telegram” trên web rồi gửi mã RP-XXXXXX vào đây.' });
      }
      return tg('sendMessage', { chat_id: u.message.chat.id,
        text: 'Gửi mã đăng nhập dạng RP-XXXXXX để xác nhận đăng nhập App Report.' });
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
