/**
 * store.js — LỚP NGUỒN DỮ LIỆU.
 *
 * Thứ tự ưu tiên nguồn doanh thu (giống quy tắc App Report cũ):
 *   1) Slot UPLOAD đang active (dữ liệu CEO tải lên)  ← nguồn chính, THẬT
 *   2) ORDS/Lumos (nếu bật env, dùng khi kỳ chưa có upload)  ← fallback, bật trên server
 *   3) Dữ liệu MẪU ẩn danh (server/data/*.json)  ← để demo khi chưa có gì
 *
 * Slot đọc MỚI mỗi lần gọi (file nhỏ) nên upload xong báo cáo cập nhật ngay,
 * không cần restart server.
 */
const fs = require('fs');
const path = require('path');
const ords = require('./ords');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const readJson = (name, def) => {
  const p = path.join(DATA_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def;
};

// ----- Cache phần dữ liệu MẪU + danh mục (nặng, ít đổi) -----
let _base = null;
function base() {
  if (_base) return _base;
  const catalog = readJson('catalog.json', { units: [], products: [], periods: [], latest_ky: null });
  const users = readJson('users.json', []);
  const unitByCode = Object.fromEntries(catalog.units.map((u) => [u.unit_code, u]));
  const prodByCode = Object.fromEntries(catalog.products.map((p) => [p.iit_code, p]));
  const empByCode = Object.fromEntries(users.map((u) => [u.emp_code, u]));
  const enrich = (r) => ({
    ...r,
    unit_name: r.unit_name || unitByCode[r.unit_code]?.unit_name,
    product_name: r.product_name || prodByCode[r.iit_code]?.product_name,
    emp_name: empByCode[r.emp_code]?.name,
  });
  _base = {
    catalog,
    sampleRows: readJson('report_rows.json', []).map(enrich),
    users,
    cst: readJson('cst_rows.json', []),
    targets: readJson('targets.json', []),
    unitByCode, prodByCode, empByCode, enrich,
  };
  return _base;
}

// ----- Đọc các slot upload đang active (đọc mới mỗi lần) -----
function activeSlots() {
  return readJson('upload_slots.json', []).filter((s) => s.active);
}
function slotRows(slot) {
  const p = path.join(UP_DIR, slot.id + '.json');
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const { enrich } = base();
  return raw.map((r) => enrich({ ...r, ky: slot.ky, date: slot.dateFrom || slot.ky }));
}

/** Toàn bộ dòng doanh thu: slot active ghi đè kỳ tương ứng; kỳ còn lại dùng mẫu. */
function allRows() {
  const b = base();
  const slots = activeSlots();
  if (!slots.length) return b.sampleRows;
  const slotKys = new Set(slots.map((s) => s.ky));
  const fromSlots = slots.flatMap(slotRows);
  const fromSample = b.sampleRows.filter((r) => !slotKys.has(r.ky));
  return fromSample.concat(fromSlots);
}

/** Danh sách kỳ = kỳ mẫu + kỳ từ slot upload (slot ưu tiên), sắp theo thời gian. */
function listPeriods() {
  const b = base();
  const map = new Map(b.catalog.periods.map((p) => [p.ky, p]));
  for (const s of activeSlots()) {
    map.set(s.ky, { ky: s.ky, dateFrom: s.dateFrom, dateTo: s.dateTo, source: 'upload' });
  }
  return [...map.values()].sort((a, b2) => ((a.dateFrom || a.ky) < (b2.dateFrom || b2.ky) ? -1 : 1));
}
function latestKy() {
  const ps = listPeriods();
  return ps.length ? ps[ps.length - 1].ky : base().catalog.latest_ky;
}

const listUsers = () => base().users;
const findUserByPhone = (phone) => base().users.find((u) => u.phone === phone);
const findUserByCode = (code) => base().empByCode[code];

/**
 * Danh sách mã NV THỰC SỰ có doanh thu (đúng danh sách App Report), trong phạm vi quyền.
 * - Có `ky`: chỉ NV có bán trong KỲ ĐÓ (tránh hiện NV không bán kỳ này).
 * - Không `ky`: NV có bán ở bất kỳ kỳ nào.
 */
function empCodesWithData({ ky, scope } = {}) {
  const set = new Set();
  const periods = ky ? [{ ky }] : listPeriods();
  for (const p of periods) for (const r of getRows({ ky: p.ky, scope })) if (r.emp_code) set.add(r.emp_code);
  return [...set];
}

/**
 * Lọc dòng doanh thu theo kỳ + phạm vi quyền.
 * scope.empCode !== null => chỉ dòng của nhân viên đó (NV thường).
 * Nếu kỳ không có upload/mẫu và bật ORDS -> thử ORDS (đồng bộ, đã cache).
 */
function getRows({ ky, scope }) {
  let rows = allRows();
  if (ky) rows = rows.filter((r) => r.ky === ky);
  // Fallback ORDS khi kỳ trống và có cấu hình (chạy trên server)
  if (ky && rows.length === 0 && ords.isEnabled()) {
    rows = base().sampleRows.length ? rows : ords.getRowsSyncCached(ky);
  }
  if (scope && scope.empCode) rows = rows.filter((r) => r.emp_code === scope.empCode);
  return rows;
}

function getCst({ scope }) {
  // Khi đã có dữ liệu thật (runtime import), ưu tiên cst_real.json thay dữ liệu mẫu.
  let rows = readJson('cst_real.json', null) || base().cst;
  if (scope && scope.empCode) {
    const emp = String(scope.empCode).trim().toUpperCase();
    rows = rows.filter((r) => String(r.emp_code || '').split(',').map((x) => x.trim().toUpperCase()).includes(emp));
  }
  return rows;
}

// TODO(LIVE): fallback ORDS V_TEM_TARGET_BONUS khi kỳ chưa nhập target.
// Khi ĐÃ có dữ liệu THẬT (slot upload active): KHÔNG dùng target mẫu — chỉ dùng
// target thật đã import (data/targets_real.json). Chưa import -> rỗng (target cũ = 0, trung thực).
function getTargets({ ky, scope }) {
  const real = activeSlots().length > 0;
  let t = real ? readJson('targets_real.json', []) : base().targets;
  if (ky) t = t.filter((x) => x.ky === ky);
  if (scope && scope.empCode) t = t.filter((x) => x.emp_code === scope.empCode);
  return t;
}

// Cho phép xoá cache khi cần (VD sau khi nạp danh mục mới)
function clearCache() { _base = null; }

module.exports = {
  base, listPeriods, latestKy, listUsers, findUserByPhone, findUserByCode,
  getRows, getCst, getTargets, clearCache, empCodesWithData,
  // giữ tên cũ để nơi khác không vỡ
  db: base,
};
