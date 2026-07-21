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

test('month range defaults to current month and rejects incomplete, invalid or reversed input', () => {
  assert.deepEqual(employeeCost.parseMonthRange({}, new Date(2026, 6, 21)), {
    from: '2026-07', to: '2026-07', months: ['2026-07'],
  });
  assert.deepEqual(employeeCost.parseMonthRange({ from: '2026-11', to: '2027-02' }).months, [
    '2026-11', '2026-12', '2027-01', '2027-02',
  ]);
  assert.throws(() => employeeCost.parseMonthRange({ from: '2026-07' }), { code: 'EMPLOYEE_COST_RANGE_REQUIRED' });
  assert.throws(() => employeeCost.parseMonthRange({ from: '07.2026', to: '2026-08' }), { code: 'EMPLOYEE_COST_RANGE_INVALID' });
  assert.throws(() => employeeCost.parseMonthRange({ from: '2026-08', to: '2026-07' }), { code: 'EMPLOYEE_COST_RANGE_ORDER' });
});

test('range proxy sends validated from/to with the backend-locked employee scope', async () => {
  let calledUrl = '';
  const payload = await employeeCost.getForSession({
    scope: { empCode: 'DN001' }, session: { emp_code: 'DN001', role: 'sale' }, requestedEmp: 'DN999',
  }, {
    baseUrl: 'http://hub.test', token: 'server-only', backoffMs: [], from: '2026-06', to: '2026-07',
    revenueRowsByPeriod: { '2026-06': [], '2026-07': [] }, catalogRowsByPeriod: { '2026-06': [], '2026-07': [] },
    auditImpl: () => {},
    fetchImpl: async (url) => {
      calledUrl = url;
      return {
        ok: true, status: 200, json: async () => ({
          empCode: 'DN001', periods: [
            { period: '2026-06', columns: [], rows: [] },
            { period: '2026-07', columns: [], rows: [] },
          ],
        }),
      };
    },
  });
  assert.equal(calledUrl, 'http://hub.test/api/integrations/app-report/employee-cost?emp=DN001&from=2026-06&to=2026-07');
  assert.deepEqual(payload.periods.map((period) => period.period), ['2026-06', '2026-07']);
  assert.equal(payload.empCode, 'DN001');
});

test('period adapter accepts explicit periods/months and rows with period, while stripping blocked fields', () => {
  const range = employeeCost.parseMonthRange({ from: '2026-06', to: '2026-07' });
  const periods = employeeCost.adaptPeriodPayload({
    empCode: 'DN001',
    periods: [
      { period: '2026-06', columns: source.columns, rows: source.rows },
      { month: '07.2026', columns: source.columns, rows: source.rows },
    ],
  }, 'DN001', range);
  assert.deepEqual(periods.periods.map((period) => period.period), ['2026-06', '2026-07']);
  assert.equal(JSON.stringify(periods).includes('c32'), false);
  assert.equal(JSON.stringify(periods).includes('c47'), false);

  const months = employeeCost.adaptPeriodPayload({
    empCode: 'DN001', columns: source.columns,
    months: {
      '2026-06': source.rows,
      '2026-07': { rows: source.rows },
    },
  }, 'DN001', range);
  assert.deepEqual(months.periods.map((period) => period.rows.length), [1, 1]);

  const rowPeriods = employeeCost.adaptPeriodPayload({
    empCode: 'DN001', columns: source.columns,
    rows: [{ ...source.rows[0], period: '2026-06' }, { ...source.rows[0], period: '2026-07' }],
  }, 'DN001', range);
  assert.deepEqual(rowPeriods.periods.map((period) => period.rows.length), [1, 1]);
});

test('period adapter fails closed instead of guessing legacy or ambiguous multi-month payloads', () => {
  const range = employeeCost.parseMonthRange({ from: '2026-06', to: '2026-07' });
  assert.equal(employeeCost.adaptPeriodPayload(source, 'DN001', range), null);
  assert.equal(employeeCost.adaptPeriodPayload({
    empCode: 'DN001', columns: source.columns,
    rows: [{ ...source.rows[0], period: '2026-06' }, { ...source.rows[0] }],
  }, 'DN001', range), null);
  assert.equal(employeeCost.adaptPeriodPayload({
    empCode: 'DN001', periods: [{ period: '2026-08', columns: source.columns, rows: source.rows }],
  }, 'DN001', range), null);

  const oneMonth = employeeCost.parseMonthRange({ from: '2026-07', to: '2026-07' });
  const legacy = employeeCost.adaptPeriodPayload(source, 'DN001', oneMonth);
  assert.equal(legacy.periods[0].period, '2026-07');
  assert.equal(legacy.periods[0].rows.length, 1);
});

