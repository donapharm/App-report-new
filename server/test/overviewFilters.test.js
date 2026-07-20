const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const store = require('../src/store');
const A = require('../src/analytics');

const rows = [
  { emp_code: 'DN001', emp_name: 'NV 1', contractor_code: 'DONA', source: 'CRM_MISA', route: 'CL', unit_code: '033.PK A', unit_name: 'PK A', revenue: 100, quantity: 1 },
  { emp_code: 'DN001', emp_name: 'NV 1', contractor_code: '03.TUE.N', source: 'APP_WEB_PARTNER', route: 'NCL', unit_code: '033.PK B', unit_name: 'PK B', revenue: 200, quantity: 1 },
  { emp_code: 'DN002', emp_name: 'NV 2', contractor_code: 'AFP', source: 'CRM_MISA', route: 'CL', unit_code: '034.BV C', unit_name: 'BV C', revenue: 300, quantity: 1 },
  { emp_code: 'DN003', emp_name: 'NV 3', contractor_code: '04.NGUYEN.P', source: 'APP_WEB_PARTNER', route: 'NT', unit_code: '033.PK D', unit_name: 'PK D', revenue: 400, quantity: 1 },
  { emp_code: 'DN003', emp_name: 'NV 3', contractor_code: 'DONA', source: 'CRM_MISA', route: 'NCL', unit_code: '0331.KHONG CUNG NHOM', unit_name: 'Không cùng nhóm 033', revenue: 500, quantity: 1 },
];

const revenue = (filters) => A.sum(A.applyFilters(rows, filters), (row) => row.revenue);

test('Group-Dona là DONA + AFP; đối tác là các nhà thầu còn lại', () => {
  assert.equal(A.companyGroupOf(rows[0]), 'dona');
  assert.equal(A.companyGroupOf(rows[2]), 'dona');
  assert.equal(A.companyGroupOf({ contractor_code: '01.DONAPHARM' }), 'dona');
  assert.equal(A.companyGroupOf({ contractor_code: '02.AFP PHARMA' }), 'dona');
  assert.equal(A.companyGroupOf({ contractor_code: 'Công Ty Tnhh Dược Phẩm Donapharm' }), 'dona');
  assert.equal(A.companyGroupOf({ contractor_code: 'Công Ty Tnhh Afp Pharma' }), 'dona');
  assert.equal(A.companyGroupOf(rows[1]), 'partner');
  assert.equal(revenue({ companyGroup: 'dona' }), 900);
  assert.equal(revenue({ companyGroup: 'partner' }), 600);
});

test('nhóm đơn vị chỉ dùng membership DataHub đã xác thực và không suy từ tiền tố', () => {
  const members = ['033.PK A', '033.PK B', '033.PK D'];
  assert.equal(A.unitGroupOf(rows[0]), '033');
  assert.equal(A.unitGroupOf(rows[4]), '');
  assert.equal(A.unitGroupOf({ unit_code: '033-KHONG-PHAI-CON' }), '');
  assert.equal(revenue({ unitGroup: '033', unitGroupMembers: members }), 700);
  assert.equal(revenue({ unitGroup: '033.', unitGroupMembers: members }), 700);
  assert.equal(revenue({ unitGroup: '033' }), 0);
  assert.deepEqual(A.applyFilters(rows, { unitGroup: '033', unitGroupMembers: members }).map((row) => row.unit_code), ['033.PK A', '033.PK B', '033.PK D']);
});

test('nhân viên và tuyến hỗ trợ chọn nhiều bằng dấu |', () => {
  assert.equal(revenue({ emp: 'DN001|DN002' }), 600);
  assert.equal(revenue({ route: 'CL|NT' }), 800);
  assert.equal(revenue({ emp: 'DN001|DN003', route: 'NCL|NT', unitGroup: '033', unitGroupMembers: ['033.PK A', '033.PK B', '033.PK D'] }), 600);
});

