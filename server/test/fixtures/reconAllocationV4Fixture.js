'use strict';
const crypto = require('node:crypto');
const { checksum } = require('../../src/appSaleReconAllocationV4');
const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
function child(index, overrides = {}) {
  const preview = index === 1
    ? { order_id: 'order-2524', order_code: 'DT-260708-0176', order_item_id: '2524', base_quantity: '2400' }
    : { order_id: 'order-2783', order_code: 'DT-260723-0346', order_item_id: '2783', base_quantity: '4000' };
  const identity = { ...preview, employee_id: '5', employee_code: 'DN005' };
  const merged = { ...identity, ...overrides };
  const checksumIdentity = { order_id: merged.order_id, order_code: merged.order_code, order_item_id: merged.order_item_id, employee_id: merged.employee_id, employee_code: merged.employee_code, base_quantity: merged.base_quantity };
  return {
    child_ordinal: index,
    order_id: merged.order_id,
    order_code: merged.order_code,
    order_item_id: merged.order_item_id,
    employee_id: merged.employee_id,
    employee_code: merged.employee_code,
    base_quantity: merged.base_quantity,
    reconciled_quantity: merged.base_quantity,
    quantity_delta: '0',
    immutable_identity_checksum: sha(checksumIdentity),
  };
}
function group(index = 1, overrides = {}) {
  const children = overrides.children || [child(1), child(2)];
  const ordered = children.reduce((sum, item) => sum + Number(item.base_quantity), 0);
  const delta = Object.hasOwn(overrides, 'quantity_delta') ? Number(overrides.quantity_delta) : (index === 1 ? 20 : 0);
  const core = { confirmed_line_id: String(index), partner_reconciliation_line_id: String(255 + index), row_ordinal: index, period: '2026-07', contractor_code: '20.HĐS', unit_code: '002.NT-BVĐK Thống Nhất ĐN', product_id: '72', qlnb_code: 'G1.GE.QĐ110.G0723.26', unit_price: '1', document_codes: children.map((item) => item.order_code), order_item_ids: children.map((item) => item.order_item_id), ordered_quantity: String(ordered), reconciled_quantity: String(ordered + delta), quantity_delta: String(delta), order_count: children.length, children, variance: delta ? { kind: 'EMPLOYEE_GROUP_VARIANCE', quantity: String(delta), quantity_delta: String(delta), attribution_status: 'EMPLOYEE_GROUP', employee_id: '5', employee_code: 'DN005', order_id: null, order_item_id: null } : null };
  Object.assign(core, overrides); delete core.bridge_checksum;
  return { ...core, bridge_checksum: sha(core) };
}
function snapshot(groups = [group()]) { return { contract: 'app-sale-reconciliation-allocation-v4', shadow_only: true, effective_values_changed: false, period: '2026-07', contractor_code: '20.HĐS', reconciliation_version: 7, reconciliation_rows_checksum_v2: 'a'.repeat(64), allocation_version: 4, allocation_checksum: checksum(groups), confirmed_by: 'VP018', confirmed_at: '2026-08-09T00:00:00.000Z', offset: 0, next_offset: null, has_more: false, page_checksum: checksum(groups), groups }; }
module.exports = { sha, child, group, snapshot };
