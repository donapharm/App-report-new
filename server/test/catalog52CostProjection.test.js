const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const projection = require('../src/catalog52CostProjection');

const manifest = { contract: 'data-hub.app-report.full52-snapshot.v1', period: '2026-09', packageChecksum: 'a'.repeat(64), publishedAt: '2026-09-01T00:00:00.000Z', rowCount: 21,
  columns: Array.from({ length: 52 }, (_, index) => ({ key: `c${index + 1}`, label: `C${index + 1}` })) };
const rows = Array.from({ length: 21 }, (_, index) => ({ c5: `QL${index}`, c6: `DN${String(index + 1).padStart(3, '0')}`, c7: `U${index}`, c16: `P${index}`, c25: 'Viên',
  ...Object.fromEntries(projection.COST_COLUMNS.map((key, offset) => [key, offset])) }));

test('Full52 creates a checksummed App Report-owned projection for all 21 employees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog52-cost-')); const env = { CATALOG52_STORE_ROOT: root };
  const value = projection.build({ manifest, rows, actor: 'CEO', builtAt: '2026-09-02T06:00:00+07:00' });
  projection.write(value, { env });
  const fingerprint = projection.fingerprint({ env });
  const kept = projection.readEmployee('2026-09', 'DN001', { env });
  assert.equal(value.employeeCount, 21); assert.equal(kept.source, 'app_report_full52');
  assert.equal(kept.payload.columns.length, 14); assert.equal(kept.payload.rows[0].c46, 13);
  assert.match(fingerprint, /^catalog52-cost:[a-f0-9]{64}$/);
  const file = projection.projectionFile('2026-09', env); const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
  tampered.employees.DN001.rows[0].c46 = 99; fs.writeFileSync(file, JSON.stringify(tampered));
  assert.equal(projection.readEmployee('2026-09', 'DN001', { env }), null);
});

test('projection rejects incomplete employee roster and non-numeric cost cells', () => {
  assert.throws(() => projection.build({ manifest: { ...manifest, rowCount: 20 }, rows: rows.slice(0, 20), actor: 'CEO' }), { code: 'CATALOG52_COST_ROSTER_INCOMPLETE' });
  assert.throws(() => projection.build({ manifest, rows: rows.map((row, index) => index ? row : { ...row, c33: 'x' }), actor: 'CEO' }), { code: 'CATALOG52_COST_VALUE_INVALID' });
});
