'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const employeeCost = require('../src/employeeCost');
const allocationV4 = require('../src/employeeCostReconAllocationV4');
const shadowV3 = require('../src/employeeCostReconciliationShadow');
const { child, group, snapshot, sha } = require('./fixtures/reconAllocationV4Fixture');

const ORDER_1 = 'DT-260708-0176';
const ORDER_2 = 'DT-260723-0346';
function sourceRows() {
  return [
    { sourceLineId: '2524', orderCode: ORDER_1, employeeCode: 'DN005', c16: 'Thuốc A', c7: 'BV', contractorName: '20.HĐS', rowMonthlyTotal: 100, shadowReconciledQuantity: null, shadowQuantityDelta: null },
    { sourceLineId: '2783', orderCode: ORDER_2, employeeCode: 'DN005', c16: 'Thuốc B', c7: 'BV', contractorName: '20.HĐS', rowMonthlyTotal: 200, shadowReconciledQuantity: null, shadowQuantityDelta: null },
  ];
}

test('sealed App Sale handoff fixture locks the CEO preview values', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/fixtures/app-sale-reconciliation-allocation-v4-handoff.json'), 'utf8'));
  assert.equal(fixture.contract, 'app-sale-reconciliation-allocation-v4-fixture');
  assert.equal(fixture.confirmed.period, '2026-07');
  assert.equal(fixture.confirmed.contractor_code, '20.HĐS');
  assert.deepEqual(fixture.expected.children.map((item) => [item.order_item_id, item.order_code, item.employee_code, item.reconciled_quantity, item.quantity_delta]), [
    ['2524', 'DT-260708-0176', 'DN005', '2400', '0'],
    ['2783', 'DT-260723-0346', 'DN005', '4000', '0'],
  ]);
  assert.deepEqual(fixture.expected.totals, { ordered_quantity: '6400', reconciled_quantity: '6420', quantity_delta: '20' });
});

test('v4 projection maps 2400/0 and 4000/0 atomically, then appends one non-financial 20/+20 variance row', () => {
  const result = allocationV4.projectEmployeeCostRows(sourceRows(), snapshot(), { employeeCode: 'DN005' });
  assert.equal(result.applied, true);
  assert.deepEqual(result.rows.slice(0, 2).map((row) => [row.shadowReconciledQuantity, row.shadowQuantityDelta]), [[2400, 0], [4000, 0]]);
  const synthetic = result.rows[2];
  assert.equal(synthetic.c16, 'Chênh lệch chưa phân bổ theo đơn');
  assert.equal(synthetic.quantity, null);
  assert.equal(synthetic.shadowReconciledQuantity, 20);
  assert.equal(synthetic.shadowQuantityDelta, 20);
  assert.equal(synthetic.orderCode, null);
  assert.equal(synthetic.rowMonthlyTotal, null);
  assert.equal(synthetic.revenue, null);
  assert.deepEqual(result.totals, { orderedQuantity: 6400, reconciledQuantity: 6420, quantityDelta: 20, employeeVarianceRows: 1, mixedEmployeeVarianceCount: 0 });
});

test('partial identity, duplicate rows and duplicate children project no part of a group', () => {
  const partial = allocationV4.projectEmployeeCostRows(sourceRows().slice(0, 1), snapshot(), { employeeCode: 'DN005' });
  assert.equal(partial.applied, false);
  assert.equal(partial.rows[0].shadowReconciledQuantity, null);
  const duplicateRows = allocationV4.projectEmployeeCostRows([sourceRows()[0], sourceRows()[0], sourceRows()[1]], snapshot(), { employeeCode: 'DN005' });
  assert.equal(duplicateRows.applied, false);
  const duplicateChild = child(1, { order_id: 'other-order' });
  const badGroup = group(1, { children: [child(1), duplicateChild] });
  const malformed = allocationV4.projectEmployeeCostRows(sourceRows(), snapshot([badGroup]), { employeeCode: 'DN005' });
  assert.equal(malformed.applied, false);
});

test('mixed-employee variance is count-only and never enters an employee view', () => {
  const second = child(2, { employee_id: '6', employee_code: 'DN006' });
  const core = group(1, { children: [child(1), second] });
  const variance = { ...core.variance, attribution_status: 'UNALLOCATED_MIXED_EMPLOYEE', employee_id: null, employee_code: null };
  const withoutChecksum = { ...core, variance }; delete withoutChecksum.bridge_checksum;
  const mixedGroup = { ...withoutChecksum, bridge_checksum: sha(withoutChecksum) };
  const result = allocationV4.projectEmployeeCostRows(sourceRows(), snapshot([mixedGroup]), { employeeCode: 'DN005' });
  assert.equal(result.rows.some((row) => row.reconciliationSynthetic), false);
  assert.equal(result.applied, false);
});

