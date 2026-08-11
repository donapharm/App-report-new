/**
 * employeeCostFormulaIdentity.js — CĂN CƯỚC CỦA CÁCH TÍNH TIỀN.
 *
 * ‼ VÌ SAO PHẢI CÓ FILE NÀY (bot audit đợt 14, mục A2).
 *
 * Con dấu kỳ khoá sổ được đánh khoá theo bốn thứ, trong đó "phiên bản app" lại chỉ là
 * `package.json.version` = `2.0.0` — một con số **không đổi suốt hàng chục commit**.
 * Khoá con dấu vì thế **mù hoàn toàn với cách tính tiền**. Bot đổi
 * `EMPLOYEE_COST_DERIVED_BASE` cho C44 phải ra 10.000 thay vì 6.000: khoá y hệt ⇒ app
 * đọc lại dấu cũ và trả 6.000. Đổi công thức mà con số không đổi; ở kỳ đã khoá sổ thì
 * **sai vĩnh viễn**.
 *
 * ‼ VÌ SAO KHÔNG CÒN DANH SÁCH MODULE VIẾT TAY (bot audit đợt 15 — đúng).
 *
 * Bản đầu tôi liệt kê tay 18 module "tính tiền". Bot sửa `paymentSchedule.js` làm tiền
 * đợt 2 đổi **54.000.000đ → 45.000.000đ**: căn cước **không đổi**, khoá **không đổi**,
 * app vẫn trả **54.000.000đ**. Và họ chỉ ra còn thiếu `paymentTeamSummary.js`,
 * `routes.js`, cùng các mắt xích target / tạm ứng lương / sổ thanh toán / analytics /
 * chính sách thưởng / đối soát.
 *
 * Danh sách viết tay là mô hình SAI cho việc này. Không phải vì tôi liệt kê ẩu, mà vì
 * nó đòi hỏi **mọi người sửa code về sau đều phải nhớ cập nhật danh sách** — mà quên
 * thì không có gì kêu lên, chỉ có một con số sai được đóng dấu vĩnh viễn. Hàng rào nào
 * phải nhờ trí nhớ thì không phải hàng rào.
 *
 * Nay: **băm TOÀN BỘ `src/**.js`**, toàn bộ `config/`, và các file ĐẦU VÀO ở tầng trên
 * cùng của `data/`. Không còn câu hỏi "đã liệt kê đủ module chưa".
 *
 * Giá phải trả, đã cân: đổi một module chẳng liên quan gì tới tiền cũng làm khoá đổi ⇒
 * sau mỗi lần deploy, kỳ đã khoá sổ phải dựng lại **đúng một lần** rồi đóng dấu mới
 * (đo được: ~200 ms nóng). Đổi lại là **không một dòng code nào ảnh hưởng tới tiền có
 * thể lọt ra ngoài tầm phủ**. Một lần dựng lại sau deploy so với một con số sai đóng
 * dấu vĩnh viễn — không cùng hạng để mà cân nhắc.
 *
 * ‼ CẤM ghi giá trị biến môi trường vào căn cước. Chỉ ghi **băm** — trong đám biến này
 * có khoá API (`*_KEY`), mà khoá con dấu thì nằm trong file dấu và trong log.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ngan = (value) => sha256(value).slice(0, 16); // đủ phân biệt, gọn cho khoá

const SRC_DIR = __dirname;
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const DATA_DIR = path.join(__dirname, '..', 'data');

// Liệt kê đệ quy, sắp xếp cố định để thứ tự đọc thư mục không làm đổi băm.
function liet(dir, loc = () => true, boQua = []) {
  const ra = [];
  const chan = boQua.map((p) => path.resolve(p));
  const di = (thuMuc) => {
    if (chan.includes(path.resolve(thuMuc))) return;
    let muc;
    try { muc = fs.readdirSync(thuMuc, { withFileTypes: true }); } catch { return; }
    for (const e of muc) {
      const p = path.join(thuMuc, e.name);
      if (e.isDirectory()) di(p);
      else if (loc(e.name)) ra.push(p);
    }
  };
  di(dir);
  return ra.sort();
}

/* ① MÃ NGUỒN — toàn bộ `src/**.js`, không chọn lọc. Mã nguồn không đổi khi tiến trình
 * đang chạy (đổi code thì phải khởi động lại), nên băm MỘT LẦN rồi giữ.
 * Đo trên kho thật: 153 file / 2,3 MB / 5–11 ms. */
let bamNguon = null;
function digestNguon() {
  if (bamNguon) return bamNguon;
  const h = crypto.createHash('sha256');
  for (const p of liet(SRC_DIR, (ten) => ten.endsWith('.js'))) {
    h.update(path.relative(SRC_DIR, p));
    h.update('\0');
    try { h.update(fs.readFileSync(p)); } catch { h.update('khong-doc-duoc'); }
    h.update('\n');
  }
  bamNguon = h.digest('hex').slice(0, 16);
  return bamNguon;
}

