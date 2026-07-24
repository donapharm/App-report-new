const test = require('node:test');
const assert = require('node:assert/strict');
const catalogManagement = require('../src/catalogManagement');

test('đổi kỳ MM.YYYY <-> YYYY-MM tường minh', () => {
  assert.equal(catalogManagement.toHubPeriod('07.2026'), '2026-07');
  assert.equal(catalogManagement.toHubPeriod('2026-07'), '2026-07');
  assert.equal(catalogManagement.toUiPeriod('2026-07'), '07.2026');
  assert.throws(() => catalogManagement.toHubPeriod('7/2026'), /Kỳ phải/);
});

test('employee response chỉ giữ whitelist và không lộ counterpart/audit', () => {
  const snapshot = {
    rows: [{
      id: 'a1', emp_code: 'DN016', emp_name: 'NV A', type: 'unit_qlnb', value: `BV01\u001fQL01`, label: 'BV01 · QL01', route: 'CL', contractor_code: 'NT01', unit_code: 'BV01', qlnb_code: 'QL01',
      product_name: 'Thuốc A', uom: 'Viên', bid_price: 12500,
      effective_from: '2026-07', effective_to: '2026-07', active: true, source: 'data-hub',
      old_emp: 'DN001', new_emp: 'DN016', from_emp: 'DN001', to_emp: 'DN016', counterpart: 'DN001',
      actor: 'CEO', transfer_batch_id: 'secret-batch', internal_note: 'secret',
    }],
    history: [{ actor: 'CEO', transfer_batch_id: 'secret-batch' }],
    meta: { source: 'data-hub', version: 'v1', checksum: 'abc', updatedAt: '2026-07-15T00:00:00Z', lastSyncAt: '2026-07-15T00:00:00Z', stale: false, message: 'Đã đồng bộ Data Hub.' },
  };
  const response = catalogManagement.employeeView(snapshot, 'DN016', '2026-07');
  const text = JSON.stringify(response);
  for (const forbidden of ['old_emp', 'new_emp', 'from_emp', 'to_emp', 'counterpart', 'batch', 'secret']) assert.equal(text.includes(forbidden), false, forbidden);
  assert.doesNotMatch(text, /"actor"\s*:|bàn giao cho|nhận từ/i);
  assert.equal(response.sections.current[0].label, 'BV01 · QL01');
  assert.deepEqual(
    { route: response.sections.current[0].route, contractor_code: response.sections.current[0].contractor_code, unit_code: response.sections.current[0].unit_code, qlnb_code: response.sections.current[0].qlnb_code, product_name: response.sections.current[0].product_name, uom: response.sections.current[0].uom, bid_price: response.sections.current[0].bid_price },
    { route: 'CL', contractor_code: 'NT01', unit_code: 'BV01', qlnb_code: 'QL01', product_name: 'Thuốc A', uom: 'Viên', bid_price: 12500 },
  );
});

test('ghép đúng tên thuốc, hoạt chất, hàm lượng, ĐVT và đơn giá theo khóa đơn vị + QLNB', () => {
  const rows = [catalogManagement.normalizeRow({ scope: 'unit_qlnb', code: `DV01\u001fQL01`, unit_code: 'DV01', qlnb_code: 'QL01', emp_code: 'DN016', effective_from: '2026-07' })];
  const enriched = catalogManagement.enrichRowsFromCatalog(rows, [{ c7: 'DV01', c5: 'QL01', c4: 'NT01', c15: 'Hoạt chất A', c16: 'Thuốc A', c17: '500 mg', c25: 'Hộp', c31: 98765 }]);
  assert.deepEqual(
    { contractor_code: enriched[0].contractor_code, product_name: enriched[0].product_name, active_ingredient: enriched[0].active_ingredient, strength: enriched[0].strength, uom: enriched[0].uom, bid_price: enriched[0].bid_price },
    { contractor_code: 'NT01', product_name: 'Thuốc A', active_ingredient: 'Hoạt chất A', strength: '500 mg', uom: 'Hộp', bid_price: 98765 },
  );
});

