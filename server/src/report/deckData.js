/**
 * Phase 1 of the CEO deep-sales deck: build grounded FACTS only (no rendering).
 * All revenue rows are read with CEO/company scope. Employee-only scope is never
 * used here; employee breakdowns are calculated from the same company row set.
 */
const store = require('../store');
const analytics = require('../analytics');
const diemXu = require('../diemXu');
const salesReport = require('../salesReport');

const VALID_KINDS = new Set(['week', 'month']);
const CANONICAL_ROUTES = new Set(['CL', 'NCL', 'NT']);
const UNGROUPED = 'Chưa phân nhóm';
const UNCLASSIFIED = 'Chưa phân loại';

const number = (v) => Number(v || 0);
const text = (v) => String(v == null ? '' : v).trim();
const upper = (v) => text(v).toUpperCase();
const norm = (v) => text(v).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
const sumRevenue = (rows) => analytics.sum(rows, (row) => number(row.revenue));
const pctOf = (value, total) => total ? value / total * 100 : 0;

function parseDate(value) {
  const [y, m, d] = text(value).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function daysInclusive(from, to) {
  const out = [];
  for (let d = parseDate(from), end = parseDate(to); d <= end; d.setDate(d.getDate() + 1)) out.push(ymd(d));
  return out;
}
function monthLabel(date) {
  const d = parseDate(date);
  return `T${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function isMonthEnd(date) {
  const d = parseDate(date);
  return d.getDate() === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// Kept equivalent to salesReport.comparisonMeta without changing salesReport's API.
function comparisonMeta(kind, ranges) {
  const fullVsFull = kind === 'month' && isMonthEnd(ranges.monthRange.to);
  const current = parseDate(ranges.monthRange.to);
  const factor = fullVsFull ? 1 : current.getDate() / new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
  const previousMonth = monthLabel(ranges.prevRange.to);
  return {
    factor,
    fullVsFull,
    label: fullVsFull ? `So với ${previousMonth}` : `So với nhịp cùng kỳ ${previousMonth}`,
    shortLabel: fullVsFull ? previousMonth : `nhịp ${previousMonth}`,
  };
}

function rowsInRange(range) {
  const kys = diemXu.kysSpanning(range.from, range.to);
  const rows = store.getRowsRange({ kys, scope: {} }); // CEO/company scope only.
  return analytics.applyFilters(rows, { dateFrom: range.from, dateTo: range.to });
}

function catalogIndexes() {
  const catalog = store.base().catalog || {};
  return {
    units: new Map((catalog.units || []).map((x) => [text(x.unit_code), x])),
    products: new Map((catalog.products || []).map((x) => [text(x.iit_code), x])),
  };
}

function canonicalRoute(row, indexes) {
  const unit = indexes.units.get(text(row.unit_code)) || {};
  const explicit = upper(row.line || unit.line);
  if (CANONICAL_ROUTES.has(explicit)) return explicit;
  const rawRoute = text(row.route || unit.route);
  const route = upper(rawRoute);
  if (CANONICAL_ROUTES.has(route)) return route;
  if (!rawRoute || ['#N/A', 'N/A', 'NA', 'NULL', '—', '-'].includes(route)) return UNCLASSIFIED;
  return rawRoute; // Keep a real unmapped live label rather than inventing CL/NCL/NT.
}

function sourceGroup(row) {
  const hay = norm(`${row.contractor_code || ''} ${row.contractor_name || ''}`);
  return /(^|\s|[^a-z0-9])(dona|donapharm|afp)(\s|[^a-z0-9]|$)/.test(hay) ? 'Group-Dona' : 'Đối tác';
}

function customerType(row, indexes) {
  const unit = indexes.units.get(text(row.unit_code)) || {};
  const explicit = text(row.customer_type || row.unit_type || unit.customer_type || unit.type);
  if (explicit) return explicit;
  const value = norm(`${row.unit_code || ''} ${row.unit_name || unit.unit_name || ''}`);
  if (/(^|[ ._-])(nt)([ ._-]|$)|nha thuoc|quay thuoc/.test(value)) return 'Nhà thuốc';
  if (/(^|[ ._-])(ttyt|tt)([ ._-]|$)|trung tam y te/.test(value)) return 'TTYT';
  if (/(^|[ ._-])pkdk([ ._-]|$)|phong kham da khoa/.test(value)) return 'PKĐK';
  if (/(^|[ ._-])pk([ ._-]|$)|phong kham/.test(value)) return 'Phòng khám';
  if (/(^|[ ._-])bvdk([ ._-]|$)|benh vien da khoa/.test(value)) return 'BVĐK';
  if (/(^|[ ._-])bv([ ._-]|$)|benh vien/.test(value)) return 'Bệnh viện';
  return UNCLASSIFIED;
}

function therapyGroup(row, indexes) {
  const product = indexes.products.get(text(row.iit_code)) || {};
  return text(row.c14 || product.c14 || product.group || product.therapy) || UNGROUPED;
}

function groupRows(rows, keyFn, labelFn = keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = text(keyFn(row)) || '—';
    const current = groups.get(key) || { key, label: text(labelFn(row)) || key, revenue: 0, quantity: 0, rowCount: 0 };
    current.revenue += number(row.revenue);
    current.quantity += number(row.quantity);
    current.rowCount += 1;
    groups.set(key, current);
  }
  const total = sumRevenue(rows);
  return [...groups.values()].sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label, 'vi'))
    .map((item, index) => ({ ...item, rank: index + 1, pct: pctOf(item.revenue, total) }));
}

function compareGroups(currentRows, previousRows, keyFn, labelFn = keyFn, previousScale = 1, limit = 12) {
  const current = new Map(groupRows(currentRows, keyFn, labelFn).map((x) => [x.key, x]));
  const previous = new Map(groupRows(previousRows, keyFn, labelFn).map((x) => [x.key, x]));
  const compared = [...new Set([...current.keys(), ...previous.keys()])].map((key) => {
    const cur = current.get(key);
    const prev = previous.get(key);
    const curRevenue = cur?.revenue || 0;
    const prevRevenue = (prev?.revenue || 0) * previousScale;
    return {
      key,
      label: cur?.label || prev?.label || key,
      current: curRevenue,
      previous: prevRevenue,
      diff: curRevenue - prevRevenue,
      pctChange: prevRevenue ? (curRevenue - prevRevenue) / prevRevenue * 100 : null,
      isNew: curRevenue > 0 && prevRevenue === 0,
      isDormant: curRevenue === 0 && prevRevenue > 0,
    };
  });
  return {
    all: compared.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
    up: compared.filter((x) => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, limit),
    down: compared.filter((x) => x.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, limit),
    new: compared.filter((x) => x.isNew).sort((a, b) => b.current - a.current).slice(0, limit),
    dormant: compared.filter((x) => x.isDormant).sort((a, b) => b.previous - a.previous).slice(0, limit),
  };
}

function dailyBars(rows, range) {
  const byDate = new Map(daysInclusive(range.from, range.to).map((date) => [date, 0]));
  for (const row of rows) {
    const date = text(row.date).slice(0, 10);
    if (byDate.has(date)) byDate.set(date, byDate.get(date) + number(row.revenue));
  }
  const max = Math.max(0, ...byDate.values());
  return [...byDate].map(([date, revenue]) => ({ date, revenue, pctOfMax: max ? revenue / max * 100 : 0 }));
}

function routeBreakdown(rows, previousRows, indexes, previousScale) {
  const current = groupRows(rows, (r) => canonicalRoute(r, indexes));
  const previous = new Map(groupRows(previousRows, (r) => canonicalRoute(r, indexes)).map((x) => [x.key, x.revenue * previousScale]));
  const keys = [...new Set([...current.map((x) => x.key), ...previous.keys()])];
  const currentMap = new Map(current.map((x) => [x.key, x]));
  const total = sumRevenue(rows);
  return keys.map((key) => {
    const cur = currentMap.get(key) || { key, label: key, revenue: 0, quantity: 0, rowCount: 0 };
    const prev = previous.get(key) || 0;
    return { ...cur, pct: pctOf(cur.revenue, total), previous: prev, diff: cur.revenue - prev };
  }).sort((a, b) => b.revenue - a.revenue);
}

function sourceBreakdown(rows, previousRows, indexes, previousScale) {
  const groups = groupRows(rows, sourceGroup);
  const previous = new Map(groupRows(previousRows, sourceGroup).map((x) => [x.key, x.revenue * previousScale]));
  return groups.map((group) => ({
    ...group,
    previous: previous.get(group.key) || 0,
    diff: group.revenue - (previous.get(group.key) || 0),
    contractors: groupRows(rows.filter((r) => sourceGroup(r) === group.key), (r) => r.contractor_code, (r) => r.contractor_name || r.contractor_code),
    routes: groupRows(rows.filter((r) => sourceGroup(r) === group.key), (r) => canonicalRoute(r, indexes)),
  }));
}

function employeeRows(rows) {
  return rows.filter((row) => !diemXu.isExcluded(row.emp_code));
}

function buildScores(rows, ranges) {
  const codes = [...new Set(rows.map((r) => upper(r.emp_code)).filter((code) => code && !diemXu.EXCLUDE.has(code)))].sort();
  const names = new Map(rows.map((r) => [upper(r.emp_code), text(r.emp_name) || upper(r.emp_code)]));
  return codes.map((empCode) => ({
    empCode,
    empName: names.get(empCode) || empCode,
    ...diemXu.scoreForEmp({ empCode, weekRange: ranges.weekRange, monthRange: ranges.monthRange, quarterRange: ranges.quarterRange }),
  })).sort((a, b) => b.diem_quy - a.diem_quy || b.xu_quy - a.xu_quy);
}

function attachScoreRoutes(scores, quarterRows, indexes) {
  const routeRevenueByEmployee = new Map();
  for (const row of quarterRows) {
    const empCode = upper(row.emp_code);
    if (!empCode || diemXu.isExcluded(empCode)) continue;
    const route = canonicalRoute(row, indexes);
    const map = routeRevenueByEmployee.get(empCode) || new Map();
    map.set(route, (map.get(route) || 0) + number(row.revenue));
    routeRevenueByEmployee.set(empCode, map);
  }
  return scores.map((score) => {
    const ranked = [...(routeRevenueByEmployee.get(score.empCode) || new Map())].sort((a, b) => b[1] - a[1]);
    return { ...score, route: ranked[0]?.[0] || UNCLASSIFIED, routeRevenue: ranked[0]?.[1] || 0 };
  });
}

function scoresByRoute(scores) {
  const groups = new Map();
  for (const score of scores) {
    const current = groups.get(score.route) || { key: score.route, label: score.route, employeeCount: 0, diemQuy: 0, xuQuy: 0, warningCount: 0, employees: [] };
    current.employeeCount += 1;
    current.diemQuy += number(score.diem_quy);
    current.xuQuy += number(score.xu_quy);
    current.warningCount += score.canh_bao ? 1 : 0;
    current.employees.push(score);
    groups.set(score.route, current);
  }
  return [...groups.values()].sort((a, b) => b.diemQuy - a.diemQuy);
}

function performanceTiers(employeeGroups) {
  const count = employeeGroups.length;
  const firstCut = Math.ceil(count / 4);
  const lastCut = Math.floor(count * 3 / 4);
  return {
    leading: employeeGroups.slice(0, firstCut),
    upperMiddle: employeeGroups.slice(firstCut, Math.ceil(count / 2)),
    lowerMiddle: employeeGroups.slice(Math.ceil(count / 2), lastCut),
    developing: employeeGroups.slice(lastCut),
  };
}

function narrativeFacts(facts) {
  const best = (diff) => diff.up[0] || null;
  const worst = (diff) => diff.down[0] || null;
  const ncl = facts.routeBreakdown.find((x) => x.key === 'NCL') || null;
  const scoreWarnings = facts.scores.filter((x) => x.canh_bao);
  const promises = [
    best(facts.diffTop.employee) && { type: 'employee-growth', item: best(facts.diffTop.employee), text: `${best(facts.diffTop.employee).label} là nhân sự tạo mức tăng doanh thu mạnh nhất kỳ.` },
    best(facts.diffTop.unit) && { type: 'unit-growth', item: best(facts.diffTop.unit), text: `${best(facts.diffTop.unit).label} là đơn vị tăng doanh thu mạnh nhất kỳ.` },
    best(facts.diffTop.product) && { type: 'product-growth', item: best(facts.diffTop.product), text: `${best(facts.diffTop.product).label} là sản phẩm tăng doanh thu mạnh nhất kỳ.` },
  ].filter(Boolean);
  const risks = [
    worst(facts.diffTop.unit) && { type: 'unit-decline', item: worst(facts.diffTop.unit), text: `${worst(facts.diffTop.unit).label} là đơn vị giảm doanh thu cần ưu tiên rà soát.` },
    facts.diffTop.unit.dormant[0] && { type: 'dormant-unit', item: facts.diffTop.unit.dormant[0], text: `${facts.diffTop.unit.dormant[0].label} có doanh thu kỳ trước nhưng chưa phát sinh kỳ này.` },
    scoreWarnings[0] && { type: 'score-warning', item: scoreWarnings[0], text: `${scoreWarnings[0].empName} đang ở trạng thái cảnh báo tỷ lệ xu quý theo luật tích xu.` },
  ].filter(Boolean);
  const opportunities = [
    ncl && { type: 'ncl-opportunity', item: ncl, text: 'Tuyến NCL là dư địa mở rộng không bị giới hạn bởi cơ số thầu.' },
    facts.midTierUnits[0] && { type: 'mid-tier-unit', item: facts.midTierUnits[0], text: `${facts.midTierUnits[0].label} thuộc nhóm đơn vị hạng giữa có thể khai thác thêm.` },
    facts.diffTop.product.new[0] && { type: 'new-product', item: facts.diffTop.product.new[0], text: `${facts.diffTop.product.new[0].label} là sản phẩm mới phát sinh so với kỳ đối chiếu.` },
  ].filter(Boolean);
  return {
    promises,
    risks,
    opportunities,
    recommendations: [
      risks[0] && { type: 'recover-risk', source: risks[0], text: `Ưu tiên xác minh nguyên nhân và lập kế hoạch kéo lại ${risks[0].item.label}.` },
      promises[1] && { type: 'protect-growth', source: promises[1], text: `Duy trì nhịp bán tại ${promises[1].item.label} và kiểm tra khả năng nhân rộng.` },
      opportunities[0] && { type: 'expand-opportunity', source: opportunities[0], text: opportunities[0].text },
    ].filter(Boolean),
    conclusion: {
      direction: facts.deltaRevenue >= 0 ? 'Tăng so với kỳ đối chiếu' : 'Giảm so với kỳ đối chiếu',
      text: facts.deltaRevenue >= 0
        ? 'Doanh thu đang cao hơn kỳ đối chiếu; cần bảo vệ các điểm tăng và xử lý sớm các điểm giảm.'
        : 'Doanh thu đang thấp hơn kỳ đối chiếu; cần ưu tiên phục hồi các điểm giảm và khai thác dư địa đã nhận diện.',
    },
  };
}

async function build({ kind = 'week', ranges: suppliedRanges } = {}) {
  if (!VALID_KINDS.has(kind)) throw new Error(`Unsupported deck kind: ${kind}`);
  const ranges = suppliedRanges || salesReport.defaultRanges();
  const range = kind === 'month' ? ranges.monthRange : ranges.weekRange;
  if (!range?.from || !range?.to || !ranges.prevRange?.from || !ranges.prevRange?.to) throw new Error('Invalid deck ranges');

  const indexes = catalogIndexes();
  const currentRows = rowsInRange(range);
  const previousRows = rowsInRange(ranges.prevRange);
  const quarterRows = rowsInRange(ranges.quarterRange);
  const comparison = comparisonMeta(kind, ranges);
  const totalRevenue = sumRevenue(currentRows);
  const previousFullRevenue = sumRevenue(previousRows);
  const previousRevenue = previousFullRevenue * comparison.factor;
  const employeeCurrentRows = employeeRows(currentRows);
  const employeePreviousRows = employeeRows(previousRows);

  const employees = groupRows(employeeCurrentRows, (r) => r.emp_code, (r) => r.emp_name || r.emp_code);
  const units = groupRows(currentRows, (r) => r.unit_code, (r) => r.unit_name || r.unit_code);
  const products = groupRows(currentRows, (r) => r.iit_code, (r) => r.product_name || r.iit_code);
  const customerTypes = groupRows(currentRows, (r) => customerType(r, indexes));
  const therapies = groupRows(currentRows, (r) => therapyGroup(r, indexes));
  const contractors = groupRows(currentRows, (r) => r.contractor_code, (r) => r.contractor_name || r.contractor_code);
  const routes = routeBreakdown(currentRows, previousRows, indexes, comparison.factor).map((route) => {
    const rows = currentRows.filter((row) => canonicalRoute(row, indexes) === route.key);
    return {
      ...route,
      employees: groupRows(employeeRows(rows), (r) => r.emp_code, (r) => r.emp_name || r.emp_code),
      units: groupRows(rows, (r) => r.unit_code, (r) => r.unit_name || r.unit_code),
      products: groupRows(rows, (r) => r.iit_code, (r) => r.product_name || r.iit_code),
    };
  });
  const scores = attachScoreRoutes(buildScores(employeeRows(quarterRows), ranges), quarterRows, indexes);

  const facts = {
    schemaVersion: 1,
    scope: 'CEO',
    presenter: (() => {
      const ceo = store.findUserByCode('CEO') || {};
      return { code: 'CEO', name: text(ceo.name) || 'CEO' };
    })(),
    kind,
    generatedAt: new Date().toISOString(),
    dataAsOf: ranges.asOf || range.to,
    range,
    ranges,
    periodLabel: `${range.from}–${range.to}`,
    comparisonMeta: comparison,
    currentRows,
    previousRows,
    rows: currentRows,
    prevRows: previousRows,
    rowCounts: { current: currentRows.length, previous: previousRows.length },
    totalRevenue,
    previousRevenue,
    previousFullRevenue,
    deltaRevenue: totalRevenue - previousRevenue,
    deltaPct: previousRevenue ? (totalRevenue - previousRevenue) / previousRevenue * 100 : null,
    dailyBars: dailyBars(currentRows, range),
    routeBreakdown: routes,
    sourceBreakdown: sourceBreakdown(currentRows, previousRows, indexes, comparison.factor),
    customerTypeBreakdown: customerTypes,
    therapyBreakdown: therapies,
    contractorBreakdown: contractors,
    groupRows: { employee: employees, unit: units, product: products, customerType: customerTypes, therapy: therapies, contractor: contractors },
    topEmployees: employees.slice(0, 16),
    topUnits: units.slice(0, 16),
    topProducts: products.slice(0, 16),
    midTierEmployees: employees.slice(4, 12),
    midTierUnits: units.slice(4, 12),
    midTierProducts: products.slice(4, 12),
    employeeTiers: performanceTiers(employees),
    diffTop: {
      employee: compareGroups(employeeCurrentRows, employeePreviousRows, (r) => r.emp_code, (r) => r.emp_name || r.emp_code, comparison.factor),
      unit: compareGroups(currentRows, previousRows, (r) => r.unit_code, (r) => r.unit_name || r.unit_code, comparison.factor),
      product: compareGroups(currentRows, previousRows, (r) => r.iit_code, (r) => r.product_name || r.iit_code, comparison.factor),
      route: compareGroups(currentRows, previousRows, (r) => canonicalRoute(r, indexes), (r) => canonicalRoute(r, indexes), comparison.factor),
      source: compareGroups(currentRows, previousRows, sourceGroup, sourceGroup, comparison.factor),
      customerType: compareGroups(currentRows, previousRows, (r) => customerType(r, indexes), (r) => customerType(r, indexes), comparison.factor),
      therapy: compareGroups(currentRows, previousRows, (r) => therapyGroup(r, indexes), (r) => therapyGroup(r, indexes), comparison.factor),
    },
    scores,
    scoresByRoute: scoresByRoute(scores),
    scorePolicy: { period: 'quarter', carryForward: false, excludedEmployeeCodes: [...diemXu.EXCLUDE] },
    disclaimers: [
      'Số liệu nội bộ; không bao gồm giá vốn hoặc lợi nhuận.',
      'Xu được tính theo quý và không chuyển tiếp sang quý sau.',
    ],
  };
  facts.scoreWarnings = facts.scores.filter((x) => x.canh_bao);
  facts.highRevenueLowXu = facts.scores
    .map((score) => ({ ...score, revenue: employees.find((x) => x.key === score.empCode)?.revenue || 0 }))
    .filter((x) => x.revenue > 0 && x.canh_bao).sort((a, b) => b.revenue - a.revenue);
  facts.narrativeFacts = narrativeFacts(facts);
  return facts;
}

module.exports = {
  build,
  comparisonMeta,
  rowsInRange,
  groupRows,
  dailyBars,
  customerType,
  sourceGroup,
  therapyGroup,
};
