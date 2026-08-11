/**
 * employeeCostFormulaIdentity.js — CĂN CƯỚC CỦA CÁCH TÍNH TIỀN.
 *
 * ‼ VÌ SAO PHẢI CÓ FILE NÀY (bot audit đợt 14, mục A2 — đúng, và đây là lỗ đắt nhất).
 *
 * Con dấu kỳ khoá sổ được đánh khoá theo bốn thứ: dữ liệu, kho tỷ lệ, số hiệu công
 * thức, và "phiên bản app". Nhưng "phiên bản app" lại chỉ là `package.json.version`
 * = `2.0.0` — một con số **không đổi suốt cả chục commit**. Nghĩa là khoá con dấu
 * hoàn toàn **mù với cách tính tiền**.
 *
 * Bot dựng lại được đúng cảnh chết người: đổi `EMPLOYEE_COST_DERIVED_BASE` để C44
 * phải ra **10.000** thay vì **6.000** — khoá con dấu **y hệt** ⇒ app đọc lại dấu cũ
 * và hiển thị **6.000**. Đổi cách tính tiền mà con số không đổi, không ai được báo,
 * và vì là kỳ đã khoá sổ nên **sai vĩnh viễn**.
 *
 * Nay khoá phải gắn với TOÀN BỘ những gì quyết định ra con số:
 *   ① MÃ NGUỒN các module tính tiền — đổi một dòng công thức là khoá đổi.
 *   ② FILE CẤU HÌNH tính tiền — sửa bậc thưởng, mẫu cột, nhóm đơn vị… là khoá đổi.
 *   ③ BIẾN MÔI TRƯỜNG điều khiển cách tính — đúng cái bot bẻ được.
 *
 * ‼ NGUYÊN TẮC: THÀ THỪA CÒN HƠN THIẾU. Thừa một mục thì cùng lắm là dựng lại một
 * lần (chậm vài trăm mili giây). Thiếu một mục thì đóng dấu vĩnh viễn một con số
 * sai. Hai cái giá đó không cùng hạng, nên không được "tối ưu" bằng cách bỏ bớt.
 *
 * ‼ CẤM ghi giá trị biến môi trường vào căn cước. Chỉ ghi **băm** của nó — trong đám
 * này có khoá API (`*_KEY`). Băm vẫn đổi khi giá trị đổi, mà không rò gì ra khoá,
 * ra log, hay ra file dấu.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ngan = (value) => sha256(value).slice(0, 16); // đủ phân biệt, gọn cho khoá

const SRC_DIR = __dirname;
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const DATA_DIR = path.join(__dirname, '..', 'data');

/* ① Module nào có một dòng dính tới việc ra con số thì có mặt ở đây. Thiếu file nào
 * (đổi tên, xoá) thì được ghi là "khong-co" — cũng làm căn cước đổi, đúng ý: cấu trúc
 * tính tiền đã khác thì con dấu cũ phải hết hiệu lực. */
const MODULE_TINH_TIEN = Object.freeze([
  'employeeCost.js',
  'employeeCostTemplates.js',
  'employeeCostTable.js',
  'employeeCostRateSnapshot.js',
  'employeeCostUnitGroups.js',
  'employeeCostRoster.js',
  'employeeCostRevenueRecon.js',
  'employeeCostReconAllocationV4.js',
  'employeeBonus.js',
  'employeeBonusPolicy.js',
  'employeePenalty.js',
  'employeePenaltyAggregate.js',
  'employeePenaltyPolicy.js',
  'costAmounts.js',
  'costBreakdown.js',
  'costRatesTable.js',
  'xuPolicy.js',
  'diemXu.js',
]);

/* ② File cấu hình. Đường dẫn lấy từ biến môi trường nếu có, không thì dùng mặc định —
 * phải khớp đúng cách các module kia tự đọc, nếu không thì canh nhầm file. */