test('danh mục quản lý không suy tỉnh từ tên và chỉ giữ tỉnh chính thức trong response NV đã scope', () => {
  const unassigned = catalogManagement.normalizeRow({
    id: 'bp-1', emp_code: 'DN016', scope: 'unit_qlnb', code: `BVĐK Bình Phước\u001fQL01`,
    unit_code: 'BVĐK Bình Phước', qlnb_code: 'QL01', effective_from: '2026-07',
  });
  assert.equal(unassigned.province, '');
  const row = catalogManagement.normalizeRow({
    id: 'bp-2', emp_code: 'DN016', scope: 'unit_qlnb', code: `BVĐK Bình Phước\u001fQL01`,
    unit_code: 'BVĐK Bình Phước', qlnb_code: 'QL01', province: 'Bình Phước', effective_from: '2026-07',
  });
  const response = catalogManagement.employeeView({
    period: '2026-07', rows: [row], meta: { source: 'test', version: '1' },
  }, 'DN016', '2026-07');
  assert.equal(response.sections.current[0].province, 'Bình Phước');
});

test('từ chối snapshot Data Hub thiếu C4 để không ghi đè cache mã nhà thầu tốt', () => {
  assert.equal(catalogManagement.assertContractorCoverage([{ c4: '01.DONA' }, { c4: '02.AFP' }]), true);
  assert.throws(
    () => catalogManagement.assertContractorCoverage([]),
    (error) => error.code === 'CATALOG_SOURCE_EMPTY',
  );
  assert.throws(
    () => catalogManagement.assertContractorCoverage([{ c4: '01.DONA' }, { c5: 'QL02' }]),
    (error) => error.code === 'CATALOG_CONTRACTOR_C4_MISSING' && /1\/2/.test(error.message),
  );
});

test('CST chỉ ghép khi đúng chính xác đơn vị + QLNB, không dùng tiền tố gần giống', () => {
  const rows = [
    catalogManagement.normalizeRow({ scope: 'unit_qlnb', code: `001.BV A\u001fQL01`, unit_code: '001.BV A', qlnb_code: 'QL01', emp_code: 'DN016', effective_from: '2026-07' }),
    catalogManagement.normalizeRow({ scope: 'unit_qlnb', code: `001.BV B\u001fQL01`, unit_code: '001.BV B', qlnb_code: 'QL01', emp_code: 'DN016', effective_from: '2026-07' }),
  ];
  const enriched = catalogManagement.enrichRowsWithCst(rows, [{ unit_code: '001.BV A', iit_code: 'QL01', bid_qty_initial: 1000, remain_qty: 250 }]);
  assert.deepEqual({ initial: enriched[0].cst_initial, remaining: enriched[0].cst_remaining }, { initial: 1000, remaining: 250 });
  assert.equal(enriched[1].cst_initial, null);
  assert.equal(enriched[1].cst_remaining, null);
});

test('nguồn C30 thưa field không được ghi đè CST baseline đầy đủ', () => {
  const rows = [catalogManagement.normalizeRow({ scope: 'unit_qlnb', code: `DV01\u001fQL01`, unit_code: 'DV01', qlnb_code: 'QL01', emp_code: 'DN016', effective_from: '2026-07' })];
  const baseline = { unit_code: 'DV01', iit_code: 'QL01', bid_qty_initial: 1000, remain_qty: 250, source: 'cst-baseline' };
  const c30Only = { unitCode: 'DV01', productCode: 'QL01', slTrungThau: null, slConLai: null, source: 'c30-only' };
  const enriched = catalogManagement.buildCatalogRows(rows, [baseline, c30Only]);
  assert.deepEqual(
    { initial: enriched[0].cst_initial, remaining: enriched[0].cst_remaining, source: enriched[0].cst_source },
    { initial: 1000, remaining: 250, source: 'cst-baseline' },
  );
});

test('CST còn lại bằng 0 tường minh là giá trị hợp lệ, không bị coi là thiếu', () => {
  const rows = [catalogManagement.normalizeRow({ scope: 'unit_qlnb', code: `DV01\u001fQL01`, unit_code: 'DV01', qlnb_code: 'QL01', emp_code: 'DN016', effective_from: '2026-07' })];
  const enriched = catalogManagement.buildCatalogRows(rows, [{ unit_code: 'DV01', iit_code: 'QL01', bid_qty_initial: 1000, remain_qty: 0 }]);
  assert.equal(enriched[0].cst_initial, 1000);
  assert.equal(enriched[0].cst_remaining, 0);
});

