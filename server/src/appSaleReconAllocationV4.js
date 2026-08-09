'use strict';

const crypto = require('node:crypto');
const { normalizeContractorCode } = require('./appSaleReconShadowV3');

const CONTRACT = 'app-sale-reconciliation-allocation-v4';
const PATH_PREFIX = '/api/integrations/app-report/reconciliation-allocation/v4';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PAGE_GROUPS = 250;
const MAX_GROUPS = 100000;
const MAX_VERSION = 1000000;
const PAGE_KEYS = Object.freeze([
  'contract', 'shadow_only', 'effective_values_changed', 'period', 'contractor_code',
  'reconciliation_version', 'reconciliation_rows_checksum_v2', 'allocation_version',
  'allocation_checksum', 'confirmed_by', 'confirmed_at', 'offset', 'next_offset',
  'has_more', 'page_checksum', 'groups',
]);
const GROUP_KEYS = Object.freeze([
  'confirmed_line_id', 'partner_reconciliation_line_id', 'row_ordinal', 'period',
  'contractor_code', 'unit_code', 'product_id', 'qlnb_code', 'unit_price',
  'document_codes', 'order_item_ids', 'ordered_quantity', 'reconciled_quantity',
  'quantity_delta', 'order_count', 'children', 'variance', 'bridge_checksum',
]);
const CHILD_KEYS = Object.freeze([
  'child_ordinal', 'order_id', 'order_code', 'order_item_id', 'employee_id',
  'employee_code', 'base_quantity', 'reconciled_quantity', 'quantity_delta',
  'immutable_identity_checksum',
]);
const VARIANCE_KEYS = Object.freeze([
  'kind', 'quantity', 'quantity_delta', 'attribution_status', 'employee_id',
  'employee_code', 'order_id', 'order_item_id',
]);

