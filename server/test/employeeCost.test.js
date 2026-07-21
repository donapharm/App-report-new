const test = require('node:test');
const assert = require('node:assert/strict');
const employeeCost = require('../src/employeeCost');

const source = {
  empCode: 'DN001',
  columns: [
    { key: 'c36', pos: 36, label: 'CP ctv (%)' },
    { key: 'c41', pos: 41, label: 'CP đặt hàng (%)' },
    { key: 'c32', pos: 32, label: 'Cấm' },
    { key: 'c47', pos: 47, label: 'Cấm' },
  ],
  rows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c25: 'Viên', c36: 8, c41: 3, c32: 11, c47: 99, secret: 'drop' }],
};

test('sale scope ignores another requested employee; CEO/admin may select one', () => {
  assert.equal(employeeCost.resolveScopedEmployee({ scope: { empCode: 'DN001' }, session: { emp_code: 'DN001', role: 'sale' }, requestedEmp: 'DN999' }), 'DN001');
  assert.equal(employeeCost.resolveScopedEmployee({ scope: { empCode: null }, session: { emp_code: 'CEO', role: 'ceo' }, requestedEmp: 'dn009' }), 'DN009');
  assert.equal(employeeCost.resolveScopedEmployee({ scope: { empCode: null }, session: { emp_code: 'ADM1', role: 'admin' }, requestedEmp: 'dn016' }), 'DN016');
});

test('sale request for another employee still calls DataHub with own identity', async () => {
  let calledUrl = '';
  const audits = [];
  const payload = await employeeCost.getForSession({
    scope: { empCode: 'DN001' }, session: { emp_code: 'DN001', role: 'sale' }, requestedEmp: 'DN999',
  }, {
    baseUrl: 'http://hub.test', token: 'x', backoffMs: [], auditImpl: (entry) => audits.push(entry),
    fetchImpl: async (url) => { calledUrl = url; return { ok: true, status: 200, json: async () => source }; },
  });
  assert.match(calledUrl, /emp=DN001$/);
  assert.equal(payload.empCode, 'DN001');
  assert.equal(audits[0].empCode, 'DN001');
});

test('proxy sends S2S token only upstream and sanitizes forbidden/unknown fields', async () => {
  let request;
  const result = await employeeCost.fetchEmployeeCost('DN001', {
    baseUrl: 'http://hub.test', token: 'server-only-token', backoffMs: [],
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, status: 200, json: async () => source }; },
  });
  assert.equal(request.url, 'http://hub.test/api/integrations/app-report/employee-cost?emp=DN001');
  assert.equal(request.options.headers['x-assignment-key'], 'server-only-token');
  assert.deepEqual(result.payload.columns.map((column) => column.key), ['c36', 'c41']);
  assert.deepEqual(result.payload.rows[0], { c5: 'QL1', c7: 'U1', c16: 'Thuốc', c25: 'Viên', c36: 8, c41: 3 });
  assert.equal(JSON.stringify(result.payload).includes('server-only-token'), false);
  assert.equal(JSON.stringify(result.payload).includes('c32'), false);
  assert.equal(JSON.stringify(result.payload).includes('c47'), false);

  const wrongEmployee = employeeCost.sanitizePayload({ ...source, empCode: 'DN999' }, 'DN001');
  assert.deepEqual(wrongEmployee, { empCode: 'DN001', columns: [], rows: [], note: employeeCost.DEFAULT_NOTE });
  const mismatch = await employeeCost.fetchEmployeeCost('DN001', {
    baseUrl: 'http://hub.test', token: 'x', backoffMs: [],
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ...source, empCode: 'DN999' }) }),
  });
  assert.equal(mismatch.outcome, 'scope_mismatch');
  assert.equal(mismatch.payload.rows.length, 0);
});

