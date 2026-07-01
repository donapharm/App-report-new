/**
 * index.js — điểm khởi động backend App Report New.
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const routes = require('./routes');

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
});
