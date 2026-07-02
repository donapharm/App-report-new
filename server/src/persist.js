/**
 * persist.js — LƯU BỀN bằng file JSON (không thêm dependency ngoài).
 * Dùng cho: phiên đăng nhập, thiết bị tin cậy, mapping Telegram, audit auth.
 * Ghi ATOMIC (ghi file .tmp rồi rename) để restart giữa chừng không hỏng dữ liệu.
 * Quy mô nhỏ (≤ vài trăm bản ghi) nên đọc/ghi cả file là đủ, không cần DB.
 */
const fs = require('fs');
const path = require('path');

// Mặc định server/data/auth; cho phép override qua AUTH_DATA_DIR (dùng khi chạy
// instance tạm để nghiệm thu, tránh đụng dữ liệu auth của app đang chạy).
const DIR = process.env.AUTH_DATA_DIR || path.join(__dirname, '..', 'data', 'auth');
try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* ignore */ }

const file = (name) => path.join(DIR, name + '.json');

function load(name, def) {
  try {
    const p = file(name);
    if (!fs.existsSync(p)) return def;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return def;
  }
}

function save(name, data) {
  const p = file(name);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, p);
}

module.exports = { load, save, DIR };
