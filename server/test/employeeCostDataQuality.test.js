const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const ExcelJS = require('exceljs');
const dq = require('../src/employeeCostDataQuality');
const employeeCostExport = require('../src/employeeCostExport');

function buildFixture() {
  const revenueRows = [
    { emp_code: 'DN001', period: '2026-07', unit_code: 'U3', unit_name: 'U3.Bệnh viện A', iit_code: 'P3', product_name: 'Thuốc 3', uom: 'Hộp', bid_price: 100, revenue: 700, route: 'OTC' },
    { emp_code: 'DN001', period: '2026-07', unit_code: 'U4', unit_name: 'U4.Bệnh viện B', iit_code: 'P4', product_name: 'Thuốc 4', uom: 'Viên', bid_price: 0, revenue: 1200, route: 'ETC' },
    { emp_code: 'DN001', period: '2026-07', unit_code: 'U9', unit_name: 'U9.Đơn vị lạ', iit_code: 'P9', product_name: 'Thuốc 9', uom: 'Viên', bid_price: 20, revenue: 500, route: 'ETC' },
  ];
  const catalogRows = [
    { c7: 'U3.Bệnh viện A', c5: 'P3', c16: 'Thuốc 3', c25: 'Viên', c31: 100 },
    { c7: 'U4.Bệnh viện B', c5: 'P4', c16: 'Thuốc 4', c25: 'Viên', c31: 120 },
    { c7: 'U5.Bệnh viện C', c5: 'P5', c16: 'Thuốc 5', c25: 'Viên', c31: 55 },
  ];
  const gapPairs = [
    { period: '2026-07', employeeCode: 'DN001', unitLabel: 'U1.Bệnh viện Mất %', productCode: 'P1', productName: 'Thiếu mã', revenueAffected: 800, orderLineCount: 2, reason: 'missing' },
    { period: '2026-07', employeeCode: 'DN002', unitLabel: 'U1.Bệnh viện Mất %', productCode: 'P1', productName: 'Thiếu mã', revenueAffected: 200, orderLineCount: 1, reason: 'missing' },
    { period: '2026-07', employeeCode: 'DN001', unitLabel: 'U2.Bệnh viện Lệch mã', productCode: 'P2.OLD', productName: 'Lệch QĐ', revenueAffected: 900, orderLineCount: 1, reason: 'qd_mismatch', suggestedCatalogCode: 'P2.NEW' },
  ];
  return {
    revenueRows, catalogRows, gapPairs,
    productCrosswalkRows: [{ sub_code: 'OTHER.SUB', master_code: 'OTHER.MASTER', sub_uom: 'Viên', master_uom: 'Viên', relation: 'same_product', convert_factor: 1 }],
  };
}

test('groups and sorts exceptions deterministically with summary totals', () => {
  const result = dq.analyzeDataQuality(buildFixture());
  assert.deepEqual(result.exceptions.map((item) => item.type), [
    'BID_PRICE_INVALID',
    'PRODUCT_MISSING',
    'PRODUCT_MISMATCH',
    'UOM_MISMATCH',
    'UNIT_UNKNOWN',
  ]);
  const missing = result.exceptions.find((item) => item.type === 'PRODUCT_MISSING');
  assert.equal(missing.revenueAffected, 1000);
  assert.equal(missing.lineCount, 3);
  assert.deepEqual(missing.employeeCodes, ['DN001', 'DN002']);
  assert.equal(missing.repairSource, 'DataHub');

  const mismatch = result.exceptions.find((item) => item.type === 'PRODUCT_MISMATCH');
  assert.equal(mismatch.errorValue, 'P2.OLD ≠ P2.NEW');
  assert.match(mismatch.cause, /khác số QĐ/i);

  assert.deepEqual(result.summary, {
    count: 5,
    redCount: 4,
    yellowCount: 1,
    revenueAffected: 4300,
    redRevenueAffected: 3800,
    lineCount: 7,
  });
});

