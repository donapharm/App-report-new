'use strict';
/**
 * employeeCostClosedSeal.js — ĐÓNG DẤU CHI PHÍ CỦA KỲ ĐÃ KHOÁ SỔ
 *
 * CEO 10/08/2026, ngày thứ ba: *"tao cần mày fix cho dữ liệu T07.2026 không nhảy
 * loạn xạ nữa. Tao yêu cầu mày có giải pháp dứt điểm."*
 *
 * ── VÌ SAO SỐ NHẢY ───────────────────────────────────────────────────────────
 * Màn "Tất cả nhân viên" dựng sổ chi phí cho TỪNG NV rồi cộng lại. Ai không kịp
 * trong hạn 25 giây thì bị `onSkip` đóng dấu "Chưa lấy kịp trong hạn" và **toàn bộ
 * dòng của người đó không lên bảng**. Nghĩa là **tổng hiển thị phụ thuộc vào số
 * người kịp về**:
 *
 *   14:52 → 5/21 người kịp → 499 dòng   · 7.103.965.427đ
 *   14:53 → 9/21 người kịp → 1.191 dòng · số khác hẳn
 *   16:57 → 0/21 người kịp → 0 dòng
 *
 * Vá tốc độ (`persist` nhớ bản đã đọc: 25 giây → 621 ms) làm chuyện này hiếm đi
 * NHƯNG KHÔNG DỨT ĐIỂM: chỉ cần một người trễ là tổng lại đổi. Bệnh gốc không phải
 * chậm — mà là **công bố một con tổng tính từ nhóm chưa đủ người**.
 *
 * ── CÁCH CHỮA DỨT ĐIỂM ───────────────────────────────────────────────────────
 * Doanh thu đã có `revenueMaterializeGuard` ghim kỳ khoá sổ nên đứng yên tuyệt đối
 * (T07 = 2.091 dòng / 30.982.248.913đ, kiểm bao nhiêu lần cũng lệch 0). Chi phí
 * chưa có cơ chế tương đương. Đây chính là nó:
 *
 *   Kỳ ĐÃ KHOÁ SỔ + dựng được bản ĐỦ CẢ ĐỘI  ⇒ đóng dấu, lưu xuống đĩa.
 *   Từ đó về sau                              ⇒ phục vụ NGUYÊN BẢN đã đóng dấu.
 *
 * Hệ quả: T07 chỉ cần **một lần** dựng đủ là **đứng yên vĩnh viễn** — không hỏi
 * DataHub, không phụ thuộc mạng, không phụ thuộc hạn chót, F5 bao nhiêu lần cũng
 * ra đúng một con số.
 *
 * ── BA ĐIỀU KHÔNG ĐƯỢC PHÉP SAI ──────────────────────────────────────────────
 * 1. **KHÔNG BAO GIỜ đóng dấu bản thiếu người.** Đóng dấu nhầm bản thiếu là biến
 *    một lỗi tạm thời thành số sai vĩnh viễn — tệ hơn hẳn bệnh đang chữa.
 * 2. **Nguồn đổi thì dấu hết hiệu lực.** Khoá gồm chữ ký dữ liệu doanh thu/catalog;
 *    nguồn thay bản là tự dựng lại, không phục vụ số cũ.
 * 3. **Chỉ kỳ ĐÃ KHOÁ SỔ.** Kỳ đang chạy thì doanh thu còn về, đóng băng là sai.
 */

const persist = require('./persist');

const FILE = 'employee_cost_closed_seal';
// Giữ vài kỳ gần nhất; kỳ quá cũ không ai mở nữa, không việc gì ôm mãi.
const MAX_SEALS = 8;

const text = (value) => String(value ?? '').trim();

/**
 * Khoá của dấu. Trả `null` ⇒ KHÔNG được đóng dấu (kỳ chưa khoá sổ, hoặc thiếu chữ
 * ký nguồn nên không biết dấu thuộc về bản dữ liệu nào).
 */
function keyFor({ from, to, months, closed, dataSignature }) {
  if (!closed) return null;
  const sig = text(dataSignature);
  if (!sig) return null;
  const range = Array.isArray(months) && months.length
    ? months.map(text).join(',')
    : `${text(from)}..${text(to)}`;
  if (!range || range === '..') return null;
  return `${range}|${sig}`;
}

function readAll(store = persist) {
  // Đọc thuần ⇒ dùng bản nhớ dùng chung, không phân tích lại file mỗi lượt.
  const read = typeof store.loadShared === 'function' ? store.loadShared : store.load;
  const rows = read.call(store, FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

function read(key, { store = persist } = {}) {
  if (!key) return null;
  const entry = readAll(store)[key];
  if (!entry || !entry.payload) return null;
  return entry.payload;
}

function sealedAt(key, { store = persist } = {}) {
  if (!key) return '';
  return text(readAll(store)[key]?.sealedAt);
}

/**
 * Đóng dấu. `complete` do người gọi quyết định và PHẢI đúng nghĩa "đủ cả đội":
 * không NV nào thiếu nguồn, không NV nào bị bỏ vì hết hạn.
 * Trả `true` nếu thực sự ghi dấu.
 */
function write(key, payload, { complete, store = persist, now = () => new Date().toISOString() } = {}) {
  if (!key || !payload || complete !== true) return false;
  const rows = { ...readAll(store) };
  rows[key] = { sealedAt: now(), payload };
  // Bỏ dấu cũ nhất khi vượt sức chứa (thứ tự chèn = thứ tự đóng dấu).
  const keys = Object.keys(rows);
  if (keys.length > MAX_SEALS) {
    for (const stale of keys.slice(0, keys.length - MAX_SEALS)) delete rows[stale];
  }
  persistSave(store, rows);
  return true;
}

function persistSave(store, rows) {
  const save = typeof store.save === 'function' ? store.save : persist.save;
  save.call(store, FILE, rows);
}

function clear({ store = persist } = {}) {
  persistSave(store, {});
}

module.exports = { FILE, MAX_SEALS, keyFor, read, write, sealedAt, clear };
