/**
 * index.js — điểm khởi động backend App Report New.
 */
const fs = require('fs');
const path = require('path');

// Nạp .env cạnh repo (không thêm dependency dotenv). KHÔNG ghi đè biến đã có sẵn
// trong môi trường (PM2/shell) — chỉ điền biến còn thiếu. Cần để TELEGRAM_BOT_SECRET
// và các config đăng nhập luôn có mặt sau khi restart PM2 (cùng cách telegram-bot.js đọc .env).
(function loadEnv() {
  try {
    const p = path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ignore */ }
})();

const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const revenueRefresh = require('./revenueRefresh');

const PORT = process.env.PORT || 3860;
const app = express();

app.use(cors()); // demo mở CORS; production siết theo domain nội bộ
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'app-report-new', ts: Date.now() }));
app.use('/api', routes);

// Phục vụ frontend đã build (web/dist) nếu có — cho phép chạy 1 cổng ở production.
const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
app.use(express.static(webDist));
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(webDist, 'index.html'), (err) => (err ? next() : null));
});

app.listen(PORT, () => {
  console.log(`✔ App Report New API chạy tại http://localhost:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/api/health`);
  revenueRefresh.start();
});
