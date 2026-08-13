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

  /* ‼ PHÉP CÂN KHÔNG CÂN THÌ KHÔNG ĐÓNG DẤU (bot audit đợt 17, mục A2).
   *
   * Bot dựng: nguồn 250, hiển thị 200, lệch 50, `balanced=false` — app vẫn đóng dấu,
   * tức đóng băng vĩnh viễn một kỳ đang thiếu 50 đồng không giải thích được.
   *
   * Đây đúng là cái lỗ tôi đã BÁO TRƯỚC với CEO chiều nay rồi không bịt: doanh thu của
   * mã NV **không nằm trong danh sách** thì không ai kêu. `buildRevenueRecon` đã tính
   * sẵn phép cân này và đã trả `balanced` — chỉ là chưa ai hỏi nó trước khi đóng dấu.
   * Đúng tinh thần `SPEC_REVENUE_SYNC_EXCEPTIONS`: Σ(đưa vào)+Σ(loại) == Σ(nguồn),
   * lệch thì DỪNG.
   *
   * Fail-closed cả ba đường: chưa soát được (`unavailable`), không đo được
   * (`balanced === null`, vì chưa có số hiển thị để so), và lệch thật (`false`). */
  const recon = merged.revenueRecon;
  if (!recon || typeof recon !== 'object') return false;
  if (recon.unavailable === true) return false;
  if (recon.balanced !== true) return false;

  /* ‼ LAI LỊCH DỮ LIỆU QUA MẠNG PHẢI CÓ MẶT. Thiếu hẳn trường ⇒ không ai ghi lại đã
   * dùng gói từ xa nào ⇒ không có cách nào soi lại khi mở dấu. Mảng RỖNG thì hợp lệ:
   * nó nói rõ "không dùng gói từ xa nào", khác hẳn `undefined` là "không ai ghi". */
  if (!Array.isArray(merged.remoteProvenance)) return false;
  /* ‼ Scope nào hỏi hụt gói thì lai lịch ghi `THIEU` — đóng dấu lúc đó là đóng băng một
   * kỳ mà chính ta không biết đã dùng dữ liệu gì (bot audit vòng 4, mục A1). */
  if (merged.remoteProvenance.some((dong) => String(dong).endsWith(':THIEU'))) return false;

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
/* ── VÂN TAY THEO NỘI DUNG, KHÔNG THEO GIỜ SỬA ───────────────────────────────
 * Bot audit đợt 8 bẻ đúng lập luận của tôi. Tôi từng loại `salary_advance_snapshot`
 * và `employee_cost_rate_snapshot` ra khỏi vân tay với lý do "chúng là sản phẩm phụ
 * do chính lượt dựng ghi ra". Sai: **ở lượt đọc SAU, chúng là ĐẦU VÀO TÀI CHÍNH**.
 * Bot tái hiện 111→222: khoá không đổi ⇒ RAM memo vẫn 111, dấu vẫn phục vụ lương 111,
 * rate snapshot cũng 111. Đó là (A) SAI SỐ, không phải (B) gia cố.
 *
 * Nhưng đưa lại vào bằng `mtime` thì sập bẫy cũ: ghi lại **cùng nội dung** vẫn làm
 * `mtime`/`ctime` nhảy ⇒ mỗi lượt dựng tự huỷ khoá của mình ⇒ cache không bao giờ
 * trúng (ca `warm-cache` đỏ).
 *
 * Lối thoát: **băm NỘI DUNG**. Ghi lại y nguyên ⇒ băm không đổi ⇒ khoá đứng yên.
 * Nội dung đổi thật ⇒ băm đổi ⇒ khoá đổi ⇒ dựng lại. Đúng cả hai chiều.
 *
 * Giá: chỉ băm khi `stat` cho thấy file đã đụng vào; không đụng thì dùng lại băm cũ.
 * Nên đường nóng KHÔNG phải đọc lại 17,9 MB mỗi lượt xem. */
const hashCache = new Map(); // name -> { print, hash }

