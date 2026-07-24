/**
 * analytics.js — Tổng hợp doanh thu / cơ số thầu / target.
 * Mọi số liệu tính ở đây (không để LLM/frontend tự tính).
 */
const store = require('./store');
const cstSequence = require('./cstSequence');
const productSearch = require('./productSearch');

const VAT_DIVISOR = 1.05; // doanh thu trước VAT = sau VAT / 1.05

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const DONA_GROUP_CONTRACTORS = new Set(['DONA', 'AFP']);
const pipeList = (value, { upper = false } = {}) => String(value || '').split('|')
  .map((s) => s.trim()).filter(Boolean).map((s) => upper ? s.toUpperCase() : s);
function companyGroupOf(row = {}) {
  const contractor = String(row.contractor_code || row.contractor || '').trim().toUpperCase();
  const contractorWords = contractor.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  // Dữ liệu lịch sử dùng 01.DONAPHARM / 02.AFP PHARMA hoặc tên công ty đầy đủ,
  // còn nguồn materialize hiện tại dùng DONA / AFP. Tất cả đều là cùng hai nhà thầu.
  const isDonaAlias = DONA_GROUP_CONTRACTORS.has(contractor)
    || /(^| )donapharm($| )/.test(contractorWords)
    || /(^| )afp($| )/.test(contractorWords);
  if (isDonaAlias) return 'dona';
  if (contractor || String(row.source || '').trim().toUpperCase() === 'APP_WEB_PARTNER') return 'partner';
  return '';
}
function unitGroupOf(row = {}) {
  const value = String(row.unit_code || row.unit_name || '').trim();
  return value.match(/^(\d{3})\./)?.[1] || '';
}
function normalizeUnitCode(value = '') {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}
function selectedEmployeeCodes(filters = {}) { return pipeList(filters.emp, { upper: true }); }
// Target chỉ được giao theo nhân viên. Không lấy doanh thu của một lát cắt tuyến/group/đơn vị
// chia cho target toàn nhân viên vì sẽ tạo tỷ lệ sai về mặt quản trị.
function targetFiltersComparable(filters = {}) {
  return !['route', 'companyGroup', 'unitGroup', 'unit'].some((key) => !!filters[key]);
}
function kyParts(ky) {
  const [mm, yyyy] = String(ky || '').split('.').map(Number);
  return { mm, yyyy };
}
function isCurrentKy(ky, d = new Date()) {
  const { mm, yyyy } = kyParts(ky);
  return mm === d.getMonth() + 1 && yyyy === d.getFullYear();
}
function targetPacingMeta(ky, d = new Date()) {
  const { mm, yyyy } = kyParts(ky);
  const daysInMonth = mm && yyyy ? new Date(yyyy, mm, 0).getDate() : 30;
  const current = isCurrentKy(ky, d);
  const daysElapsed = current ? Math.min(d.getDate(), daysInMonth) : daysInMonth;
  return { isCurrent: current, daysElapsed, daysInMonth, factor: daysInMonth ? daysElapsed / daysInMonth : 1 };
}
function targetCompareValue(targetFull, ky, d = new Date()) {
  const meta = targetPacingMeta(ky, d);
  return Math.round(Number(targetFull || 0) * (meta.isCurrent ? meta.factor : 1));
}

