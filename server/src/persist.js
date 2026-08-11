/**
 * persist.js — LƯU BỀN bằng file JSON (không thêm dependency ngoài).
 * Dùng cho: phiên đăng nhập, thiết bị tin cậy, mapping Telegram, audit auth.
 * Ghi ATOMIC (ghi file .tmp rồi rename) để restart giữa chừng không hỏng dữ liệu.
 *
 * ── HAI CỬA ĐỌC, CỐ Ý TÁCH ĐÔI ─────────────────────────────────────────────
 *
 *   load(name, def)        đọc lại từ đĩa MỖI LẦN. Hành vi gốc, không đổi một ly.
 *                          Mọi chỗ đang dùng — kể cả lối "đọc → sửa → ghi" — giữ
 *                          nguyên ngữ nghĩa cũ, không rủi ro gì mới.
 *
 *   loadShared(name, def)  CÓ NHỚ, và trả về ĐỐI TƯỢNG DÙNG CHUNG.
 *                          ‼ CHỈ ĐỌC. Sửa vào kết quả là hỏng cả tiến trình.
 *                          Chỉ dùng ở đường đọc thuần, nóng, file to.
 *
 * Vì sao phải tách (bot audit 10/08/2026, đúng): bản đầu tôi cho `load()` nhớ luôn,
 * rồi ghi chú "sửa xong nhớ save()". Chú thích không phải hàng rào — bot tái hiện
 * được ca **sửa mà không save() thì rò sang lượt đọc sau**. Đường tiền không sống
 * bằng lời dặn. Nay cửa có nhớ là cửa RIÊNG, ai mở phải cố ý.
 *
 * ── VÌ SAO CẦN CỬA CÓ NHỚ (gốc rễ 3 ngày CEO bế tắc) ───────────────────────
 * Giả định ban đầu của file này — *"quy mô nhỏ (≤ vài trăm bản ghi)"* — đã vỡ:
 *   cost_rates_local.json            17,9 MB
 *   employee_cost_rate_snapshot.json 12,7 MB
 * Mà `readLocalSync(empCode, kỳ)` đọc file **một lần cho MỖI nhân viên**. Màn "Tất
 * cả nhân viên" 21 người ⇒ `JSON.parse` hàng trăm MB mỗi lần mở màn, **đồng bộ**,
 * khoá cứng vòng lặp sự kiện ⇒ hạn 25 giây hết sau ~5 người ⇒ 16 người bị đóng dấu
 * "Chưa lấy kịp trong hạn". Đo trên kho thật: **21 lượt còn 621 ms**.
 */
const fs = require('fs');
const path = require('path');

// Mặc định server/data/auth; cho phép override qua AUTH_DATA_DIR (dùng khi chạy
// instance tạm để nghiệm thu, tránh đụng dữ liệu auth của app đang chạy).
const DIR = process.env.AUTH_DATA_DIR || path.join(__dirname, '..', 'data', 'auth');
try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* ignore */ }

const file = (name) => path.join(DIR, name + '.json');

/* Trần tính theo SỐ BYTE THẬT CỦA FILE (`stat.size`), không phải độ dài chuỗi —
 * bot audit đúng: `raw.length` là số đơn vị UTF-16, lệch với byte thật ở dữ liệu
 * tiếng Việt. Vẫn phải nhớ: đối tượng sau khi phân tích chiếm bộ nhớ GẤP MẤY LẦN
 * cỡ file, nên đặt trần khiêm tốn 48 MB nguồn (đủ ôm hai file nặng nhất). */
const MAX_CACHE_BYTES = Math.max(
  0, Number(process.env.APP_REPORT_PERSIST_CACHE_BYTES ?? 48 * 1024 * 1024) || 0,
);

const cache = new Map(); // name -> { ino, size, mtimeMs, ctimeMs, value, bytes }
let cacheBytes = 0;

