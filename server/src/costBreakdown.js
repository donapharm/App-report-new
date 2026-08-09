'use strict';
/**
 * MENU "TỔNG HỢP CHI PHÍ C33–C46" (CEO yêu cầu 09/08/2026)
 *
 * CEO: *"tổng hợp các khoản chi theo từng cột từ C33 đến C46 (VẪN TÍNH C44, nhưng
 * nêu rõ) để tao biết tháng này tao chi hết 8% là bao nhiêu tiền, chi tiết ở mỗi
 * cột, mỗi mã đơn vị, nhóm mã đơn vị, mỗi nhân viên, mỗi tuyến. Xuất Excel từ tháng
 * này đến tháng này, chỉ chọn các cột/mã đơn vị/nhóm/NV cần xuất."*
 *
 * ‼ HAI CON SỐ TỔNG khác nhau, tách bạch — KHÔNG gộp làm một:
 *   · `spentWithC44`    = tổng chi TẤT CẢ cột C33→C46 (tiền thực sự đi ra).
 *   · `spentToward C47` = tổng 13 cột KHÔNG C44 — đúng phần bị trừ trong công thức
 *     C47 (file CP_TOTAL V29.9). Chênh lệch giữa hai số = chính tiền C44.
 *
 * ‼ Riêng biệt với menu "Thành tiền C32·C47" (CEO chốt giữ riêng) — dùng chung
 *   nguồn % + doanh thu nhưng là màn khác, không trộn.
 *
 * ‼ Fail-closed: cột nào thiếu % ở cặp nào thì cặp đó KHÔNG đóng góp vào cột đó và
 *   được ĐẾM VÀO `missingPairs` của cột — tổng cột kèm số cặp thiếu, không suy 0.
 *   Kỳ chưa đồng bộ ⇒ nằm trong `missingPeriods`, không lặng lẽ xuất thiếu tháng.
 *
 * Quyền: route chặn CHỈ CEO (requireCeo). Số tiền nhạy cảm ⇒ frontend phủ con mắt
 * (data-sensitive) trên MỌI ô tiền và %.
 */

const persist = require('./persist');
const employeeCost = require('./employeeCost');
const costRatesSync = require('./costRatesSync');
const costAmounts = require('./costAmounts');
const { groupOf } = require('./catalogCostColumnGrants');

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();

// Đủ 14 cột C33→C46. Nhãn theo file CP_TOTAL V29.9. C44 vẫn TÍNH nhưng gắn cờ
// `outsideC47` để mọi màn/file xuất đều nêu rõ nó nằm ngoài công thức C47.
const BREAKDOWN_COLUMNS = Object.freeze([
  { key: 'c33', label: 'C33 CP syt1' },
  { key: 'c34', label: 'C34 CP syt2' },
  { key: 'c35', label: 'C35 CP bhyt' },
  { key: 'c36', label: 'C36 CP ctv/khác' },
  { key: 'c37', label: 'C37 CP bgđ/kd' },
  { key: 'c38', label: 'C38 CP kd1/bgđ' },
  { key: 'c39', label: 'C39 CP bgđ-Ngoài CL' },
  { key: 'c40', label: 'C40 CP.LCB' },
  { key: 'c41', label: 'C41 CP Đặt hàng' },
  { key: 'c42', label: 'C42 CP Kế toán' },
  { key: 'c43', label: 'C43 CP bs/td' },
  { key: 'c44', label: 'C44 CP bs/td Giữ lại 5%', outsideC47: true },
  { key: 'c45', label: 'C45 Lương tăng thêm' },
  { key: 'c46', label: 'C46 Target' },
]);
const COLUMN_KEYS = Object.freeze(BREAKDOWN_COLUMNS.map((column) => column.key));

// Sáu chiều gộp CEO nêu. 'column' không nằm đây vì cột luôn là trục ngang.
const GROUP_BYS = Object.freeze(['employee', 'unit', 'group', 'route', 'contractor', 'priority']);

const normList = (value) => [...new Set((Array.isArray(value) ? value : []).map(upper).filter(Boolean))];

