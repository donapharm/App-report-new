/**
 * store.js — LỚP NGUỒN DỮ LIỆU.
 *
 * Bản demo đọc từ file JSON mẫu (server/data/*).
 * TODO(LIVE): khi lên server, thay các hàm load* bằng:
 *   - đọc file upload doanh thu thật (report_upload_data_*.json)
 *   - fallback ORDS/Lumos (SALES_REPORT, V_TEM_TARGET_BONUS)
 * Giữ nguyên chữ ký hàm để phần trên (services/routes) không phải sửa.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));

// Cache đơn giản trong RAM (demo). Production: thay bằng query có cache theo kỳ.
let _cache = null;
function db() {
  if (_cache) return _cache;
  const catalog = readJson('catalog.json');
  const reportRows = readJson('report_rows.json');
  const users = readJson('users.json');
  const unitByCode = Object.fromEntries(catalog.units.map((u) => [u.unit_code, u]));
  const prodByCode = Object.fromEntries(catalog.products.map((p) => [p.iit_code, p]));
  const empByCode = Object.fromEntries(users.map((u) => [u.emp_code, u]));
  // gắn tên đơn vị/sản phẩm/nhân viên vào từng dòng để tra cứu nhanh
  const rows = reportRows.map((r) => ({
    ...r,
    unit_name: unitByCode[r.unit_code]?.unit_name,
    product_name: prodByCode[r.iit_code]?.product_name,
    emp_name: empByCode[r.emp_code]?.name,
  }));
  _cache = {
    catalog,
    rows,
    users,
    cst: readJson('cst_rows.json'),
    targets: readJson('targets.json'),
    unitByCode,
    prodByCode,
    empByCode,
  };
  return _cache;
}

const listPeriods = () => db().catalog.periods;
const latestKy = () => db().catalog.latest_ky;
const listUsers = () => db().users;
const findUserByPhone = (phone) => db().users.find((u) => u.phone === phone);
const findUserByCode = (code) => db().empByCode[code];

/**
 * Lọc dòng doanh thu theo kỳ + phạm vi quyền.
 * scope.empCode !== null  => chỉ dòng của nhân viên đó (NV thường).
 */
function getRows({ ky, scope }) {
  let rows = db().rows;
  if (ky) rows = rows.filter((r) => r.ky === ky);
  if (scope && scope.empCode) rows = rows.filter((r) => r.emp_code === scope.empCode);
  return rows;
}

function getCst({ scope }) {
  let rows = db().cst;
  if (scope && scope.empCode) rows = rows.filter((r) => r.emp_code === scope.empCode);
  return rows;
}

// TODO(LIVE): nối /api/targets thật + fallback V_TEM_TARGET_BONUS
function getTargets({ ky, scope }) {
  let t = db().targets;
  if (ky) t = t.filter((x) => x.ky === ky);
  if (scope && scope.empCode) t = t.filter((x) => x.emp_code === scope.empCode);
  return t;
}

module.exports = {
  db,
  listPeriods,
  latestKy,
  listUsers,
  findUserByPhone,
  findUserByCode,
  getRows,
  getCst,
  getTargets,
};