test('502 retries with backoff then succeeds; 401 returns safe empty payload', async () => {
  let calls = 0;
  const waits = [];
  const recovered = await employeeCost.fetchEmployeeCost('DN001', {
    baseUrl: 'http://hub.test', token: 'x', backoffMs: [2, 4], sleepImpl: async (ms) => waits.push(ms),
    fetchImpl: async () => { calls += 1; return calls < 3 ? { ok: false, status: 502 } : { ok: true, status: 200, json: async () => source }; },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2, 4]);
  assert.equal(recovered.outcome, 'ok');

  const denied = await employeeCost.fetchEmployeeCost('DN001', {
    baseUrl: 'http://hub.test', token: 'bad', backoffMs: [],
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.deepEqual(denied.payload, { empCode: 'DN001', columns: [], rows: [], note: employeeCost.DEFAULT_NOTE });
});

test('maps C16 through catalog, joins revenue by unit + product code and calculates each amount', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001',
    columns: [
      { key: 'c36', pos: 36, label: 'CP tháng (%)' },
      { key: 'c44', pos: 44, label: 'Thưởng cuối năm (%)' },
      { key: 'c47', pos: 47, label: 'Cấm' },
    ],
    rows: [
      { c5: 'QL01', c7: 'U1', c16: 'Thuốc Á', c25: 'Viên', c36: 8, c44: 0.3, c47: 99 },
      { c5: 'QL02', c7: 'U2', c16: 'Thuốc B', c25: 'Gói', c36: 0.3, c44: 10 },
    ],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '07.2026',
    catalogRows: [
      { iit_code: 'QL01', product_name: 'Thuốc A' },
      { c5: 'QL02', c16: 'Thuốc B', c7: 'U2' },
    ],
    revenueRows: [
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL01', revenue: 10_000_000 },
      { emp_code: 'DN999', unit_code: 'U1', iit_code: 'QL01', revenue: 900_000_000 },
      { emp_code: 'DN001', unit_code: 'U2', iit_code: 'QL02', revenue: 10_000_000 },
    ],
  });

  assert.equal(enriched.period, '07.2026');
  assert.deepEqual(enriched.rows[0].amounts, { c36: 800_000, c44: 30_000 });
  assert.deepEqual(enriched.rows[1].amounts, { c36: 30_000, c44: 1_000_000 });
  assert.deepEqual(enriched.match, { matchedRows: 2, totalRows: 2, rate: 100, threshold: 90, low: false });
  assert.equal(enriched.summary.monthlyTotal, 830_000);
  assert.equal(enriched.summary.annualTotal, 1_030_000);
  assert.deepEqual(enriched.summary.annualColumnKeys, ['c44']);
  assert.equal(enriched.columns.find((column) => column.key === 'c44').annual, true);
  assert.equal(JSON.stringify(enriched).includes('c47'), false);
});

test('does not match raw names, leaves amounts null and suppresses unreliable totals below threshold', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: [{ key: 'c36', label: 'CP (%)' }],
    rows: [
      { c5: 'QL01', c7: 'U1', c16: 'Thuốc A', c36: 8 },
      { c5: 'QL99', c7: 'U9', c16: 'Tên chỉ có trong doanh thu', c36: 8 },
    ],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    catalogRows: [{ c5: 'QL01', c7: 'U1', c16: 'Thuốc A' }],
    revenueRows: [
      { unit_code: 'U1', iit_code: 'QL01', product_name: 'Tên khác catalog', revenue: 10_000_000 },
      { unit_code: 'U9', iit_code: 'QL99', product_name: 'Tên chỉ có trong doanh thu', revenue: 10_000_000 },
    ],
  });

  assert.equal(enriched.rows[0].amounts.c36, 800_000);
  assert.equal(enriched.rows[1].amounts.c36, null);
  assert.deepEqual(enriched.match, { matchedRows: 1, totalRows: 2, rate: 50, threshold: 90, low: true });
  assert.equal(enriched.summary.reliable, false);
  assert.equal(enriched.summary.monthlyTotal, null);
  assert.equal(enriched.summary.annualTotal, null);
});

test('catalog ambiguity fails closed and annual columns are configurable', () => {
  const index = employeeCost.buildProductCatalogIndex([
    { iit_code: 'QL01', product_name: 'Cùng tên' },
    { iit_code: 'QL02', product_name: 'Cùng tên' },
  ]);
  assert.equal(employeeCost.resolveProductCode({ c7: 'U1', c16: 'Cùng tên' }, index), '');
  assert.equal(employeeCost.resolveProductCode({ c5: 'QL02', c7: 'U1', c16: 'Cùng tên' }, index), 'QL02');
  assert.deepEqual([...employeeCost.configuredAnnualColumnKeys('c43,c45,c32,c47')], ['c43', 'c45']);
  assert.equal(employeeCost.calculateAmount(10_000_000, null), null);
});

test('empty grounded payload does not present a zero total as real data', () => {
  const enriched = employeeCost.enrichWithRevenue({ empCode: 'DN001', columns: [], rows: [] }, {
    catalogRows: [], revenueRows: [],
  });
  assert.equal(enriched.match.rate, null);
  assert.equal(enriched.summary.reliable, false);
  assert.equal(enriched.summary.monthlyTotal, null);
  assert.equal(enriched.summary.annualTotal, null);
});

test('getForSession keeps employee scope while enriching from scoped revenue only', async () => {
  let calledUrl = '';
  const payload = await employeeCost.getForSession({
    scope: { empCode: 'DN001' }, session: { emp_code: 'DN001', role: 'sale' }, requestedEmp: 'DN999',
  }, {
    baseUrl: 'http://hub.test', token: 'server-only', backoffMs: [], period: '07.2026',
    catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 10_000_000 }],
    auditImpl: () => {},
    fetchImpl: async (url) => { calledUrl = url; return { ok: true, status: 200, json: async () => source }; },
  });
  assert.match(calledUrl, /emp=DN001$/);
  assert.equal(payload.empCode, 'DN001');
  assert.equal(payload.rows[0].amounts.c36, 800_000);
});