test('scope nhân viên được áp trước bộ lọc, không thể dùng filter để xem NV khác', () => {
  const originals = {
    getRowsRange: store.getRowsRange,
    getTargetsRange: store.getTargetsRange,
    targetRoster: store.targetRoster,
    getCst: store.getCst,
    previousKys: store.previousKys,
  };
  store.getRowsRange = ({ scope }) => rows.filter((row) => !scope?.empCode || row.emp_code === scope.empCode);
  store.getTargetsRange = ({ scope }) => [
    { emp_code: 'DN001', target: 1000 }, { emp_code: 'DN002', target: 2000 }, { emp_code: 'DN003', target: 3000 },
  ].filter((row) => !scope?.empCode || row.emp_code === scope.empCode);
  store.targetRoster = ({ scope }) => ['DN001', 'DN002', 'DN003'].map((emp_code) => ({ emp_code, name: emp_code })).filter((row) => !scope?.empCode || row.emp_code === scope.empCode);
  store.getCst = () => [];
  store.previousKys = () => [];
  try {
    A.clearOverviewCache();
    const own = A.overviewKpis({ ky: '07.2026', scope: { empCode: 'DN001' }, filters: { companyGroup: 'dona' } });
    assert.equal(own.revenue, 100);
    const escape = A.overviewKpis({ ky: '07.2026', scope: { empCode: 'DN001' }, filters: { emp: 'DN002' } });
    assert.equal(escape.revenue, 0);
    assert.equal(escape.empCount, 0);
  } finally {
    Object.assign(store, originals);
    A.clearOverviewCache();
  }
});

test('Top 20 dùng cùng bộ lọc chuẩn với KPI, gồm companyGroup và unitGroup', () => {
  const routes = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(routes, /router\.get\('\/revenue'[\s\S]*?const filters = revenueFiltersFromQuery\(req\.query\);[\s\S]*?A\.revenueBreakdown/);
  assert.match(routes, /auth\.requireAuth\(req, res, async \(\) => \{[\s\S]*dataHubUnitGroups\.membersFor\(req\.query\.unitGroup\)/);
  assert.match(routes, /unitGroupMembers: Array\.isArray\(q\.__unitGroupMembers\)/);
  assert.match(routes, /Promise\.all\(pc\.kys\.map\(async \(period\)/);
});

test('target chỉ so sánh khi lát cắt còn đúng theo nhân viên', () => {
  const originals = {
    getRowsRange: store.getRowsRange,
    getTargetsRange: store.getTargetsRange,
    targetRoster: store.targetRoster,
    getCst: store.getCst,
    previousKys: store.previousKys,
  };
  store.getRowsRange = () => rows;
  store.getTargetsRange = () => [
    { emp_code: 'DN001', target: 1000 }, { emp_code: 'DN002', target: 2000 }, { emp_code: 'DN003', target: 3000 },
  ];
  store.targetRoster = () => ['DN001', 'DN002', 'DN003'].map((emp_code) => ({ emp_code, name: emp_code }));
  store.getCst = () => [];
  store.previousKys = () => [];
  try {
    A.clearOverviewCache();
    const byEmployee = A.overviewKpis({ ky: '07.2026', scope: {}, filters: { emp: 'DN001' } });
    assert.equal(byEmployee.targetComparable, true);
    assert.equal(byEmployee.targetTotal, 1000);
    assert.equal(byEmployee.revenue, 300);

    for (const filters of [{ route: 'CL' }, { companyGroup: 'dona' }, { unitGroup: '033' }, { unit: '033.PK A' }]) {
      A.clearOverviewCache();
      const sliced = A.overviewKpis({ ky: '07.2026', scope: {}, filters });
      assert.equal(sliced.targetComparable, false, JSON.stringify(filters));
      assert.equal(sliced.targetTotal, null, JSON.stringify(filters));
      assert.equal(sliced.pctTarget, null, JSON.stringify(filters));
    }
  } finally {
    Object.assign(store, originals);
    A.clearOverviewCache();
  }
});