/* MỌI KHO ĐẦU VÀO TÀI CHÍNH đã tham gia dựng con số.
 * `salary_advance_snapshot` và `employee_cost_rate_snapshot` TUY do chính lượt dựng
 * ghi ra, NHƯNG ở lượt đọc SAU chúng là đầu vào thật — bot audit đợt 8 tái hiện
 * 111→222 chứng minh: bỏ chúng ra là RAM memo, dấu đã ghi và snapshot đều phục vụ
 * số CŨ. Nên phải có mặt đủ; chống tự-huỷ-khoá bằng cách băm NỘI DUNG (xem dưới). */
const RATE_STORE_FILES = Object.freeze([
  'cost_rates_local',            // tỷ lệ % chủ động — CEO bấm "Đồng bộ % chi phí"
  'employee_cost_rate_snapshot', // snapshot tỷ lệ bị động
  'salary_advance_snapshot',     // số ứng lần 1
  'payment_ledger',              // sổ thanh toán
]);
const SALARY_SNAPSHOT_FILE = 'salary_advance_snapshot';

/* ‼ KHO TỶ LỆ PHẢI BĂM THEO SỐ, KHÔNG BĂM THEO BYTE (bot audit đợt 12, mục 5).
 *
 * `employeeCostRateSnapshot.write()` đóng thêm `fetchedAt: <giờ hiện tại>` vào mỗi bản
 * ghi. Nghĩa là MỖI lượt dựng khoẻ mạnh — lấy được tỷ lệ ⇒ lưu lại — đều làm file này
 * đổi BYTE dù không một con số tỷ lệ nào nhúc nhích.
 *
 * Băm cả file thì hậu quả dây chuyền: vân tay đổi ⇒ khoá đổi ⇒ dấu vừa đóng không bao
 * giờ tra lại được ⇒ mỗi lần mở màn lại dựng từ đầu (24 giây) và lại đóng thêm một dấu
 * mồ côi; đồng thời cổng chống-trôi thấy "nội dung đầu ≠ cuối" nên báo nguồn đang đổi
 * cho một việc hoàn toàn lành. Toàn bộ cơ chế chống-nhảy-số coi như không có.
 *
 * Nên với riêng file này: băm phần THỰC SỰ vào công thức — cột + dòng tỷ lệ của từng
 * (nhân viên, kỳ), sắp xếp cố định — và bỏ qua `fetchedAt`.
 * Đánh đổi đã cân nhắc: hai trạng thái cùng tỷ lệ nhưng khác giờ lấy nay ra cùng một
 * khoá. `fetchedAt` chỉ dùng để dán nhãn "số cũ" và tính hạn 45 ngày, không tham gia
 * tính tiền; còn kỳ đã khoá sổ thì bản đóng dấu mới là bản có thẩm quyền. */
const RATE_SNAPSHOT_FILE = 'employee_cost_rate_snapshot';
const BO_QUA_KHOA = 'fetchedAt';

/* Băm CẢ CẤU TRÚC, chỉ bỏ đúng một khoá sổ sách `fetchedAt`, và bỏ ở mọi độ sâu.
 * Không được "chỉ băm phần mình cho là quan trọng": file lệch khỏi hình dạng dự kiến
 * mà băm vẫn y nguyên thì mọi thay đổi trong đó thành TÀNG HÌNH — đúng kiểu fail-open
 * đã hại nhiều lần. Khoá được sắp xếp để thứ tự ghi không làm đổi băm. Cập nhật thẳng
 * vào hàm băm thay vì nối một chuỗi khổng lồ (file này 12,7 MB). */
function canonicalInto(node, hash) {
  if (Array.isArray(node)) {
    hash.update('[');
    for (const item of node) { canonicalInto(item, hash); hash.update(','); }
    hash.update(']');
    return;
  }
  if (node && typeof node === 'object') {
    hash.update('{');
    for (const key of Object.keys(node).sort()) {
      if (key === BO_QUA_KHOA) continue;
      hash.update(JSON.stringify(key));
      hash.update(':');
      canonicalInto(node[key], hash);
      hash.update(',');
    }
    hash.update('}');
    return;
  }
  hash.update(JSON.stringify(node === undefined ? null : node));
}

