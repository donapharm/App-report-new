const test = require('node:test');
const assert = require('node:assert/strict');
const employeeCost = require('../src/employeeCost');
const employeeCostTemplates = require('../src/employeeCostTemplates');

const ASSIGNMENT_KEY = 'assignment-service-key';
const EMPLOYEE_KEYS = 'DN001=employee-secret-key-dn001,DN002=employee-secret-key-dn002';
const credentials = (employeeCostKeys = EMPLOYEE_KEYS) => ({
  assignmentKey: ASSIGNMENT_KEY,
  employeeCostKeys,
});
const FULL_COST_KEYS = ['c36', 'c41', 'c43', 'c44', 'c45'];
const fullColumns = (labels = {}) => FULL_COST_KEYS.map((key) => ({ key, label: labels[key] || key }));
const fullRow = (row = {}) => ({ c36: 0, c41: 0, c43: 0, c44: 0, c45: 0, ...row });

const source = {
  empCode: 'DN001',
  columns: [
    { key: 'c36', pos: 36, label: 'CP ctv (%)' },
    { key: 'c41', pos: 41, label: 'CP đặt hàng (%)' },
    { key: 'c43', pos: 43, label: 'CP bs/td (%)' },
    { key: 'c44', pos: 44, label: 'Lương cuối năm (%)' },
    { key: 'c45', pos: 45, label: 'Lương tăng thêm (%)' },
    { key: 'c32', pos: 32, label: 'Cấm' },
    { key: 'c47', pos: 47, label: 'Cấm' },
  ],
  rows: [fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c25: 'Viên', c36: 8, c41: 3, c32: 11, c47: 99, secret: 'drop' })],
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
    baseUrl: 'http://hub.test', ...credentials(), backoffMs: [], auditImpl: (entry) => audits.push(entry),
    fetchImpl: async (url) => { calledUrl = url; return { ok: true, status: 200, json: async () => source }; },
  });
  assert.match(calledUrl, /emp=DN001$/);
  assert.equal(payload.empCode, 'DN001');
  assert.equal(audits[0].empCode, 'DN001');
});

test('proxy sends both server-selected S2S keys upstream and sanitizes forbidden/unknown fields', async () => {
  let request;
  const result = await employeeCost.fetchEmployeeCost('DN001', {
    baseUrl: 'http://hub.test', ...credentials(), backoffMs: [],
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, status: 200, json: async () => source }; },
  });
  assert.equal(request.url, 'http://hub.test/api/integrations/app-report/employee-cost?emp=DN001');
  assert.equal(request.options.headers['x-assignment-key'], ASSIGNMENT_KEY);
  assert.equal(request.options.headers['x-employee-cost-key'], 'employee-secret-key-dn001');
  assert.deepEqual(result.payload.columns.map((column) => column.key), FULL_COST_KEYS);
  assert.deepEqual(result.payload.rows[0], { c5: 'QL1', c7: 'U1', c16: 'Thuốc', c25: 'Viên', c36: 8, c41: 3, c43: 0, c44: 0, c45: 0 });
  assert.equal(JSON.stringify(result.payload).includes(ASSIGNMENT_KEY), false);
  assert.equal(JSON.stringify(result.payload).includes('employee-secret-key-dn001'), false);
  assert.equal(JSON.stringify(result.payload).includes('c32'), false);
  assert.equal(JSON.stringify(result.payload).includes('c47'), false);

  const wrongEmployee = employeeCost.sanitizePayload({ ...source, empCode: 'DN999' }, 'DN001');
  assert.deepEqual(wrongEmployee, { empCode: 'DN001', columns: [], rows: [], note: employeeCost.DEFAULT_NOTE });
  const mismatch = await employeeCost.fetchEmployeeCost('DN001', {
    baseUrl: 'http://hub.test', ...credentials(), backoffMs: [],
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ...source, empCode: 'DN999' }) }),
  });
  assert.equal(mismatch.outcome, 'scope_mismatch');
  assert.equal(mismatch.payload.rows.length, 0);
});