test('fail-closed nếu projection làm mất bất kỳ cột danh mục trọng yếu nào', () => {
  const before = [{ id: 'a1', contractor_code: 'NT01', unit_code: 'DV01', qlnb_code: 'QL01', product_name: 'Thuốc A', active_ingredient: 'HC A', strength: '500mg', uom: 'Viên', bid_price: 1000 }];
  for (const field of catalogManagement.CRITICAL_CATALOG_FIELDS) {
    const after = [{ ...before[0], [field]: null }];
    assert.throws(
      () => catalogManagement.assertCriticalProjectionCoverage(before, after),
      (error) => error.code === 'CATALOG_CRITICAL_FIELD_COVERAGE_LOSS' && error.details.field === field,
      field,
    );
  }
});

test('fail-closed nếu serializer làm sai giá trị CST so với nguồn chuẩn', () => {
  assert.throws(
    () => catalogManagement.assertCstProjectionCoverage(
      [{ unit_code: 'DV01', qlnb_code: 'QL01', cst_initial: null, cst_remaining: 0 }],
      [{ unit_code: 'DV01', iit_code: 'QL01', bid_qty_initial: 1000, remain_qty: 250 }],
    ),
    (error) => error.code === 'CATALOG_CRITICAL_FIELD_COVERAGE_LOSS' && error.details.field === 'cst_initial',
  );
  assert.throws(
    () => catalogManagement.assertCstProjectionCoverage(
      [{ unit_code: 'DV01', qlnb_code: 'QL01', cst_initial: 1000, cst_remaining: null }],
      [{ unit_code: 'DV01', iit_code: 'QL01', bid_qty_initial: 1000, remain_qty: 0 }],
    ),
    (error) => error.code === 'CATALOG_CRITICAL_FIELD_COVERAGE_LOSS' && error.details.field === 'cst_remaining',
  );
});

test('fail-closed nếu catalog nguồn rỗng, thiếu field trọng yếu hoặc thiếu cặp phân công', () => {
  const catalogRow = { c4: 'NT01', c5: 'QL01', c7: 'DV01', c15: 'HC A', c16: 'Thuốc A', c17: '500mg', c25: 'Viên', c31: 1000 };
  const assignment = catalogManagement.normalizeRow({ unit_code: 'DV01', qlnb_code: 'QL01', emp_code: 'DN016', effective_from: '2026-07' });
  assert.doesNotThrow(() => catalogManagement.assertCatalogSourceContract([catalogRow], [assignment]));
  for (const field of catalogManagement.CRITICAL_CATALOG_SOURCE_FIELDS) {
    assert.throws(
      () => catalogManagement.assertCatalogSourceContract([{ ...catalogRow, [field]: null }], [assignment]),
      (error) => error.code === (field === 'c4' ? 'CATALOG_CONTRACTOR_C4_MISSING' : 'CATALOG_CRITICAL_SOURCE_MISSING'),
      field,
    );
  }
  assert.throws(
    () => catalogManagement.assertCatalogSourceContract([catalogRow], []),
    (error) => error.code === 'CATALOG_ASSIGNMENTS_EMPTY',
  );
  for (const field of ['unit_code', 'qlnb_code']) {
    assert.throws(
      () => catalogManagement.assertCatalogSourceContract([catalogRow], [{ ...assignment, type: 'unit_qlnb', [field]: null }]),
      (error) => error.code === 'CATALOG_ASSIGNMENT_KEY_MISSING',
      field,
    );
  }
  assert.throws(
    () => catalogManagement.assertCatalogSourceContract([catalogRow], [{ ...assignment, qlnb_code: 'QL02' }]),
    (error) => error.code === 'CATALOG_PAIR_COVERAGE_MISSING',
  );
});

test('nguồn CST sai định dạng bị chặn thay vì âm thầm biến thành thiếu', () => {
  const rows = [catalogManagement.normalizeRow({ unit_code: 'DV01', qlnb_code: 'QL01', emp_code: 'DN016', effective_from: '2026-07' })];
  assert.throws(
    () => catalogManagement.buildCatalogRows(rows, [{ unit_code: 'DV01', iit_code: 'QL01', bid_qty_initial: 'không-phải-số', remain_qty: 0 }]),
    (error) => error.code === 'CATALOG_CST_INVALID_NUMBER',
  );
});

test('privacy assertion chặn field/phrase cấm nếu serializer bị sửa sai', () => {
  assert.throws(() => catalogManagement.assertEmployeeSafe({ actor: 'CEO' }), /privacy field/i);
  assert.throws(() => catalogManagement.assertEmployeeSafe({ message: 'Nhận từ một nhân viên khác' }), /privacy phrase/i);
});

