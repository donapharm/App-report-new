const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const ExcelJS = require('exceljs');
const gaps = require('../src/employeeCostGaps');

const columns = ['c36', 'c41', 'c43', 'c44', 'c45'].map((key) => ({ key, label: key }));
const costRow = (row = {}) => ({ c36: 0, c41: 0, c43: 0, c44: 0, c45: 0, ...row });
const rangePayload = (empCode, rows) => ({
  empCode, from: '2026-07', to: '2026-07',
  periods: [{ empCode, period: '2026-07', columns, rows }],
});

function fixtureDeps({ employees = ['DN001'], sameGap = false } = {}) {
  const calls = [];
  const revenueRowsFor = async (empCode) => [
    { emp_code: empCode, unit_code: `U-${empCode}`, iit_code: 'MATCH', product_name: 'Thuốc đã khớp', revenue: 1_000_000 },
    { emp_code: empCode, unit_code: `GAP-${empCode}`, iit_code: sameGap ? 'G1.GE.QĐ139.2963.N4.549' : `MISS-${empCode}`, product_name: 'Valesto', revenue: empCode === 'DN001' ? 2_000_000 : 3_000_000 },
  ];
  const catalogRowsFor = async () => employees.flatMap((empCode) => [
    { c7: `U-${empCode}`, c5: 'MATCH', c16: 'Thuốc đã khớp' },
    { c7: `GAP-${empCode}`, c5: sameGap ? 'G1.GE.QĐ48.549.N4.549' : `CAT-${empCode}`, c16: 'Valesto' },
  ]);
  const fetchCost = async (empCode) => {
    calls.push(empCode);
    return {
      outcome: 'ok', attempts: 1,
      payload: rangePayload(empCode, [
        costRow({ c7: `U-${empCode}`, c5: 'MATCH', c16: 'Thuốc đã khớp', c36: 5 }),
        costRow({ c7: `GAP-${empCode}`, c5: sameGap ? 'G1.GE.QĐ48.549.N4.549' : `CAT-${empCode}`, c16: 'Valesto', c36: 5 }),
      ]),
    };
  };
  return { calls, revenueRowsFor, catalogRowsFor, fetchCost };
}

test('QD suggestion requires same unit and product name and never auto-maps the revenue code', () => {
  const pair = { unitLabel: 'U1.Bệnh viện', productCode: 'G1.GE.QĐ139.2963.N4.549', productName: 'Valesto' };
  const suggestion = gaps.findCatalogSuggestion(pair, [
    { c7: 'U2.Bệnh viện khác', c5: 'G1.GE.QĐ48.549.N4.549', c16: 'Valesto' },
    { c7: 'U1.Bệnh viện', c5: 'G1.GE.QĐ48.549.N4.549', c16: 'Thuốc khác' },
    { c7: 'U1.Bệnh viện', c5: 'G1.GE.QĐ48.549.N4.549', c16: 'Valesto' },
  ]);
  assert.equal(suggestion, 'G1.GE.QĐ48.549.N4.549');
  assert.notEqual(suggestion, pair.productCode);
  assert.equal(gaps.findCatalogSuggestion(pair, [
    { c7: 'U1.Bệnh viện', c5: 'G9.BT.QĐ999.1.N1.2', c16: 'Valesto' },
  ]), null);
});

test('DN001 T07 acceptance grain keeps 13 unique missing unit-product pairs', () => {
  const rows = [
    ...Array.from({ length: 171 }, (_, index) => ({ c7: `MATCH-${index}`, c5: `OK-${index}`, c16: 'Đã có tỷ lệ', revenue: 1, revenueMatched: true })),
    ...Array.from({ length: 13 }, (_, index) => ({ c7: `GAP-${index}`, c5: `MISS-${index}`, c16: 'Thiếu tỷ lệ', revenue: index + 1, revenueMatched: false })),
  ];
  const pairs = gaps.groupGapRows({ rows }, { empCode: 'DN001', employeeName: 'DN001', period: '2026-07', catalogRows: [] });
  assert.equal(pairs.length, 13);
  assert.equal(new Set(pairs.map((pair) => `${pair.unitLabel}\u001f${pair.productCode}`)).size, 13);
});

test('sale gap read is self-scoped, returns only missing pairs, and exposes no percentages', async () => {
  const deps = fixtureDeps({ sameGap: true });
  const audits = [];
  const payload = await gaps.buildForSession({
    session: { emp_code: 'DN001', role: 'sale' }, scope: { empCode: 'DN001' }, requestedEmp: 'DN999',
    roster: [{ emp_code: 'DN001', name: 'NV 1' }], from: '2026-07', to: '2026-07',
    ...deps, auditImpl: (entry) => audits.push(entry),
  });
  assert.deepEqual(deps.calls, ['DN001']);
  assert.deepEqual(payload.scope, { admin: false, employeeCode: 'DN001' });
  assert.equal(payload.coverage.matchedPairs, 1);
  assert.equal(payload.coverage.totalPairs, 2);
  assert.equal(payload.coverage.gapPairCount, 1);
  assert.equal(payload.pairs[0].employeeCode, 'DN001');
  assert.equal(payload.pairs[0].reason, gaps.REASON_QD_MISMATCH);
  assert.equal(payload.pairs[0].suggestedCatalogCode, 'G1.GE.QĐ48.549.N4.549');
  assert.equal(/c(?:32|36|41|43|44|45|47)|percent|amounts/i.test(JSON.stringify(payload)), false);
  assert.equal(audits[0].event, 'gaps_view');
  assert.equal(audits[0].scope, 'DN001');
});

