'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  CHILD_KEYS, GROUP_KEYS, PAGE_KEYS, MAX_PAGE_GROUPS, checksum, combinePages, loadSnapshot,
} = require('../src/appSaleReconAllocationV4');

const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
function child(index, overrides = {}) {
  const identity = {
    order_id: `order-${index}`,
    order_code: index % 2 ? `DT-${index}-A` : `DT-${index}-B`,
    order_item_id: String(2500 + index),
    employee_id: '5',
    employee_code: 'DN005',
    base_quantity: index % 2 ? '2400' : '4000',
  };
  return {
    child_ordinal: index,
    ...identity,
    reconciled_quantity: identity.base_quantity,
    quantity_delta: '0',
    immutable_identity_checksum: sha(identity),
    ...overrides,
  };
}
function rehashedChild(index, overrides = {}) {
  const item = child(index, overrides);
  const identity = {
    order_id: item.order_id,
    order_code: item.order_code,
    order_item_id: item.order_item_id,
    employee_id: item.employee_id,
    employee_code: item.employee_code,
    base_quantity: item.base_quantity,
  };
  return { ...item, immutable_identity_checksum: sha(identity) };
}
function group(index = 1, overrides = {}) {
  const children = overrides.children || [child(1), child(2)];
  const ordered = children.reduce((sum, item) => sum + Number(item.base_quantity), 0);
  const delta = index === 1 ? 20 : 0;
  const core = {
    confirmed_line_id: String(index),
    partner_reconciliation_line_id: String(255 + index),
    row_ordinal: index,
    period: '2026-07',
    contractor_code: '20.HĐS',
    unit_code: '002.NT-BVĐK Thống Nhất ĐN',
    product_id: '72',
    qlnb_code: 'G1.GE.QĐ110.G0723.26',
    unit_price: '1',
    document_codes: children.map((item) => item.order_code),
    order_item_ids: children.map((item) => item.order_item_id),
    ordered_quantity: String(ordered),
    reconciled_quantity: String(ordered + delta),
    quantity_delta: String(delta),
    order_count: children.length,
    children,
    variance: delta ? {
      kind: 'EMPLOYEE_GROUP_VARIANCE', quantity: String(delta), quantity_delta: String(delta),
      attribution_status: 'EMPLOYEE_GROUP', employee_id: '5', employee_code: 'DN005',
      order_id: null, order_item_id: null,
    } : null,
  };
  Object.assign(core, overrides);
  delete core.bridge_checksum;
  return { ...core, bridge_checksum: sha(core) };
}
function page(groups, allGroups = groups, overrides = {}) {
  const value = {
    contract: 'app-sale-reconciliation-allocation-v4',
    shadow_only: true,
    effective_values_changed: false,
    period: '2026-07',
    contractor_code: '20.HĐS',
    reconciliation_version: 7,
    reconciliation_rows_checksum_v2: 'a'.repeat(64),
    allocation_version: 4,
    allocation_checksum: checksum(allGroups),
    confirmed_by: 'VP018',
    confirmed_at: '2026-08-09T00:00:00.000Z',
    offset: 0,
    next_offset: null,
    has_more: false,
    page_checksum: checksum(groups),
    groups,
  };
  return { ...value, ...overrides };
}

test('consumer enforces the exact App Sale wire schema, checksums and canonical path with pinned versions', async () => {
  assert.deepEqual(Object.keys(group()).sort(), [...GROUP_KEYS].sort());
  assert.deepEqual(Object.keys(child(1)).sort(), [...CHILD_KEYS].sort());
  const groups = Array.from({ length: MAX_PAGE_GROUPS + 1 }, (_, index) => {
    const ordinal = index + 1;
    const children = [
      child(1, { order_id: `order-${ordinal}-1`, order_item_id: `${ordinal}01` }),
      child(2, { order_id: `order-${ordinal}-2`, order_item_id: `${ordinal}02` }),
    ].map((item, childIndex) => {
      const identity = {
        order_id: item.order_id, order_code: item.order_code, order_item_id: item.order_item_id,
        employee_id: item.employee_id, employee_code: item.employee_code, base_quantity: item.base_quantity,
      };
      return { ...item, child_ordinal: childIndex + 1, immutable_identity_checksum: sha(identity) };
    });
    return group(ordinal, { children });
  });
  const first = page(groups.slice(0, MAX_PAGE_GROUPS), groups, { next_offset: MAX_PAGE_GROUPS, has_more: true });
  const second = page(groups.slice(MAX_PAGE_GROUPS), groups, { offset: MAX_PAGE_GROUPS });
  const requests = [];
  const snapshot = await loadSnapshot({
    period: '2026-07', contractorCode: '20.HĐS', reconciliationVersion: 7, allocationVersion: 4,
    baseUrl: 'https://sale.invalid', key: 'dedicated-reconciliation-key',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const body = JSON.stringify(requests.length === 1 ? first : second);
      return { ok: true, headers: { get: () => String(Buffer.byteLength(body)) }, text: async () => body };
    },
  });
  assert.equal(snapshot.groups.length, 251);
  assert.equal(new URL(requests[0].url).pathname, '/api/integrations/app-report/reconciliation-allocation/v4/2026-07/20.H%C4%90S');
  assert.match(requests[0].url, /phien_ban=7/);
  assert.match(requests[0].url, /allocation_version=4/);
  assert.match(requests[1].url, /offset=250/);
  assert.equal(requests[0].options.headers['x-datahub-key'], 'dedicated-reconciliation-key');
  await assert.rejects(() => loadSnapshot({
    period: '2026-07', contractorCode: '20.HẾS'.normalize('NFD'), reconciliationVersion: 7, allocationVersion: 4,
    baseUrl: 'https://sale.invalid', key: 'dedicated-reconciliation-key',
    fetchImpl: async () => { throw new Error('must not call'); },
  }), /Invalid App Sale reconciliation allocation input/);
});