test('keeps source inputs immutable and never leaks blocked fields', () => {
  const revenueRows = [{ emp_code: 'DN001', unit_code: 'U1', unit_name: 'U1.BV', iit_code: 'P1', product_name: 'Thuốc', uom: 'Hộp', bid_price: 10, revenue: 100, c32: 9, c47: 11 }];
  const catalogRows = [{ c7: 'U1.BV', c5: 'P1', c16: 'Thuốc', c25: 'Viên', c31: 10, c32: 88, c47: 99 }];
  const gapPairs = [{ unitLabel: 'U1.BV', productCode: 'P1', productName: 'Thuốc', revenueAffected: 100, orderLineCount: 1, reason: 'missing', c32: 1, c47: 2 }];
  const before = JSON.stringify({ revenueRows, catalogRows, gapPairs });
  const result = dq.analyzeDataQuality({
    revenueRows, catalogRows, gapPairs,
    productCrosswalkRows: [{ sub_code: 'OTHER.SUB', master_code: 'OTHER.MASTER', sub_uom: 'Viên', master_uom: 'Viên', relation: 'same_product', convert_factor: 1 }],
  });
  assert.equal(JSON.stringify({ revenueRows, catalogRows, gapPairs }), before);
  const json = JSON.stringify(result);
  assert.equal(/c32|c47/i.test(json), false);
  assert.equal(/percent/i.test(json), false);
});

test('respects configurable rule enablement and bid-price outlier threshold', () => {
  const input = {
    revenueRows: [{ emp_code: 'DN001', period: '2026-07', unit_code: 'U1', unit_name: 'U1.BV', iit_code: 'P1', product_name: 'Thuốc', uom: 'Viên', bid_price: 340, revenue: 1000 }],
    catalogRows: [{ c7: 'U1.BV', c5: 'P1', c16: 'Thuốc', c25: 'Viên', c31: 100 }],
    knownUnits: ['U1'],
  };
  const base = dq.analyzeDataQuality(input);
  assert.equal(base.exceptions.length, 1);
  assert.equal(base.exceptions[0].type, 'BID_PRICE_INVALID');

  const relaxed = dq.analyzeDataQuality({
    ...input,
    config: {
      rules: {
        BID_PRICE_INVALID: { outlierRatio: 5 },
        UNIT_UNKNOWN: { enabled: false },
      },
    },
  });
  assert.equal(relaxed.exceptions.length, 0);
  assert.equal(relaxed.config.rules.BID_PRICE_INVALID.outlierRatio, 5);
});

test('flags missing bid price even when that product has no resolvable catalog row', () => {
  const result = dq.analyzeDataQuality({
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', unit_name: 'U1.BV', iit_code: 'P-MISSING', bid_price: null, revenue: 750 }],
    catalogRows: [{ c7: 'U1.BV', c5: 'P-OTHER', c16: 'Khác', c25: 'Viên', c31: 100 }],
    knownUnits: ['U1'],
  });
  assert.equal(result.exceptions.length, 1);
  assert.equal(result.exceptions[0].type, 'BID_PRICE_INVALID');
  assert.equal(result.exceptions[0].errorValue, 'Thiếu giá trúng thầu');
  assert.equal(result.exceptions[0].revenueAffected, 750);
});

test('fails closed when catalog-dependent rules are enabled but catalog is missing', () => {
  assert.throws(() => dq.analyzeDataQuality({
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', iit_code: 'P1', revenue: 10 }],
  }), { code: 'EMPLOYEE_COST_DQ_CATALOG_REQUIRED' });
});

test('treats UNALLOCATED attribution as PRODUCT_MISMATCH without adding a sixth public rule', () => {
  const result = dq.analyzeDataQuality({
    revenueRows: [{
      emp_code: 'UNALLOCATED', attribution_status: 'ROSTER_CONFLICT_QUARANTINED', raw_emp_code: 'DN001',
      period: '2026-07', unit_code: 'U7', unit_name: 'U7.BV', iit_code: 'P7', product_name: 'Thuốc 7', uom: 'Viên', bid_price: 10, revenue: 400,
    }],
    catalogRows: [{ c7: 'U7.BV', c5: 'P7', c16: 'Thuốc 7', c25: 'Viên', c31: 10 }],
    knownUnits: ['U7'],
  });
  assert.equal(result.exceptions.length, 1);
  assert.equal(result.exceptions[0].type, 'PRODUCT_MISMATCH');
  assert.equal(result.exceptions[0].severity, 'red');
  assert.equal(result.exceptions[0].errorValue, 'UNALLOCATED');
  assert.match(result.exceptions[0].cause, /UNALLOCATED/);
  assert.equal(result.summary.redCount, 1);
});