test('two authenticated employees use distinct server-selected cost keys', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const empCode = new URL(url).searchParams.get('emp');
    return { ok: true, status: 200, json: async () => ({ empCode, columns: [], rows: [] }) };
  };
  await employeeCost.getForSession({
    scope: { empCode: 'dn001' }, session: { emp_code: 'DN001', role: 'sale' }, requestedEmp: 'DN999',
  }, { baseUrl: 'http://hub.test', ...credentials(), backoffMs: [], auditImpl: () => {}, fetchImpl });
  await employeeCost.getForSession({
    scope: { empCode: 'DN002' }, session: { emp_code: 'DN002', role: 'sale' }, requestedEmp: 'DN999',
  }, { baseUrl: 'http://hub.test', ...credentials(), backoffMs: [], auditImpl: () => {}, fetchImpl });

  assert.deepEqual(requests.map((request) => request.options.headers['x-employee-cost-key']), [
    'employee-secret-key-dn001', 'employee-secret-key-dn002',
  ]);
  assert.deepEqual(requests.map((request) => request.options.headers['x-assignment-key']), [ASSIGNMENT_KEY, ASSIGNMENT_KEY]);
});

test('missing, malformed, duplicated, conflicting or reused employee keys fail closed before network', async () => {
  const badMappings = [
    '',
    'DN001=short',
    'bad employee=employee-secret-key-dn001',
    'DN001=shared-employee-key-0001,DN002=shared-employee-key-0001',
    'DN001=employee-secret-key-dn001,DN001=employee-secret-key-other1',
    `DN001=${ASSIGNMENT_KEY}`,
  ];
  for (const employeeCostKeys of badMappings) {
    let calls = 0;
    const result = await employeeCost.fetchEmployeeCost('DN001', {
      baseUrl: 'http://hub.test', ...credentials(employeeCostKeys), backoffMs: [],
      fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
    });
    assert.equal(calls, 0, employeeCostKeys || 'missing mapping');
    assert.equal(result.outcome, 'not_configured');
    assert.equal(result.attempts, 0);
  }
});

test('legacy shared APP_REPORT_COST_TOKEN cannot authorize employee cost reads', async () => {
  let calls = 0;
  const result = await employeeCost.fetchEmployeeCost('DN001', {
    baseUrl: 'http://hub.test', token: 'legacy-placeholder-that-used-to-work',
    employeeCostKey: 'caller-controlled-employee-key',
    assignmentKey: '', employeeCostKeys: '', backoffMs: [],
    fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
  });
  assert.equal(calls, 0);
  assert.equal(result.outcome, 'not_configured');
});

test('502 retries with backoff then succeeds; 401 returns safe empty payload', async () => {
  let calls = 0;
  const waits = [];
  const recovered = await employeeCost.fetchEmployeeCost('DN001', {
    baseUrl: 'http://hub.test', ...credentials(), backoffMs: [2, 4], sleepImpl: async (ms) => waits.push(ms),
    fetchImpl: async () => { calls += 1; return calls < 3 ? { ok: false, status: 502 } : { ok: true, status: 200, json: async () => source }; },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2, 4]);
  assert.equal(recovered.outcome, 'ok');

  const denied = await employeeCost.fetchEmployeeCost('DN001', {
    baseUrl: 'http://hub.test', ...credentials(), backoffMs: [],
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.deepEqual(denied.payload, { empCode: 'DN001', columns: [], rows: [], note: employeeCost.DEFAULT_NOTE });
});

test('maps C16 through catalog, joins revenue by unit + product code and calculates each amount', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001',
    columns: [...fullColumns({ c36: 'CP tháng (%)', c44: 'Thưởng cuối năm (%)' }), { key: 'c47', pos: 47, label: 'Cấm' }],
    rows: [
      fullRow({ c5: 'QL01', c7: 'U1', c16: 'Thuốc Á', c25: 'Viên', c36: 8, c44: 0.3, c47: 99 }),
      fullRow({ c5: 'QL02', c7: 'U2', c16: 'Thuốc B', c25: 'Gói', c36: 0.3, c44: 10 }),
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
  assert.equal(enriched.rows[0].amounts.c36, 761_905);
  assert.equal(enriched.rows[0].amounts.c44, 0);
  assert.equal(enriched.rows[0].amounts.c41, 0);
  assert.equal(enriched.rows[1].amounts.c36, 28_571);
  assert.equal(enriched.rows[1].amounts.c44, 0);
  assert.deepEqual(enriched.match, { matchedRows: 2, totalRows: 2, rate: 100, threshold: 90, low: false });
  assert.equal(enriched.summary.monthlyTotal, 790_476);
  assert.equal(enriched.summary.annualTotal, 0);
  assert.deepEqual(enriched.summary.columnTotals, {
    c36: 790_476, c41: 0, c43: 0, c44: 0, c45: 0,
  });
  assert.deepEqual(enriched.summary.annualColumnKeys, ['c44']);
  assert.equal(enriched.columns.find((column) => column.key === 'c44').annual, true);
  assert.equal(enriched.columns.find((column) => column.key === 'c44').derivesFrom, 'c43');
  assert.equal(JSON.stringify(enriched).includes('c47'), false);
});

test('C44 derives from the allocated C43 amount instead of revenue before VAT', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns(),
    rows: [fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c43: 12, c44: 5 })],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 13_246_800 }],
  });
  const row = enriched.rows[0];
  assert.equal(row.revenueBeforeVat, 12_616_000);
  assert.equal(row.amounts.c43, 1_513_920);
  assert.equal(row.amounts.c44, 75_696);
  assert.equal(row.rowMonthlyTotal, 1_513_920);
  assert.equal(row.rowAnnualTotal, 75_696);
  assert.equal(enriched.summary.monthlyTotal, 1_513_920);
  assert.equal(enriched.summary.annualTotal, 75_696);
  assert.deepEqual(enriched.summary.columnTotals, {
    c36: 0, c41: 0, c43: 1_513_920, c44: 75_696, c45: 0,
  });
  assert.equal(enriched.columns.find((column) => column.key === 'c44').derivesFrom, 'c43');
});

