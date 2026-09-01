'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const slot = require('../src/debtsRevenueSlot');
const debts = { period: '2026-09', rowsChecksum: 'a'.repeat(64), sourceReceipts: [{ legalEntity: 'DONA' }, { legalEntity: 'AFP' }], rows: [
  { source: 'DEBTS_INVOICE_SHADOW', source_line_id: 'DEBTS:DONA:1', contractor_code: '01.DONA', emp_code: 'DN001', revenue: '105' },
  { source: 'DEBTS_INVOICE_SHADOW', source_line_id: 'DEBTS:AFP:2', contractor_code: '02.AFP', emp_code: 'AF001', revenue: '210' },
] };
test('compose removes Group-Dona CRM, retains partners and adds Debts rows without mixing', () => {
  const currentRows = [{ source: 'CRM_MISA', source_line_id: 'MISA:1', contractor_code: '01.DONA', revenue: 99 },
    { source: 'APP_WEB_PARTNER', source_line_id: 'WEB:1', contractor_code: '03.TUE.N', revenue: 50 }];
  const result = slot.compose({ period: '09.2026', currentRows, debts });
  assert.deepEqual(result.rows.map((r) => r.source), ['APP_WEB_PARTNER', 'DEBTS_INVOICE_SHADOW', 'DEBTS_INVOICE_SHADOW']);
  assert.equal(result.retainedPartnerRows, 1);
});
test('atomic publish switches one period, is idempotent and preserves rollback slot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-slot-')); const loc = slot.paths(root);
  fs.mkdirSync(loc.uploads, { recursive: true });
  fs.writeFileSync(path.join(loc.uploads, 'old.json'), '[]');
  fs.writeFileSync(loc.slots, JSON.stringify([{ id: 'old', ky: '09.2026', active: true, source: 'CRM_MISA_PLUS_APP_WEB' }]));
  const composed = slot.compose({ period: '2026-09', currentRows: [], debts });
  try {
    const first = slot.publish(composed, { dataDir: root, now: () => new Date('2026-09-03T11:00:00Z'), idFactory: () => 'fixed-id' });
    assert.equal(first.slot.active, true); assert.equal(first.slot.replacedSlotId, 'old');
    const registry = JSON.parse(fs.readFileSync(loc.slots)); assert.equal(registry.find((x) => x.id === 'old').active, false);
    assert.equal(registry.filter((x) => x.active).length, 1); assert.equal(fs.existsSync(path.join(loc.uploads, `${first.slot.id}.json`)), true);
    const second = slot.publish(composed, { dataDir: root }); assert.equal(second.skipped, 'unchanged');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
