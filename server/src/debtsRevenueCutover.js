'use strict';

const crypto = require('node:crypto');
const policy = require('./groupDonaRevenuePolicy');

function fail(code, details = {}) {
  const error = new Error(code); error.code = code; error.details = details; throw error;
}
function clean(value, max = 240) { return String(value ?? '').normalize('NFC').trim().slice(0, max); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
}
function canonical(value) { return JSON.stringify(stable(value)); }

function toRevenueRow(row) {
  const legalEntity = clean(row?.legal_entity, 80).toUpperCase();
  const contractorCode = legalEntity === 'DONA' ? '01.DONA' : legalEntity === 'AFP' ? '02.AFP' : '';
  const sourceLineId = clean(row?.source_line_id, 240);
  const invoiceNumber = clean(row?.invoice_number, 180);
  const empCode = clean(row?.emp_code, 80).toUpperCase();
  const unitCode = clean(row?.unit_code, 180);
  const qlnbCode = clean(row?.qlnb_code, 180);
  const productName = clean(row?.product_name, 300);
  if (!contractorCode || !sourceLineId || !invoiceNumber || !empCode || !unitCode || !qlnbCode
    || !productName
    || row?.quarantine !== false || row?.mapping_status !== 'mapped') fail('DEBTS_REVENUE_ROW_INVALID');
  return Object.freeze({
    source: 'DEBTS_INVOICE_SHADOW', legal_entity: legalEntity, contractor_code: contractorCode,
    date: clean(row.invoice_date, 10), source_order: invoiceNumber, source_line_id: sourceLineId,
    emp_code: empCode, unit_code: unitCode, iit_code: qlnbCode, qlnb_code: qlnbCode, product_name: productName,
    route: clean(row.route, 30).toUpperCase(),
    uom: clean(row.uom, 100), quantity: clean(row.quantity, 48),
    unit_price: clean(row.unit_price_before_vat, 48), revenue_before_vat: clean(row.revenue_before_vat, 48),
    vat_amount: clean(row.vat_amount, 48), revenue: clean(row.revenue_after_vat, 48), row_type: clean(row.row_type, 60),
  });
}

function build({ period, partitions } = {}) {
  const normalized = policy.normalizePeriod(period);
  if (!policy.isCutoverPeriod(normalized)) fail('DEBTS_REVENUE_CUTOVER_PERIOD_BLOCKED', { period: normalized || period });
  if (!partitions || typeof partitions !== 'object') fail('DEBTS_REVENUE_PARTITIONS_MISSING');
  const rows = []; const receipts = [];
  for (const legalEntity of ['DONA', 'AFP']) {
    const part = partitions[legalEntity];
    if (!part || !Array.isArray(part.rows) || !Array.isArray(part.quarantined) || !part.receipt) fail('DEBTS_REVENUE_PARTITION_MISSING', { legalEntity });
    if (part.receipt.period !== normalized || part.receipt.rowCount !== part.rows.length || part.receipt.rowCount <= 0 || part.receipt.mappedCount <= 0
      || part.receipt.quarantinedCount !== 0 || part.quarantined.length !== 0
      || part.receipt.mappedCount !== part.rows.length || part.rows.some((row) => row?.legal_entity !== legalEntity)) {
      fail('DEBTS_REVENUE_PARTITION_NOT_ACCEPTABLE', { legalEntity });
    }
    rows.push(...part.rows.map(toRevenueRow));
    receipts.push({ legalEntity, snapshotId: part.receipt.snapshotId, sourceChecksum: part.receipt.sourceChecksum,
      mappingChecksum: part.receipt.mappingChecksum, rowsChecksum: part.receipt.rowsChecksum, mappedCount: part.receipt.mappedCount });
  }
  const identities = new Set(rows.map((row) => row.source_line_id));
  if (!rows.length) fail('DEBTS_REVENUE_EMPTY');
  if (identities.size !== rows.length) fail('DEBTS_REVENUE_DUPLICATE_LINE_ID');
  rows.sort((a, b) => a.source_line_id.localeCompare(b.source_line_id, 'en'));
  return Object.freeze({ period: normalized, rows: Object.freeze(rows), rowCount: rows.length,
    rowsChecksum: sha(canonical(rows)), sourceReceipts: Object.freeze(receipts), source: 'DEBTS_ONLY_GROUP_DONA' });
}

module.exports = { canonical, toRevenueRow, build };
