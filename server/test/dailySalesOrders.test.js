const test = require('node:test');
const assert = require('node:assert/strict');
const analytics = require('../src/analytics');
const { buildPayload, createHandler, groupOrders } = require('../src/dailySalesOrders');

const NOW = new Date('2026-07-16T11:36:00+07:00');
const REFRESH = { weekday: 'off', sat: 'off', sun: 'off', minutes: 60 };

function row(overrides = {}) {
  return {
    ky: '07.2026',
    date: '2026-07-16',
    source: 'app-sale',
    source_order: 'DH-001',
    source_line_id: 'L-001',
    emp_code: 'DN001',
    emp_name: 'Anh Một',
    unit_code: '001',
    unit_name: 'BV Một',
    product_name: 'Thuốc A',
    iit_code: 'IIT-A',
    uom: 'Hộp',
    quantity: 2,
    unit_price: 50,
    revenue: 100,
    revenue_status: 'accepted',
    bid_package: 'QĐ139',
    route: 'ETC',
    contractor_code: 'NT01',
    contractor_name: 'Nhà thầu 1',
    data_as_of: '2026-07-16T11:30:00+07:00',
    ...overrides,
  };
}

function makeApi(rows) {
  const scopes = [];
  const store = {
    getRowsRange({ kys, scope }) {
      scopes.push({ kys, scope });
      return rows.filter((r) => kys.includes(r.ky) && (!scope.empCode || r.emp_code === scope.empCode));
    },
    listPeriods() {
      return [{ ky: '07.2026', data_as_of: '2026-07-16T11:30:00+07:00' }];
    },
  };
  const auth = {
    scopeOf(session) { return { empCode: session.role === 'ceo' ? null : session.emp_code }; },
    isAdmin(role) { return role === 'ceo' || role === 'admin'; },
  };
  const handler = createHandler({ store, auth, analytics, revenueRefresh: { status: () => REFRESH }, now: () => NOW });
  async function call(session, query = {}) {
    let body;
    const res = { json(value) { body = value; return this; } };
    await handler({ session, query }, res);
    return body;
  }
  return { call, scopes };
}

function assertNoSensitiveKeys(value) {
  const forbidden = /^(cost|cost_price|profit|margin|gross_profit|gia_von|chi_phi|cp_total)$/i;
  if (Array.isArray(value)) return value.forEach(assertNoSensitiveKeys);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, forbidden);
    assertNoSensitiveKeys(child);
  }
}

test('CEO API returns KPI-matching totals and paginated orders for Bangkok today only', async () => {
  const rows = [
    row(),
    row({ source_line_id: 'L-002', revenue: 200, product_name: 'Thuốc B', iit_code: 'IIT-B' }),
    row({ source: 'legacy', source_order: 'DH-001', source_line_id: 'L-003', revenue: 300, unit_code: '002', unit_name: 'BV Hai' }),
    row({ date: '2026-07-15', source_order: 'OLD', source_line_id: 'OLD-L', revenue: 9999 }),
  ];
  const api = makeApi(rows);
  const result = await api.call({ role: 'ceo', emp_code: 'CEO' }, { page: '1', pageSize: '1' });

  assert.deepEqual(api.scopes, [{ kys: ['07.2026'], scope: { empCode: null } }]);
  assert.equal(result.summary.date, '2026-07-16');
  assert.equal(result.summary.ky, '07.2026');
  assert.equal(result.summary.revenue, 600);
  assert.equal(result.summary.rowCount, 3);
  assert.equal(result.summary.sourceRowCount, 3);
  assert.equal(result.summary.orderCount, 2);
  assert.equal(result.summary.unitCount, 2);
  assert.equal(result.summary.sourceUpdatedAt, '2026-07-16T11:30:00+07:00');
  assert.equal(result.summary.status, 'has_sales');
  assert.equal(result.total, 2);
  assert.equal(result.pageSize, 1);
  assert.equal(result.orders.length, 1);
});

