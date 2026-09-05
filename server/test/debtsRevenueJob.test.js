'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs');
const os = require('node:os'); const path = require('node:path');
const job = require('../src/debtsRevenueJob');

function catalog() { return { period: '2026-09', meta: { sourceVersion: '31.7', version: 'v1', checksum: 'a'.repeat(64) }, rows: [
  { id: 'dona-map', contractor_code: '01.DONA', unit_code: 'U1', qlnb_code: 'Q1', product_name: 'THUỐC DONA', emp_code: 'DN001', uom: 'HOP' },
  { id: 'afp-map', contractor_code: '02.AFP', unit_code: 'U2', qlnb_code: 'Q2', product_name: 'THUỐC AFP', emp_code: 'DN002', uom: 'HOP' },
] }; }
function result(entity) { const row = { legal_entity: entity, source_line_id: `${entity}:1`, invoice_number: '1', invoice_date: '2026-09-01',
  emp_code: entity === 'DONA' ? 'DN001' : 'DN002', unit_code: entity === 'DONA' ? 'U1' : 'U2', qlnb_code: entity === 'DONA' ? 'Q1' : 'Q2',
  product_name: entity === 'DONA' ? 'THUỐC DONA' : 'THUỐC AFP',
  uom: 'HOP', quantity: '1', unit_price_before_vat: '10', revenue_before_vat: '10', vat_amount: '1', revenue_after_vat: '11',
  row_type: 'sale', quarantine: false, mapping_status: 'mapped' };
  return { rows: [row], mapped: [row], quarantined: [], receipt: { period: '2026-09', snapshotId: `${entity}-snap`, sourceChecksum: entity,
    mappingChecksum: 'm', rowsChecksum: entity, rowCount: 1, mappedCount: 1, quarantinedCount: 0 } }; }
function env() { return { APP_REPORT_DEBTS_SHADOW_ENABLED: '1', APP_REPORT_DEBTS_ENDPOINT: 'https://debts.invalid', APP_REPORT_DEBTS_TOKEN: 'x',
  APP_REPORT_DEBTS_SHADOW_WRITE_ENABLED: '1', APP_REPORT_DEBTS_RECEIPT_SIGNING_KEY: Buffer.alloc(32, 1).toString('base64'),
  APP_REPORT_DEBTS_RECEIPT_SIGNING_KEY_ID: 'k1' }; }
test('job verifies both partitions before switching one T09 revenue slot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-job-')); fs.mkdirSync(path.join(root, 'uploads')); fs.writeFileSync(path.join(root, 'upload_slots.json'), '[]');
  const seen = [];
  try {
    const out = await job.runOnce({ force: true, now: new Date('2026-09-01T11:00:00Z'), env: env(), dataDir: root, deps: {
      getCatalogSnapshot: async () => catalog(), fetchSnapshotPages: async ({ legalEntity }) => ({ legalEntity }),
      materializeShadow: (combined) => result(combined.legalEntity), publishShadow: (part) => part,
      verifyPublishedShadow: (part) => { seen.push(part.receipt.snapshotId); return part; }, loadPartnerRows: async () => ({ rows: [] }),
      publishSlot: (composed) => ({ skipped: null, slot: { rows: composed.rows.length } }),
    } });
    assert.equal(out.ok, true); assert.equal(out.rowCount, 2); assert.deepEqual(seen, ['DONA-snap', 'AFP-snap']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('fresh APP_WEB is composed with the last verified atomic DONA+AFP generation when current debts fail', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-job-fallback-')); let published = null;
  const coordinator = require('../src/revenuePartitionCoordinator');
  const previousRows = [
      { source: 'DEBTS_INVOICE_SHADOW', source_line_id: 'DONA:old', contractor_code: '01.DONA' },
      { source: 'DEBTS_INVOICE_SHADOW', source_line_id: 'AFP:old', contractor_code: '02.AFP' },
    ];
  const previousDebts = coordinator.buildDebts('2026-09', {
    period: '2026-09', rows: previousRows, rowsChecksum: coordinator.checksum(previousRows),
    sourceReceipts: [{ legalEntity: 'DONA' }, { legalEntity: 'AFP' }] }, { generatedAt: '2026-09-04T11:00:00.000Z' });
  try {
    await assert.rejects(() => job.runOnce({ force: true, now: new Date('2026-09-05T11:00:00Z'), env: env(), dataDir: root, deps: {
      getCatalogSnapshot: async () => catalog(), loadPartnerRows: async () => ({ rows: [{ source: 'APP_WEB_PARTNER', source_line_id: 'WEB:new', contractor_code: '03.X', date: '2026-09-05' }] }),
      fetchSnapshotPages: async () => { const error = new Error('DEBTS_REVENUE_PARTITION_NOT_ACCEPTABLE'); error.code = error.message; throw error; },
      stageGeneration: () => {}, loadGeneration: ({ kind }) => kind === 'debts-dona-afp' ? previousDebts : null,
      bootstrapGenerations: () => { throw new Error('unused'); }, publishSlot: (value) => { published = value; return { skipped: null }; },
    } }), { code: 'DEBTS_REVENUE_PARTITION_NOT_ACCEPTABLE' });
    assert.deepEqual(published.rows.map((row) => row.source_line_id), ['WEB:new', 'DONA:old', 'AFP:old']);
    assert.equal(published.partitionGenerations.APP_WEB.dataThrough, '2026-09-05');
    assert.equal(published.partitionGenerations.DEBTS_DONA_AFP.generatedAt, '2026-09-04T11:00:00.000Z');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('old CRM scheduler is hard blocked for T09 even when force=true', async () => {
  const old = require('../src/revenueRefresh');
  await assert.rejects(() => old.runOnce({ force: true, ky: '09.2026' }), { code: 'MISA_REVENUE_DISABLED_FROM_2026_09' });
  assert.equal(old.isDue(new Date('2026-09-03T01:00:00Z')).reason, 'misa_disabled_from_2026_09');
});
test('job status is safe with the scheduler enabled', () => {
  const previous = process.env.APP_REPORT_DEBTS_REVENUE_SCHEDULE_ENABLED;
  process.env.APP_REPORT_DEBTS_REVENUE_SCHEDULE_ENABLED = '1';
  try { assert.equal(job.status().weekday, '18:00'); } finally {
    if (previous === undefined) delete process.env.APP_REPORT_DEBTS_REVENUE_SCHEDULE_ENABLED;
    else process.env.APP_REPORT_DEBTS_REVENUE_SCHEDULE_ENABLED = previous;
  }
});