test('filter metadata keeps official province, drops inferred province, and maps unit prefix without changing money', () => {
  const unit = '002.BVĐK Thống Nhất ĐN';
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns(), rows: [fullRow({ c5: 'QL1', c7: unit, c16: 'Thuốc', c36: 10 })],
  }, 'DN001');
  const official = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c7: unit, c16: 'Thuốc' }],
    revenueRows: [{ emp_code: 'DN001', unit_code: unit, iit_code: 'QL1', revenue: 1_050_000, province: 'ĐỒNG NAI', province_source: 'source', route: 'CL' }],
  }).rows[0];
  assert.equal(official.province, 'ĐỒNG NAI');
  assert.equal(official.unitGroup, 'BV');
  assert.equal(official.unitGroupLabel, 'BV · Bệnh viện');
  assert.equal(official.route, 'CL');
  assert.equal(official.revenueBeforeVat, 1_000_000);

  const inferred = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c7: unit, c16: 'Thuốc' }],
    revenueRows: [{ emp_code: 'DN001', unit_code: unit, iit_code: 'QL1', revenue: 1_050_000, province: 'ĐỒNG NAI', province_source: 'inferred', route: 'CL' }],
  }).rows[0];
  assert.equal(inferred.province, null);
});

test('one authoritative province row safely covers other rows of the exact same unit, but conflicts fail closed', () => {
  const official = { unit_code: '001.BVĐK Đồng Nai', province: 'ĐỒNG NAI', province_source: 'source' };
  const inferred = { unit_code: '001.BVĐK Đồng Nai', province: 'Đồng Nai', province_source: 'inferred' };
  const guessed = { unit_code: '001.BVĐK Đồng Nai', province: 'Đồng Nai', province_source: 'guessed_from_name' };
  const catalog = { unit_code: '001.BVĐK Đồng Nai', province: 'Đồng Nai', province_source: 'catalog' };
  assert.equal(employeeCost.authoritativeProvinceByUnit([official, inferred, guessed, catalog]).get('001.BVĐK ĐỒNG NAI'), 'ĐỒNG NAI');
  const conflict = { unit_code: '001.BVĐK Đồng Nai', province: 'BÌNH PHƯỚC', province_source: 'source' };
  assert.equal(employeeCost.authoritativeProvinceByUnit([official, conflict]).get('001.BVĐK ĐỒNG NAI'), null);
  assert.equal(employeeCost.authoritativeProvinceByUnit([], [official]).has('001.BVĐK ĐỒNG NAI'), false);
});

