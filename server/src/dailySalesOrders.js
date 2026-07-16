const crypto = require('crypto');
const dailySales = require('./dailySales');

const UNKNOWN_SOURCE = 'unknown';

function text(v) { return String(v == null ? '' : v).trim(); }
function amount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function safeSource(v) { return text(v) || UNKNOWN_SOURCE; }
function hashId(v) { return crypto.createHash('sha256').update(v).digest('hex').slice(0, 24); }
function statusOf(values) {
  const statuses = [...new Set(values.map(text).filter(Boolean))];
  if (!statuses.length) return null;
  return statuses.length === 1 ? statuses[0] : 'mixed';
}
function maxTimestamp(values) {
  return values.map(text).filter(Boolean).sort().at(-1) || null;
}

function revenueFiltersFromQuery(q = {}) {
  return {
    emp: q.emp || null,
    province: q.province || null,
    unit: q.unit || null,
    group: q.group || null,
    product: q.product || null,
    route: q.route || null,
    priority: q.priority || null,
    contractor: q.contractor || null,
    bid: q.bid || null,
    q: q.q || null,
  };
}

function hasRevenueFilters(filters) {
  return Object.values(filters).some((v) => Array.isArray(v) ? v.length > 0 : !!v);
}

function lineFromRow(r) {
  return {
    source_line_id: text(r.source_line_id) || null,
    product_name: text(r.product_name) || null,
    iit_code: text(r.iit_code) || null,
    uom: text(r.uom) || null,
    quantity: amount(r.quantity),
    unit_price: amount(r.unit_price),
    revenue: amount(r.revenue),
    bid_package: text(r.bid_package) || null,
    route: text(r.route) || null,
    contractor_code: text(r.contractor_code) || null,
    contractor_name: text(r.contractor_name) || null,
    revenue_status: text(r.revenue_status) || null,
  };
}

function orderKey(r, index) {
  const source = safeSource(r.source);
  const sourceOrder = text(r.source_order);
  if (sourceOrder) return `${source}\u0000order:${sourceOrder}`;
  const sourceLineId = text(r.source_line_id);
  if (sourceLineId) return `${source}\u0000line:${sourceLineId}`;
  // Never merge anonymous rows. The index is deterministic for the source row order.
  return `${source}\u0000anonymous:${index}`;
}

function groupOrders(rows = []) {
  const groups = new Map();
  rows.forEach((r, index) => {
    const key = orderKey(r, index);
    let order = groups.get(key);
    if (!order) {
      order = {
        id: hashId(key),
        source: safeSource(r.source),
        source_order: text(r.source_order) || null,
        date: text(r.date).slice(0, 10) || null,
        revenue: 0,
        employees: new Map(),
        units: new Map(),
        revenueStatuses: [],
        lines: [],
      };
      groups.set(key, order);
    }
    order.revenue += amount(r.revenue);
    const empCode = text(r.emp_code);
    const empName = text(r.emp_name);
    if (empCode || empName) order.employees.set(empCode || empName, { code: empCode || null, name: empName || null });
    const unitCode = text(r.unit_code);
    const unitName = text(r.unit_name);
    if (unitCode || unitName) order.units.set(unitCode || unitName, { unit_code: unitCode || null, unit_name: unitName || null });
    order.revenueStatuses.push(r.revenue_status);
    order.lines.push(lineFromRow(r));
  });

  return [...groups.values()].map((o) => {
    const units = [...o.units.values()];
    return {
      key: o.id,
      source: o.source,
      source_order: o.source_order,
      date: o.date,
      revenue: o.revenue,
      line_count: o.lines.length,
      unit_code: units[0]?.unit_code || null,
      unit_name: units[0]?.unit_name || null,
      employees: [...o.employees.values()],
      revenue_status: statusOf(o.revenueStatuses),
      lines: o.lines,
    };
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
    || b.revenue - a.revenue
    || a.source.localeCompare(b.source, 'vi')
    || String(a.source_order || a.key).localeCompare(String(b.source_order || b.key), 'vi'));
}

function normalizeSearch(v) {
  return text(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

function buildPayload({ rows = [], now = new Date(), sourceUpdatedAt = null, isAdmin = false, isFiltered = false, refresh = {}, page = 1, pageSize = 20, search = '', source = '', sort = 'revenue', baseUnitKey = (v) => text(v).toLowerCase() } = {}) {
  const parts = dailySales.vnParts(now);
  const todayRows = rows.filter((r) => text(r.date).slice(0, 10) === parts.date);
  const allOrders = groupOrders(todayRows);
  const availableSources = [...new Set(allOrders.map((o) => o.source))].sort((a, b) => a.localeCompare(b, 'vi'));
  const needle = normalizeSearch(search);
  let orders = allOrders.filter((o) => {
    if (source && o.source !== source) return false;
    if (!needle) return true;
    return normalizeSearch([
      o.source_order,
      o.source,
      ...o.employees.flatMap((e) => [e.code, e.name]),
      o.unit_code,
      o.unit_name,
    ].join(' ')).includes(needle);
  });
  if (sort === 'newest') {
    orders = orders.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
      || String(b.source_order || b.key).localeCompare(String(a.source_order || a.key), 'vi'));
  }
  const units = new Set(todayRows.map((r) => r.unit_code || r.unit_name).filter(Boolean).map(baseUnitKey));
  const daily = dailySales.buildDailySales({ rows: todayRows, now, sourceUpdatedAt, isAdmin, isFiltered, refresh });
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const start = (safePage - 1) * safePageSize;
  const totalPages = Math.max(1, Math.ceil(orders.length / safePageSize));
  return {
    date: parts.date,
    ky: parts.ky,
    summary: {
      revenue: daily.revenue,
      rowCount: daily.rowCount,
      orderCount: allOrders.length,
      unitCount: units.size,
      sourceUpdatedAt: daily.sourceUpdatedAt,
      status: daily.status,
      note: daily.note,
      stale: daily.stale,
      reconciled: Math.abs(allOrders.reduce((sum, order) => sum + Number(order.revenue || 0), 0) - daily.revenue) < 0.5,
    },
    availableSources,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    total: orders.length,
    orders: orders.slice(start, start + safePageSize),
  };
}

function createHandler({ store, auth, analytics, revenueRefresh, now = () => new Date() }) {
  return (req, res) => {
    const current = now();
    const parts = dailySales.vnParts(current);
    const scope = auth.scopeOf(req.session);
    // Scope is enforced at the store boundary, before filters and before order grouping.
    const scopedRows = store.getRowsRange({ kys: [parts.ky], scope });
    const filters = revenueFiltersFromQuery(req.query || {});
    const rows = analytics.applyFilters(scopedRows, filters);
    const period = store.listPeriods().find((p) => p.ky === parts.ky) || {};
    const sourceUpdatedAt = period.data_as_of || period.dataAsOf || period.uploadedAt
      || maxTimestamp(scopedRows.map((r) => r.data_as_of));
    return res.json(buildPayload({
      rows,
      now: current,
      sourceUpdatedAt,
      isAdmin: auth.isAdmin(req.session.role),
      isFiltered: hasRevenueFilters(filters),
      refresh: revenueRefresh.status(),
      page: req.query?.page,
      pageSize: req.query?.pageSize,
      search: req.query?.search,
      source: req.query?.source,
      sort: req.query?.sort,
      baseUnitKey: analytics.baseUnitKey,
    }));
  };
}

module.exports = {
  buildPayload,
  createHandler,
  groupOrders,
  orderKey,
  revenueFiltersFromQuery,
};