function groupSum(rows, keyField, labelField) {
  const map = new Map();
  for (const r of rows) {
    const key = r[keyField];
    if (key == null) continue;
    const cur = map.get(key) || { key, label: r[labelField] || key, revenue: 0, quantity: 0, rows: 0 };
    cur.revenue += r.revenue || 0;
    cur.quantity += r.quantity || 0;
    cur.rows += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
// Gộp mã đơn vị để đếm ĐÚNG số đơn vị: bỏ tiền tố "NT-" (nhà thuốc của cùng bệnh viện)
// → "001.BVĐK Thống Nhất" và "001.NT-BVĐK Thống Nhất" tính LÀ 1 đơn vị.
// KHÔNG gộp theo số đầu: "033.PKĐK An Long Khánh" vs "033.PKĐK An Long Thành" là 2 PK khác nhau.
function baseUnitKey(u) {
  const s = String(u || '').trim();
  const stripped = s.replace(/^(\s*\d+[.\-]?\s*)NT[\s.\-]+/i, '$1');
  return norm(stripped).replace(/\s+/g, ' ').trim() || norm(s);
}
// Lọc gói thầu chọn NHIỀU: tham số 'bid' có thể là chuỗi nối bằng '|'. Rỗng = mọi gói.
function bidMatch(rowBid, bidParam) {
  const list = String(bidParam || '').split('|').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  const rb = String(rowBid || '');
  return list.some((b) => rb.includes(b));
}
function applyFilters(rows, f = {}) {
  const q = norm(f.q || '');
  const from = f.dateFrom ? String(f.dateFrom).slice(0, 10) : '';
  const to = f.dateTo ? String(f.dateTo).slice(0, 10) : '';
  // emp có thể là 1 mã hoặc NHIỀU mã nối bằng '|' (xuất/lọc nhiều NV cùng lúc).
  const empList = selectedEmployeeCodes(f);
  const routeList = pipeList(f.route, { upper: true });
  const companyGroupList = pipeList(f.companyGroup);
  const unitGroup = String(f.unitGroup || '').trim().replace(/\.$/, '');
  // DataHub is authoritative for group membership. A selected group without a
  // validated member list must fail closed instead of falling back to prefixes.
  const unitGroupMembers = new Set((Array.isArray(f.unitGroupMembers) ? f.unitGroupMembers : []).map(normalizeUnitCode).filter(Boolean));
  return rows.filter((r) => {
    if (empList.length && !empList.includes(String(r.emp_code || '').trim().toUpperCase())) return false;
    // Tỉnh/thành từ các nguồn có thể khác hoa/thường hoặc dấu ("Đồng Nai"/"ĐỒNG NAI").
    // So theo khóa chuẩn hóa để bộ lọc không làm mất dữ liệu thực tế.
    if (f.province && norm(r.province) !== norm(f.province)) return false;
    if (f.unit && r.unit_code !== f.unit) return false;
    if (unitGroup && (!unitGroupMembers.size || !unitGroupMembers.has(normalizeUnitCode(r.unit_code)))) return false;
    if (companyGroupList.length && !companyGroupList.includes(companyGroupOf(r))) return false;
    if (f.group && String(r.c14 || '') !== String(f.group)) return false;
    if (f.product && r.iit_code !== f.product) return false;
    if (routeList.length && !routeList.includes(String(r.route || '').toUpperCase())) return false;
    if (f.priority && r.priority !== f.priority) return false;
    if (f.contractor && r.contractor_code !== f.contractor) return false;
    if (f.bid && !bidMatch(r.bid_package, f.bid)) return false;
    if (from || to) {
      const granular = r.date_granularity === 'day';
      if (granular) {
        const d = String(r.date || '').slice(0, 10);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      } else {
        // Legacy 01–06 imports only have period-level totals. Do not fake day allocation:
        // include them only when the requested date range covers the whole source period.
        const a = String(r.source_date_from || r.date || '').slice(0, 10);
        const b = String(r.source_date_to || r.date || '').slice(0, 10);
        if ((from && a && from > a) || (to && b && to < b)) return false;
      }
    }
    if (q) {
      const hay = norm([r.emp_code, r.emp_name, r.unit_code, r.unit_name, r.iit_code, r.product_name, r.c14, companyGroupOf(r), r.contractor_code, r.contractor_name, r.bid_package, r.priority].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const normKys = ({ ky, kys }) => (Array.isArray(kys) && kys.length ? kys : [ky || store.latestKy()]);
const overviewCache = new Map();
const OVERVIEW_CACHE_MS = 60 * 1000;
function clearOverviewCache() { overviewCache.clear(); }

/** KPI tổng quan cho 1 kỳ hoặc nhiều kỳ trong phạm vi quyền. */
function overviewKpis({ ky, kys, scope, label, filters = {} }) {
  const list = normKys({ ky, kys });
  const cacheKey = JSON.stringify({ data: store.dashboardDataSignature(), list, empCode: scope?.empCode || null, label: label || '', filters });
  const cached = overviewCache.get(cacheKey);
  if (cached && Date.now() - cached.at < OVERVIEW_CACHE_MS) return cached.value;
  const rows = applyFilters(store.getRowsRange({ kys: list, scope }), filters);
  const revenue = sum(rows, (r) => r.revenue);
  const empFilter = new Set(selectedEmployeeCodes(filters));
  const comparableTarget = targetFiltersComparable(filters);
  const targets = store.getTargetsRange({ kys: list, scope }).filter((t) => !empFilter.size || empFilter.has(String(t.emp_code || '').toUpperCase()));
  const targetTotal = comparableTarget ? sum(targets, (t) => t.target) : null;
  const revenueBeforeVat = revenue / VAT_DIVISOR;
  // DIRECTIVE_TARGET_KPI: KPI chính so với target CẢ THÁNG, không dùng pacing làm mẫu số.
  const pctTarget = comparableTarget && targetTotal > 0 ? +(revenueBeforeVat / targetTotal * 100).toFixed(1) : null;
  const targetByEmp = {};
  for (const t of targets) targetByEmp[t.emp_code] = (targetByEmp[t.emp_code] || 0) + Number(t.target || 0);
  const revenueBeforeVatByEmp = {};
  for (const r of rows) revenueBeforeVatByEmp[r.emp_code] = (revenueBeforeVatByEmp[r.emp_code] || 0) + Number(r.revenue || 0) / VAT_DIVISOR;
  const empTarget = { achieved: 0, total: 0 };
  for (const u of store.targetRoster({ scope }).filter((x) => !empFilter.size || empFilter.has(String(x.emp_code || '').toUpperCase()))) {
    const empCode = u.emp_code;
    const target = Number(targetByEmp[empCode] || 0);
    if (target <= 0) continue;
    const empRevBeforeVat = revenueBeforeVatByEmp[empCode] || 0;
    empTarget.total += 1;
    if (empRevBeforeVat >= target) empTarget.achieved += 1;
  }
  const cstLowCount = cstTable({ scope, filters }).filter((r) => Number(r.remain_pct || 0) < 10).length;

  // so với kỳ liền trước cùng độ dài (MoM/range-over-range)
  let momPct = null;
  const prevKys = store.previousKys(list);
  if (prevKys.length === list.length) {
    const prevRev = sum(applyFilters(store.getRowsRange({ kys: prevKys, scope }), filters), (r) => r.revenue);
    if (prevRev > 0) momPct = +(((revenue - prevRev) / prevRev) * 100).toFixed(1);
  }
  const value = {
    ky: list[list.length - 1],
    kys: list,
    label,
    revenue,
    revenueBeforeVat: Math.round(revenueBeforeVat),
    targetTotal,
    targetCompareTotal: targetTotal,
    pctTarget,
    targetComparable: comparableTarget,
    empTarget,
    cstLowCount,
    momPct,
    empCount: new Set(rows.map((r) => r.emp_code)).size,
    unitCount: new Set(rows.map((r) => baseUnitKey(r.unit_code || r.unit_name))).size,
    productCount: new Set(rows.map((r) => r.iit_code)).size,
    rowCount: rows.length,
  };
  overviewCache.set(cacheKey, { at: Date.now(), value });
  if (overviewCache.size > 200) overviewCache.clear();
  return value;
}

/** Doanh thu drill-down: 'emp' | 'unit' | 'product'. */
function revenueBreakdown({ ky, kys, scope, dimension, filterEmp, filterUnit, filters }) {
  let rows = store.getRowsRange({ kys: normKys({ ky, kys }), scope });
  if (filterEmp) rows = rows.filter((r) => r.emp_code === filterEmp);
  if (filterUnit) rows = rows.filter((r) => r.unit_code === filterUnit);
  rows = applyFilters(rows, filters);
  if (dimension === 'unit') return groupSum(rows, 'unit_code', 'unit_name');
  if (dimension === 'product') return groupSum(rows, 'iit_code', 'product_name');
  return groupSum(rows, 'emp_code', 'emp_name'); // mặc định theo NV
}

/** Bảng cơ số thầu + cảnh báo ngưỡng. */
function cstTable({ scope, remainPctMax, remainPctMin, remainPctLt, bidPackage, filters }) {
  // Scope is enforced by store before sequence classification. This is important:
  // an employee must never receive sibling metadata from outside their scope.
  let rows = cstSequence.classifyCstSequence(store.getCst({ scope }));
  if (bidPackage) rows = rows.filter((r) => bidMatch(r.bid_package, bidPackage));
  if (filters?.emp) {
    const emps = String(filters.emp).split('|').map((x) => x.trim().toUpperCase()).filter(Boolean);
    rows = rows.filter((r) => {
      const rowEmps = [r.emp_code, r.sales_emps].flatMap((v) => String(v || '').split(',')).map((x) => x.trim().toUpperCase()).filter(Boolean);
      return emps.some((emp) => rowEmps.includes(emp));
    });
  }
  if (filters?.province) rows = rows.filter((r) => r.province === filters.province);
  if (filters?.unit) rows = rows.filter((r) => r.unit_code === filters.unit || r.unit_name === filters.unit);
  if (filters?.unitGroup) {
    const members = new Set((Array.isArray(filters.unitGroupMembers) ? filters.unitGroupMembers : []).map(normalizeUnitCode).filter(Boolean));
    rows = rows.filter((r) => members.size && members.has(normalizeUnitCode(r.unit_code)));
  }
  if (filters?.companyGroup) {
    const groups = pipeList(filters.companyGroup);
    rows = rows.filter((r) => groups.includes(companyGroupOf(r)));
  }
  if (filters?.group) rows = rows.filter((r) => String(r.c14 || '') === String(filters.group));
  if (filters?.product) rows = rows.filter((r) => r.iit_code === filters.product);
  if (filters?.route) {
    const routes = pipeList(filters.route, { upper: true });
    rows = rows.filter((r) => routes.includes(String(r.route || '').trim().toUpperCase()));
  }
  if (filters?.priority) rows = rows.filter((r) => r.priority === filters.priority);
  // "empty" now means a full CST code that is actually actionable. Full codes
  // waiting behind a current sibling are deliberately not employee action items.
  if (filters?.status === 'empty') rows = rows.filter((r) => r.cst_sequence?.state === cstSequence.STATES.ACTIONABLE);
  if (filters?.status === 'queued') rows = rows.filter((r) => r.cst_sequence?.state === cstSequence.STATES.QUEUED);
  if (filters?.status === 'needs_confirmation') rows = rows.filter((r) => r.cst_sequence?.state === cstSequence.STATES.NEEDS_CONFIRMATION);
  if (filters?.q) rows = filterCstSearch(rows, filters.q);
  if (remainPctMax != null) rows = rows.filter((r) => r.remain_pct <= remainPctMax);
  if (remainPctMin != null) rows = rows.filter((r) => r.remain_pct >= remainPctMin);
  if (remainPctLt != null) rows = rows.filter((r) => r.remain_pct < remainPctLt);
  return rows.sort((a, b) => a.remain_pct - b.remain_pct);
}

function filterCstSearch(rows, query) {
  return productSearch.filterProductRows(rows, query);
}

module.exports = { VAT_DIVISOR, sum, overviewKpis, revenueBreakdown, cstTable, filterCstSearch, groupSum, applyFilters, baseUnitKey, companyGroupOf, unitGroupOf, normalizeUnitCode, selectedEmployeeCodes, targetFiltersComparable, isCurrentKy, targetPacingMeta, targetCompareValue, clearOverviewCache };