test('does not match raw names, leaves amounts null and suppresses unreliable totals below threshold', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns({ c36: 'CP (%)' }),
    rows: [
      fullRow({ c5: 'QL01', c7: 'U1', c16: 'Thuốc A', c36: 8 }),
      fullRow({ c5: 'QL99', c7: 'U9', c16: 'Tên chỉ có trong doanh thu', c36: 8 }),
    ],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    catalogRows: [{ c5: 'QL01', c7: 'U1', c16: 'Thuốc A' }],
    revenueRows: [
      { unit_code: 'U1', iit_code: 'QL01', product_name: 'Tên khác catalog', revenue: 10_000_000 },
      { unit_code: 'U9', iit_code: 'QL99', product_name: 'Tên chỉ có trong doanh thu', revenue: 10_000_000 },
    ],
  });

  assert.equal(enriched.rows[0].amounts.c36, 761_905);
  assert.equal(enriched.rows[1].amounts.c36, null);
  assert.deepEqual(enriched.match, { matchedRows: 1, totalRows: 2, rate: 50, threshold: 90, low: true });
  assert.equal(enriched.summary.reliable, false);
  assert.equal(enriched.summary.monthlyTotal, null);
  assert.equal(enriched.summary.annualTotal, null);
  assert.equal(enriched.summary.columnTotals, null);
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
    baseUrl: 'http://hub.test', ...credentials(), backoffMs: [], period: '07.2026',
    catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 10_000_000 }],
    auditImpl: () => {},
    fetchImpl: async (url) => { calledUrl = url; return { ok: true, status: 200, json: async () => source }; },
  });
  assert.match(calledUrl, /emp=DN001$/);
  assert.equal(payload.empCode, 'DN001');
  assert.equal(payload.rows[0].amounts.c36, 761_905);
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
    baseUrl: 'http://hub.test', ...credentials(), backoffMs: [], from: '2026-06', to: '2026-07',
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
      columns: fullColumns({ c36: 'CP tháng', c44: 'Cuối năm' }),
      rows: [fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c36: 10, c43: 10, c44: 5 })],
    })),
  }, 'DN001', range);
  const revenueRowsByPeriod = Object.fromEntries(range.months.map((period) => [period, [
    { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: period === '2026-06' ? 1_000_000 : 2_000_000 },
  ]]));
  const catalogRowsByPeriod = Object.fromEntries(range.months.map((period) => [period, [
    { c5: 'QL1', c7: 'U1', c16: 'Thuốc' },
  ]]));
  const enriched = employeeCost.enrichRangePayload(payload, { revenueRowsByPeriod, catalogRowsByPeriod });
  assert.deepEqual(enriched.periods.map((period) => period.summary.monthlyTotal), [190_476, 380_952]);
  assert.deepEqual(enriched.periods.map((period) => period.summary.annualTotal), [4_762, 9_524]);
  assert.equal(enriched.summary.periodTotal, 571_428);
  assert.equal(enriched.summary.annualTotal, 14_286);
  assert.deepEqual(enriched.summary.columnTotals, {
    c36: 285_714, c41: 0, c43: 285_714, c44: 14_286, c45: 0,
  });
  assert.deepEqual(enriched.summary.annualColumnKeys, ['c44']);
});

test('Cerecaps T06 DN001 keeps two order-lines instead of aggregating unit-product revenue', () => {
  const product = 'G3.ĐY.QĐ141.145.N3.133';
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001',
    columns: fullColumns({ c36: 'CP tháng', c44: 'Cuối năm' }),
    // Timeline lookup is unit+product+month while detail remains order-line.
    rows: [
      fullRow({ c5: product, c7: '171', c16: 'Cerecaps', c36: 8, c44: 1 }),
      fullRow({ c5: product, c7: '038', c16: 'Cerecaps', c36: 8, c44: 1 }),
    ],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-06',
    catalogRows: [
      { c5: product, c7: '171', c16: 'Cerecaps', c25: 'Viên' },
      { c5: product, c7: '038', c16: 'Cerecaps', c25: 'Viên' },
    ],
    revenueRows: [
      { emp_code: 'DN001', source_order: 'DH-001', source_line_id: 'DH-001-1', date: '2026-06-13', date_granularity: 'day', unit_code: '171', unit_name: 'PKĐK Nam Việt', iit_code: product, product_name: 'Cerecaps', uom: 'Viên', quantity: 4_980, revenue: 13_246_800 },
      { emp_code: 'DN001', source_order: 'DH-002', source_line_id: 'DH-002-1', date: '2026-06-16', date_granularity: 'day', unit_code: '038', unit_name: 'PKĐK Thiện Nhân', iit_code: product, product_name: 'Cerecaps', uom: 'Viên', quantity: 4_500, revenue: 11_970_000 },
    ],
  });

  assert.equal(enriched.rows.length, 2);
  assert.deepEqual(enriched.rows.map((row) => row.revenue), [13_246_800, 11_970_000]);
  assert.deepEqual(enriched.rows.map((row) => row.orderCode), ['DH-001', 'DH-002']);
  assert.deepEqual(enriched.rows.map((row) => row.amounts.c36), [1_009_280, 912_000]);
  assert.equal(enriched.summary.revenueTotal, 25_216_800);
  assert.equal(enriched.summary.monthlyTotal, 1_921_280);
  assert.equal(enriched.summary.annualTotal, 0);
  assert.equal(enriched.daily.totals.reduce((sum, day) => sum + day.monthlyTotal, 0), enriched.summary.monthlyTotal);
});

