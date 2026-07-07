/**
 * notifyChannels.js — kênh gửi thông báo (hiện có Telegram; email GĐ2).
 * Dùng cho gửi CHỦ ĐỘNG từ app (CEO bấm "Gửi ngay"/"Gửi thử").
 * Worker telegram-bot.js gửi TỰ ĐỘNG theo lịch bằng bộ gửi riêng của nó.
 */
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

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

module.exports = { sendTelegram, telegramReady };