test('C10 được whitelist cho Thưởng v2; C32/C47 khóa cứng và C41 vẫn chưa được duyệt', () => {
  assert.deepEqual(catalogManagement.PERMANENTLY_BLOCKED_CATALOG_FIELDS, ['c32', 'c47']);
  for (const field of ['c32', 'C32', 'c_32', 'c47', 'C47', 'c_47']) {
    assert.equal(catalogManagement.isPermanentlyBlockedCatalogField(field), true, field);
    assert.throws(
      () => catalogManagement.assertNoPermanentCatalogFields({ snapshots: { '2026-07': { catalog: [{ [field]: 'SECRET' }] } } }, 'restoredLkg'),
      (error) => error.code === 'CATALOG_PERMANENT_FIELD_BLOCKED' && error.status === 502,
    );
    assert.throws(() => catalogManagement.assertEmployeeSafe({ [field]: 'SECRET' }), /privacy field/i);
  }
  assert.deepEqual(catalogManagement.APPROVED_OPTIONAL_CATALOG_FIELDS, ['c10']);
  assert.doesNotThrow(() => catalogManagement.assertCatalogFieldPolicy({ catalog: [{ c10: 'H.A*' }] }));
  assert.doesNotThrow(() => catalogManagement.assertNoPermanentCatalogFields({ catalog: [{ c41: 'FUTURE_OPTIONAL' }] }));
  assert.throws(
    () => catalogManagement.assertCatalogFieldPolicy({ catalog: [{ c41: 'NOT_APPROVED_YET' }] }),
    (error) => error.code === 'CATALOG_FIELD_NOT_APPROVED' && error.status === 502,
  );
  const recovered = catalogManagement.safeRestoredSnapshots({
    '2026-06': {
      rows: [{ unit_code: 'DV01', qlnb_code: 'QL01', product_name: 'SAFE' }],
      catalog: [{ c4: 'NT01', c5: 'QL01', c7: 'DV01', c15: 'HC', c16: 'SAFE', c17: '1mg', c25: 'Viên', c31: 1 }],
    },
    '2026-07': { rows: [], catalog: [{ c32: 'POISONED' }] },
    '2026-08': { rows: [], catalog: [{ c41: 'NOT_APPROVED_YET' }] },
  });
  assert.deepEqual(Object.keys(recovered), ['2026-06']);
});

test('normalize giữ audit cần thiết cho CEO view', () => {
  const row = catalogManagement.normalizeRow({ assignment_id: 'x', employee_code: 'dn001', assignment_type: 'iit', assignment_value: 'QL01', from_period: '2026-07', actor: 'CEO', batch_id: 'b1', note: 'audit note' });
  assert.equal(row.emp_code, 'DN001');
  assert.equal(row.actor, 'CEO');
  assert.equal(row.transfer_batch_id, 'b1');
  assert.equal(row.internal_note, 'audit note');
});

test('lệnh điều chuyển được đổi sang contract batch Data Hub và không gửi người cũ', async () => {
  const oldFetch = global.fetch;
  const oldUrl = process.env.DATA_HUB_BASE_URL;
  const oldKey = process.env.DATA_HUB_ASSIGNMENT_KEY;
  let captured;
  process.env.DATA_HUB_BASE_URL = 'https://hub.example';
  process.env.DATA_HUB_ASSIGNMENT_KEY = 'test-key';
  global.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ ok: true, changed: 1 }) };
  };
  try {
    await catalogManagement.transfer({ period: '08.2026', effective_period: '08.2026', from_emp_code: 'DN001', to_emp_code: 'dn016', type: 'iit', value: 'QL01', note: 'Nội bộ' }, { emp_code: 'CEO' });
    assert.equal(captured.url, 'https://hub.example/api/integrations/app-report/assignments/transfer');
    assert.deepEqual(captured.body, { effective_from: '2026-08', to_emp: 'DN016', items: [{ scope: 'qlnb', code: 'QL01' }], reason: 'Nội bộ' });
    assert.equal(JSON.stringify(captured.body).includes('DN001'), false);
    assert.equal(captured.options.headers['x-assignment-key'], 'test-key');
    assert.equal(captured.options.headers['x-app-report-actor'], 'CEO');
  } finally {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.DATA_HUB_BASE_URL; else process.env.DATA_HUB_BASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.DATA_HUB_ASSIGNMENT_KEY; else process.env.DATA_HUB_ASSIGNMENT_KEY = oldKey;
  }
});