test('raw App Report upload aliases retain the two real Cerecaps T06 DN001 lines', () => {
  const rows = employeeCost.buildRevenueLines([
    { DATE: '2026-06-13', DONVI: '171.PKĐK NAM VIỆT', EMP_NUMBER: 'DN001', IIT_CODE: 'G3.ĐY.QĐ141.145.N3.133', ITEM_NAME: 'Cerecaps', UOM: 'Viên', QUANTITY: 4_980, REVENUE: 13_246_800 },
    { DATE: '2026-06-16', DONVI: '038.PKĐK THIỆN NHÂN', EMP_NUMBER: 'DN001', IIT_CODE: 'G3.ĐY.QĐ141.145.N3.133', ITEM_NAME: 'Cerecaps', UOM: 'Viên', QUANTITY: 4_500, REVENUE: 11_970_000 },
  ], 'DN001', '2026-06');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.unit), ['171', '038']);
  assert.deepEqual(rows.map((row) => row.revenue), [13_246_800, 11_970_000]);
  assert.deepEqual(rows.map((row) => row.date), ['2026-06-13', '2026-06-16']);
});

test('one order with multiple products renders one row per source line', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns({ c36: 'CP tháng' }),
    rows: [
      fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc A', c36: 10 }),
      fullRow({ c5: 'QL2', c7: 'U1', c16: 'Thuốc B', c36: 5 }),
    ],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07',
    catalogRows: [
      { c5: 'QL1', c7: 'U1', c16: 'Thuốc A' },
      { c5: 'QL2', c7: 'U1', c16: 'Thuốc B' },
    ],
    revenueRows: [
      { emp_code: 'DN001', source_order: 'ORDER-7', source_line_id: 'ORDER-7-1', date: '2026-07-05', date_granularity: 'day', unit_code: 'U1', iit_code: 'QL1', revenue: 1_000_000 },
      { emp_code: 'DN001', source_order: 'ORDER-7', source_line_id: 'ORDER-7-2', date: '2026-07-05', date_granularity: 'day', unit_code: 'U1', iit_code: 'QL2', revenue: 2_000_000 },
    ],
  });
  assert.equal(enriched.rows.length, 2);
  assert.deepEqual(enriched.rows.map((row) => row.c5), ['QL1', 'QL2']);
  assert.deepEqual(enriched.rows.map((row) => row.orderCode), ['ORDER-7', 'ORDER-7']);
  assert.deepEqual(enriched.rows.map((row) => row.amounts.c36), [95_238, 95_238]);
});

test('revenue lines remain visible when DataHub timeline is unavailable', () => {
  const enriched = employeeCost.enrichWithRevenue({ empCode: 'DN001', columns: [], rows: [], note: employeeCost.DEFAULT_NOTE }, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc A' }],
    revenueRows: [
      { emp_code: 'DN001', source_order: 'ORDER-1', date: '2026-07-01', date_granularity: 'day', unit_code: 'U1', iit_code: 'QL1', revenue: 1_000_000 },
      { emp_code: 'DN001', source_order: 'ORDER-2', date: '2026-07-02', date_granularity: 'day', unit_code: 'U1', iit_code: 'QL1', revenue: 2_000_000 },
    ],
  });
  assert.equal(enriched.rows.length, 2);
  assert.deepEqual(enriched.rows.map((row) => row.revenue), [1_000_000, 2_000_000]);
  assert.equal(enriched.match.matchedRows, 0);
  assert.equal(enriched.summary.monthlyTotal, null);
  assert.equal(enriched.note, undefined);
});

test('getForSession returns scoped revenue order-lines when DataHub is not configured', async () => {
  const payload = await employeeCost.getForSession({
    session: { emp_code: 'DN001', role: 'sale' }, scope: { empCode: 'DN001' }, requestedEmp: 'DN999',
  }, {
    from: '2026-06', to: '2026-06', baseUrl: '', assignmentKey: '', employeeCostKeys: '',
    revenueRowsByPeriod: {
      '2026-06': [
        { emp_code: 'DN001', source_order: 'DH-1', source_line_id: 'DH-1-1', date: '2026-06-13', date_granularity: 'day', unit_code: '171', iit_code: 'CERECAPS', revenue: 13_246_800 },
        { emp_code: 'DN001', source_order: 'DH-2', source_line_id: 'DH-2-1', date: '2026-06-16', date_granularity: 'day', unit_code: '038', iit_code: 'CERECAPS', revenue: 11_970_000 },
      ],
    },
    catalogRowsByPeriod: { '2026-06': [{ c5: 'CERECAPS', c7: '171', c16: 'Cerecaps' }, { c5: 'CERECAPS', c7: '038', c16: 'Cerecaps' }] },
    auditImpl: () => {},
  });
  assert.equal(payload.empCode, 'DN001');
  assert.deepEqual(payload.periods[0].rows.map((row) => row.revenue), [13_246_800, 11_970_000]);
  assert.deepEqual(payload.periods[0].rows.map((row) => row.c36), [null, null]);
  assert.equal(payload.periods[0].summary.monthlyTotal, null);
});