test('CEO all-roster view groups by QLNB, ranks impact, and filters by employee/reason/search', async () => {
  const deps = fixtureDeps({ employees: ['DN001', 'DN002'], sameGap: true });
  const payload = await gaps.buildForSession({
    session: { emp_code: 'CEO', role: 'ceo' }, scope: { empCode: null },
    roster: [{ emp_code: 'DN001', name: 'NV 1' }, { emp_code: 'DN002', name: 'NV 2' }],
    from: '2026-07', to: '2026-07', ...deps, auditImpl: () => {},
  });
  assert.deepEqual(deps.calls.sort(), ['DN001', 'DN002']);
  assert.equal(payload.pairs.length, 2);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].employeeCount, 2);
  assert.equal(payload.items[0].unitCount, 2);
  assert.equal(payload.items[0].revenueAffected, 5_000_000);
  assert.equal(payload.items[0].reason, gaps.REASON_QD_MISMATCH);

  const filtered = gaps.filterPairs(payload.pairs, { employee: 'dn002', reason: gaps.REASON_QD_MISMATCH, q: 'Valesto' }, { admin: true });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].employeeCode, 'DN002');
  assert.equal(gaps.aggregatePairs(filtered)[0].revenueAffected, 3_000_000);
});

test('admin invalid roster target and unavailable catalog/cost source fail closed', async () => {
  const deps = fixtureDeps();
  const base = {
    session: { emp_code: 'CEO', role: 'ceo' }, scope: { empCode: null },
    roster: [{ emp_code: 'DN001', name: 'NV 1' }], from: '2026-07', to: '2026-07',
    ...deps, auditImpl: () => {},
  };
  await assert.rejects(gaps.buildForSession({ ...base, requestedEmp: 'DN999' }), { code: 'EMPLOYEE_COST_GAPS_EMP_INVALID' });
  await assert.rejects(gaps.buildForSession({ ...base, catalogRowsFor: async () => [] }), { code: 'EMPLOYEE_COST_GAPS_CATALOG_UNAVAILABLE' });
  await assert.rejects(gaps.buildForSession({ ...base, fetchCost: async (empCode) => ({ outcome: 'upstream_unavailable', payload: rangePayload(empCode, []) }) }), { code: 'EMPLOYEE_COST_GAPS_SOURCE_UNAVAILABLE' });
});

test('Excel worklist has two sheets, blank fill/confirmation cells, and mismatch mapping', async () => {
  const payload = {
    items: [{
      productCode: 'G1.GE.QĐ139.2963.N4.549', productName: 'Valesto', unitLabels: ['U1.BV'],
      employeeCount: 1, employeeCodes: ['DN001'], revenueAffected: 2_000_000,
      reason: gaps.REASON_QD_MISMATCH, suggestedCatalogCodes: ['G1.GE.QĐ48.549.N4.549'],
    }],
  };
  const buffer = await gaps.createWorkbook(payload);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Theo mã QLNB', 'Ánh xạ lệch mã']);
  const main = workbook.getWorksheet('Theo mã QLNB');
  assert.equal(main.getCell('I7').value, '% cần điền');
  assert.equal(main.getCell('I8').value, '');
  assert.equal(main.getCell('A5').value, gaps.EXPORT_NOTE);
  const mapping = workbook.getWorksheet('Ánh xạ lệch mã');
  assert.equal(mapping.getCell('A8').value, 'G1.GE.QĐ139.2963.N4.549');
  assert.equal(mapping.getCell('B8').value, 'G1.GE.QĐ48.549.N4.549');
  assert.equal(mapping.getCell('C8').value, '');
});

test('gap and export routes are authenticated and reuse the employee-cost visibility gate', () => {
  const routes = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(routes, /router\.get\('\/employee-cost\/gaps', auth\.requireAuth/);
  assert.match(routes, /router\.get\('\/employee-cost\/gaps\/export\.xlsx', auth\.requireAuth/);
  const start = routes.indexOf('async function employeeCostGapPayload');
  const end = routes.indexOf("router.get('/employee-cost/employees'", start);
  const block = routes.slice(start, end);
  assert.match(block, /employeeCost\.resolveScopedEmployee/);
  assert.match(block, /employeeCostVisibility\.run/);
  assert.match(block, /scope: \{ empCode: targetEmp \}/);
});