test('suppresses UOM mismatch only for the exact directed phu_convert mapping', () => {
  const subCode = 'G3.ĐY.QĐ141.214.N3.107';
  const masterCode = 'G3.ĐY.QĐ141.213.N3.107';
  const revenueRows = [{
    emp_code: 'DN001', period: '2026-07', unit_code: 'U1', unit_name: 'U1.BV',
    iit_code: subCode, product_name: 'Thuốc quy đổi', uom: 'Gói', bid_price: 100, revenue: 500,
  }];
  const sourceCatalog = [{ c7: 'U1.BV', c5: subCode, c16: 'Thuốc quy đổi', c25: 'Gam', c31: 100 }];
  const valid = {
    sub_code: subCode, master_code: masterCode, sub_uom: 'Gói', master_uom: 'Gam',
    relation: 'phu_convert', convert_factor: 5,
  };
  const master = {
    sub_code: masterCode, master_code: masterCode, sub_uom: 'Gam', master_uom: 'Gam',
    relation: 'goc', convert_factor: 1,
  };
  const analyze = (mapping, catalogRows = sourceCatalog, { includeMaster = true } = {}) => dq.analyzeDataQuality({
    revenueRows, catalogRows, knownUnits: ['U1'],
    productCrosswalk: { status: 'ready', rows: mapping == null ? [] : [mapping, ...(includeMaster && mapping.sub_code !== masterCode ? [master] : [])] },
  });
  assert.equal(analyze(valid).exceptions.some((item) => item.type === 'UOM_MISMATCH'), false);
  assert.equal(analyze(valid, [{ c7: 'U1.BV', c5: masterCode, c16: 'Thuốc master', c25: 'Gam', c31: 100 }]).exceptions.length, 0);

  const invalidMappings = [
    { ...valid, relation: undefined },
    { ...valid, convert_factor: null },
    { ...valid, relation: 'alias' },
    { ...valid, convert_factor: 0 },
    { ...valid, convert_factor: -5 },
    { ...valid, sub_code: masterCode, master_code: subCode },
    { ...valid, sub_code: 'OTHER.CODE' },
    { ...valid, sub_uom: 'Hộp' },
    { ...valid, master_uom: 'Viên' },
  ];
  for (const mapping of invalidMappings) {
    const result = analyze(mapping);
    assert.equal(result.sources.productMasterCrosswalk.status, 'ready', JSON.stringify(mapping));
    assert.equal(result.exceptions.filter((item) => item.type === 'UOM_MISMATCH').length, 1, JSON.stringify(mapping));
  }
  assert.equal(analyze(valid, sourceCatalog, { includeMaster: false }).exceptions.filter((item) => item.type === 'UOM_MISMATCH').length, 1);

  const duplicate = analyzeDataQualityWithRows([valid, { ...valid, master_code: 'OTHER.MASTER' }, master]);
  assert.equal(duplicate.sources.productMasterCrosswalk.status, 'source_unavailable');
  assert.equal(duplicate.exceptions.some((item) => item.type === 'UOM_MISMATCH'), false);
  assert.equal(duplicate.exceptions.filter((item) => item.type === 'UOM_CONVERSION_UNVERIFIED').length, 1);

  function analyzeDataQualityWithRows(rows) {
    return dq.analyzeDataQuality({
      revenueRows, catalogRows: sourceCatalog, knownUnits: ['U1'],
      productCrosswalk: { status: 'ready', rows },
    });
  }
});