test('daily amount uses monthly percentage and reconciles exactly to its month', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns({ c36: 'CP tháng', c44: 'Cuối năm' }),
    rows: [fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c36: 10, c43: 10, c44: 5 })],
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
  assert.equal(enriched.rows.length, 2);
  assert.equal(enriched.rows[0].dailyAmounts['2026-07-01'].c36, 95_238);
  assert.equal(enriched.rows[0].dailyAmounts['2026-07-01'].c44, 4_762);
  assert.equal(enriched.rows[1].dailyAmounts['2026-07-02'].c36, 190_476);
  assert.equal(enriched.rows[1].dailyAmounts['2026-07-02'].c44, 9_524);
  assert.equal(enriched.daily.totals.reduce((sum, day) => sum + day.monthlyTotal, 0), enriched.summary.monthlyTotal);
  assert.equal(enriched.daily.totals.reduce((sum, day) => sum + day.annualTotal, 0), enriched.summary.annualTotal);
});

test('daily allocation reconciles VND rounding residual to the monthly amount', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns({ c36: 'CP tháng' }),
    rows: [fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c36: 33.3 })],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
    revenueRows: [
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1, date: '2026-07-01', date_granularity: 'day' },
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1, date: '2026-07-02', date_granularity: 'day' },
    ],
  });
  const dailySum = enriched.rows.reduce((sum, row) => sum + Object.values(row.dailyAmounts)[0].c36, 0);
  assert.equal(enriched.rows.length, 2);
  assert.deepEqual(enriched.rows.map((row) => row.amounts.c36), [0, 1]);
  assert.equal(enriched.summary.monthlyTotal, 1);
  assert.equal(dailySum, enriched.summary.monthlyTotal);
  assert.equal(enriched.daily.reliable, true);
});

test('derived-column residual uses the reconciled source-column amount and keeps daily totals exact', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns(),
    rows: [fullRow({ c5: 'QL1', c7: 'U1', c43: 10, c44: 33.3 })],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
    revenueRows: [
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', source_line_id: 'L1', revenue: 1_055.25, date: '2026-07-01', date_granularity: 'day' },
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', source_line_id: 'L2', revenue: 1_055.25, date: '2026-07-02', date_granularity: 'day' },
    ],
  });
  assert.deepEqual(enriched.rows.map((row) => row.amounts.c43), [101, 100]);
  assert.deepEqual(enriched.rows.map((row) => row.amounts.c44), [34, 33]);
  assert.equal(enriched.summary.monthlyTotal, 201);
  assert.equal(enriched.summary.annualTotal, 67);
  assert.equal(enriched.daily.totals.reduce((sum, day) => sum + day.monthlyTotal, 0), 201);
  assert.equal(enriched.daily.totals.reduce((sum, day) => sum + day.annualTotal, 0), 67);
  assert.equal(enriched.daily.reliable, true);
});

test('timeline lookup uses unit+product and isolates conflicting duplicates to that exact key', () => {
  const makePayload = (duplicateU1Rate = null) => employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns({ c36: 'CP tháng' }),
    rows: [
      fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c25: 'Viên', c36: 10 }),
      fullRow({ c5: 'QL1', c7: 'U2', c16: 'Thuốc', c25: 'Hộp', c36: 12 }),
      ...(duplicateU1Rate == null ? [] : [fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c25: 'Viên', c36: duplicateU1Rate })]),
    ],
  }, 'DN001');
  const options = {
    period: '2026-07', catalogRows: [
      { c5: 'QL1', c7: 'U1', c16: 'Thuốc' }, { c5: 'QL1', c7: 'U2', c16: 'Thuốc' },
    ],
    revenueRows: [
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1_000_000 },
      { emp_code: 'DN001', unit_code: 'U2', iit_code: 'QL1', revenue: 1_000_000 },
    ],
  };
  const isolated = employeeCost.enrichWithRevenue(makePayload(), options);
  assert.deepEqual(isolated.rows.map((row) => row.amounts.c36), [95_238, 114_286]);
  assert.deepEqual(isolated.rows.map((row) => row.c36), [10, 12]);
  assert.equal(isolated.match.rate, 100);

  const conflicting = employeeCost.enrichWithRevenue(makePayload(11), options);
  assert.deepEqual(conflicting.rows.map((row) => row.amounts.c36), [null, 114_286]);
  assert.equal(conflicting.match.matchedRows, 1);
  assert.equal(conflicting.match.totalRows, 2);
  assert.equal(conflicting.match.rate, 50);
  assert.equal(conflicting.summary.monthlyTotal, null);
});

