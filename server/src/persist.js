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
const { resolveAuthDataDir } = require('./runtimeDataDir');

// Release production nạp `.env` qua symlink về repo bền vững. Dùng realpath của
// chính file đó để mọi release cùng đọc/ghi một kho, không làm rơi phiên đăng nhập
// khi đổi symlink. AUTH_DATA_DIR vẫn thắng tuyệt đối cho test/instance cô lập.
const DIR = resolveAuthDataDir({ fallbackDir: path.join(__dirname, '..', 'data', 'auth') });
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

/* ── SỔ QUAN SÁT ĐỜI DỮ LIỆU: THEO TỪNG FILE, GHI VÀO LÚC ĐỌC ───────────────
 * Việc cần làm: bắt cho được cảnh **A → B → A** (nguồn 111 → 222 → 111 ngay giữa
 * lúc dựng). Chụp vân tay nội dung ở hai đầu là MÙ, vì nội dung thật sự đã quay về.
 *
 * Bản trước tôi đếm MỌI cú ghi của MỌI file vào MỘT con đếm chung. Bot audit đợt 12
 * bắn thủng cả hai đầu, và đúng cả hai:
 *   · Quá RỘNG — ghi `audit_auth` (mỗi lần đăng nhập cũng ghi) làm màn chi phí kêu
 *     "nguồn đang đổi". Tệ hơn: chính lượt dựng khoẻ mạnh cũng tự ghi lại kho tỷ lệ
 *     ⇒ tự làm lệch đồng hồ của mình ⇒ 503 oan cho việc hoàn toàn lành.
 *   · Quá HẸP — con đếm chỉ nghe được những cú ghi trong CHÍNH tiến trình này. Tiến
 *     trình khác (đồng bộ, cron, tay người) ghi 222 rồi trả lại 111 thì đồng hồ đứng
 *     im ⇒ A→B→A vẫn lọt nguyên.
 *
 * Nay ghi sổ theo TỪNG FILE, và mốc ghi là lúc ĐỌC — vì thứ ta cần biết không phải
 * "ai đó có ghi gì không" mà là **"bản ta cầm trong tay có còn là bản trên đĩa không"**:
 *   · Mỗi lượt đọc (CẢ HAI cửa) ⇒ đối chiếu vân tay với lần gần nhất ta biết về file
 *     đó. Khác đi ⇒ +1 nhịp cho RIÊNG file đó. Đây mới là thứ nghe được tiến trình khác.
 *   · Lần đầu thấy một file thì KHÔNG tính là đổi — chưa có gì để so.
 *   · `save()` của chính ta ⇒ ghi nhận vân tay mới nhưng KHÔNG +1: ta cố ý ghi, và
 *     số ta đang cầm chính là số vừa ghi. Ghi của mình mà tự tính là "nguồn đổi" thì
 *     app tự bóp cổ mình.
 *   · `observedGeneration(names)` tự `stat` đúng những file được hỏi TRƯỚC khi trả lời.
 *     Nhờ vậy mốc ĐẦU của cổng kiểm luôn có sẵn "lần đầu thấy", còn mốc CUỐI luôn nhìn
 *     vào đĩa ở hiện tại — A→B→A lộ ra ở đúng hai nhịp.
 *
 * ‼ Sổ này CHỈ dùng cho cổng kiểm "có gì động đậy giữa chừng không". TUYỆT ĐỐI không
 * đưa vào khoá cache hay khoá đóng dấu — hai thứ đó phải là hàm của NỘI DUNG để còn
 * tra lại được ở lượt sau. Bản trước tôi thề đúng câu này rồi vẫn để nó rò vào khoá
 * đóng dấu ở `routes.js`; nay có bài kiểm ĐỘNG so khoá thật, không chỉ đọc chữ. */
const seen = new Map(); // name -> { print, changes }

function observe(name, print) {
  const hit = seen.get(name);
  if (!hit) { seen.set(name, { print, changes: 0 }); return; }
  if (sameFile(hit.print, print)) return;
  hit.print = print;
  hit.changes += 1;
}

// Ta vừa tự ghi: biết mặt bản mới, nhưng không tính là "nguồn đổi dưới chân mình".
function adopt(name, print) {
  const hit = seen.get(name);
  if (!hit) { seen.set(name, { print, changes: 0 }); return; }
  hit.print = print;
}

// File biến mất cũng là một đời khác — trừ khi ta chưa từng thấy nó bao giờ.
function markMissing(name) {
  const hit = seen.get(name);
  if (!hit) { seen.set(name, { print: null, changes: 0 }); return; }
  if (hit.print === null) return;
  hit.print = null;
  hit.changes += 1;
}

/** Mốc đời của ĐÚNG những file được hỏi. Bắt buộc nêu tên — không có cửa "tất cả". */
function observedGeneration(names) {
  if (names === undefined || names === null) {
    throw new Error('observedGeneration cần danh sách tên file — không có mốc đời toàn cục');
  }
  const list = Array.isArray(names) ? names : [names];
  return list.map((name) => {
    try { observe(name, fingerprint(fs.statSync(file(name)))); } catch { markMissing(name); }
    return `${name}#${seen.get(name)?.changes ?? 0}`;
  }).join(',');
}

// Chỉ dành cho test: xoá sổ quan sát để mỗi ca bắt đầu từ trang trắng.
function forgetObservations() { seen.clear(); }

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

/* Đọc lại từ đĩa MỖI LẦN — hành vi gốc, giữ nguyên cho mọi chỗ đang dùng.
 * Chỉ thêm ĐÚNG một việc: ghi sổ vân tay của bản vừa đọc. Bắt buộc, vì có kho tiền
 * đi bằng cửa này (`salary_advance_snapshot` đọc qua `load`, bot audit đợt 12 chỉ ra):
 * cửa nào không ghi sổ thì A→B→A đi qua cửa đó là lọt.
 * `open` rồi `fstat`+`read` trên CHÍNH fd đó, để vân tay và nội dung chắc chắn cùng
 * một file — `existsSync` rồi mới đọc theo đường dẫn thì một cú `rename` chen vào
 * giữa là ghi sổ nhầm mặt. */
function load(name, def) {
  let fd = null;
  try {
    try { fd = fs.openSync(file(name), 'r'); } catch { markMissing(name); return def; }
    observe(name, fingerprint(fs.fstatSync(fd)));
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch {
    return def;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* đóng hụt cũng không sao */ } }
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
    try { fd = fs.openSync(p, 'r'); } catch { markMissing(name); forget(name); return def; }
    const before = fingerprint(fs.fstatSync(fd));
    observe(name, before); // ghi sổ ĐỜI của bản ta sắp dùng, kể cả khi trúng bản nhớ

    const hit = cache.get(name);
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
  /* Ghi nhận mặt bản vừa ghi, nhưng KHÔNG tính là "nguồn đổi": chính ta ghi, và số ta
   * đang cầm là số vừa ghi. Bản trước cộng nhịp ở đây nên lượt dựng khoẻ mạnh — vốn
   * luôn ghi lại kho tỷ lệ (`fetchedAt` đổi mỗi lần lấy) — tự đá mình văng ra 503. */
  try { adopt(name, fingerprint(fs.statSync(p))); } catch { /* stat hụt thì lượt đọc sau tự ghi sổ */ }
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

module.exports = {
  load, loadShared, save, DIR, invalidate, cacheStats, observedGeneration, forgetObservations,
};
