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
// Kho do CEO chủ động đồng bộ theo kỳ. Không require `costRatesSync` tại đây vì
// module đó cần `employeeCost`, sẽ tạo vòng phụ thuộc ngay trên đường đọc chính.
const LOCAL_SYNC_FILE = 'cost_rates_local';
const MAX_RECORDS = 800;
// Quá cũ thì thà không có còn hơn: tỷ lệ đổi mà vẫn dùng bản cách hàng tháng là sai.
const MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;

const keyOf = (empCode, period) => `${String(empCode || '').trim().toUpperCase()}|${String(period || '').trim()}`;

/* `shared: true` chỉ dành cho đường ĐỌC THUẦN — dùng bản nhớ của persist, không
 * phân tích lại file. Đường ĐỌC-RỒI-GHI (`write`) phải để `shared: false` để lấy
 * bản tươi của riêng nó mà sửa, không đụng vào bản dùng chung. */
function readAll(store, { shared = false } = {}) {
  const read = shared && typeof store.loadShared === 'function' ? store.loadShared : store.load;
  const rows = read.call(store, FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

/* ĐƯỜNG NÓNG NHẤT CỦA APP: gọi một lần cho MỖI nhân viên (21 lượt mỗi lần mở màn
 * "Tất cả nhân viên"), trên file 17,9 MB. Đây là chỗ `load()` cũ đốt hết hạn 25 giây.
 * Nay đọc qua bản nhớ dùng chung.
 *
 * ‼ `loadShared` trả ĐỐI TƯỢNG DÙNG CHUNG. Nên `columns`/`rows` phải `slice()` trước
 * khi giao ra ngoài: tầng trên có sắp xếp/cắt trang, mà sắp xếp tại chỗ trên mảng
 * dùng chung là **hỏng kho trong bộ nhớ của cả tiến trình**. `slice()` chỉ chép danh
 * sách tham chiếu — vài chục micro giây, so với 17,9 MB phân tích lại thì không đáng kể. */
function readLocalSync(empCode, period, { store = persist } = {}) {
  const read = typeof store.loadShared === 'function' ? store.loadShared : store.load;
  const rows = read.call(store, LOCAL_SYNC_FILE, {});
  const entry = rows && typeof rows === 'object' && !Array.isArray(rows) ? rows[String(period || '').trim()] : null;
  const kept = entry?.employees?.[String(empCode || '').trim().toUpperCase()];
  const payload = kept && Array.isArray(kept.rows) && Array.isArray(kept.columns)
    ? { columns: kept.columns.slice(), rows: kept.rows.slice(), period: String(period || '').trim() }
    : null;
  if (!isStorable(payload)) return null;
  return { payload, fetchedAt: String(entry.fetchedAt || ''), source: 'local_sync' };
}

// Chỉ đáng lưu khi thực sự CÓ bảng tỷ lệ. Payload rỗng thì đừng đóng băng cái rỗng.
function isStorable(periodPayload) {
  return !!periodPayload && Array.isArray(periodPayload.rows) && periodPayload.rows.length > 0
    && Array.isArray(periodPayload.columns) && periodPayload.columns.length > 0;
}

function read(empCode, period, { store = persist, now = Date.now } = {}) {
  // Kho chủ động đã được ghi ALL-OR-NOTHING cho cả đội và là bản sao bền vững
  // theo kỳ. Nó phải thắng snapshot bị động và không hết hạn sau 45 ngày: chỉ
  // lần đồng bộ chủ động tiếp theo mới thay bản này.
  const local = readLocalSync(empCode, period, { store });
  if (local) return local;
  // Đọc thuần ⇒ dùng bản nhớ (file này cũng 12,7 MB, cũng bị gọi mỗi nhân viên).
  const row = readAll(store, { shared: true })[keyOf(empCode, period)];
  if (!row || !isStorable(row.payload)) return null;
  const at = Date.parse(row.fetchedAt || '');
  if (!Number.isFinite(at) || now() - at > MAX_AGE_MS) return null;
  // Cắt bản sao danh sách trước khi giao ra: bản gốc là của chung, không ai được sửa.
  return {
    payload: { ...row.payload, columns: row.payload.columns.slice(), rows: row.payload.rows.slice() },
    fetchedAt: String(row.fetchedAt),
  };
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

module.exports = {
  FILE, LOCAL_SYNC_FILE, MAX_RECORDS, MAX_AGE_MS,
  keyOf, isStorable, readLocalSync, read, write, remember, restore, covers,
};
