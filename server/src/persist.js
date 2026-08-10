/**
 * persist.js — LƯU BỀN bằng file JSON (không thêm dependency ngoài).
 * Dùng cho: phiên đăng nhập, thiết bị tin cậy, mapping Telegram, audit auth.
 * Ghi ATOMIC (ghi file .tmp rồi rename) để restart giữa chừng không hỏng dữ liệu.
 *
 * ‼ NHỚ BẢN ĐÃ ĐỌC — ĐỪNG PHÂN TÍCH LẠI 17,9 MB CHO TỪNG NHÂN VIÊN
 * (CEO bế tắc 3 ngày, truy ra 10/08/2026)
 *
 * Giả định ban đầu của file này là *"quy mô nhỏ (≤ vài trăm bản ghi) nên đọc/ghi cả
 * file là đủ"*. Giả định đó đã vỡ từ lâu mà không ai nhận ra:
 *
 *   cost_rates_local.json          17,9 MB
 *   employee_cost_rate_snapshot.json 12,7 MB
 *
 * Mà `readLocalSync(empCode, kỳ)` gọi `load()` **một lần cho MỖI nhân viên**. Màn
 * "Tất cả nhân viên" có 21 người ⇒ mỗi lần mở màn là đọc đĩa + `JSON.parse` **hàng
 * trăm MB**. Tệ hơn: `readFileSync`/`JSON.parse` là **đồng bộ**, khoá cứng vòng lặp
 * sự kiện — nên "chạy 6 người song song" chỉ là trên giấy, thực tế xếp hàng từng
 * người, và hạn chót 25 giây hết veo sau ~5 người.
 *
 * Triệu chứng CEO thấy: mở màn T07 ra 499 dòng, **đúng 5 người đầu bảng** (DN001–DN004,
 * DN007) có số, 16 người còn lại bị đóng dấu *"Chưa lấy kịp trong hạn"* — và vì hoàn
 * toàn tất định nên **hai lần mở cách nhau 2 tiếng ra y hệt từng đồng**. Không phải
 * DataHub hỏng, không phải kho thiếu: kho đủ 21 người, 27.719 dòng, đủ cột.
 *
 * Nay: nhớ bản đã phân tích trong bộ nhớ, chỉ đọc lại khi **file thật sự đổi**
 * (so `mtime` + `size`). 21 lượt thành 1 lượt.
 *
 * AN TOÀN:
 * - Ai đó (kể cả tiến trình khác) ghi đè file ⇒ `mtime`/`size` đổi ⇒ tự đọc lại.
 * - `save()` cập nhật luôn bản nhớ, nên lối dùng quen thuộc `x = load(); sửa x; save(x)`
 *   vẫn đúng.
 * - ‼ Sửa bản đọc được mà KHÔNG `save()` thì bản nhớ lệch với đĩa. Lối đó vốn đã là
 *   lỗi (mất thay đổi), nay thêm hậu quả — nên nhớ: **sửa xong phải `save()`**.
 * - Có trần bộ nhớ, vượt thì bỏ bản lâu không dùng nhất (LRU).
 */
const fs = require('fs');
const path = require('path');

// Mặc định server/data/auth; cho phép override qua AUTH_DATA_DIR (dùng khi chạy
// instance tạm để nghiệm thu, tránh đụng dữ liệu auth của app đang chạy).
const DIR = process.env.AUTH_DATA_DIR || path.join(__dirname, '..', 'data', 'auth');
try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* ignore */ }

const file = (name) => path.join(DIR, name + '.json');

// Trần bộ nhớ cho bản nhớ. Mặc định 96 MB — đủ ôm cả hai file nặng nhất cùng lúc,
// vẫn nhỏ hơn nhiều so với lượng rác mà cách cũ sinh ra mỗi lần mở màn.
const MAX_CACHE_BYTES = Math.max(
  0, Number(process.env.APP_REPORT_PERSIST_CACHE_BYTES ?? 96 * 1024 * 1024) || 0,
);

const cache = new Map(); // name -> { mtimeMs, size, value, bytes }
let cacheBytes = 0;

function forget(name) {
  const hit = cache.get(name);
  if (!hit) return;
  cacheBytes -= hit.bytes;
  cache.delete(name);
}

function remember(name, entry) {
  forget(name);
  if (MAX_CACHE_BYTES <= 0 || entry.bytes > MAX_CACHE_BYTES) return; // to hơn cả trần thì thôi
  cache.set(name, entry);
  cacheBytes += entry.bytes;
  // Map giữ đúng thứ tự chèn ⇒ khoá đầu tiên là bản lâu không dùng nhất.
  while (cacheBytes > MAX_CACHE_BYTES && cache.size > 1) {
    forget(cache.keys().next().value);
  }
}

function load(name, def) {
  try {
    const p = file(name);
    let stat;
    try { stat = fs.statSync(p); } catch { forget(name); return def; }

    const hit = cache.get(name);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      // Chạm vào để đẩy xuống cuối hàng LRU.
      cache.delete(name);
      cache.set(name, hit);
      return hit.value;
    }

    const raw = fs.readFileSync(p, 'utf8');
    const value = JSON.parse(raw);
    remember(name, { mtimeMs: stat.mtimeMs, size: stat.size, value, bytes: raw.length });
    return value;
  } catch {
    // File hỏng/không đọc được: đừng giữ bản nhớ cũ có thể sai lệch.
    forget(name);
    return def;
  }
}

function save(name, data) {
  const p = file(name);
  const tmp = p + '.tmp';
  const raw = JSON.stringify(data);
  fs.writeFileSync(tmp, raw);
  fs.renameSync(tmp, p);
  try {
    const stat = fs.statSync(p);
    remember(name, { mtimeMs: stat.mtimeMs, size: stat.size, value: data, bytes: raw.length });
  } catch {
    forget(name); // không stat được thì thà đọc lại lần sau còn hơn nhớ sai
  }
}

// Cho test và cho chỗ nào cần ép đọc lại từ đĩa.
function invalidate(name) {
  if (name === undefined) { cache.clear(); cacheBytes = 0; return; }
  forget(name);
}

function cacheStats() {
  return { entries: cache.size, bytes: cacheBytes, maxBytes: MAX_CACHE_BYTES };
}

module.exports = { load, save, DIR, invalidate, cacheStats };