test('combinePages rejects contract drift, private fields, duplicate identities and partial or mutated pagination', () => {
  const groups = [group()];
  const base = page(groups);
  assert.deepEqual(Object.keys(base), PAGE_KEYS);
  assert.equal(combinePages([base], { period: '2026-07', contractorCode: '20.HĐS', reconciliationVersion: 7, allocationVersion: 4 }).groups.length, 1);
  for (const drift of [
    { reconciliation_version: 0 },
    { allocation_checksum: 'b'.repeat(64) },
    { page_checksum: 'b'.repeat(64) },
    { groups: [{ ...group(), c32: 'private' }] },
    { shadow_only: false },
    { confirmed_by: 'DN005' },
    { confirmed_by: 'vp018' },
    { confirmed_at: '2026-08-09T00:00:00Z' },
  ]) assert.throws(() => combinePages([{ ...base, ...drift }]));
  const duplicateChildren = [child(1), child(1)];
  assert.throws(() => combinePages([page([group(1, { children: duplicateChildren })])]));
  const uniqueSecondChildren = [
    rehashedChild(1, { order_id: 'order-3', order_code: 'DT-3-C', order_item_id: '3503' }),
    rehashedChild(2, { order_id: 'order-4', order_code: 'DT-4-D', order_item_id: '3504' }),
  ];
  const second = group(2, { children: uniqueSecondChildren });
  assert.throws(() => combinePages([page([group(), group(2, { children: uniqueSecondChildren, confirmed_line_id: '1' })])]));
  assert.throws(() => combinePages([page([group(), group(2, { children: uniqueSecondChildren, partner_reconciliation_line_id: '256' })])]));
  assert.throws(() => combinePages([page([group(), group(2, { children: uniqueSecondChildren, row_ordinal: 1 })])]));
  const repeatedItemChildren = [
    rehashedChild(1, { order_id: 'order-3', order_code: 'DT-3-C', order_item_id: '2501' }),
    uniqueSecondChildren[1],
  ];
  assert.throws(() => combinePages([page([group(), group(2, { children: repeatedItemChildren })])]));
  const repeatedOrderChildren = [
    rehashedChild(1, { order_id: 'same-order', order_code: 'DT-SAME', order_item_id: '4501' }),
    rehashedChild(2, { order_id: 'same-order', order_code: 'DT-SAME', order_item_id: '4502' }),
  ];
  assert.throws(() => combinePages([page([group(2, { children: repeatedOrderChildren })])]));
  assert.equal(combinePages([page([group(), second])]).groups.length, 2);
  assert.throws(() => combinePages([{ ...base, has_more: true, next_offset: 1 }]));
  assert.throws(() => combinePages([{ ...base, offset: 1 }]));
});

test('variance provenance and immutable child/bridge checksums fail closed', () => {
  const baseGroup = group();
  for (const bad of [
    { children: [{ ...baseGroup.children[0], immutable_identity_checksum: 'b'.repeat(64) }, baseGroup.children[1]], bridge_checksum: baseGroup.bridge_checksum },
    { variance: { ...baseGroup.variance, attribution_status: 'UNALLOCATED_MIXED_EMPLOYEE' }, bridge_checksum: baseGroup.bridge_checksum },
    { bridge_checksum: 'b'.repeat(64) },
  ]) assert.throws(() => combinePages([page([{ ...baseGroup, ...bad }])]));
});

test('loader fails closed on missing pins, oversize, auth, redirect and timeout', async () => {
  const input = {
    period: '2026-07', contractorCode: '20.HĐS', reconciliationVersion: 7, allocationVersion: 4,
    baseUrl: 'https://sale.invalid', key: 'dedicated-reconciliation-key',
  };
  await assert.rejects(() => loadSnapshot({ ...input, reconciliationVersion: undefined, fetchImpl: async () => {} }), /input/);
  await assert.rejects(() => loadSnapshot({ ...input, fetchImpl: async () => ({ ok: true, headers: { get: () => String(1024 * 1024 + 1) }, text: async () => '' }) }), /Invalid App Sale|unavailable/);
  await assert.rejects(() => loadSnapshot({ ...input, fetchImpl: async () => ({ ok: false, status: 401, headers: { get: () => '0' }, text: async () => '' }) }), /unavailable/);
  await assert.rejects(() => loadSnapshot({ ...input, fetchImpl: async () => ({ ok: false, status: 302, headers: { get: () => '0' }, text: async () => '' }) }), /unavailable/);
  await assert.rejects(() => loadSnapshot({
    ...input, timeoutMs: 250,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  }), /unavailable/);
});

module.exports = { child, group, page };