function rateSnapshotDigest(full, dir) {
  // Dùng chung bản ĐÃ phân tích khi có thể — file này cũng chính là file 12,7 MB.
  const rows = dir === persist.DIR
    ? persist.loadShared(RATE_SNAPSHOT_FILE, null)
    : JSON.parse(fs.readFileSync(full, 'utf8'));
  const hash = crypto.createHash('sha256');
  canonicalInto(rows === undefined ? null : rows, hash);
  return hash.digest('hex');
}

function fileFingerprint(dir, fileName) {
  const full = path.join(dir, `${fileName}.json`);
  let stat;
  try { stat = fs.statSync(full); } catch { hashCache.delete(fileName); return `${fileName}=khong-co`; }
  const print = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const hit = hashCache.get(fileName);
  if (hit && hit.print === print) return `${fileName}=${hit.hash}`;
  let hash;
  try {
    hash = fileName === RATE_SNAPSHOT_FILE
      ? rateSnapshotDigest(full, dir)
      : sha256(fs.readFileSync(full));
  } catch { hashCache.delete(fileName); return `${fileName}=khong-doc-duoc`; }
  hashCache.set(fileName, { print, hash });
  return `${fileName}=${hash}`;
}

/** Vân tay gộp của MỌI kho đầu vào tài chính. Kho nào đổi NỘI DUNG ⇒ vân tay đổi. */
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


/* ‼ SOI LẠI LAI LỊCH DỮ LIỆU QUA MẠNG KHI MỞ DẤU (bot audit đợt 17, mục A1).
 *
 * Bot dựng: nguồn từ xa trả 12,5 rồi đổi thành 9,5. Không file nào trên đĩa đổi nên
 * khoá dấu y nguyên ⇒ app mở lại dấu cũ và trả **12,5** vĩnh viễn. Băm file không bao
 * giờ với tới thứ đến từ mạng, nới vùng quét bao nhiêu vòng cũng không tới.
 *
 * Lai lịch không nằm trong KHOÁ (khoá phải tính được trước khi dựng, lai lịch chỉ biết
 * sau khi dựng — xem chú thích ở `routes.js`). Nó nằm trong THÂN DẤU, và được soi lại
 * mỗi lần mở: hỏi đúng những gói mà dấu ghi là đã dùng, so checksum. Lệch ⇒ vứt dấu.
 *
 * Fail-closed ba đường: dấu không ghi lai lịch (dấu đời cũ), hỏi lại không được, hoặc
 * checksum lệch — cả ba đều trả `false` để dựng lại. Chậm một lượt còn hơn sai vĩnh viễn.
 */