/* ② CẤU HÌNH & DỮ LIỆU TĨNH.
 *
 * Quy tắc: lấy hết rồi trừ ra — nhưng trừ theo AI GHI RA FILE, không trừ theo thư mục.
 * File do NGƯỜI đặt vào (lịch nghỉ, mẫu cột, bậc thưởng) là ĐẦU VÀO của phép tính, phải
 * nằm trong khoá. File do CHÍNH APP ghi ra (trạng thái, LKG, nhật ký, sao lưu) là ĐẦU RA,
 * đưa vào khoá là tự quay vòng: app ghi -> khoá đổi -> dựng lại -> app ghi tiếp.
 *
 * ‼ BỐN KHO TIỀN nằm trong `AUTH_DATA_DIR` và CỐ Ý không băm ở đây: đã được phủ bởi
 * `closedSeal.rateStoreFingerprint()` theo NỘI DUNG SỐ (bỏ `fetchedAt`). Băm lại bằng
 * byte thô là dựng lại đúng lỗi churn đã mất một vòng để gỡ. ĐỪNG "bổ sung cho đủ".
 *
 * Thêm `package.json` + `package-lock.json` (server và gốc): nâng một thư viện có thể
 * đổi cách làm tròn; lockfile ghi chính xác phiên bản đang dùng, rẻ hơn băm `node_modules`.
 */
/* ‼ ĐO TRÊN KHO THẬT, ĐỪNG ĐO TRÊN KHO MẪU (bot audit đợt 17 — lỗi của tôi).
 *
 * Tôi đo `data/` trong repo: 20 file / 276 KB, quét vèo cái xong, rồi tuyên bố "quét cả
 * `data/`". Trên PROD thư mục đó là **524 file / 1,03 GB** — LKG, trạng thái thông báo,
 * nhật ký, bản sao lưu, và `uploads` lồng nhiều tầng. Bot đo: **cold 7.055 ms, hot
 * 4.931 ms** mỗi lượt tính căn cước. Tệ hơn: chỉ cần `catalog_management_lkg.json` đổi
 * mỗi trường `updatedAt`, hay `notif_cost_state.json` được ghi, là khoá đổi ⇒ dấu trượt
 * ⇒ dựng lại — đúng cái bệnh cơ chế này sinh ra để chữa.
 *
 * Sai ở đâu: tôi đúng khi nói "lấy hết rồi trừ ra", nhưng đã trừ theo **thư mục** trong
 * khi thứ cần phân biệt là **ai ghi ra file đó**. File do NGƯỜI đặt vào (lịch nghỉ, mẫu
 * cột, bậc thưởng) là ĐẦU VÀO của phép tính. File do CHÍNH APP ghi ra (trạng thái, LKG,
 * nhật ký, sao lưu) là ĐẦU RA — đưa đầu ra vào khoá là tự quay vòng.
 *
 * Nay: `data/` chỉ quét TẦNG TRÊN CÙNG (đầu vào tĩnh nằm cả ở đó), bỏ mọi thư mục con,
 * và loại thêm các đuôi file do app tự ghi. Kèm HẠN MỨC: vượt ngưỡng thì KHÔNG đóng dấu
 * nữa — thà mất đường tắt còn hơn đóng dấu bằng một khoá không ai hiểu nổi. */
const DUOI_APP_TU_GHI = /(_lkg|_state|_audit|_snapshot|_cache|_backup)\.json$|\.(log|bak|tmp|lock)$/i;

const MAX_FILE_QUET = 200;
const MAX_BYTE_QUET = 32 * 1024 * 1024;

const filePhuThuoc = () => [
  path.join(__dirname, '..', 'package.json'),
  path.join(__dirname, '..', 'package-lock.json'),
  path.join(__dirname, '..', '..', 'package.json'),
  path.join(__dirname, '..', '..', 'package-lock.json'),
];

// Đường dẫn cấu hình do biến môi trường trỏ tới — có thể nằm ngoài `config/`.
const fileCauHinhNgoai = () => [
  process.env.EMPLOYEE_COST_TEMPLATE_CONFIG,
  process.env.EMPLOYEE_COST_GROUP_CONFIG,
  process.env.EMPLOYEE_COST_UNIT_GROUPS_FILE,
].filter(Boolean);

const nhoCauHinh = new Map(); // đường dẫn -> { print, hash }
function digestMotFile(duongDan) {
  let stat;
  try { stat = fs.statSync(duongDan); } catch { nhoCauHinh.delete(duongDan); return 'khong-co'; }
  const print = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const hit = nhoCauHinh.get(duongDan);
  if (hit && hit.print === print) return hit.hash;
  let hash;
  try { hash = sha256(fs.readFileSync(duongDan)); } catch { nhoCauHinh.delete(duongDan); return 'khong-doc-duoc'; }
  nhoCauHinh.set(duongDan, { print, hash });
  return hash;
}

