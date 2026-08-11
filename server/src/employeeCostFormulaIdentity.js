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
 * Nay: **băm TOÀN BỘ `src/**.js` và TOÀN BỘ `config/`**, không chọn lọc. Không còn câu
 * hỏi "đã liệt kê đủ chưa" vì không còn danh sách nào để thiếu.
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
function liet(dir, loc = () => true) {
  const ra = [];
  const di = (thuMuc) => {
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

/* ② CẤU HÌNH — toàn bộ `config/`, cộng vài file chính sách nằm trong `data/` (thư mục
 * đó còn chứa dữ liệu biến động nên không quét cả). File cấu hình SỬA ĐƯỢC lúc app
 * đang chạy, nên phải soi lại mỗi lượt; nhớ theo vân tay `stat` để khỏi đọc lại file
 * không đổi. */
const fileChinhSachTrongData = () => [
  process.env.EMPLOYEE_BONUS_POLICY_FILE || path.join(DATA_DIR, 'employee_bonus_policies.json'),
  process.env.EMPLOYEE_PENALTY_POLICY_FILE || path.join(DATA_DIR, 'employee_penalty_policies.json'),
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

function digestCauHinh() {
  const danh = [
    ...liet(CONFIG_DIR),
    ...fileChinhSachTrongData(),
    ...fileCauHinhNgoai(),
  ];
  const duyNhat = [...new Set(danh)].sort();
  return ngan(duyNhat.map((p) => `${p}=${digestMotFile(p)}`).join('\n'));
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

module.exports = { identity, forgetCache, tenBienTinhTien, TIEN_TO_TINH_TIEN };