test('coverage counts unique unit+product keys while preserving repeated order-line rows', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns({ c36: 'CP tháng' }),
    rows: [fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c36: 10 })],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc' }],
    revenueRows: [
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', source_order: 'DH1', source_line_id: 'L1', revenue: 1_000_000 },
      { emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', source_order: 'DH2', source_line_id: 'L2', revenue: 2_000_000 },
    ],
  });
  assert.equal(enriched.rows.length, 2);
  assert.deepEqual(enriched.rows.map((row) => row.orderCode), ['DH1', 'DH2']);
  assert.equal(enriched.match.matchedRows, 1);
  assert.equal(enriched.match.totalRows, 1);
  assert.equal(enriched.match.rate, 100);
});

test('template config keeps calculation groups separate and resolves exact full-time/part-time layouts', () => {
  const config = employeeCostTemplates.loadConfig();
  const fulltime = employeeCostTemplates.resolveTemplate('DN001', config);
  const parttime = employeeCostTemplates.resolveTemplate('DN021', config);
  assert.equal(fulltime.calculationGroup, 'fulltime');
  assert.equal(fulltime.key, 'fulltime');
  assert.deepEqual(fulltime.costColumns, ['c36', 'c41', 'c43', 'c44', 'c45']);
  assert.equal(fulltime.columns.length, 19);
  assert.equal(fulltime.columns.at(-1), 'note');
  assert.ok(fulltime.columns.indexOf('bidPrice') < fulltime.columns.indexOf('quantity'));
  assert.equal(parttime.calculationGroup, 'parttime');
  assert.deepEqual(parttime.costColumns, ['c36']);
  assert.equal(parttime.columns.length, 15);
  assert.deepEqual(fulltime.derivedBases, { c44: 'c43' });
  assert.deepEqual(parttime.derivedBases, {});
  assert.deepEqual(['DN021', 'DN022', 'DN023'].map((emp) => employeeCostTemplates.resolveTemplate(emp, config).key), ['parttime', 'parttime', 'parttime']);
});

test('derived bases are configurable and malformed dependencies fail closed', () => {
  const config = employeeCostTemplates.loadConfig();
  const changed = employeeCostTemplates.resolveTemplate('DN001', config, 'c44:c41');
  assert.deepEqual(changed.derivedBases, { c44: 'c41' });

  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns(),
    rows: [fullRow({ c5: 'QL1', c7: 'U1', c41: 20, c43: 12, c44: 5 })],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    derivedBaseConfig: 'c44:c41', catalogRows: [{ c5: 'QL1', c7: 'U1' }],
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1_050_000 }],
  });
  assert.equal(enriched.rows[0].amounts.c41, 200_000);
  assert.equal(enriched.rows[0].amounts.c44, 10_000);
  assert.equal(enriched.columns.find((column) => column.key === 'c44').derivesFrom, 'c41');

  for (const value of ['c44:c44', 'c44:c47', 'c44:c43,c44:c41', 'c44:c45,c45:c44', 'c44:c46', 'c46:c43']) {
    assert.throws(() => employeeCostTemplates.resolveTemplate('DN001', config, value), (error) => {
      assert.match(error.code || '', /^EMPLOYEE_COST_DERIVED_BASE_/);
      return true;
    }, value);
  }
});

test('unresolved derived base stays null and cannot make coverage reliable', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns(),
    rows: [{ c5: 'QL1', c7: 'U1', c36: 0, c41: 0, c43: null, c44: 5, c45: 0 }],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    catalogRows: [{ c5: 'QL1', c7: 'U1' }],
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1_050_000 }],
  });
  assert.equal(enriched.rows[0].amounts.c44, null);
  assert.equal(enriched.rows[0].revenueMatched, false);
  assert.equal(enriched.summary.reliable, false);
  assert.equal(enriched.summary.annualTotal, null);
});

