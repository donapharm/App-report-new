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

function kySortValue(ky) {
  const [mm, yyyy] = String(ky || '').split('.').map(Number);
  return (yyyy || 0) * 100 + (mm || 0);
}
function latestActiveSlot() {
  return activeSlots().sort((a, b) => kySortValue(a.ky) - kySortValue(b.ky) || String(a.dateTo || '').localeCompare(String(b.dateTo || ''))).at(-1) || null;
}
function normCstUnit(v) {
  const s = String(v || '').trim();
  const merged = s === '001.BVĐK Đồng Nai-KHU C' ? '001.BVĐK Đồng Nai' : s;
  // Dùng mã 3 số đầu để chống lệch format "002" vs "002.BVĐK...".
  const m = merged.match(/^(\d{3})\b|^(\d{3})\./);
  return (m && (m[1] || m[2])) || merged.toUpperCase();
}
function normCstIit(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }
function cstKey(iit, unit) { return `${normCstIit(iit)}|${normCstUnit(unit)}`; }

// App cũ tính CST = V_TEMP_PHARMA/GIVEN_QUANTITY - SALES_REPORT DB, rồi cộng thêm
// dữ liệu upload kỳ hiện tại chưa có trong DB. Vì cst_real.json là baseline đã dump,
// cần merge slot upload active mới nhất theo đúng khóa app cũ: IIT_CODE + DONVI chuẩn hóa.
function mergeLatestUploadIntoCst(rows) {
  const slot = latestActiveSlot();
  if (!slot) return rows;
  const upRows = slotRows(slot).filter((r) => String(r.route || r.TUYEN || '').toUpperCase() === 'CL');
  if (!upRows.length) return rows;
  const upMap = new Map();
  for (const r of upRows) {
    const key = cstKey(r.iit_code || r.IIT_CODE, r.unit_code || r.DONVI || r.unit_name);
    if (!key.startsWith('|')) {
      const cur = upMap.get(key) || { qty: 0, revenue: 0 };
      cur.qty += Number(r.quantity || r.QUANTITY || 0);
      cur.revenue += Number(r.revenue || r.REVENUE || 0);
      upMap.set(key, cur);
    }
  }
  if (!upMap.size) return rows;
  return rows.map((r) => {
    const up = upMap.get(cstKey(r.iit_code, r.unit_code || r.unit_name));
    if (!up || !up.qty) return r;
    const baseSold = Number(r.sold_qty || 0);
    const sold = baseSold + up.qty;
    const bidQty = Number(r.bid_qty_initial || 0);
    const remain = Math.max(0, bidQty - sold);
    const soldAmount = Number(r.sold_amount || 0) + Number(up.revenue || 0);
    const bidPrice = Number(r.bid_price || 0);
    return {
      ...r,
      sold_qty: sold,
      remain_qty: remain,
      remain_pct: bidQty > 0 ? +(remain / bidQty * 100).toFixed(1) : 0,
      sold_amount: soldAmount || sold * bidPrice,
      remain_amount: remain * bidPrice,
      sale_price: sold ? +((soldAmount || sold * bidPrice) / sold).toFixed(2) : Number(r.sale_price || 0),
      cst_baseline_sold_qty: baseSold,
      cst_upload_ky: slot.ky,
      cst_upload_qty: up.qty,
    };
  });
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
function periodKys() { return listPeriods().map((p) => p.ky); }
function periodRange(from, to) {
  const ps = periodKys();
  const a = ps.indexOf(from);
  const b = ps.indexOf(to);
  if (a < 0 || b < 0) return [];
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return ps.slice(lo, hi + 1);
}
function previousKys(kys = []) {
  const ps = periodKys();
  if (!kys.length) return [];
  const start = ps.indexOf(kys[0]);
  if (start < 0 || start < kys.length) return [];
  return ps.slice(start - kys.length, start);
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
function empCodesWithRows({ kys, scope } = {}) {
  const set = new Set();
  for (const r of getRowsRange({ kys, scope })) if (r.emp_code) set.add(r.emp_code);
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
function getRowsRange({ kys, scope }) {
  const list = Array.isArray(kys) && kys.length ? kys : [latestKy()];
  return list.flatMap((ky) => getRows({ ky, scope }));
}

function getCst({ scope }) {
  // Khi đã có dữ liệu thật (runtime import), ưu tiên cst_real.json thay dữ liệu mẫu.
  let rows = readJson('cst_real.json', null) || base().cst;
  rows = mergeLatestUploadIntoCst(rows);
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
function getTargetsRange({ kys, scope }) {
  const list = Array.isArray(kys) && kys.length ? kys : [latestKy()];
  return list.flatMap((ky) => getTargets({ ky, scope }));
}

// Cho phép xoá cache khi cần (VD sau khi nạp danh mục mới)
function clearCache() { _base = null; }

module.exports = {
  base, listPeriods, latestKy, listUsers, findUserByPhone, findUserByCode,
  periodKys, periodRange, previousKys,
  getRows, getRowsRange, getCst, getTargets, getTargetsRange, clearCache, empCodesWithData, empCodesWithRows,
  // giữ tên cũ để nơi khác không vỡ
  db: base,
};
