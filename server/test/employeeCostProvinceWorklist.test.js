const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/employeeCostProvinceWorklist');

const roster = [
  { emp_code: 'DN001', name: 'NV 1' },
  { emp_code: 'DN002', name: 'NV 2' },
];

function row(overrides = {}) {
  return {
    unit_code: '175.BVĐK VŨNG TÀU',
    unit_name: '175.BVĐK VŨNG TÀU',
    emp_code: 'DN001',
    route: 'NCL',
    tong_tien: 100,
    ...overrides,
  };
}

function resolver(config = {}) {
  return (unitCode) => ({ value: config[unitCode] || '', source: config[unitCode] ? 'config' : '' });
}

test('province worklist uniquely aggregates roster units, employees, routes, and revenue then ranks descending', () => {
  const payload = service.buildProvinceWorklist([
    row({ tong_tien: 100, emp_code: 'DN001', route: 'NCL' }),
    row({ tong_tien: 250, emp_code: 'DN002', route: 'ETC' }),
    row({ unit_code: '135.HTNT-FPT LONG CHÂU', unit_name: '135.HTNT-FPT LONG CHÂU', tong_tien: 500, route: 'CL' }),
    row({ unit_code: '999', unit_name: 'Ngoài roster', emp_code: 'DN999', tong_tien: 999999 }),
  ], { roster, from: '2026-07', to: '2026-07', provinceResolver: resolver() });

  assert.equal(payload.rowCount, 2);
  assert.equal(payload.revenueAffected, 850);
  assert.equal(payload.rows[0].unitCode, '135.HTNT-FPT LONG CHÂU');
  assert.equal(payload.rows[1].unitCode, '175.BVĐK VŨNG TÀU');
  assert.deepEqual(payload.rows[1].routes, ['ETC', 'NCL']);
  assert.equal(payload.rows[1].employeeCount, 2);
  assert.equal(payload.rows[1].revenueAffected, 350);
  assert.equal(payload.rows[1].provinceToFill, '');
  assert.deepEqual(Object.keys(payload.rows[1]).sort(), [
    'employeeCount', 'provinceToFill', 'revenueAffected', 'routes', 'unitCode', 'unitName',
  ]);
});

test('official row/config province excludes units while catalog/name guesses remain unresolved', () => {
  const payload = service.buildProvinceWorklist([
    row({ unit_code: '001', province: 'Đồng Nai', province_source: 'source' }),
    row({ unit_code: '002' }),
    row({ unit_code: '003', province: 'Đồng Nai', province_source: 'catalog' }),
    row({ unit_code: '004', province: 'Đồng Nai', province_source: 'guessed_from_name' }),
  ], { roster, provinceResolver: resolver({ '002': 'Bà Rịa - Vũng Tàu' }) });

  assert.deepEqual(payload.rows.map((item) => item.unitCode), ['003', '004']);
  assert.ok(payload.rows.every((item) => !('province' in item)));
});

test('conflicting official provinces fail closed and no sensitive source fields leak', () => {
  const payload = service.buildProvinceWorklist([
    row({ unit_code: 'CONFLICT', province: 'Đồng Nai', province_source: 'source', c32: 3, c47: 4, percent: 5 }),
    row({ unit_code: 'CONFLICT', province: 'TP Hồ Chí Minh', province_source: 'source', c32: 9, c47: 10 }),
  ], { roster, provinceResolver: resolver() });
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].unitCode, 'CONFLICT');
  assert.doesNotMatch(JSON.stringify(payload), /c32|c47|percent/i);
});

test('audit is metadata-only and bounded', () => {
  let saved;
  const storage = {
    load: () => Array.from({ length: service.AUDIT_LIMIT }, (_, index) => ({ index, secret: 'old-only' })),
    save: (name, rows) => { saved = { name, rows }; },
  };
  service.writeAudit({
    actor: 'dn001', role: 'admin', from: '2026-07', to: '2026-07', unitCount: 2,
    revenueAffected: 103588300, outcome: 'ok', rows: [{ c32: 1, c47: 1 }],
  }, storage);
  assert.equal(saved.name, service.AUDIT_FILE);
  assert.equal(saved.rows.length, service.AUDIT_LIMIT);
  const last = saved.rows.at(-1);
  assert.deepEqual(last, {
    at: last.at,
    event: 'province_worklist_export_xlsx',
    actor: 'DN001', role: 'admin', scope: 'ALL', from: '2026-07', to: '2026-07',
    unitCount: 2, revenueAffected: 103588300, outcome: 'ok',
  });
  assert.doesNotMatch(JSON.stringify(last), /c32|c47|rows|secret/i);
});