/** Bộ lọc 6 chiều. Danh sách rỗng = không lọc chiều đó. */
function normalizeFilters(filters = {}) {
  return {
    contractors: normList(filters.contractors),
    units: normList(filters.units),
    groups: normList(filters.groups),
    employees: normList(filters.employees),
    routes: normList(filters.routes),
    priorities: normList(filters.priorities),
    columns: normList(filters.columns).map((k) => k.toLowerCase()).filter((k) => COLUMN_KEYS.includes(k)),
  };
}

function pairPasses(meta, filters) {
  if (filters.contractors.length && !filters.contractors.includes(meta.contractor)) return false;
  if (filters.units.length && !filters.units.includes(meta.unitCode)) return false;
  if (filters.groups.length && !filters.groups.includes(meta.group)) return false;
  if (filters.employees.length && !filters.employees.includes(meta.empCode)) return false;
  if (filters.routes.length && !filters.routes.includes(meta.route)) return false;
  if (filters.priorities.length && !filters.priorities.includes(meta.priority)) return false;
  return true;
}

function keyOfDimension(meta, groupBy) {
  switch (groupBy) {
    case 'unit': return meta.unitCode;
    case 'group': return meta.group || 'KHÔNG NHÓM';
    case 'route': return meta.route || '—';
    case 'contractor': return meta.contractor || '—';
    case 'priority': return meta.priority || '—';
    default: return meta.empCode;
  }
}

/**
 * Tổng hợp MỘT hoặc NHIỀU kỳ.
 *
 * `catalogAttrsOf(period)` → Map `UNIT\u001fQLNB` → { contractor, route, priority }:
 * ba thuộc tính lọc nằm ở danh mục, không có trong kho %. Cặp không tra được thì
 * ba chiều đó là '—' và VẪN HIỆN — lọc theo '—' được, không dòng nào biến mất.
 */
