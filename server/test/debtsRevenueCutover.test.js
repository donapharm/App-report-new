'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const cutover = require('../src/debtsRevenueCutover');
function row(entity, id) { return { source_line_id: `DEBTS:${entity}:${id}`, legal_entity: entity, invoice_date: '2026-09-01',
  invoice_number: `INV-${id}`, emp_code: entity === 'DONA' ? 'DN001' : 'AF001', unit_code: '001.BV', qlnb_code: 'Q1', product_name: 'THUỐC A', uom: 'VIÊN',
  route: entity === 'DONA' ? 'CL' : 'NCL',
  quantity: '1', unit_price_before_vat: '100', revenue_before_vat: '100', vat_amount: '5', revenue_after_vat: '105', row_type: 'SALE',
  mapping_status: 'mapped', quarantine: false }; }
function part(entity, id) { const rows = [row(entity, id)]; return { rows, quarantined: [], receipt: { period: '2026-09', snapshotId: `snapshot-${entity}`,
  sourceChecksum: `sha256:${'a'.repeat(64)}`, mappingChecksum: 'b'.repeat(64), rowsChecksum: 'c'.repeat(64), rowCount: 1, mappedCount: 1, quarantinedCount: 0 } }; }

test('T09 builds one Debts-only Group-Dona payload from both complete signed partitions', () => {
  const result = cutover.build({ period: '09.2026', partitions: { DONA: part('DONA', '1'), AFP: part('AFP', '2') } });
  assert.equal(result.rowCount, 2); assert.equal(result.source, 'DEBTS_ONLY_GROUP_DONA');
  assert.deepEqual(result.rows.map((r) => r.contractor_code).sort(), ['01.DONA', '02.AFP']);
  assert.ok(result.rows.every((r) => r.source === 'DEBTS_INVOICE_SHADOW'));
  assert.ok(result.rows.every((r) => r.qlnb_code === 'Q1' && r.product_name === 'THUỐC A'));
  assert.ok(result.rows.every((r) => r.product_name !== r.qlnb_code));
  assert.deepEqual(result.rows.map((r) => r.route).sort(), ['CL', 'NCL']);
});
test('T09 cutover rejects a mapped row when product_name is absent', () => {
  const dona = part('DONA', '1'); delete dona.rows[0].product_name;
  assert.throws(() => cutover.build({ period: '2026-09', partitions: { DONA: dona, AFP: part('AFP', '2') } }), { code: 'DEBTS_REVENUE_ROW_INVALID' });
});
test('T08 is immutable and cannot enter the T09 cutover path', () => {
  assert.throws(() => cutover.build({ period: '08.2026', partitions: {} }), { code: 'DEBTS_REVENUE_CUTOVER_PERIOD_BLOCKED' });
});
test('any quarantine, missing partition or duplicate line fails closed with no partial payload', () => {
  const dona = part('DONA', '1'); dona.receipt.quarantinedCount = 1; dona.quarantined = [{}];
  assert.throws(() => cutover.build({ period: '2026-09', partitions: { DONA: dona, AFP: part('AFP', '2') } }), { code: 'DEBTS_REVENUE_PARTITION_NOT_ACCEPTABLE' });
  assert.throws(() => cutover.build({ period: '2026-09', partitions: { DONA: part('DONA', '1') } }), { code: 'DEBTS_REVENUE_PARTITION_MISSING' });
  const afp = part('AFP', '2'); afp.rows[0].source_line_id = 'DEBTS:DONA:1';
  assert.throws(() => cutover.build({ period: '2026-09', partitions: { DONA: part('DONA', '1'), AFP: afp } }), { code: 'DEBTS_REVENUE_DUPLICATE_LINE_ID' });
});
test('empty current-period source cannot replace the active revenue slot', () => {
  const empty = { rows: [], quarantined: [], receipt: { period: '2026-09', rowCount: 0, mappedCount: 0, quarantinedCount: 0 } };
  assert.throws(() => cutover.build({ period: '2026-09', partitions: { DONA: empty, AFP: empty } }), { code: 'DEBTS_REVENUE_PARTITION_NOT_ACCEPTABLE' });
});