test('missing required full-time percentage stays null and suppresses totals through coverage', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns(),
    rows: [{ c5: 'QL1', c7: 'U1', c36: 10, c41: null, c43: 3, c44: 4, c45: 5 }],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07', catalogRows: [{ c5: 'QL1', c16: 'Thuốc' }],
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', iit_code: 'QL1', revenue: 1_050_000 }],
  });
  assert.equal(enriched.rows[0].c41, null);
  assert.equal(enriched.rows[0].amounts.c36, 100_000);
  assert.equal(enriched.match.rate, 0);
  assert.equal(enriched.summary.monthlyTotal, null);
});

test('part-time employees receive only C36 even when DataHub publishes full-time percentages', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN021',
    columns: ['c36', 'c41', 'c43', 'c44', 'c45'].map((key) => ({ key, label: key })),
    rows: [{ c5: 'QL1', c7: 'U1', c36: 10, c41: 2, c43: 3, c44: 4, c45: 5 }],
  }, 'DN021');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07',
    catalogRows: [{ c5: 'QL1', c16: 'Thuốc' }],
    revenueRows: [{ emp_code: 'DN021', unit_code: 'U1', iit_code: 'QL1', revenue: 1_050_000 }],
  });
  assert.equal(enriched.template.key, 'parttime');
  assert.deepEqual(enriched.columns.map((column) => column.key), ['c36']);
  assert.deepEqual(enriched.rows[0].amounts, { c36: 100_000 });
  assert.equal(enriched.summary.monthlyTotal, 100_000);
});

test('employee-cost exposes approved sale fields, calculates before VAT and safely allowlists C48 note', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001',
    columns: ['c36', 'c41', 'c43', 'c44', 'c45', 'c47'].map((key) => ({ key, label: key })),
    rows: [{ c5: 'QL1', c7: 'U1', c36: 10, c41: 2, c43: 3, c44: 4, c45: 5, c47: 99, c48: '  Ghi\u0000 chú từ Data Hub  ', privateNote: 'drop' }],
  }, 'DN001');
  const enriched = employeeCost.enrichWithRevenue(payload, {
    period: '2026-07',
    catalogRows: [{ c5: 'QL1', c16: 'Thuốc A', ham_luong: 'Viên nén 500 mg', c25: 'Viên', c31: 1_050 }],
    revenueRows: [{
      emp_code: 'DN001', source_order: 'DH-001', date: '2026-07-05', date_granularity: 'day',
      unit_code: 'U1', unit_name: 'Bệnh viện A', iit_code: 'QL1', quantity: 1_000, revenue: 1_050_000,
      tuyen: 'Tuyến tỉnh', contractor_name: 'Nhà thầu ABC',
    }],
  });
  const row = enriched.rows[0];
  assert.equal(row.revenueBeforeVat, 1_000_000);
  assert.equal(row.amounts.c36, 100_000);
  assert.equal(row.route, 'Tuyến tỉnh');
  assert.equal(row.contractorName, 'Nhà thầu ABC');
  assert.equal(row.strength, 'Viên nén 500 mg');
  assert.equal(row.bidPrice, 1_050);
  assert.equal(row.note, 'Ghi chú từ Data Hub');
  assert.equal(JSON.stringify(enriched).includes('privateNote'), false);
  assert.equal(JSON.stringify(enriched).includes('c47'), false);
});

test('canonical DATA_HUB_BASE_URL overrides the legacy DataHub base setting', () => {
  const previousCanonical = process.env.DATA_HUB_BASE_URL;
  const previousLegacy = process.env.DATAHUB_BASE;
  process.env.DATA_HUB_BASE_URL = 'https://canonical.example/';
  process.env.DATAHUB_BASE = 'https://legacy.example/';
  try {
    assert.equal(employeeCost.resolveDataHubBaseUrl(), 'https://canonical.example');
  } finally {
    if (previousCanonical == null) delete process.env.DATA_HUB_BASE_URL; else process.env.DATA_HUB_BASE_URL = previousCanonical;
    if (previousLegacy == null) delete process.env.DATAHUB_BASE; else process.env.DATAHUB_BASE = previousLegacy;
  }
});

test('daily drill fails closed when a revenue date is absent, outside the month or only period-granular', () => {
  const payload = employeeCost.sanitizePayload({
    empCode: 'DN001', columns: fullColumns({ c36: 'CP tháng' }),
    rows: [fullRow({ c5: 'QL1', c7: 'U1', c16: 'Thuốc', c36: 10 })],
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
    assert.equal(enriched.summary.monthlyTotal, 95_238);
    assert.equal(enriched.daily.reliable, false);
    assert.equal(enriched.rows[0].date, null);
    assert.equal(enriched.rows[0].dailyAmounts, null);
    assert.deepEqual(enriched.daily.dates, []);
  }
});