function fail(message = 'Invalid App Sale reconciliation allocation response') {
  const error = new Error(message);
  error.code = 'APP_SALE_RECON_ALLOCATION_V4_INVALID';
  error.status = 502;
  throw error;
}
function clean(value) { return String(value ?? '').trim(); }
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) fail();
}
function required(value) { const out = clean(value); if (!out) fail(); return out; }
function canonicalDecimal(value, scale = 3) {
  const raw = clean(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) fail();
  let [whole, fraction = ''] = raw.split('.');
  const negative = whole.startsWith('-');
  whole = whole.replace(/^-/, '').replace(/^0+(?=\d)/, '') || '0';
  if (fraction.length > scale) fail();
  fraction = fraction.replace(/0+$/, '');
  return `${negative && (whole !== '0' || fraction) ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
function scaled(value) {
  const normalized = canonicalDecimal(value);
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const integer = BigInt(whole + fraction.padEnd(3, '0'));
  return negative ? -integer : integer;
}
function canonicalChild(input, ordinal) {
  exactObject(input, CHILD_KEYS);
  const identity = {
    order_id: required(input.order_id),
    order_code: required(input.order_code),
    order_item_id: required(input.order_item_id),
    employee_id: required(input.employee_id),
    employee_code: required(input.employee_code).toUpperCase(),
    base_quantity: canonicalDecimal(input.base_quantity),
  };
  const out = {
    child_ordinal: input.child_ordinal,
    ...identity,
    reconciled_quantity: canonicalDecimal(input.reconciled_quantity),
    quantity_delta: canonicalDecimal(input.quantity_delta),
    immutable_identity_checksum: clean(input.immutable_identity_checksum),
  };
  if (!Number.isSafeInteger(out.child_ordinal) || out.child_ordinal !== ordinal
    || out.reconciled_quantity !== out.base_quantity || out.quantity_delta !== '0'
    || !/^[a-f0-9]{64}$/.test(out.immutable_identity_checksum)
    || out.immutable_identity_checksum !== sha(identity)) fail();
  return out;
}
function canonicalVariance(input, delta) {
  if (input === null) { if (delta !== '0') fail(); return null; }
  exactObject(input, VARIANCE_KEYS);
  const out = {
    kind: input.kind,
    quantity: canonicalDecimal(input.quantity),
    quantity_delta: canonicalDecimal(input.quantity_delta),
    attribution_status: input.attribution_status,
    employee_id: input.employee_id === null ? null : required(input.employee_id),
    employee_code: input.employee_code === null ? null : required(input.employee_code).toUpperCase(),
    order_id: input.order_id,
    order_item_id: input.order_item_id,
  };
  if (delta === '0' || out.kind !== 'EMPLOYEE_GROUP_VARIANCE' || out.quantity !== delta
    || out.quantity_delta !== delta || out.order_id !== null || out.order_item_id !== null
    || !['EMPLOYEE_GROUP', 'UNALLOCATED_MIXED_EMPLOYEE'].includes(out.attribution_status)
    || (out.attribution_status === 'EMPLOYEE_GROUP' && (!out.employee_id || !out.employee_code))
    || (out.attribution_status === 'UNALLOCATED_MIXED_EMPLOYEE' && (out.employee_id !== null || out.employee_code !== null))) fail();
  return out;
}
function canonicalGroup(input, expected = {}) {
  exactObject(input, GROUP_KEYS);
  if (!Array.isArray(input.children) || !input.children.length || input.children.length > MAX_PAGE_GROUPS
    || !Array.isArray(input.document_codes) || !input.document_codes.length
    || !Array.isArray(input.order_item_ids) || !input.order_item_ids.length) fail();
  const children = input.children.map((child, index) => canonicalChild(child, index + 1));
  const documentCodes = input.document_codes.map(required);
  const orderItemIds = input.order_item_ids.map(required);
  const orderedQuantity = canonicalDecimal(input.ordered_quantity);
  const reconciledQuantity = canonicalDecimal(input.reconciled_quantity);
  const quantityDelta = canonicalDecimal(input.quantity_delta);
  const core = {
    confirmed_line_id: required(input.confirmed_line_id),
    partner_reconciliation_line_id: required(input.partner_reconciliation_line_id),
    row_ordinal: input.row_ordinal,
    period: required(input.period),
    contractor_code: required(input.contractor_code),
    unit_code: required(input.unit_code),
    product_id: required(input.product_id),
    qlnb_code: required(input.qlnb_code),
    unit_price: canonicalDecimal(input.unit_price, 2),
    document_codes: documentCodes,
    order_item_ids: orderItemIds,
    ordered_quantity: orderedQuantity,
    reconciled_quantity: reconciledQuantity,
    quantity_delta: quantityDelta,
    order_count: input.order_count,
    children,
    variance: canonicalVariance(input.variance, quantityDelta),
  };
  const bridgeChecksum = clean(input.bridge_checksum);
  const childOrderIds = children.map((child) => child.order_id);
  const candidateDocuments = [];
  for (const child of children) if (!candidateDocuments.includes(child.order_code)) candidateDocuments.push(child.order_code);
  if (!Number.isSafeInteger(core.row_ordinal) || core.row_ordinal < 1
    || !Number.isSafeInteger(core.order_count) || core.order_count !== candidateDocuments.length
    || new Set(documentCodes).size !== documentCodes.length
    || new Set(orderItemIds).size !== orderItemIds.length
    || core.order_count !== new Set(childOrderIds).size
    || children.length !== orderItemIds.length
    || children.some((child, index) => child.order_item_id !== orderItemIds[index])
    || JSON.stringify(candidateDocuments) !== JSON.stringify(documentCodes)
    || children.reduce((sum, child) => sum + scaled(child.base_quantity), 0n) !== scaled(orderedQuantity)
    || scaled(reconciledQuantity) - scaled(orderedQuantity) !== scaled(quantityDelta)
    || !/^[a-f0-9]{64}$/.test(bridgeChecksum) || bridgeChecksum !== sha(core)
    || (expected.period && core.period !== expected.period)
    || (expected.contractorCode && core.contractor_code !== expected.contractorCode)) fail();
  if (core.variance?.attribution_status === 'EMPLOYEE_GROUP') {
    const identities = new Set(children.map((child) => `${child.employee_id}\0${child.employee_code}`));
    if (identities.size !== 1 || core.variance.employee_id !== children[0].employee_id
      || core.variance.employee_code !== children[0].employee_code) fail();
  }
  return { ...core, bridge_checksum: bridgeChecksum };
}
function checksum(groups) { return sha(groups); }
function canonicalPage(input, expected = {}) {
  exactObject(input, PAGE_KEYS);
  if (input.contract !== CONTRACT || input.shadow_only !== true || input.effective_values_changed !== false
    || !Number.isSafeInteger(input.reconciliation_version) || input.reconciliation_version < 1 || input.reconciliation_version > MAX_VERSION
    || !Number.isSafeInteger(input.allocation_version) || input.allocation_version < 1 || input.allocation_version > MAX_VERSION
    || !/^[a-f0-9]{64}$/.test(clean(input.reconciliation_rows_checksum_v2))
    || !/^[a-f0-9]{64}$/.test(clean(input.allocation_checksum))
    || !/^[a-f0-9]{64}$/.test(clean(input.page_checksum))
    || !Number.isSafeInteger(input.offset) || input.offset < 0
    || typeof input.has_more !== 'boolean'
    || (input.next_offset !== null && (!Number.isSafeInteger(input.next_offset) || input.next_offset < 0))
    || !Array.isArray(input.groups) || input.groups.length > MAX_PAGE_GROUPS) fail();
  const confirmedAt = new Date(input.confirmed_at);
  if (!Number.isFinite(confirmedAt.getTime())) fail();
  const contractorCode = required(input.contractor_code);
  const period = required(input.period);
  const confirmedBy = required(input.confirmed_by);
  const groups = input.groups.map((group) => canonicalGroup(group, { period, contractorCode }));
  const out = { ...input, period, contractor_code: contractorCode, confirmed_by: confirmedBy, groups };
  if (checksum(groups) !== out.page_checksum
    || (expected.period && period !== expected.period)
    || (expected.contractorCode && contractorCode !== expected.contractorCode)
    || (expected.reconciliationVersion && out.reconciliation_version !== expected.reconciliationVersion)
    || (expected.allocationVersion && out.allocation_version !== expected.allocationVersion)) fail();
  return out;
}
function combinePages(pages, expected = {}) {
  if (!Array.isArray(pages) || !pages.length) fail();
  const normalized = pages.map((page) => canonicalPage(page, expected));
  const first = normalized[0];
  const pin = JSON.stringify([
    first.contract, first.period, first.contractor_code, first.reconciliation_version,
    first.reconciliation_rows_checksum_v2, first.allocation_version, first.allocation_checksum,
    first.confirmed_by, new Date(first.confirmed_at).toISOString(),
  ]);
  const groups = [];
  const groupIds = new Set();
  const childIds = new Set();
  let offset = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const page = normalized[index];
    const pagePin = JSON.stringify([
      page.contract, page.period, page.contractor_code, page.reconciliation_version,
      page.reconciliation_rows_checksum_v2, page.allocation_version, page.allocation_checksum,
      page.confirmed_by, new Date(page.confirmed_at).toISOString(),
    ]);
    if (pagePin !== pin || page.offset !== offset
      || (index < normalized.length - 1 && page.has_more !== true)
      || (page.has_more && page.groups.length !== MAX_PAGE_GROUPS)) fail();
    for (const group of page.groups) {
      const groupId = `${group.confirmed_line_id}\x1f${group.partner_reconciliation_line_id}\x1f${group.row_ordinal}`;
      if (groupIds.has(groupId)) fail();
      groupIds.add(groupId);
      for (const child of group.children) {
        const childId = `${child.order_id}\x1f${child.order_item_id}\x1f${child.employee_id}`;
        if (childIds.has(childId)) fail();
        childIds.add(childId);
      }
      groups.push(group);
    }
    offset += page.groups.length;
    if (page.next_offset !== (page.has_more ? offset : null) || groups.length > MAX_GROUPS) fail();
  }
  if (normalized.at(-1).has_more || checksum(groups) !== first.allocation_checksum) fail();
  return { ...first, groups, offset: 0, next_offset: null, has_more: false, page_checksum: checksum(groups) };
}
function parseBaseUrl(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { fail('Invalid App Sale reconciliation allocation config'); }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) fail('Invalid App Sale reconciliation allocation config');
  return url;
}
async function loadSnapshot({ period, contractorCode, reconciliationVersion, allocationVersion, baseUrl, key, fetchImpl = fetch, timeoutMs = 1500 }) {
  const rawContractor = clean(contractorCode);
  const contractor = normalizeContractorCode(contractorCode);
  if (rawContractor !== rawContractor.normalize('NFC') || Array.from(rawContractor).length > 64
    || Buffer.byteLength(rawContractor) > 192 || rawContractor.includes('..')
    || !/^[0-9A-Za-zÀ-ỹĐđ][0-9A-Za-zÀ-ỹĐđ._&-]*$/u.test(rawContractor)
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !contractor || clean(key).length < 16
    || !Number.isInteger(reconciliationVersion) || reconciliationVersion < 1 || reconciliationVersion > MAX_VERSION
    || !Number.isInteger(allocationVersion) || allocationVersion < 1 || allocationVersion > MAX_VERSION) fail('Invalid App Sale reconciliation allocation input');
  const origin = parseBaseUrl(baseUrl);
  const pages = [];
  let offset = 0;
  for (let requestCount = 0; requestCount <= 400; requestCount += 1) {
    const url = new URL(`${PATH_PREFIX}/${period}/${encodeURIComponent(contractor)}`, origin);
    url.searchParams.set('phien_ban', String(reconciliationVersion));
    url.searchParams.set('allocation_version', String(allocationVersion));
    url.searchParams.set('offset', String(offset));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs) || 1500, 250), 10000));
    try {
      const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', 'x-datahub-key': key }, redirect: 'manual', signal: controller.signal });
      if (!response.ok) fail('App Sale reconciliation allocation unavailable');
      const declaredLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) fail();
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) fail();
      let page;
      try { page = JSON.parse(text); } catch { fail(); }
      canonicalPage(page, { period, contractorCode: contractor, reconciliationVersion, allocationVersion });
      pages.push(page);
      if (!page.has_more) break;
      offset = page.next_offset;
    } catch (error) {
      if (error?.code === 'APP_SALE_RECON_ALLOCATION_V4_INVALID') throw error;
      fail('App Sale reconciliation allocation unavailable');
    } finally { clearTimeout(timer); }
  }
  return combinePages(pages, { period, contractorCode: contractor, reconciliationVersion, allocationVersion });
}

module.exports = {
  CONTRACT, PATH_PREFIX, MAX_PAGE_GROUPS, PAGE_KEYS, GROUP_KEYS, CHILD_KEYS, VARIANCE_KEYS,
  checksum, canonicalChild, canonicalGroup, canonicalPage, combinePages, loadSnapshot,
};
