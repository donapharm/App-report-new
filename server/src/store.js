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
const targetAdmin = require('./targetAdmin');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const readJson = (name, def) => {
  const p = path.join(DATA_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def;
};
const UNALLOCATED_EMP = 'UNALLOCATED';
const UNALLOCATED_LABEL = 'Chưa phân bổ';
const DEFAULT_TARGET_ROSTER_CODES = [
  'DN001', 'DN002', 'DN003', 'DN004', 'DN005', 'DN006', 'DN007', 'DN008', 'DN009', 'DN010', 'DN011', 'DN012',
  'DN016', 'DN017', 'DN018', 'DN019', 'DN021', 'DN022', 'DN023', 'DN024', 'VP004',
];
function isValidEmpCode(v) {
  return /^(DN|VP)\d{3}$/.test(String(v || '').trim().toUpperCase());
}
function normEmpCode(v) { return String(v || '').trim().toUpperCase(); }
function normalizeEmpForReport(r = {}) {
  const code = String(r.emp_code || '').trim().toUpperCase();
  if (!code || isValidEmpCode(code)) return r;
  return {
    ...r,
    raw_emp_code: r.raw_emp_code || r.raw_nv || r.emp_code,
    emp_code: UNALLOCATED_EMP,
    emp_name: UNALLOCATED_LABEL,
    emp_code_invalid: code,
  };
}

// ----- Cache phần dữ liệu MẪU + danh mục (nặng, ít đổi) -----
let _base = null;
function base() {
  if (_base) return _base;
  const catalog = readJson('catalog.json', { units: [], products: [], periods: [], latest_ky: null });
  const users = readJson('users.json', []);
  const unitByCode = Object.fromEntries(catalog.units.map((u) => [u.unit_code, u]));
  const prodByCode = Object.fromEntries(catalog.products.map((p) => [p.iit_code, p]));
  const empByCode = Object.fromEntries(users.map((u) => [u.emp_code, u]));
  const enrich = (r) => {
    const rr = normalizeEmpForReport(r);
    return {
      ...rr,
      unit_name: rr.unit_name || unitByCode[rr.unit_code]?.unit_name,
      product_name: rr.product_name || prodByCode[rr.iit_code]?.product_name,
      emp_name: rr.emp_name || empByCode[rr.emp_code]?.name,
    };
  };
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
function slotDateMeta(slot) {
  const p = path.join(UP_DIR, slot.id + '.json');
  let detailed = false;
  if (fs.existsSync(p)) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      detailed = (raw || []).some((r) => r && (r.date || r.ngay || r.order_date || r.invoice_date || r.created_at));
    } catch { detailed = false; }
  }
  return { dateGranularity: detailed ? 'day' : 'period', canFilterByDay: detailed };
}
function slotRows(slot) {
  const p = path.join(UP_DIR, slot.id + '.json');
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const { enrich } = base();
  const dm = slotDateMeta(slot);
  return raw.map((r) => enrich({
    ...r,
    ky: slot.ky,
    date: r.date || r.ngay || r.order_date || r.invoice_date || r.created_at || slot.dateFrom || slot.ky,
    source_date_from: slot.dateFrom || r.date || null,
    source_date_to: slot.dateTo || r.date || null,
    date_granularity: dm.dateGranularity,
    data_as_of: slot.data_as_of || slot.dataAsOf || slot.uploadedAt || null,
  }));
}

