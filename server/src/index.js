/**
 * index.js — điểm khởi động backend App Report.
 */
// Múi giờ GMT+7 (Việt Nam) cho mọi mốc thời gian/log/lịch. Cho phép env override.
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
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

const PORT = process.env.PORT || 3873;
const HOST = process.env.HOST || '127.0.0.1';
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Chỉ còn một địa chỉ App Report chính thức. Alias chuyển tiếp không phục vụ
// ứng dụng trực tiếp để người dùng luôn nhìn thấy domain chuẩn.
const CANONICAL_ORIGIN = 'https://report.donapharm.asia';
app.use((req, res, next) => {
  const host = String(req.hostname || '').toLowerCase();
  if (host === 'reportnew.donapharm.asia') {
    return res.redirect(308, `${CANONICAL_ORIGIN}${req.originalUrl || '/'}`);
  }
  return next();
});

const allowedOrigins = new Set(
  String(process.env.CORS_ORIGINS || 'https://report.donapharm.asia,https://home.donapharm.asia')
    .split(',').map((x) => x.trim()).filter(Boolean),
);
app.use(cors({
  credentials: true,
  origin(origin, cb) {
    // Không có Origin = same-origin/server-to-server/curl. Origin lạ vẫn nhận
    // response nhưng không có CORS header nên trình duyệt không đọc được.
    cb(null, !origin || allowedOrigins.has(origin));
  },
}));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'app-report', ts: Date.now() }));
app.use('/api', routes);

// Phục vụ frontend đã build (web/dist) nếu có — cho phép chạy 1 cổng ở production.
// index.html + manifest: no-cache (PWA/trình duyệt LUÔN lấy shell mới -> hết kẹt bản cũ).
// Asset có hash tên (/assets/*): cache lâu, immutable (an toàn vì đổi bản là đổi tên file).
const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
app.use(express.static(webDist, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('.webmanifest') || filePath.endsWith('version.json')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (/[\\/]assets[\\/]/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get(/^(?!\/api).*/, (req, res, next) => {
  // Không trả SPA shell cho asset/file bị thiếu; tránh HTTP 200 sai MIME và cache.
  if (path.extname(req.path)) return res.status(404).type('text/plain').send('Not Found');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(webDist, 'index.html'), (err) => (err ? next() : null));
});

app.listen(PORT, HOST, () => {
  console.log(`✔ App Report API chạy tại http://${HOST}:${PORT}`);
  console.log(`  Health: http://${HOST}:${PORT}/api/health`);
  revenueRefresh.start();
});