test('employee scope is applied before grouping and exposes only scoped lines/subtotal', async () => {
  const rows = [
    row({ emp_code: 'DN001', emp_name: 'Anh Một', revenue: 100 }),
    row({ source_line_id: 'L-002', emp_code: 'DN002', emp_name: 'Chị Hai', revenue: 900 }),
  ];
  const api = makeApi(rows);
  const result = await api.call({ role: 'sale', emp_code: 'DN001' });

  assert.deepEqual(api.scopes, [{ kys: ['07.2026'], scope: { empCode: 'DN001' } }]);
  assert.equal(result.summary.revenue, 100);
  assert.equal(result.summary.sourceRowCount, 1);
  assert.equal(result.summary.orderCount, 1);
  assert.equal(result.orders[0].revenue, 100);
  assert.equal(result.orders[0].lineCount, 1);
  assert.deepEqual(result.orders[0].employees, [{ code: 'DN001', name: 'Anh Một' }]);
  assert.equal(result.orders[0].lines[0].revenue, 100);
});

test('same order number from different sources never collides', () => {
  const orders = groupOrders([
    row({ source: 'app-sale', source_order: 'DUP', source_line_id: 'A', revenue: 100 }),
    row({ source: 'legacy', source_order: 'DUP', source_line_id: 'B', revenue: 200 }),
  ]);
  assert.equal(orders.length, 2);
  assert.deepEqual(new Set(orders.map((o) => o.source)), new Set(['app-sale', 'legacy']));
  assert.deepEqual(new Set(orders.map((o) => o.revenue)), new Set([100, 200]));
});

test('missing source_order falls back per source line and anonymous rows do not coalesce', () => {
  const orders = groupOrders([
    row({ source_order: '', source_line_id: 'NO-ORDER-1', revenue: 10 }),
    row({ source_order: null, source_line_id: 'NO-ORDER-2', revenue: 20 }),
    row({ source_order: null, source_line_id: null, revenue: 30 }),
    row({ source_order: null, source_line_id: null, revenue: 40 }),
  ]);
  assert.equal(orders.length, 4);
  assert.ok(orders.every((o) => o.source_order === null));
  assert.equal(orders.reduce((sum, o) => sum + o.revenue, 0), 100);
});

test('API contract whitelists safe fields and never leaks cost/profit/margin input', () => {
  const result = buildPayload({
    rows: [row({ cost: 70, cost_price: 70, profit: 30, margin: 30, gia_von: 70, chi_phi: 5, cp_total: 75 })],
    now: NOW,
    sourceUpdatedAt: '2026-07-16T11:30:00+07:00',
    isAdmin: true,
    refresh: REFRESH,
    baseUnitKey: analytics.baseUnitKey,
  });
  assertNoSensitiveKeys(result);
  assert.deepEqual(Object.keys(result.orders[0].lines[0]).sort(), [
    'bid_package', 'contractor_code', 'contractor_name', 'iit_code', 'product_name',
    'quantity', 'revenue', 'route', 'source_line_id', 'unit_price', 'uom',
  ].sort());
});

test('existing revenue filters are supported but date query cannot move the API off today', async () => {
  const rows = [
    row({ unit_code: '001', revenue: 100 }),
    row({ unit_code: '002', source_order: 'DH-002', source_line_id: 'L-002', revenue: 200 }),
    row({ unit_code: '001', date: '2026-07-15', source_order: 'OLD', source_line_id: 'OLD', revenue: 500 }),
  ];
  const api = makeApi(rows);
  const result = await api.call(
    { role: 'ceo', emp_code: 'CEO' },
    { unit: '001', dateFrom: '2026-07-15', dateTo: '2026-07-15' },
  );
  assert.equal(result.summary.date, '2026-07-16');
  assert.equal(result.summary.revenue, 100);
  assert.equal(result.summary.orderCount, 1);
});

test('list search/source filters and sorting do not change the KPI summary', () => {
  const result = buildPayload({
    rows: [
      row({ source: 'app-sale', source_order: 'DH-001', revenue: 100 }),
      row({ source: 'legacy', source_order: 'DH-002', source_line_id: 'L-002', unit_name: 'BV Hai', revenue: 200 }),
    ],
    now: NOW,
    sourceUpdatedAt: '2026-07-16T11:30:00+07:00',
    isAdmin: true,
    refresh: REFRESH,
    search: 'BV Hai',
    source: 'legacy',
    sort: 'newest',
    baseUnitKey: analytics.baseUnitKey,
  });
  assert.equal(result.summary.revenue, 300);
  assert.equal(result.summary.orderCount, 2);
  assert.equal(result.total, 1);
  assert.equal(result.orders[0].source_order, 'DH-002');
  assert.deepEqual(result.availableSources, ['app-sale', 'legacy']);
});
