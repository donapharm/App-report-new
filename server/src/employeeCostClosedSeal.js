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
/**
 * Bản gộp có ĐỦ ĐIỀU KIỆN đóng dấu không?
 *
 * ‼ PHẢI truyền `reports` — BÁO CÁO GỐC của từng NV. Không được suy từ `merged`:
 * `mergeEmployeeReports(reports, roster)` dựng `merged.employees` **TỪ CHÍNH ROSTER**,
 * nên đối chiếu `merged.employees` với roster là **vòng tròn tự chứng minh** — luôn
 * đúng, kể cả khi thiếu hẳn báo cáo của một người. Bot audit bắt đúng, và bản test cũ
 * của tôi còn **sửa tay trường đó để che lỗi**. Bằng chứng "ai thật sự có số" chỉ nằm
 * ở `reports`.
 */
function isSealable(merged, roster, reports) {
  if (!merged || typeof merged !== 'object') return false;
  if (merged.rateStale === true) return false;

  const periods = Array.isArray(merged.periods) ? merged.periods : null;
  if (!periods || !periods.length) return false;

  const expected = new Set(
    (Array.isArray(roster) ? roster : [])
      .map((row) => text(row?.emp_code).toUpperCase()).filter(Boolean),
  );
  if (!expected.size) return false; // không biết đội gồm ai thì không dám đóng

  // Không có báo cáo gốc ⇒ không có cách nào chứng minh đủ người ⇒ fail closed.
  if (!Array.isArray(reports) || !reports.length) return false;

  /* Tên trường lấy đúng bản THẬT của `mergeEmployeeReports`
   * (`period.employees` KHÔNG tồn tại; stale là `staleEmployees`). */
  for (const period of periods) {
    const match = period?.match;
    if (!match || typeof match !== 'object') return false;
    if (Number(match.unavailableEmployeeCount || 0) > 0) return false;
    if (Array.isArray(match.unavailableEmployees) && match.unavailableEmployees.length) return false;
    // Xài tỷ lệ CŨ là số TẠM — đóng băng số tạm là đóng băng cái sai.
    if (Number(match.staleEmployeeCount || 0) > 0) return false;
    if (Array.isArray(match.staleEmployees) && match.staleEmployees.length) return false;
    if (!Number.isFinite(Number(match.totalRows))) return false;
  }

  // BẰNG CHỨNG THẬT: mỗi người trong đội phải có ĐÚNG MỘT báo cáo, kết quả `ok` đúng nghĩa.
  const daCo = new Set();
  for (const report of reports) {
    const code = text(report?.empCode).toUpperCase();
    if (!code) return false;
    if (daCo.has(code)) return false; // trùng NV ⇒ không rõ lấy bản nào
    /* ‼ THIẾU `sourceOutcome` KHÔNG ĐƯỢC COI LÀ `ok` (bot audit đúng). Mặc định
     * "coi như ok" là fail-OPEN: một báo cáo dựng thiếu trường sẽ lọt qua và được
     * đóng dấu vĩnh viễn. Phải có mặt, và phải đúng chữ `ok`. */
    if (!Object.prototype.hasOwnProperty.call(report, 'sourceOutcome')) return false;
    if (text(report.sourceOutcome) !== 'ok') return false;
    daCo.add(code);
  }
  if (daCo.size !== expected.size) return false;
  for (const code of expected) if (!daCo.has(code)) return false;

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
function fileFingerprint(dir, fileName) {
  try {
    const stat = fs.statSync(path.join(dir, `${fileName}.json`));
    return `${fileName}=${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch {
    return `${fileName}=khong-co`;
  }
}

/* MỌI KHO đã tham gia dựng con số, gộp thành một vân tay.
 * Bot audit đúng: thiếu `salary_advance_snapshot` và `payment_ledger` thì hai kho đó
 * đổi mà khoá dấu KHÔNG đổi ⇒ app phục vụ lại số thanh toán CŨ. Đã tái hiện được. */
const RATE_STORE_FILES = Object.freeze([
  'cost_rates_local', // tỷ lệ % chủ động — CEO bấm "Đồng bộ % chi phí"
  'payment_ledger',   // sổ thanh toán
]);

/* ‼ VÌ SAO CHỈ CÓ HAI FILE — VÀ ĐÂY LÀ MỘT BÀI HỌC ĐẮT
 * Vân tay này phải gồm **ĐẦU VÀO ĐỘC LẬP**, không được gồm **SẢN PHẨM PHỤ do chính
 * lượt dựng ghi ra**. `salary_advance_snapshot` và `employee_cost_rate_snapshot` đều
 * do đường dựng tự ghi (`salaryAdvance` gọi `snapshot.write`). Đưa chúng vào thì mỗi
 * lượt dựng **tự làm hỏng khoá của chính mình** ⇒ bộ nhớ đệm không bao giờ trúng, dấu
 * không bao giờ đọc lại ⇒ quay về đúng cảnh dựng lại từ đầu mỗi lần mở màn, tức là
 * bệnh vừa mất ba ngày để chữa. Ca `warm-cache` đỏ ngay khi tôi thêm chúng vào — may
 * mà có test đó.
 *
 * VIỆC CÒN NỢ (nói thẳng, không giấu): "nguồn lương/snapshot đổi thật thì phải làm
 * mới" cần giải bằng cho đường ghi **xoá memo tường minh**, không phải bằng vân tay file.
 *
 * VÌ SAO KHÔNG CÓ `salary_advance_snapshot` Ở ĐÂY
 * Nó là **sản phẩm PHỤ do chính lượt dựng này ghi ra**, không phải đầu vào độc lập.
 * Đưa nó vào vân tay thì mỗi lượt dựng lại tự làm hỏng khoá của chính mình ⇒ bộ nhớ
 * đệm KHÔNG BAO GIỜ trúng, dấu không bao giờ đọc lại được, và màn hình quay về cảnh
 * dựng lại từ đầu mỗi lần mở (đúng thứ vừa mất ba ngày để chữa). Đã đo: ca warm-cache
 * hỏng ngay khi thêm nó vào.
 * Việc "số lương ứng đổi ở NGUỒN thì phải làm mới" cần được giải bằng cách cho đường
 * ghi salary **xoá memo tường minh**, không phải bằng vân tay file. Ghi lại đây làm
 * việc còn nợ, không giấu. */
const SALARY_SNAPSHOT_FILE = 'salary_advance_snapshot';

function rateStoreFingerprint(store = persist, files = RATE_STORE_FILES) {
  const dir = (store && store.DIR) || persist.DIR;
  const list = Array.isArray(files) ? files : [files];
  return list.map((name) => fileFingerprint(dir, name)).join('|');
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
  hardenPermissions, rateStoreFingerprint, RATE_STORE_FILES, SALARY_SNAPSHOT_FILE,
};