test('crosswalk handles reverse direction without changing business numbers and rejects ambiguous reverse mappings', () => {
  const subCode = 'SUB.1';
  const masterCode = 'MASTER.1';
  const mapping = { sub_code: subCode, master_code: masterCode, sub_uom: 'Gói', master_uom: 'Gam', relation: 'phu_convert', convert_factor: 5 };
  const master = { sub_code: masterCode, master_code: masterCode, sub_uom: 'Gam', master_uom: 'Gam', relation: 'goc', convert_factor: 1 };
  const revenueRows = [{ emp_code: 'DN001', unit_code: 'U1', iit_code: masterCode, uom: 'Gam', bid_price: 100, revenue: 500, quantity: 25 }];
  const catalogRows = [{ c7: 'U1.BV', c5: masterCode, c25: 'Gói', c31: 100 }];
  const before = JSON.stringify({ revenueRows, catalogRows });
  const reverse = dq.analyzeDataQuality({ revenueRows, catalogRows, knownUnits: ['U1'], productCrosswalk: { status: 'ready', rows: [mapping, master] } });
  assert.equal(reverse.exceptions.some((item) => item.type === 'UOM_MISMATCH'), false);
  assert.equal(reverse.exceptions.some((item) => item.type === 'UOM_CONVERSION_UNVERIFIED'), false);
  assert.equal(JSON.stringify({ revenueRows, catalogRows }), before, 'không đổi quantity/revenue/input khi chuẩn hóa cảnh báo');

  const mapping2 = { ...mapping, sub_code: 'SUB.2', convert_factor: 10 };
  const ambiguous = dq.analyzeDataQuality({ revenueRows, catalogRows, knownUnits: ['U1'], productCrosswalk: { status: 'ready', rows: [mapping, mapping2, master] } });
  assert.equal(ambiguous.exceptions.some((item) => item.type === 'UOM_MISMATCH'), false);
  assert.equal(ambiguous.exceptions.filter((item) => item.type === 'UOM_CONVERSION_UNVERIFIED').length, 1);
});

test('same UOM needs no crosswalk; authoritative not-found alone creates mismatch', () => {
  const base = { emp_code: 'DN001', unit_code: 'U1', iit_code: 'P1', bid_price: 100, revenue: 500 };
  const same = dq.analyzeDataQuality({
    revenueRows: [{ ...base, uom: 'Gói' }],
    catalogRows: [{ c7: 'U1.BV', c5: 'P1', c25: 'Gói', c31: 100 }],
    knownUnits: ['U1'], productCrosswalk: { status: 'source_unavailable', rows: [] },
  });
  assert.equal(same.exceptions.some((item) => item.type.startsWith('UOM_')), false);

  const notFound = dq.analyzeDataQuality({
    revenueRows: [{ ...base, uom: 'Gói' }],
    catalogRows: [{ c7: 'U1.BV', c5: 'P1', c25: 'Gam', c31: 100 }],
    knownUnits: ['U1'], productCrosswalk: { status: 'ready', rows: [] },
  });
  assert.equal(notFound.exceptions.filter((item) => item.type === 'UOM_MISMATCH').length, 1);
  assert.equal(notFound.exceptions.some((item) => item.type === 'UOM_CONVERSION_UNVERIFIED'), false);
});

test('source-unavailable crosswalk records unverified UOM and leaves the other rules active', () => {
  const result = dq.analyzeDataQuality({
    revenueRows: [{ emp_code: 'DN001', unit_code: 'U1', unit_name: 'U1.BV', iit_code: 'P1', uom: 'Gói', bid_price: 0, revenue: 900 }],
    catalogRows: [{ c7: 'U1.BV', c5: 'P1', c25: 'Gam', c31: 100 }],
    knownUnits: ['U1'],
    productCrosswalk: { status: 'source_unavailable', message: 'provider down', rows: [] },
  });
  assert.deepEqual(result.exceptions.map((item) => item.type), ['BID_PRICE_INVALID', 'UOM_CONVERSION_UNVERIFIED']);
  assert.equal(result.exceptions.some((item) => item.type === 'UOM_MISMATCH'), false);
  assert.equal(result.sources.productMasterCrosswalk.status, 'source_unavailable');
  assert.match(result.sources.productMasterCrosswalk.message, /provider down/);
});

