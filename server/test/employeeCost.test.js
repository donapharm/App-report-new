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