const fileCauHinh = () => Object.freeze([
  ['templates', process.env.EMPLOYEE_COST_TEMPLATE_CONFIG || path.join(CONFIG_DIR, 'employee_cost_templates.json')],
  ['groups', process.env.EMPLOYEE_COST_GROUP_CONFIG || path.join(CONFIG_DIR, 'employee_cost_groups.json')],
  ['unitGroups', process.env.EMPLOYEE_COST_UNIT_GROUPS_FILE || path.join(CONFIG_DIR, 'employee_cost_unit_groups.json')],
  ['bonusTiers', path.join(CONFIG_DIR, 'employee_bonus_tiers.json')],
  ['bonusLock', path.join(CONFIG_DIR, 'bonus_formula_lock.json')],
  ['pointCoeff', path.join(CONFIG_DIR, 'employee_point_coeff.json')],
  ['dataQuality', path.join(CONFIG_DIR, 'employee_cost_data_quality.json')],
  ['bonusPolicy', process.env.EMPLOYEE_BONUS_POLICY_FILE || path.join(DATA_DIR, 'employee_bonus_policies.json')],
  ['penaltyPolicy', process.env.EMPLOYEE_PENALTY_POLICY_FILE || path.join(DATA_DIR, 'employee_penalty_policies.json')],
]);

/* ③ Biến môi trường điều khiển cách tính. `EMPLOYEE_COST_DERIVED_BASE` là biến bot
 * bẻ được; những biến còn lại cùng loại nên vào chung cho kín. */
const BIEN_TINH_TIEN = Object.freeze([
  'EMPLOYEE_COST_DERIVED_BASE',
  'EMPLOYEE_COST_TEMPLATE_CONFIG',
  'EMPLOYEE_COST_GROUP_CONFIG',
  'EMPLOYEE_COST_UNIT_GROUPS_FILE',
  'EMPLOYEE_COST_ANNUAL_COLUMNS',
  'EMPLOYEE_COST_MATCH_WARN_PCT',
  'EMPLOYEE_BONUS_POLICY_FILE',
  'EMPLOYEE_PENALTY_POLICY_FILE',
  'APP_REPORT_EMPLOYEE_COST_KEYS',
  'APP_REPORT_COST_GO_LIVE_MONTH',
  'APP_REPORT_COST_LOCAL_FIRST',
  'APP_SALE_RECON_ALLOCATION_V4_VERSION',
  'APP_SALE_RECON_ALLOCATION_V4_RECONCILIATION_VERSION',
]);

/* Mã nguồn không đổi giữa chừng khi tiến trình đang chạy, nên băm MỘT LẦN rồi giữ.
 * (Đổi code thì phải khởi động lại — lúc đó cache này cũng mất theo.) */
let bamNguon = null;
function digestNguon() {
  if (bamNguon) return bamNguon;
  const parts = MODULE_TINH_TIEN.map((ten) => {
    try { return `${ten}=${sha256(fs.readFileSync(path.join(SRC_DIR, ten)))}`; } catch { return `${ten}=khong-co`; }
  });
  bamNguon = ngan(parts.join('\n'));
  return bamNguon;
}

/* File cấu hình thì SỬA ĐƯỢC lúc app đang chạy, nên phải soi lại mỗi lượt. Băm theo
 * nội dung, nhớ theo vân tay `stat` để không đọc lại file không đổi. */
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
  return ngan(fileCauHinh().map(([ten, duongDan]) => `${ten}=${digestMotFile(duongDan)}`).join('\n'));
}

// Chỉ băm, KHÔNG bao giờ để lộ giá trị — trong đám này có khoá API.
function digestBienMoiTruong() {
  return ngan(BIEN_TINH_TIEN.map((ten) => {
    const gia = process.env[ten];
    return `${ten}=${gia === undefined ? 'khong-dat' : sha256(String(gia))}`;
  }).join('\n'));
}

/**
 * Căn cước đầy đủ của cách tính tiền hiện hành. Đưa thẳng vào vân tay nguồn ⇒ vào
 * khoá bộ nhớ đệm và khoá con dấu. Đổi bất cứ thứ gì ở trên là khoá đổi ⇒ dựng lại
 * và đóng dấu mới, thay vì phục vụ lại con số tính bằng công thức đã bị thay.
 */
function identity() {
  return `ct1:${digestNguon()}.${digestCauHinh()}.${digestBienMoiTruong()}`;
}

// Cho test ép tính lại sau khi đổi biến/ sửa file.
function forgetCache() { bamNguon = null; nhoCauHinh.clear(); }

module.exports = {
  identity, forgetCache, MODULE_TINH_TIEN, BIEN_TINH_TIEN, fileCauHinh,
};