function kySortValue(ky) {
  const [mm, yyyy] = String(ky || '').split('.').map(Number);
  return (yyyy || 0) * 100 + (mm || 0);
}
function latestActiveSlot() {
  return activeSlots().sort((a, b) => kySortValue(a.ky) - kySortValue(b.ky) || String(a.dateTo || '').localeCompare(String(b.dateTo || ''))).at(-1) || null;
}
function kyFromSourceDate(v) {
  const s = String(v || '').trim().toUpperCase();
  const m = s.match(/(\d{1,2})-([A-Z]{3})-(\d{2,4})/);
  if (!m) return null;
  const mon = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }[m[2]];
  if (!mon) return null;
  const y = Number(m[3]);
  return `${mon}.${y < 100 ? 2000 + y : y}`;
}
function cstBaselineCoveredKy(rows) {
  // Hiện baseline CST dump từ app cũ có `source_from_date=01-MAY-26`; theo trace app cũ,
  // baseline sold đã bao gồm các kỳ <= tháng snapshot này, và app cũ merge thêm upload kỳ sau đó.
  // Guard này tránh double-count nếu sau này re-dump baseline mới hơn: chỉ merge slot có ky > baselineCoveredKy.
  const vals = [...new Set((rows || []).map((r) => kyFromSourceDate(r.source_from_date)).filter(Boolean))]
    .sort((a, b) => kySortValue(a) - kySortValue(b));
  return vals.at(-1) || null;
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
// dữ liệu upload chưa có trong baseline DB. Vì cst_real.json là baseline đã dump,
// cần merge các slot upload active có ky > baselineCoveredKy theo đúng khóa app cũ:
// IIT_CODE + DONVI chuẩn hóa. Nếu một key CST baseline bị trùng nhiều dòng thì KHÔNG merge key đó
// để tránh trừ dư; phải điều tra/phân bổ riêng thay vì cộng cùng upload vào nhiều dòng.
function mergeLatestUploadIntoCst(rows) {
  const baselineKy = cstBaselineCoveredKy(rows);
  const slots = activeSlots()
    .filter((s) => !baselineKy || kySortValue(s.ky) > kySortValue(baselineKy))
    .sort((a, b) => kySortValue(a.ky) - kySortValue(b.ky) || String(a.dateTo || '').localeCompare(String(b.dateTo || '')));
  const uploadKyLabel = slots.map((s) => s.ky).join(',');
  const withCstSourceMeta = (r) => ({
    ...r,
    cst_baseline_covered_ky: r.cst_baseline_covered_ky || baselineKy || undefined,
    cst_upload_ky: r.cst_upload_ky || uploadKyLabel || undefined,
  });
  if (!slots.length) return rows.map(withCstSourceMeta);

  const cstKeyCount = new Map();
  for (const r of rows) {
    const k = cstKey(r.iit_code, r.unit_code || r.unit_name);
    cstKeyCount.set(k, (cstKeyCount.get(k) || 0) + 1);
  }
  const upMap = new Map();
  for (const slot of slots) {
    const upRows = slotRows(slot).filter((r) => String(r.route || r.TUYEN || '').toUpperCase() === 'CL');
    for (const r of upRows) {
      const key = cstKey(r.iit_code || r.IIT_CODE, r.unit_code || r.DONVI || r.unit_name);
      if (!key.startsWith('|') && (cstKeyCount.get(key) || 0) <= 1) {
        const cur = upMap.get(key) || { qty: 0, revenue: 0, kys: new Set() };
        cur.qty += Number(r.quantity || r.QUANTITY || 0);
        cur.revenue += Number(r.revenue || r.REVENUE || 0);
        cur.kys.add(slot.ky);
        upMap.set(key, cur);
      }
    }
  }
  if (!upMap.size) return rows.map(withCstSourceMeta);
  return rows.map((r) => {
    const up = upMap.get(cstKey(r.iit_code, r.unit_code || r.unit_name));
    if (!up || !up.qty) return withCstSourceMeta(r);
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
      cst_baseline_covered_ky: baselineKy,
      cst_upload_ky: [...up.kys].join(',') || uploadKyLabel,
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
    const dm = slotDateMeta(s);
    map.set(s.ky, { ky: s.ky, dateFrom: s.dateFrom, dateTo: s.dateTo, source: 'upload', data_as_of: s.data_as_of || s.dataAsOf || s.uploadedAt, sourceSummary: s.sourceSummary || null, ...dm });
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
function currentKyByDate(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${mm}.${d.getFullYear()}`;
}
function lastCompleteKy() {
  const cur = currentKyByDate();
  const ps = periodKys().filter((ky) => kySortValue(ky) < kySortValue(cur));
  return ps.at(-1) || periodKys().at(-1) || base().catalog.latest_ky;
}
function nextKy(ky) {
  const [m0, y0] = String(ky || latestKy()).split('.').map(Number);
  const m = (m0 % 12) + 1;
  const y = m === 1 ? y0 + 1 : y0;
  return `${String(m).padStart(2, '0')}.${y}`;
}
function previousKys(kys = []) {
  const ps = periodKys();
  if (!kys.length) return [];
  const start = ps.indexOf(kys[0]);
  if (start < 0 || start < kys.length) return [];
  return ps.slice(start - kys.length, start);
}

/**
 * Cặp kỳ để SO SÁNH tăng/giảm cho công bằng.
 * Nếu kỳ đang xem chạm THÁNG HIỆN TẠI (chưa đủ ngày) thì tự lùi về kỳ đã HOÀN TẤT
 * gần nhất để so với kỳ trước nó (vd đang xem T07 dở → so T06 với T05).
 * Trả về { curKys, prevKys, curKy, prevKy, adjusted }.
 */
function comparePeriods(kys = []) {
  const list = kys && kys.length ? kys : [latestKy()];
  const ps = periodKys();
  const lastComplete = lastCompleteKy();
  const lastIdx = ps.indexOf(list[list.length - 1]);
  const completeIdx = ps.indexOf(lastComplete);
  const reachesCurrent = lastIdx < 0 || (completeIdx >= 0 && lastIdx > completeIdx);
  const curKys = reachesCurrent ? [lastComplete] : list;
  const prevKys = previousKys(curKys);
  return {
    curKys, prevKys,
    curKy: curKys[curKys.length - 1] || null,
    prevKy: prevKys.length ? prevKys[prevKys.length - 1] : null,
    adjusted: reachesCurrent,
  };
}

const listUsers = () => base().users;
const findUserByPhone = (phone) => base().users.find((u) => u.phone === phone);
const findUserByCode = (code) => base().empByCode[code];
function targetRosterConfig() {
  const cfg = readJson('target_roster.json', null) || {};
  const rawCodes = Array.isArray(cfg.allowed_codes) ? cfg.allowed_codes : DEFAULT_TARGET_ROSTER_CODES;
  const allowedCodes = [...new Set(rawCodes.map(normEmpCode).filter(Boolean))];
  return { ...cfg, allowedCodes, allowedSet: new Set(allowedCodes) };
}
function employeeType(u = {}) {
  if (u.employee_type) return String(u.employee_type).toLowerCase();
  if (String(u.emp_code || '').toUpperCase() === 'VP018') return 'telesale';
  if (u.status === 'Cộng tác') return 'ctv';
  return u.role === 'sale' ? 'sale' : 'other';
}
function hasTarget(u = {}) {
  const code = normEmpCode(u.emp_code);
  if (!code) return false;
  // 0-BIS: Target roster là allowlist CEO chốt (hoặc flag has_target=true),
  // tuyệt đối không suy luận theo role/status để tránh lẫn văn phòng/telesale.
  if (typeof u.has_target === 'boolean') return u.has_target;
  return targetRosterConfig().allowedSet.has(code);
}
function isActiveSalesUser(u = {}) {
  return hasTarget(u);
}
function targetRoster({ scope } = {}) {
  const { allowedCodes } = targetRosterConfig();
  const byCode = base().empByCode;
  let users = allowedCodes.map((code) => byCode[code]).filter((u) => u && hasTarget(u));
  if (scope?.empCode) users = users.filter((u) => normEmpCode(u.emp_code) === normEmpCode(scope.empCode));
  return users.sort((a, b) => String(a.emp_code).localeCompare(String(b.emp_code), 'vi'));
}
function targetRosterCodes({ scope } = {}) { return targetRoster({ scope }).map((u) => u.emp_code); }

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
  rows = rows.map((r) => {
    const code = String(r.emp_code || '').trim().toUpperCase();
    if (!code || isValidEmpCode(code)) return r;
    return { ...r, raw_emp_code: r.raw_emp_code || r.raw_nv || r.emp_code, emp_code: UNALLOCATED_EMP, emp_code_invalid: code };
  });
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
  const codes = targetRosterCodes({ scope });
  let t = targetAdmin.resolveTargets({ ky, empCodes: codes }).map((x) => ({
    emp_code: x.emp_code,
    ky: x.ky,
    target: Number(x.target || 0),
    source: x.source,
    scope: x.scope || 'all',
    target_source: x.source,
    target_source_label: x.source_label || x.source,
    target_source_ky: x.source_ky || null,
    target_reference: !!x.reference,
    target_entry_id: x.id,
    updated_at: x.at,
  }));
  // Khi chưa có dữ liệu thật/admin, giữ fallback mẫu cho môi trường demo cũ.
  if (!activeSlots().length && !t.length) {
    t = base().targets;
    if (ky) t = t.filter((x) => x.ky === ky);
    if (scope && scope.empCode) t = t.filter((x) => x.emp_code === scope.empCode);
  }
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
  periodKys, periodRange, previousKys, comparePeriods,
  currentKyByDate, lastCompleteKy, nextKy,
  getRows, getRowsRange, getCst, getTargets, getTargetsRange, clearCache, empCodesWithData, empCodesWithRows,
  employeeType, hasTarget, isActiveSalesUser, targetRoster, targetRosterCodes, targetRosterConfig,
  isValidEmpCode, UNALLOCATED_EMP, UNALLOCATED_LABEL,
  // giữ tên cũ để nơi khác không vỡ
  db: base,
};