async function remoteProvenanceStillValid(sealedPayload, {
  loadScopes, loadAllocationScopes, revalidateRemote = true,
} = {}) {
  const ghi = sealedPayload?.remoteProvenance;
  if (!Array.isArray(ghi)) return false; // dấu đời cũ không có lai lịch ⇒ không tin
  if (!ghi.length) return true;          // dấu ghi rõ "không dùng gói từ xa nào"

  // Có `THIEU` nghĩa là chính lúc đóng dấu ta đã không lấy được gói — dấu đó không đáng tin.
  if (ghi.some((dong) => String(dong).endsWith(':THIEU'))) return false;

  // Dựng lại danh sách scope TỪ CHÍNH DẤU — chỉ hỏi đúng những gói đã dùng, không quét rộng.
  // Đồng thời đòi đủ tuple chuẩn; ở đường local, checksum seal không được biến một chuỗi
  // tùy ý thành "provenance hợp lệ" chỉ vì nó có hai đoạn đầu.
  const scopes = [];
  const provenancePattern = /^(\d{4}-(?:0[1-9]|1[0-2])):([^:]+):rv=([^:]+):rc=([^:]+):ca=(.+):sc=([^:]+):iv=([^:]+):ic=([^:]+):av=([^:]+):ac=([^:]+)$/;
  for (const dong of ghi) {
    const match = String(dong).match(provenancePattern);
    if (!match) return false;
    scopes.push({ period: match[1], contractorCode: match[2] });
  }

  /* Kỳ đã khoá phục vụ từ seal là một chính sách khác đường tương tác: không được hỏi
   * DataHub lại chỉ để "xác nhận" một bản đã đóng. `revalidateRemote=false` vẫn đi qua
   * cùng cổng lai lịch này, nhưng chỉ tin chứng cứ đã được checksum trong thân seal;
   * thiếu/méo/THIEU đã bị loại ở trên. Nhờ vậy đồng bộ snapshot kỳ khoá có đúng 0
   * network call, còn đường mở màn hiện hành vẫn revalidate nguồn thật như trước. */
  if (revalidateRemote === false) return true;
  if (typeof loadScopes !== 'function' || typeof loadAllocationScopes !== 'function') return false;

  let snapshots;
  let allocationSnapshots;
  try {
    /* ‼ `boQuaBoNho` — bắt buộc. Không có nó thì bộ soi đọc lại đúng bản mà lượt dựng
     * trước đã ghi vào bộ nhớ, rồi tự gật "vẫn khớp": nó xác nhận chính nó, không hề
     * hỏi nguồn (bot audit vòng 4, mục A3). */
    snapshots = await loadScopes(scopes, { boQuaBoNho: true });
    const allocationScopes = [];
    for (const [scopeKey, snapshot] of snapshots) {
      const [period, contractorCode] = scopeKey.split('\u001f');
      if (!snapshot) continue;
      allocationScopes.push({
        period, contractorCode,
        reconciliationVersion: snapshot.reconciliation_version,
        reconciliationRowsChecksumV2: snapshot.reconciliation_rows_checksum_v2,
        reconciliationConfirmedAt: snapshot.confirmed_at,
      });
    }
    allocationSnapshots = await loadAllocationScopes(allocationScopes, { boQuaBoNho: true });
  } catch {
    return false; // hỏi lại không được thì không kết luận là "vẫn đúng"
  }

  // Dựng lại chuỗi lai lịch theo ĐÚNG công thức của `employeeCost.js`, rồi so nguyên khối.
  const bayGio = [];
  for (const [scopeKey, snapshot] of snapshots) {
    const [period, contractorCode] = scopeKey.split('\u001f');
    // Lúc đóng dấu lấy được, giờ hỏi lại không ra ⇒ KHÔNG kết luận "vẫn đúng".
    if (!snapshot) return false;
    const allocationSnapshot = allocationSnapshots.get(scopeKey);
    bayGio.push([
      period, contractorCode,
      `rv=${snapshot.reconciliation_version}`,
      `rc=${snapshot.reconciliation_rows_checksum_v2}`,
      `ca=${snapshot.confirmed_at}`,
      `sc=${snapshot.shadow_snapshot_checksum ?? 'khong-co'}`,
      `iv=${snapshot.immutable_version ?? 'khong-co'}`,
      `ic=${snapshot.immutable_checksum ?? 'khong-co'}`,
      allocationSnapshot ? `av=${allocationSnapshot.allocation_version}` : 'av=khong-co',
      allocationSnapshot ? `ac=${allocationSnapshot.allocation_checksum}` : 'ac=khong-co',
    ].join(':'));
  }
  const truoc = [...new Set(ghi.map(String))].sort().join('&');
  const sau = [...new Set(bayGio)].sort().join('&');
  return truoc === sau;
}

module.exports = {
  FILE, MAX_SEALS, SEAL_FORMAT,
  keyFor, isSealable, read, write, sealedAt, clear, checksumOf, remoteProvenanceStillValid,
  hardenPermissions, rateStoreFingerprint, RATE_STORE_FILES, SALARY_SNAPSHOT_FILE,
};