function buildBreakdown({ periods = [], filters: rawFilters = {}, groupBy = 'employee', store = persist, revenueRowsOf, catalogAttrsOf = () => new Map() } = {}) {
  const filters = normalizeFilters(rawFilters);
  const dimension = GROUP_BYS.includes(groupBy) ? groupBy : 'employee';
  const activeColumns = filters.columns.length
    ? BREAKDOWN_COLUMNS.filter((column) => filters.columns.includes(column.key))
    : [...BREAKDOWN_COLUMNS];

  const warehouse = store.load(costRatesSync.FILE, {});
  const missingPeriods = [];
  const buckets = new Map();
  // Giá trị từng chiều lọc, thu thập TRƯỚC khi lọc — CEO bỏ lọc còn đường quay lại;
  // thu sau lọc thì chọn một giá trị xong là các lựa chọn khác biến mất.
  const seen = { contractors: new Set(), units: new Set(), groups: new Set(), employees: new Set(), routes: new Set(), priorities: new Set() };
  const emptyCell = () => ({ noVat: 0, withVat: 0, missingPairs: 0 });
  const bucketOf = (key) => {
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        pairCount: 0,
        revenueNoVat: 0,
        revenueWithVat: 0,
        columns: Object.fromEntries(activeColumns.map((column) => [column.key, emptyCell()])),
      });
    }
    return buckets.get(key);
  };

  for (const period of periods) {
    const entry = warehouse[text(period)];
    if (!entry) { missingPeriods.push(text(period)); continue; }
    const attrs = catalogAttrsOf(text(period)) || new Map();
    for (const empCode of Object.keys(entry.employees || {}).sort()) {
      if (filters.employees.length && !filters.employees.includes(upper(empCode))) continue;
      const rates = costAmounts.pairRates(entry.employees[empCode], COLUMN_KEYS);
      const lines = employeeCost.buildRevenueLines(revenueRowsOf(empCode, text(period)), empCode, text(period));
      const revenueByPair = new Map();
      for (const line of lines) {
        const key = `${line.unit}\u001f${line.product}`;
        const agg = revenueByPair.get(key) || { withVat: 0, noVat: 0 };
        agg.withVat += line.revenue;
        agg.noVat += line.revenueBeforeVat;
        revenueByPair.set(key, agg);
      }
      for (const [pairKey, agg] of revenueByPair) {
        const [unitCode, productCode] = pairKey.split('\u001f');
        const attr = attrs.get(pairKey) || {};
        const meta = {
          empCode: upper(empCode),
          unitCode,
          productCode,
          group: groupOf(unitCode),
          contractor: upper(attr.contractor),
          route: upper(attr.route),
          priority: upper(attr.priority),
        };
        seen.employees.add(meta.empCode);
        seen.units.add(meta.unitCode);
        if (meta.group) seen.groups.add(meta.group);
        if (meta.contractor) seen.contractors.add(meta.contractor);
        if (meta.route) seen.routes.add(meta.route);
        if (meta.priority) seen.priorities.add(meta.priority);
        if (!pairPasses(meta, filters)) continue;
        const rate = rates.get(pairKey);
        const bucket = bucketOf(keyOfDimension(meta, dimension));
        bucket.pairCount += 1;
        bucket.revenueNoVat += agg.noVat;
        bucket.revenueWithVat += agg.withVat;
        for (const column of activeColumns) {
          const cell = bucket.columns[column.key];
          const percent = rate && !rate.conflict ? rate.percents[column.key] : null;
          if (percent == null) { cell.missingPairs += 1; continue; }
          cell.noVat += employeeCost.calculateAmount(agg.noVat, percent);
          cell.withVat += employeeCost.calculateAmount(agg.withVat, percent);
        }
      }
    }
  }

  const rows = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      revenueNoVat: Math.round(bucket.revenueNoVat),
      revenueWithVat: Math.round(bucket.revenueWithVat),
      // Hai tổng TÁCH BẠCH — xem chú thích đầu file.
      spentWithC44NoVat: activeColumns.reduce((sum, c) => sum + bucket.columns[c.key].noVat, 0),
      spentWithC44WithVat: activeColumns.reduce((sum, c) => sum + bucket.columns[c.key].withVat, 0),
      spentTowardC47NoVat: activeColumns.filter((c) => !c.outsideC47).reduce((sum, c) => sum + bucket.columns[c.key].noVat, 0),
      spentTowardC47WithVat: activeColumns.filter((c) => !c.outsideC47).reduce((sum, c) => sum + bucket.columns[c.key].withVat, 0),
    }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key), 'vi'));

  const totals = rows.reduce((sum, row) => {
    sum.pairCount += row.pairCount;
    sum.revenueNoVat += row.revenueNoVat;
    sum.revenueWithVat += row.revenueWithVat;
    sum.spentWithC44NoVat += row.spentWithC44NoVat;
    sum.spentWithC44WithVat += row.spentWithC44WithVat;
    sum.spentTowardC47NoVat += row.spentTowardC47NoVat;
    sum.spentTowardC47WithVat += row.spentTowardC47WithVat;
    for (const column of activeColumns) {
      const cell = sum.columns[column.key];
      cell.noVat += row.columns[column.key].noVat;
      cell.withVat += row.columns[column.key].withVat;
      cell.missingPairs += row.columns[column.key].missingPairs;
    }
    return sum;
  }, {
    pairCount: 0, revenueNoVat: 0, revenueWithVat: 0,
    spentWithC44NoVat: 0, spentWithC44WithVat: 0, spentTowardC47NoVat: 0, spentTowardC47WithVat: 0,
    columns: Object.fromEntries(activeColumns.map((column) => [column.key, emptyCell()])),
  });

  return {
    groupBy: dimension,
    periods: periods.map(text),
    missingPeriods,
    filterOptions: Object.fromEntries(Object.entries(seen).map(([key, set]) => [key, [...set].sort((a, b) => a.localeCompare(b, 'vi'))])),
    columns: activeColumns,
    rows,
    totals,
    c44Note: 'C44 được TÍNH vào "Tổng chi có C44" nhưng nằm NGOÀI công thức C47 (file CP_TOTAL V29.9). Chênh lệch hai dòng tổng = chính tiền C44.',
  };
}

/** Dải kỳ 'YYYY-MM' từ..đến (cùng năm hoặc khác năm), tối đa 24 kỳ cho an toàn. */
function periodRange(from, to) {
  const parse = (v) => { const m = /^(\d{4})-(\d{2})$/.exec(text(v)); return m ? { y: +m[1], m: +m[2] } : null; };
  const a = parse(from); const b = parse(to);
  if (!a || !b) return [];
  const out = [];
  let { y, m } = a;
  while ((y < b.y || (y === b.y && m <= b.m)) && out.length < 24) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

module.exports = { BREAKDOWN_COLUMNS, COLUMN_KEYS, GROUP_BYS, normalizeFilters, buildBreakdown, periodRange };