test('Vietnamese DQ Excel/PDF exports reuse the secure Employee Cost export conventions', async () => {
  const payload = {
    from: '2026-07', to: '2026-07', scope: { admin: false, employeeCode: 'DN001' },
    summary: { exceptionCount: 1, redCount: 1, yellowCount: 0, revenueAffected: 1_200_000, redRevenueAffected: 1_200_000, lineCount: 2 },
    items: [{
      type: 'UOM_MISMATCH', severity: 'red', field: 'Đơn vị tính', invalidValue: 'Hộp ≠ Viên',
      productCode: 'P1', productName: 'Thuốc thử', unitCode: '001', unitLabels: ['001.BV Đồng Nai'],
      routes: ['CL'], employeeCodes: ['DN001'], periods: ['2026-07'], revenueAffected: 1_200_000, lineCount: 2,
      cause: 'ĐVT sale khác catalog.', action: 'Đối chiếu và chuẩn hóa.', repairSource: 'App Sale / catalog', status: 'new',
      c32: 99, c47: 88,
    }],
  };
  const xlsx = await employeeCostExport.dataQualityWorkbookBuffer(payload);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsx);
  const sheet = workbook.getWorksheet('Kiểm soát dữ liệu');
  assert.equal(sheet.getCell('B2').value, employeeCostExport.DATA_QUALITY_TITLE);
  assert.equal(sheet.getCell('M7').value, 'Nguyên nhân tự sinh');
  assert.equal(sheet.getCell('O8').value, 'App Sale / catalog');
  assert.equal(sheet.getCell('A8').value, 'ĐỎ · Sai/nghi tiền');
  assert.equal(/C32|C47/.test(JSON.stringify(sheet.getSheetValues())), false);
  const pdf = await employeeCostExport.dataQualityPdfBuffer(payload);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});

test('DQ routes require authentication, keep backend scope, expose admin-only bell summary and authenticated exports', () => {
  const routes = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(routes, /router\.get\('\/employee-cost\/data-quality', auth\.requireAuth/);
  assert.match(routes, /router\.get\('\/employee-cost\/data-quality\/summary', auth\.requireAuth, auth\.requireAdmin/);
  assert.match(routes, /router\.get\('\/employee-cost\/data-quality\/export\.xlsx', auth\.requireAuth/);
  assert.match(routes, /router\.get\('\/employee-cost\/data-quality\/export\.pdf', auth\.requireAuth/);
  const start = routes.indexOf('async function employeeCostDqPayload');
  const end = routes.indexOf("router.get('/employee-cost/employees'", start);
  const block = routes.slice(start, end);
  assert.doesNotMatch(block, /await employeeCostGapPayload\(req/);
  assert.match(block, /requestedRaw === 'ALL' \? '' : requestedRaw/);
  assert.match(block, /admin && !requested \? null : employeeCost\.resolveScopedEmployee/);
  assert.match(block, /employeeCostVisibility\.run/);
  assert.match(block, /scopedEmp \? \{ empCode: scopedEmp \} : \{\}/);
  assert.equal((block.match(/appSaleProductCrosswalk\.getSnapshot\(\)/g) || []).length, 1);
  assert.match(block, /productCrosswalk,/);
  assert.match(block, /sources: \{ productMasterCrosswalk: appSaleProductCrosswalk\.publicSource\(productCrosswalk\) \}/);
  assert.match(routes, /catalogManagement\.getCachedDataQualitySnapshot\(key\) \|\| await canonicalAssignmentSnapshot\(key\)/);
  assert.match(block, /scope: \{ admin, employeeCode:/);
  assert.equal(/c32|c47/i.test(block), false);
});

test('runtime DQ config keeps exactly the five phase-1 public rules', () => {
  const config = JSON.parse(fs.readFileSync(require.resolve('../config/employee_cost_data_quality.json'), 'utf8'));
  assert.deepEqual(Object.keys(config.rules), dq.RULE_ORDER);
  assert.equal(config.rules.BID_PRICE_INVALID.outlierRatio, 3);
});
