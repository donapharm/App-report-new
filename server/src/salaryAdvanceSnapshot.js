'use strict';
/**
 * KHO SỐ "ỨNG LẦN 1" — chốt số một lần, thôi gọi lại App Salary
 *
 * CEO 04/08/2026: *"Cứ lấy số ứng lần 1 tại ô KPI thì rất bất tiện — mỗi khi NV
 * truy cập menu Thanh toán CP của tôi là API lại kéo số về, rất tốn tài nguyên.
 * Khi có số rồi thì lấy số về luôn, chỉ khi thay đổi số ứng lần 1 mới đổi số."*
 *
 * Trước đây chỉ có cache trong RAM 25 giây ⇒ NV mở màn 10 lần trong ngày là 10 lượt
 * gọi App Salary, và restart app là mất sạch. Kho này lưu xuống đĩa và phân 3 mức:
 *
 *   1. Kỳ ĐÃ CHỐT (`locked`)  → số KHÔNG BAO GIỜ đổi ⇒ đọc kho, KHÔNG gọi lại. Đây
 *                               là phần lớn lượt xem (NV xem lại tháng cũ).
 *   2. Kỳ đang mở (`draft`)   → số còn có thể đổi ⇒ dùng số trong kho NGAY, chỉ gọi
 *                               lại khi đã quá `ttlMs` (mặc định 6 giờ).
 *   3. Chưa có số / lỗi nguồn → không lưu, lần sau gọi lại bình thường.
 *
 * ‼ Luôn kèm `fetchedAt` để màn hình ghi rõ "số tại lúc …". Số cũ mà không nói rõ
 * là số lúc nào thì người xem tưởng số đang sống — đúng loại hiểu nhầm phải tránh.
 * ‼ Chỉ lưu đúng 10 khoá hợp đồng; không lưu bất kỳ dữ liệu lương nào khác.
 */

const persist = require('./persist');

const FILE = 'salary_advance_snapshot';
const CONTRACT_KEYS = ['amount', 'applicable', 'available', 'currency', 'emp_code', 'locked', 'ok', 'period', 'reason', 'status'];
// ‼ CEO đính chính 04/08: *"khi sửa số ứng lần 1 cho một NV thì sẽ sửa vào App
// Salary và như vậy sẽ được cập nhật vào ô KPI thôi, không có gì khác."*
// ⇒ KHÔNG kỳ nào được coi là "không bao giờ hỏi lại". Bản đầu của Claude đóng băng
// vĩnh viễn kỳ đã chốt ⇒ Sếp sửa số bên App Salary mà App Report không bao giờ thấy.
// Thay bằng: LUÔN trả số trong kho NGAY (màn không phải chờ), rồi làm tươi NGẦM
// phía sau khi đã quá ngưỡng dưới đây. NV không thấy chậm, mà số vẫn tự cập nhật.
const REVALIDATE_OPEN_MS = 10 * 60 * 1000;    // kỳ đang mở: 10 phút
const REVALIDATE_FINAL_MS = 60 * 60 * 1000;   // kỳ đã chốt: 1 giờ (số hiếm khi đổi)
// Chặn phình file: 21 NV × ~24 kỳ là quá đủ để tra lại lịch sử.
const MAX_RECORDS = 600;

const keyOf = (empCode, period) => `${String(empCode || '').trim().toUpperCase()}|${String(period || '').trim()}`;

// Số đã chốt trên App Salary thì không đổi nữa ⇒ khỏi hỏi lại lần nào.
function isFinal(projection) {
  return !!projection && projection.available === true && projection.locked === true
    && (projection.status === 'locked' || projection.status === 'approved');
}

// Chỉ đáng lưu khi thực sự CÓ số. Lỗi nguồn/chưa duyệt thì không đóng băng cái rỗng.
function isStorable(projection) {
  return !!projection && projection.available === true && projection.applicable === true
    && Number.isSafeInteger(projection.amount);
}

function readAll(store = persist) {
  const rows = store.load(FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

function read(empCode, period, { store = persist } = {}) {
  const record = readAll(store)[keyOf(empCode, period)];
  if (!record || typeof record !== 'object' || !record.projection) return null;
  // Kho có thể bị sửa tay/hỏng file — chỉ nhận bản ghi đúng đúng phạm vi đang hỏi.
  const projection = record.projection;
  if (String(projection.emp_code || '').toUpperCase() !== String(empCode || '').toUpperCase()) return null;
  if (String(projection.period || '') !== String(period || '')) return null;
  return { projection, fetchedAt: String(record.fetchedAt || ''), final: isFinal(projection) };
}

function write(empCode, period, projection, { store = persist, now = Date.now } = {}) {
  if (!isStorable(projection)) return null;
  const rows = readAll(store);
  const record = {
    // Chỉ 10 khoá hợp đồng đi vào kho — khoá lạ dừng ở đây.
    projection: Object.fromEntries(CONTRACT_KEYS.map((key) => [key, projection[key]])),
    fetchedAt: new Date(now()).toISOString(),
  };
  rows[keyOf(empCode, period)] = record;
  const keys = Object.keys(rows);
  if (keys.length > MAX_RECORDS) {
    // Bỏ bản ghi cũ nhất theo thời điểm lấy số.
    keys.sort((a, b) => String(rows[a].fetchedAt).localeCompare(String(rows[b].fetchedAt)));
    for (const stale of keys.slice(0, keys.length - MAX_RECORDS)) delete rows[stale];
  }
  store.save(FILE, rows);
  return record;
}

/**
 * Có cần gọi App Salary nữa không?
 *  - chưa có trong kho          → CÓ
 *  - đã chốt                    → KHÔNG (vĩnh viễn)
 *  - đang mở, còn trong hạn TTL → KHÔNG
 *  - đang mở, quá hạn TTL       → CÓ
 * `force` dành cho nút "Làm mới" của người dùng và cho webhook khi App Salary duyệt.
 */
// Có PHẢI CHỜ gọi nguồn không? Chỉ khi kho chưa có gì, hoặc người dùng ép làm mới.
// Có số trong kho thì luôn trả ngay, không bắt màn hình đợi.
function mustFetch(record, { force = false } = {}) {
  return force === true || !record;
}

// Có nên làm tươi NGẦM phía sau không? Áp cho mọi kỳ, kể cả kỳ đã chốt — để chỉnh
// sửa bên App Salary luôn về được App Report mà không ai phải làm gì.
function shouldRevalidate(record, { now = Date.now, openMs = REVALIDATE_OPEN_MS, finalMs = REVALIDATE_FINAL_MS } = {}) {
  if (!record) return true;
  const at = Date.parse(record.fetchedAt || '');
  if (!Number.isFinite(at)) return true;
  return now() - at >= Number(record.final ? finalMs : openMs);
}

function invalidate(empCode, period, { store = persist } = {}) {
  const rows = readAll(store);
  const key = keyOf(empCode, period);
  if (!(key in rows)) return false;
  delete rows[key];
  store.save(FILE, rows);
  return true;
}

module.exports = {
  FILE, CONTRACT_KEYS, MAX_RECORDS, REVALIDATE_OPEN_MS, REVALIDATE_FINAL_MS,
  isFinal, isStorable, read, write, mustFetch, shouldRevalidate, invalidate, keyOf,
};
