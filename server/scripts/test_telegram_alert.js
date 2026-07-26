'use strict';

/**
 * test_telegram_alert.js — TỰ KIỂM đường cảnh báo Telegram (chạy TRÊN SERVER THẬT).
 *
 * Vì sao có file này: Claude Code chạy ngoài mạng nội bộ, không có token/chat_id nên
 * KHÔNG tự gửi thật được. Script này để người vận hành (hoặc bot) chạy 1 lệnh là biết
 * đường cảnh báo có thông không, hỏng ở khâu nào — không phải đoán.
 *
 *   cd server && node scripts/test_telegram_alert.js          # chỉ CHẨN ĐOÁN, không gửi
 *   cd server && node scripts/test_telegram_alert.js --send   # GỬI tin thử thật
 */

const path = require('path');
const fs = require('fs');

// Nạp .env cạnh repo giống src/index.js (không thêm dependency).
try {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* .env là tuỳ chọn */ }

const notifyChannels = require('../src/notifyChannels');
const alert = require('../src/employeeCostSourceAlert');

const SEND = process.argv.includes('--send');

function line(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function main() {
  console.log('=== TỰ KIỂM ĐƯỜNG CẢNH BÁO TELEGRAM ===\n');

  const hasToken = notifyChannels.telegramReady();
  line('TELEGRAM_BOT_TOKEN', hasToken, hasToken ? 'đã cấu hình' : 'THIẾU — đặt trong .env cạnh repo');

  const recipients = alert.adminRecipients();
  const hasRecipients = recipients.length > 0;
  line('Người nhận (CEO/ADMIN đã liên kết Telegram)', hasRecipients,
    hasRecipients ? recipients.map((r) => r.empCode).join(', ') : 'CHƯA CÓ AI — CEO/ADMIN cần liên kết Telegram với app');

  if (!hasToken || !hasRecipients) {
    console.log('\n⚠ Chưa gửi được. Sửa các mục ❌ ở trên rồi chạy lại.');
    process.exit(1);
  }

  const text = [
    '🔔 [TIN THỬ] App Report — kiểm tra đường cảnh báo',
    '',
    'Nếu Sếp nhận được tin này thì cảnh báo tự động đã THÔNG.',
    'Từ nay khi DataHub thiếu dữ liệu chi phí, app sẽ tự nhắn ngay,',
    'nêu đích danh nhân viên — Sếp không cần mở app để phát hiện.',
    '',
    'Mẫu tin cảnh báo thật sẽ trông như sau:',
    '---',
    alert.buildMessage({ employees: ['DN0XX'], pairs: 186, ky: '07.2026' }),
  ].join('\n');

  if (!SEND) {
    console.log('\n--- Tin sẽ gửi (chạy lại với --send để gửi thật) ---');
    console.log(text);
    console.log(`\nSẽ gửi tới ${recipients.length} người: ${recipients.map((r) => r.empCode).join(', ')}`);
    return;
  }

  console.log('\nĐang gửi...');
  let sent = 0;
  for (const recipient of recipients) {
    const result = await notifyChannels.sendTelegram(recipient.chatId, text);
    line(`Gửi tới ${recipient.empCode}`, !!result?.ok, result?.ok ? `message_id ${result.provider_message_id}` : result?.description);
    if (result?.ok) sent += 1;
  }
  console.log(`\n${sent}/${recipients.length} tin đã gửi.`);
  process.exit(sent ? 0 : 1);
}

main().catch((error) => { console.error('Lỗi không mong đợi:', error.message); process.exit(1); });
