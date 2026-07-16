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

test('danh mục quản lý suy ra tỉnh từ đơn vị và giữ tỉnh trong response NV đã scope', () => {
  const row = catalogManagement.normalizeRow({
    id: 'bp-1', emp_code: 'DN016', scope: 'unit_qlnb', code: `BVĐK Bình Phước\u001fQL01`,
    unit_code: 'BVĐK Bình Phước', qlnb_code: 'QL01', effective_from: '2026-07',
  });
  assert.equal(row.province, 'Bình Phước');
  const response = catalogManagement.employeeView({
    period: '2026-07', rows: [row], meta: { source: 'test', version: '1' },
  }, 'DN016', '2026-07');
  assert.equal(response.sections.current[0].province, 'Bình Phước');
});

test('từ chối snapshot Data Hub thiếu C4 để không ghi đè cache mã nhà thầu tốt', () => {
  assert.equal(catalogManagement.assertContractorCoverage([{ c4: '01.DONA' }, { c4: '02.AFP' }]), true);
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

test('privacy assertion chặn field/phrase cấm nếu serializer bị sửa sai', () => {
  assert.throws(() => catalogManagement.assertEmployeeSafe({ actor: 'CEO' }), /privacy field/i);
  assert.throws(() => catalogManagement.assertEmployeeSafe({ message: 'Nhận từ một nhân viên khác' }), /privacy phrase/i);
});

test('C32 và C47 bị khóa cứng kể cả payload reset/restore, còn c41 có thể được duyệt sau', () => {
  assert.deepEqual(catalogManagement.PERMANENTLY_BLOCKED_CATALOG_FIELDS, ['c32', 'c47']);
  for (const field of ['c32', 'C32', 'c_32', 'c47', 'C47', 'c_47']) {
    assert.equal(catalogManagement.isPermanentlyBlockedCatalogField(field), true, field);
    assert.throws(
      () => catalogManagement.assertNoPermanentCatalogFields({ snapshots: { '2026-07': { catalog: [{ [field]: 'SECRET' }] } } }, 'restoredLkg'),
      (error) => error.code === 'CATALOG_PERMANENT_FIELD_BLOCKED' && error.status === 502,
    );
    assert.throws(() => catalogManagement.assertEmployeeSafe({ [field]: 'SECRET' }), /privacy field/i);
  }
  assert.deepEqual(catalogManagement.APPROVED_OPTIONAL_CATALOG_FIELDS, []);
  assert.doesNotThrow(() => catalogManagement.assertNoPermanentCatalogFields({ catalog: [{ c41: 'FUTURE_OPTIONAL' }] }));
  assert.throws(
    () => catalogManagement.assertCatalogFieldPolicy({ catalog: [{ c41: 'NOT_APPROVED_YET' }] }),
    (error) => error.code === 'CATALOG_FIELD_NOT_APPROVED' && error.status === 502,
  );
  const recovered = catalogManagement.safeRestoredSnapshots({
    '2026-06': { rows: [{ product_name: 'SAFE' }], catalog: [{ c31: 1 }] },
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