test('dedicated configuration, version pins, cache scope and unavailable fallback are fail closed', async () => {
  allocationV4.resetCacheForTests();
  assert.equal(await allocationV4.loadScope({ period: '2026-07', contractorCode: '20.HĐS' }, {}), null);
  let calls = 0;
  const options = {
    baseUrl: 'https://sale.invalid', key: 'dedicated-reconciliation-key', reconciliationVersion: 7, allocationVersion: 4,
    loadSnapshotImpl: async (input) => { calls += 1; assert.equal(input.reconciliationVersion, 7); assert.equal(input.allocationVersion, 4); return snapshot(); },
  };
  assert.ok(await allocationV4.loadScope({ period: '2026-07', contractorCode: '20.HĐS' }, options));
  assert.ok(await allocationV4.loadScope({ period: '2026-07', contractorCode: '20.HĐS' }, options));
  assert.equal(calls, 1);
  allocationV4.resetCacheForTests();
  assert.equal(await allocationV4.loadScope({ period: '2026-07', contractorCode: '20.HĐS' }, { ...options, loadSnapshotImpl: async () => { throw new Error('offline'); } }), null);
});

test('EmployeeCost integration keeps all financial outputs identical and excludes synthetic rows from exports', async () => {
  shadowV3.resetCacheForTests(); allocationV4.resetCacheForTests();
  const revenueRows = [
    { emp_code: 'DN005', unit_code: 'U', iit_code: 'P1', revenue: 2400, quantity: 2400, order_code: ORDER_1, source_line_id: '2524', contractor_code: '20.HĐS' },
    { emp_code: 'DN005', unit_code: 'U', iit_code: 'P2', revenue: 4000, quantity: 4000, order_code: ORDER_2, source_line_id: '2783', contractor_code: '20.HĐS' },
  ];
  const costPayload = { empCode: 'DN005', columns: [{ key: 'c36', pos: 36, label: 'Cost' }, { key: 'c41', pos: 41, label: 'c41' }, { key: 'c43', pos: 43, label: 'c43' }, { key: 'c44', pos: 44, label: 'c44' }, { key: 'c45', pos: 45, label: 'c45' }], rows: [{ c5: 'P1', c7: 'U', c16: 'Product 1', c25: 'Box', c36: 10, c41: 0, c43: 0, c44: 0, c45: 0 }, { c5: 'P2', c7: 'U', c16: 'Product 2', c25: 'Box', c36: 10, c41: 0, c43: 0, c44: 0, c45: 0 }] };
  const subject = { scope: { empCode: 'DN005' }, session: { emp_code: 'DN005', role: 'sale' } };
  const common = { baseUrl: 'http://hub.test', assignmentKey: 'assignment-service-key', employeeCostKeys: 'DN005=employee-secret-key-dn005', backoffMs: [], period: '07.2026', catalogRows: [{ c5: 'P1', c7: 'U', c16: 'Product 1' }, { c5: 'P2', c7: 'U', c16: 'Product 2' }], revenueRows, auditImpl: () => {}, fetchImpl: async () => ({ ok: true, status: 200, json: async () => costPayload }) };
  const baseline = await employeeCost.getForSession(subject, common);
  const v4Options = { baseUrl: 'https://sale.invalid', key: 'dedicated-reconciliation-key', reconciliationVersion: 7, allocationVersion: 4, loadSnapshotImpl: async () => snapshot() };
  const actual = await employeeCost.getForSession(subject, { ...common, reconciliationAllocationV4: v4Options });
  assert.equal(actual.rows.length, 3);
  assert.deepEqual(actual.summary, baseline.summary);
  assert.equal(actual.shadowReconciliationTotals.reconciledQuantity, 6420);
  assert.equal(actual.shadowReconciliationTotals.quantityDelta, 20);
  assert.equal(JSON.stringify(actual).includes('c32'), false);
  allocationV4.resetCacheForTests();
  const exported = await employeeCost.getForSession(subject, { ...common, auditEvent: 'export_xlsx', reconciliationAllocationV4: v4Options });
  assert.equal(exported.rows.length, 2);
  assert.deepEqual(exported.summary, baseline.summary);
});
