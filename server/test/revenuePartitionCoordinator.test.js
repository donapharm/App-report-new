'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs');
const os = require('node:os'); const path = require('node:path');
const coordinator = require('../src/revenuePartitionCoordinator');

const appRows = [{ source: 'APP_WEB_PARTNER', source_line_id: 'WEB:1', contractor_code: '03.X', date: '2026-09-05', revenue: 100 }];
const debtRows = [
  { source: 'DEBTS_INVOICE_SHADOW', source_line_id: 'DONA:1', contractor_code: '01.DONA', date: '2026-09-04', revenue: 20 },
  { source: 'DEBTS_INVOICE_SHADOW', source_line_id: 'AFP:1', contractor_code: '02.AFP', date: '2026-09-04', revenue: 30 },
];
function debtPayload(receipts = [{ legalEntity: 'DONA' }, { legalEntity: 'AFP' }]) { return { period: '2026-09', rows: debtRows,
  rowsChecksum: coordinator.checksum(debtRows), sourceReceipts: receipts }; }

test('DONA and AFP can only form one complete atomic debts generation', () => {
  assert.throws(() => coordinator.buildDebts('2026-09', debtPayload([{ legalEntity: 'DONA' }])), { code: 'DEBTS_ATOMIC_GENERATION_INVALID' });
  const generation = coordinator.buildDebts('2026-09', debtPayload());
  assert.equal(generation.rowCount, 2); assert.equal(generation.kind, 'debts-dona-afp');
});

test('stages immutable partition generations and rejects pointer/checksum drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-generation-'));
  try {
    const generation = coordinator.buildAppWeb('2026-09', appRows, { generatedAt: '2026-09-05T11:00:00.000Z' });
    coordinator.stage(generation, { dataDir: root });
    assert.deepEqual(coordinator.loadCurrent({ dataDir: root, period: '2026-09', kind: 'app-web' }).rows, appRows);
    const pointer = coordinator._paths.currentPath(root, '2026-09', 'app-web');
    const value = JSON.parse(fs.readFileSync(pointer, 'utf8')); value.rowsChecksum = '0'.repeat(64); fs.writeFileSync(pointer, JSON.stringify(value));
    assert.throws(() => coordinator.loadCurrent({ dataDir: root, period: '2026-09', kind: 'app-web' }), { code: 'REVENUE_GENERATION_POINTER_DRIFT' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('coordinator pins independent provenance for APP_WEB and atomic DONA+AFP', () => {
  const appWeb = coordinator.buildAppWeb('2026-09', appRows, { generatedAt: '2026-09-05T11:00:00.000Z' });
  const debts = coordinator.buildDebts('2026-09', debtPayload(), { generatedAt: '2026-09-04T11:00:00.000Z' });
  const out = coordinator.coordinate({ period: '2026-09', appWeb, debts });
  assert.equal(out.partitionGenerations.APP_WEB.dataThrough, '2026-09-05');
  assert.equal(out.partitionGenerations.DEBTS_DONA_AFP.dataThrough, '2026-09-04');
  assert.equal(out.debts.sourceReceipts.length, 2);
});
