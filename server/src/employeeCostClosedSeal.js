'use strict';
/**
 * employeeCostClosedSeal.js — ĐÓNG DẤU CHI PHÍ CỦA KỲ ĐÃ KHOÁ SỔ
 *
 * CEO 10/08/2026, ngày thứ ba: *"tao cần mày fix cho dữ liệu T07.2026 không nhảy
 * loạn xạ nữa. Tao yêu cầu mày có giải pháp dứt điểm."*
 *
 * ── VÌ SAO SỐ NHẢY ───────────────────────────────────────────────────────────
 * Màn "Tất cả nhân viên" dựng sổ chi phí cho TỪNG NV rồi cộng lại. Ai không kịp
 * trong hạn thì bị đóng dấu "Chưa lấy kịp trong hạn" và **toàn bộ dòng của người đó
 * không lên bảng** ⇒ **tổng đổi theo số người kịp về**: 5 người → 499 dòng ·
 * 7.103.965.427đ; 9 người → 1.191 dòng; 0 người → 0 dòng.
 *
 * ── CÁCH CHỮA DỨT ĐIỂM ───────────────────────────────────────────────────────
 * Doanh thu đã có `revenueMaterializeGuard` ghim kỳ khoá sổ nên bất biến tuyệt đối.
 * Chi phí chưa có. Đây là nó:
 *
 *   Kỳ ĐÃ KHOÁ SỔ + bản ĐỦ CẢ ĐỘI + MỌI NV đều `ok` thật  ⇒ đóng dấu xuống đĩa.
 *   Từ đó về sau                                           ⇒ phục vụ NGUYÊN BẢN.
 *
 * ── SÁU ĐIỀU KHÔNG ĐƯỢC PHÉP SAI (bot audit 10/08 nêu 2–6, đúng cả năm) ──────
 * 1. **KHÔNG BAO GIỜ đóng dấu bản thiếu người.** Biến lỗi tạm thành số sai vĩnh viễn.
 * 2. **KHÔNG đóng dấu bản xài tỷ lệ CŨ** (`ok_stale_rates`). Đóng băng số tạm là
 *    đóng băng cái sai. Điều kiện nay là **mọi NV `sourceOutcome === 'ok'` đúng nghĩa**,
 *    không nhận `ok_stale_rates`, không nhận `before_go_live`.
 * 3. **Chữ ký phải gồm ĐỦ MỌI NGUỒN đã tham gia tính** — không chỉ doanh thu/catalog
 *    mà cả **kho tỷ lệ chi phí**, **số hiệu công thức thưởng/phạt** và **phiên bản app**.
 *    Thiếu một nguồn là dấu sống sót qua lần nguồn đó đổi ⇒ phục vụ số cũ.
 * 4. **Tra dấu TRƯỚC mọi việc nặng.** Có dấu rồi mà vẫn dựng catalog thì vô nghĩa
 *    (bot đo: sau restart mất 29,8 giây). Việc tra nằm ở `routes.js`, đặt trước fan-out.
 * 5. **Bản trả ra không ai sửa được**, và ghi đồng thời không được mất dấu.
 * 6. **File tài chính: quyền chặt + kiểm toàn vẹn.** Ghi `0600`, thư mục `0700`, kèm
 *    checksum; lệch checksum ⇒ coi như KHÔNG có dấu, dựng lại (fail closed).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const persist = require('./persist');

const FILE = 'employee_cost_closed_seal';
const MAX_SEALS = 8;
// Đổi khi cách đóng dấu đổi ⇒ dấu cũ tự hết hiệu lực, không cần đi dọn tay.
const SEAL_FORMAT = 'v2';

const text = (value) => String(value ?? '').trim();

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Chữ ký nội dung của một bản đã đóng dấu — dùng để phát hiện file bị sửa tay. */
function checksumOf(payload) {
  return sha256(JSON.stringify(payload));
}

/**
 * Khoá của dấu. Trả `null` ⇒ KHÔNG được đóng dấu.
 * `sources` phải liệt kê ĐỦ mọi nguồn đã tham gia tính. Thiếu bất kỳ mục nào ⇒ `null`,
 * vì một dấu không biết mình sinh ra từ nguồn nào là một dấu không dùng được.
 */
function keyFor({ from, to, months, closed, sources }) {
  if (!closed) return null;
  const need = ['data', 'rates', 'formula', 'app'];
  if (!sources || typeof sources !== 'object') return null;
  const parts = [];
  for (const name of need) {
    const value = text(sources[name]);
    if (!value) return null; // thiếu một nguồn là không đóng dấu, không đoán
    parts.push(`${name}=${value}`);
  }
  const range = Array.isArray(months) && months.length
    ? months.map(text).join(',')
    : `${text(from)}..${text(to)}`;
  if (!range || range === '..') return null;
  return `${SEAL_FORMAT}|${range}|${sha256(parts.join('&'))}`;
}

/**
 * Bản gộp có ĐỦ ĐIỀU KIỆN đóng dấu không?
 * Chặt hơn `employeeCostAllDegraded`: đòi MỌI NV có kết quả `ok` đúng nghĩa.
 */
