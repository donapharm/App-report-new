'use strict';
/**
 * SỐ CHI PHÍ CUỐI CÙNG CÒN TỐT — chống mất số khi nguồn DataHub kẹt
 *
 * Vụ thật 01/08: DataHub bị PM2 restart đúng lúc đang giữ `vault-audit.lock` ⇒ khoá
 * mồ côi ⇒ mọi request kẹt ~10 giây > timeout ⇒ App Report fail-closed ⇒ **21 NV
 * hiện 0đ**. Chẩn đoán 03/08 cho thấy vẫn còn: DN004/DN007/DN008/DN009/DN011/
 * DN017/DN019/DN024 **luân phiên** mất nguồn.
 *
 * Khoá tự lành phải sửa Ở DATAHUB (ghi PID chủ + TTL) — App Report không với tới.
 * Nhưng App Report **không được phép mất số** chỉ vì nguồn kẹt vài giây:
 *
 *   Nguồn tốt   → lưu lại bảng tỷ lệ vừa lấy được (nhỏ, chỉ % theo mã hàng × đơn vị)
 *   Nguồn kẹt   → dùng lại bảng lưu đó, GẮN NHÃN "số tại lúc …" + cờ `stale`
 *   Chưa có gì  → mới fail-closed như cũ
 *
 * ‼ Đây KHÔNG phải che lỗi: cờ `stale` + mốc thời gian luôn hiện ra màn hình, và
 * cảnh báo nguồn vẫn chạy. Chỉ khác: NV không còn thấy 0đ oan trong lúc nguồn kẹt.
 */

const persist = require('./persist');

const FILE = 'employee_cost_rate_snapshot';
const MAX_RECORDS = 800;
// Quá cũ thì thà không có còn hơn: tỷ lệ đổi mà vẫn dùng bản cách hàng tháng là sai.
const MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;

const keyOf = (empCode, period) => `${String(empCode || '').trim().toUpperCase()}|${String(period || '').trim()}`;

function readAll(store) { const rows = store.load(FILE, {}); return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {}; }

// Chỉ đáng lưu khi thực sự CÓ bảng tỷ lệ. Payload rỗng thì đừng đóng băng cái rỗng.
function isStorable(periodPayload) {
  return !!periodPayload && Array.isArray(periodPayload.rows) && periodPayload.rows.length > 0
    && Array.isArray(periodPayload.columns) && periodPayload.columns.length > 0;
}

function read(empCode, period, { store = persist, now = Date.now } = {}) {
  const row = readAll(store)[keyOf(empCode, period)];
  if (!row || !isStorable(row.payload)) return null;
  const at = Date.parse(row.fetchedAt || '');
  if (!Number.isFinite(at) || now() - at > MAX_AGE_MS) return null;
  return { payload: row.payload, fetchedAt: String(row.fetchedAt) };
}

function write(empCode, period, periodPayload, { store = persist, now = Date.now } = {}) {
  if (!isStorable(periodPayload)) return null;
  const rows = readAll(store);
  rows[keyOf(empCode, period)] = {
    // Chỉ giữ đúng phần cần để tính lại: cột + dòng tỷ lệ. Không giữ gì khác.
    payload: { columns: periodPayload.columns, rows: periodPayload.rows, period: String(periodPayload.period || period) },
    fetchedAt: new Date(now()).toISOString(),
  };
  const keys = Object.keys(rows);
  if (keys.length > MAX_RECORDS) {
    keys.sort((a, b) => String(rows[a].fetchedAt).localeCompare(String(rows[b].fetchedAt)));
    for (const stale of keys.slice(0, keys.length - MAX_RECORDS)) delete rows[stale];
  }
  store.save(FILE, rows);
  return rows[keyOf(empCode, period)];
}

/** Lưu lại mọi kỳ có tỷ lệ trong một payload range. */
function remember(empCode, payload, options = {}) {
  const periods = Array.isArray(payload?.periods) ? payload.periods : [];
  let saved = 0;
  for (const period of periods) {
    if (write(empCode, period.period, period, options)) saved += 1;
  }
  return saved;
}

/**
 * Nguồn kẹt: lấp các kỳ rỗng bằng bản lưu gần nhất. Trả về số kỳ đã lấp.
 * Mỗi kỳ được lấp đều gắn `rateStale` + `rateFetchedAt` để màn hình nói ra.
 */
function restore(empCode, payload, options = {}) {
  const periods = Array.isArray(payload?.periods) ? payload.periods : [];
  let restored = 0;
  for (const period of periods) {
    if (period.rows?.length) continue;
    const kept = read(empCode, period.period, options);
    if (!kept) continue;
    period.columns = kept.payload.columns;
    period.rows = kept.payload.rows;
    period.rateStale = true;
    period.rateFetchedAt = kept.fetchedAt;
    restored += 1;
  }
  if (restored) {
    payload.rateStale = true;
    payload.rateStaleNote = 'Nguồn chi phí đang kẹt — đang dùng bảng tỷ lệ lấy được gần nhất';
  }
  return restored;
}

// Có đủ bản lưu cho MỌI kỳ đang hỏi không? Nếu có thì không việc gì phải chờ
// nguồn kẹt hết ngân sách timeout — cứ trả số cũ ngay rồi làm tươi phía sau.
function covers(empCode, months = [], options = {}) {
  const list = Array.isArray(months) ? months : [];
  return list.length > 0 && list.every((month) => !!read(empCode, month, options));
}

module.exports = { FILE, MAX_RECORDS, MAX_AGE_MS, keyOf, isStorable, read, write, remember, restore, covers };