/* ── ĐỒNG HỒ ĐỜI DỮ LIỆU: CHỈ TIẾN, KHÔNG BAO GIỜ LÙI ────────────────────────
 * Bot audit đợt 9 tái hiện được **A → B → A**: nguồn đổi 111 → 222 rồi quay lại 111
 * ngay trong lúc dựng. Chụp vân tay đầu và cuối thì **giống hệt nhau**, nên mọi phép
 * so "đầu == cuối" đều MÙ — app hiển thị và đóng dấu số 222 trong khi nguồn hiện tại
 * là 111. Băm nội dung cũng không cứu được, vì nội dung THẬT SỰ đã quay về như cũ.
 *
 * Thứ duy nhất bắt được là một con đếm **chỉ tăng**: mỗi lần có file bị GHI, hoặc mỗi
 * lần đọc mà thấy file đã khác lần trước, thì tăng một nhịp. A → B → A đi qua hai nhịp
 * ⇒ đầu khác cuối ⇒ lộ ngay.
 *
 * ‼ Con đếm này CHỈ dùng cho cổng kiểm "có gì động đậy giữa chừng không".
 * TUYỆT ĐỐI không đưa vào khoá cache hay khoá đóng dấu — hai thứ đó phải là hàm của
 * NỘI DUNG để còn tái lập được ở lượt sau; nhét con đếm vào là mỗi lượt một khoá,
 * cache chết hẳn. */
let observedGen = 0;
const bumpGen = () => { observedGen += 1; };
function observedGeneration() { return observedGen; }

function forget(name) {
  const hit = cache.get(name);
  if (!hit) return;
  cacheBytes -= hit.bytes;
  cache.delete(name);
}

function remember(name, entry) {
  forget(name);
  if (MAX_CACHE_BYTES <= 0 || entry.bytes > MAX_CACHE_BYTES) return;
  cache.set(name, entry);
  cacheBytes += entry.bytes;
  // Map giữ thứ tự chèn ⇒ khoá đầu tiên là bản lâu không dùng nhất.
  while (cacheBytes > MAX_CACHE_BYTES && cache.size > 1) forget(cache.keys().next().value);
}

/* Dấu vân tay của file. Có `ctimeMs` là để bịt đúng ca bot tái hiện: thay nội dung
 * bằng file CÙNG CỠ rồi `touch` trả lại `mtime` cũ. Đặt lại `mtime` vẫn làm `ctime`
 * nhảy — hệ điều hành không cho lùi `ctime` — nên bản nhớ tự hết hiệu lực. Thêm
 * `ino` để tráo file bằng rename cũng bị bắt. */
function fingerprint(stat) {
  return {
    ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
  };
}

function sameFile(a, b) {
  return !!a && !!b && a.ino === b.ino && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

// Đọc lại từ đĩa MỖI LẦN — hành vi gốc, giữ nguyên cho mọi chỗ đang dùng.
function load(name, def) {
  try {
    const p = file(name);
    if (!fs.existsSync(p)) return def;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return def;
  }
}

/* ĐÓNG BĂNG SÂU bản dùng chung (bot audit đúng): `slice()` chỉ tách được MẢNG, còn
 * ĐỐI TƯỢNG TỪNG DÒNG vẫn dùng chung — sửa `rows[0].c41` là bẩn kho trong bộ nhớ của
 * cả tiến trình trong khi file trên đĩa còn nguyên. Đóng băng xong thì sửa vào là
 * ném lỗi (mã strict) hoặc không ăn thua (mã sloppy) — đằng nào kho cũng KHÔNG bẩn được.
 * Giá: đo trên cấu trúc cỡ thật ~87 ms cho 9,3 MB, và chỉ trả MỘT LẦN mỗi khi file
 * đổi, không phải mỗi lượt đọc. So với 25 giây thì không đáng kể. */
function deepFreeze(node) {
  if (!node || typeof node !== 'object' || Object.isFrozen(node)) return node;
  Object.freeze(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) deepFreeze(node[i]);
  } else {
    for (const key of Object.keys(node)) deepFreeze(node[key]);
  }
  return node;
}

/**
 * CÓ NHỚ. Trả về đối tượng DÙNG CHUNG, ĐÃ ĐÓNG BĂNG — không ai sửa được.
 * File đổi (nội dung, cỡ, hay bị tráo) ⇒ tự đọc lại. Hỏng/bị xoá ⇒ quên ngay,
 * không bao giờ phục vụ số cũ.
 */