function isSealable(merged, roster) {
  if (!merged || typeof merged !== 'object') return false;
  if (merged.rateStale === true) return false;
  const periods = Array.isArray(merged.periods) ? merged.periods : [merged];
  if (!periods.length) return false;

  const expected = new Set(
    (Array.isArray(roster) ? roster : [])
      .map((row) => text(row?.emp_code).toUpperCase()).filter(Boolean),
  );
  if (!expected.size) return false; // không biết đội gồm ai thì không dám đóng

  for (const period of periods) {
    const match = period?.match || {};
    if (Number(match.unavailableEmployeeCount || 0) > 0) return false;
    if (Array.isArray(match.unavailableEmployees) && match.unavailableEmployees.length) return false;
    // Xài tỷ lệ cũ là số TẠM — đóng băng số tạm là đóng băng cái sai.
    if (Number(match.staleRateEmployeeCount || 0) > 0) return false;
    if (Array.isArray(match.staleRateEmployees) && match.staleRateEmployees.length) return false;

    const seen = new Set();
    for (const report of Array.isArray(period?.employees) ? period.employees : []) {
      const code = text(report?.empCode).toUpperCase();
      if (!code) return false;
      // CHỈ `ok` đúng nghĩa. `ok_stale_rates`/`before_go_live`/`deadline` đều không đủ.
      if (text(report?.sourceOutcome || 'ok') !== 'ok') return false;
      seen.add(code);
    }
    if (seen.size) {
      for (const code of expected) if (!seen.has(code)) return false;
    }
  }
  return true;
}

function readAll(store = persist) {
  const read = typeof store.loadShared === 'function' ? store.loadShared : store.load;
  const rows = read.call(store, FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

/** Đọc dấu. Lệch checksum ⇒ coi như KHÔNG có dấu (fail closed), không phục vụ số nghi ngờ. */
function read(key, { store = persist } = {}) {
  if (!key) return null;
  const entry = readAll(store)[key];
  if (!entry || !entry.payload) return null;
  if (text(entry.checksum) !== checksumOf(entry.payload)) {
    console.warn('[cost-seal] checksum LỆCH — bỏ dấu, dựng lại', { key });
    return null;
  }
  return entry.payload;
}

function sealedAt(key, { store = persist } = {}) {
  if (!key) return '';
  return text(readAll(store)[key]?.sealedAt);
}

/* Ghi tuần tự: đọc-sửa-ghi mà chạy chồng nhau thì lượt sau ghi đè mất dấu lượt trước.
 * Một tiến trình, nên xếp hàng bằng chuỗi promise là đủ và không cần khoá file. */
let writeChain = Promise.resolve();

function writeNow(key, payload, { complete, store }) {
  if (!key || !payload || complete !== true) return false;
  const rows = { ...readAll(store) }; // đọc LẠI ngay trước khi ghi
  rows[key] = {
    sealedAt: new Date().toISOString(),
    checksum: checksumOf(payload),
    payload,
  };
  const keys = Object.keys(rows);
  if (keys.length > MAX_SEALS) {
    for (const stale of keys.slice(0, keys.length - MAX_SEALS)) delete rows[stale];
  }
  const save = typeof store.save === 'function' ? store.save : persist.save;
  save.call(store, FILE, rows);
  hardenPermissions(store);
  return true;
}

/** Đóng dấu (đã xếp hàng). Trả promise `true/false`. */
function write(key, payload, { complete, store = persist } = {}) {
  const task = writeChain.then(() => writeNow(key, payload, { complete, store }));
  writeChain = task.then(() => undefined, () => undefined);
  return task;
}

/**
 * Vân tay của KHO TỶ LỆ CHI PHÍ — nguồn mà chữ ký doanh thu/catalog không biết tới.
 * CEO bấm "Đồng bộ % chi phí" là file này đổi ⇒ dấu cũ phải hết hiệu lực ngay.
 * Chỉ `stat`, không đọc nội dung: rẻ, gọi được ở đầu mọi request.
 */
function rateStoreFingerprint(store = persist, fileName = 'cost_rates_local') {
  const dir = (store && store.DIR) || persist.DIR;
  try {
    const stat = fs.statSync(path.join(dir, `${fileName}.json`));
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch {
    return 'khong-co-kho-ty-le';
  }
}

/** Đây là file TÀI CHÍNH: chỉ chủ tiến trình được đọc/ghi. */
function hardenPermissions(store = persist) {
  const dir = (store && store.DIR) || persist.DIR;
  try { fs.chmodSync(path.join(dir, `${FILE}.json`), 0o600); } catch { /* không chmod được cũng không làm hỏng màn */ }
  try { fs.chmodSync(dir, 0o700); } catch { /* như trên */ }
}

function clear({ store = persist } = {}) {
  const save = typeof store.save === 'function' ? store.save : persist.save;
  save.call(store, FILE, {});
}

module.exports = {
  FILE, MAX_SEALS, SEAL_FORMAT,
  keyFor, isSealable, read, write, sealedAt, clear, checksumOf,
  hardenPermissions, rateStoreFingerprint,
};