// `data/` chỉ tầng trên cùng, và bỏ những đuôi file do CHÍNH APP ghi ra.
function fileDauVaoTrongData() {
  let muc;
  try { muc = fs.readdirSync(DATA_DIR, { withFileTypes: true }); } catch { return []; }
  return muc
    .filter((e) => e.isFile() && !DUOI_APP_TU_GHI.test(e.name))
    .map((e) => path.join(DATA_DIR, e.name));
}

let vuotNguong = null; // { soFile, soByte } khi vùng quét phình ra ngoài dự kiến

function digestCauHinh() {
  const danh = [
    ...liet(CONFIG_DIR),
    ...fileDauVaoTrongData(),
    ...filePhuThuoc(),
    ...fileCauHinhNgoai(),
  ];
  const duyNhat = [...new Set(danh.map((p) => path.resolve(p)))].sort();

  /* HẠN MỨC: vùng quét phình ra là dấu hiệu có thứ ngoài dự kiến lọt vào. Khi đó
   * KHÔNG đóng dấu nữa (xem `dangTinCay`), thay vì âm thầm tốn 7 giây mỗi lượt hoặc
   * đóng dấu bằng một khoá không ai giải thích nổi. Hỏng thì hỏng ồn ào. */
  let soByte = 0;
  const phan = duyNhat.map((p) => {
    try { soByte += fs.statSync(p).size; } catch { /* mất file thì digest tự ghi 'khong-co' */ }
    return `${p}=${digestMotFile(p)}`;
  });
  vuotNguong = (duyNhat.length > MAX_FILE_QUET || soByte > MAX_BYTE_QUET)
    ? { soFile: duyNhat.length, soByte }
    : null;
  if (vuotNguong) {
    console.error('[formula-identity] vùng quét vượt hạn mức — TẠM NGỪNG đóng dấu kỳ khoá sổ', vuotNguong);
  }
  return ngan(phan.join('\n'));
}

/** Căn cước có đáng tin để đem đi ĐÓNG DẤU VĨNH VIỄN không. Sai thì thà đừng đóng. */
function dangTinCay() {
  if (vuotNguong === null) identity();
  return { tinCay: vuotNguong === null, vuotNguong };
}

/* ③ BIẾN MÔI TRƯỜNG. Đây là chỗ DUY NHẤT còn phải chọn lọc — không thể băm cả
 * `process.env` vì trong đó có thứ đổi mỗi lần khởi động (PORT, PATH, PWD…) sẽ làm
 * khoá churn vô cớ. Nên lọc theo TIỀN TỐ thay vì liệt kê từng tên: thêm biến mới cùng
 * họ là tự động được phủ, không phải nhớ cập nhật file này. */
const TIEN_TO_TINH_TIEN = Object.freeze([
  'EMPLOYEE_',
  'BONUS_',
  'PENALTY_',
  'SALARY_',
  'PAYMENT_',
  'TARGET_',
  'INCENTIVE_',
  'APP_REPORT_COST',
  'APP_REPORT_EMPLOYEE',
  'APP_SALE_RECON',
  'DATA_HUB_',
  'DATAHUB_',
  'REVENUE_',
  'COST_',
  'XU_',
]);

function tenBienTinhTien() {
  return Object.keys(process.env)
    .filter((ten) => TIEN_TO_TINH_TIEN.some((tt) => ten.startsWith(tt)))
    .sort();
}

// Chỉ băm, KHÔNG bao giờ để lộ giá trị — trong đám này có khoá API.
function digestBienMoiTruong() {
  return ngan(tenBienTinhTien().map((ten) => `${ten}=${sha256(String(process.env[ten]))}`).join('\n'));
}

/**
 * Căn cước đầy đủ của cách tính tiền hiện hành. Đưa thẳng vào vân tay nguồn ⇒ vào khoá
 * bộ nhớ đệm và khoá con dấu. Đổi mã nguồn, đổi cấu hình, hay đổi biến điều khiển ⇒
 * khoá đổi ⇒ dựng lại và đóng dấu mới, thay vì phục vụ lại con số tính bằng công thức
 * đã bị thay.
 */
function identity() {
  return `ct2:${digestNguon()}.${digestCauHinh()}.${digestBienMoiTruong()}`;
}

// Cho test ép tính lại sau khi đổi biến / sửa file.
function forgetCache() { bamNguon = null; nhoCauHinh.clear(); }

module.exports = { identity, forgetCache, dangTinCay, tenBienTinhTien, TIEN_TO_TINH_TIEN };