function loadShared(name, def, retriesLeft = 2) {
  let fd = null;
  try {
    const p = file(name);
    /* ‼ MỞ MỘT LẦN rồi `fstat` + đọc TRÊN CHÍNH fd ĐÓ (bot audit đúng): nếu `stat`
     * rồi mới `readFileSync(đường dẫn)` thì một cú `rename` chen vào giữa sẽ cho
     * vân tay của file CŨ nhưng nội dung của file MỚI — vừa sai dấu, vừa tính sai
     * dung lượng cho trần bộ nhớ. Đã mở fd thì `rename` không đổi được inode đang mở,
     * nên (vân tay, nội dung) chắc chắn là của cùng một file. */
    try { fd = fs.openSync(p, 'r'); } catch { forget(name); return def; }
    const before = fingerprint(fs.fstatSync(fd));

    const hit = cache.get(name);
    if (hit && !sameFile(hit.print, before)) bumpGen(); // file đã khác lần đọc trước
    if (hit && sameFile(hit.print, before)) {
      cache.delete(name); cache.set(name, hit); // chạm vào để giữ hàng LRU
      return hit.value;
    }

    /* ‼ GHI ĐÈ TẠI CHỖ (bot audit đợt 3, đúng): mở fd chặn được cú `rename`, nhưng
     * KHÔNG chặn được ai đó ghi thẳng vào CHÍNH inode đang mở giữa `fstat` và `read`.
     * Khi đó nội dung là bản MỚI mà vân tay/dung lượng lại là bản CŨ ⇒ ghi sổ sai cỡ,
     * lọt qua trần bộ nhớ. Nên: đọc xong `fstat` LẠI. Vân tay đổi ⇒ file còn đang bị
     * ghi ⇒ đọc lại. Thử vài lượt vẫn không yên thì TRẢ SỐ ĐÚNG NHƯNG KHÔNG NHỚ —
     * thà chậm còn hơn nhớ một bản không biết mình là ai. */
    const raw = fs.readFileSync(fd, 'utf8');
    const after = fingerprint(fs.fstatSync(fd));
    const stable = sameFile(before, after);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      /* Đọc trúng lúc file đang ghi dở thì JSON vỡ. File ĐANG đổi ⇒ thử lại, đừng
       * vội trả mặc định (bot audit: "file đã ổn định rồi mà vẫn trả default"). */
      if (!stable && retriesLeft > 0) {
        fs.closeSync(fd); fd = null;
        return loadShared(name, def, retriesLeft - 1);
      }
      forget(name);
      return def;
    }

    if (stable) {
      const value = deepFreeze(parsed);
      remember(name, { print: after, value, bytes: after.size });
      return value;
    }

    // File đổi giữa chừng: thử lại để lấy bản yên.
    forget(name);
    if (retriesLeft > 0) {
      fs.closeSync(fd); fd = null;
      return loadShared(name, def, retriesLeft - 1);
    }
    /* Hết lượt mà file vẫn bị ghi liên tục: KHÔNG nhớ, và cũng KHÔNG trả bản vừa đọc
     * (đó là bản cũ so với file hiện tại). Đọc lại một phát bằng cửa thường để lấy
     * đúng bản đang có trên đĩa — chậm hơn, nhưng không bao giờ phục vụ bản lạc hậu. */
    /* Hết lượt mà file VẪN đang bị ghi: KHÔNG trả bản vừa đọc (nó là generation cũ so
     * với file hiện tại), và cũng KHÔNG đọc liều một phát nữa — bản đó cũng không có gì
     * ràng buộc. FAIL CLOSED: trả mặc định. Người gọi sẽ coi như "chưa có dữ liệu" ⇒
     * NV rơi vào luồng thiếu nguồn ⇒ KHÔNG đủ điều kiện đóng dấu. Thà chưa có số còn
     * hơn đóng dấu vĩnh viễn một con số tính trên bản không rõ đời nào. */
    console.warn('[persist] file bị ghi liên tục — FAIL CLOSED, coi như chưa đọc được', { name });
    return def;
  } catch {
    forget(name);
    return def;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* đóng hụt cũng không sao */ } }
  }
}

function save(name, data) {
  const p = file(name);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, p);
  bumpGen(); // có ghi là đời dữ liệu đã nhích, kể cả ghi lại y nguyên nội dung
  // Quên hẳn thay vì nhớ đối tượng vừa ghi: người gọi có thể còn giữ tham chiếu và
  // sửa tiếp. Đọc lại một lần sau khi ghi là rẻ; phục vụ số sai thì không.
  forget(name);
}

// Cho test và cho chỗ nào cần ép đọc lại từ đĩa.
function invalidate(name) {
  if (name === undefined) { cache.clear(); cacheBytes = 0; return; }
  forget(name);
}

function cacheStats() {
  return { entries: cache.size, bytes: cacheBytes, maxBytes: MAX_CACHE_BYTES };
}

module.exports = { load, loadShared, save, DIR, invalidate, cacheStats, observedGeneration };