test('multi-month enrichment separates month totals and excludes annual columns from the period total', () => {
  const range = employeeCost.parseMonthRange({ from: '2026-06', to: '2026-07' });
  const payload = employeeCost.adaptPeriodPayload({
    empCode: 'DN001', periods: range.months.map((period) => ({
      period,
      columns: [{ key: 'c36', label: 'CP tháng' }, { key: 'c44', label: 'Cuối năm' }],
      rows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c36: 10, c44: 5 }],
    })),
  }, 'DN001', range);
  const revenueRowsByPeriod = Object.fromEntries(range.months.map((period) => [period, [
    { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: period === '2026-06' ? 1_000_000 : 2_000_000 },
  ]]));
  const catalogRowsByPeriod = Object.fromEntries(range.months.map((period) => [period, [
    { c5: 'QL1', c7: 'U1', c16: 'Thuốc' },
  ]]));
  const enriched = employeeCost.enrichRangePayload(payload, { revenueRowsByPeriod, catalogRowsByPeriod });
  assert.deepEqual(enriched.periods.map((period) => period.summary.monthlyTotal), [100_000, 200_000]);
  assert.deepEqual(enriched.periods.map((period) => period.summary.annualTotal), [50_000, 100_000]);
  assert.equal(enriched.summary.periodTotal, 300_000);
  assert.equal(enriched.summary.annualTotal, 150_000);
});

test('daily amount uses monthly percentage and reconciles exactly to its month', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: [{ key: 'c36', label: 'CP tháng' }, { key: 'c44', label: 'Cuối năm' }],
    rows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c36: 10, c44: 5 }],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07',
    catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
    revenueRows: [
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1_000_000, date: '2026-07-01', date_granularity: 'day' },
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 2_000_000, date: '2026-07-02', date_granularity: 'day' },
    ],
  });
  assert.equal(enriched.daily.reliable, true);
  assert.deepEqual(enriched.daily.dates, ['2026-07-01', '2026-07-02']);
  assert.deepEqual(enriched.rows[0].dailyAmounts['2026-07-01'], { c36: 100_000, c44: 50_000 });
  assert.deepEqual(enriched.rows[0].dailyAmounts['2026-07-02'], { c36: 200_000, c44: 100_000 });
  assert.equal(enriched.daily.totals.reduce((sum, day) => sum + day.monthlyTotal, 0), enriched.summary.monthlyTotal);
  assert.equal(enriched.daily.totals.reduce((sum, day) => sum + day.annualTotal, 0), enriched.summary.annualTotal);
});

test('daily allocation reconciles VND rounding residual to the monthly amount', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: [{ key: 'c36', label: 'CP tháng' }],
    rows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c36: 33.3 }],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
    revenueRows: [
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1, date: '2026-07-01', date_granularity: 'day' },
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1, date: '2026-07-02', date_granularity: 'day' },
    ],
  });
  const dailySum = Object.values(enriched.rows[0].dailyAmounts).reduce((sum, amounts) => sum + amounts.c36, 0);
  assert.equal(enriched.summary.monthlyTotal, 1);
  assert.equal(dailySum, enriched.summary.monthlyTotal);
  assert.equal(enriched.daily.reliable, true);
});

test('duplicate cost rows for one unit-product key fail closed instead of double-counting revenue', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: [{ key: 'c36', label: 'CP tháng' }],
    rows: [
      { c5: 'QL1', c7: 'U1', c16: 'Thuốc', c25: 'Viên', c36: 10 },
      { c5: 'QL1', c7: 'U1', c16: 'Thuốc', c25: 'Hộp', c36: 10 },
    ],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1_000_000 }],
  });
  assert.deepEqual(enriched.rows.map((row) => row.amounts.c36), [null, null]);
  assert.equal(enriched.match.rate, 0);
  assert.equal(enriched.summary.monthlyTotal, null);
});

test('daily drill fails closed when a revenue date is absent, outside the month or only period-granular', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: [{ key: 'c36', label: 'CP tháng' }],
    rows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c36: 10 }],
  }, 'DN001');
  for (const invalidRow of [
    { revenue: 1_000_000 },
    { revenue: 1_000_000, date: '2026-06-30', date_granularity: 'day' },
    { revenue: 1_000_000, date: '2026-07-01', date_granularity: 'period' },
  ]) {
    const enriched = employeeCost.enrichWithRevenue(payload, {
      period: '2026-07', catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
      revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', ...invalidRow }],
    });
    assert.equal(enriched.summary.monthlyTotal, 100_000);
    assert.equal(enriched.daily.reliable, false);
    assert.equal(enriched.rows[0].dailyAmounts, null);
    assert.deepEqual(enriched.daily.dates, []);
  }
});
