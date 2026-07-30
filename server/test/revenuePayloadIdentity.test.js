const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  REVENUE_SEMANTIC_VERSION,
  hashPrettyJsonArray,
  semanticRevenueRowsHash,
  equivalentToActiveSlot,
} = require('../src/revenuePayloadIdentity');

const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('candidate byte digest still matches the atomic JSON writer', () => {
  const rows = [{ source: 'CRM_MISA', revenue: 123, nested: { ok: true } }, { source: 'APP_WEB_PARTNER', revenue: 456 }];
  assert.equal(hashPrettyJsonArray(rows), digest(JSON.stringify(rows, null, 2) + '\n'));
  assert.equal(hashPrettyJsonArray([]), digest('[]\n'));
});

test('unchanged revenue semantics skip commit despite row/key order, generated timestamps, and slot id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-identity-'));
  try {
    const activeRows = [
      { source_line_id: 'MISA:1', revenue: 100, slot_id: 'old-slot', generated_at: '2026-07-30T00:00:00Z', nested: { b: 2, a: 1 } },
      { source_line_id: 'WEB:2', revenue: 200, uploadedAt: '2026-07-30T00:00:00Z' },
    ];
    const candidateRows = [
      { uploadedAt: '2026-07-30T12:00:00Z', revenue: 200, source_line_id: 'WEB:2' },
      { nested: { a: 1, b: 2 }, generated_at: '2026-07-30T12:00:00Z', slot_id: 'candidate-slot', revenue: 100, source_line_id: 'MISA:1' },
    ];
    fs.writeFileSync(path.join(dir, 'active.json'), JSON.stringify(activeRows, null, 2) + '\n');
    const result = await equivalentToActiveSlot({ rows: candidateRows, activeSlot: { id: 'old-slot', filename: 'active.json' }, uploadsDir: dir });
    assert.equal(result.equivalent, true);
    assert.equal(result.candidateSemanticSha256, result.activeSemanticSha256);
    assert.notEqual(result.candidateSha256, result.activeSha256, 'byte payloads differ while semantics match');
    assert.equal(fs.readdirSync(dir).length, 1, 'gate creates no candidate slot/artifact');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('changed revenue business field opens commit path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-identity-'));
  try {
    fs.writeFileSync(path.join(dir, 'active.json'), JSON.stringify([{ source_line_id: 'MISA:1', revenue: 100 }], null, 2) + '\n');
    const result = await equivalentToActiveSlot({
      rows: [{ source_line_id: 'MISA:1', revenue: 101 }],
      activeSlot: { id: 'active-slot', filename: 'active.json' },
      uploadsDir: dir,
    });
    assert.equal(result.equivalent, false);
    assert.notEqual(result.candidateSemanticSha256, result.activeSemanticSha256);
    assert.notEqual(semanticRevenueRowsHash([{ revenue: 100 }]), semanticRevenueRowsHash([{ revenue: 101 }]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('materializer returns unchanged before slot/artifact commit and changed data falls through to commit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'materialize_july_revenue.js'), 'utf8');
  const gateAt = source.indexOf('const identity = await equivalentToActiveSlot');
  const skipAt = source.indexOf("skipped: 'unchanged'", gateAt);
  const returnAt = source.indexOf('return unchanged', skipAt);
  const writeAt = source.indexOf('writeJson(file, rows)', gateAt);
  const deactivateAt = source.indexOf('s.active = false', gateAt);
  assert.ok(gateAt >= 0 && skipAt > gateAt && returnAt > skipAt, 'unchanged path must return explicitly');
  assert.ok(writeAt > returnAt, 'candidate upload is reachable only for changed semantics');
  assert.ok(deactivateAt > returnAt, 'active slot is deactivated only for changed semantics');
  assert.match(source, /activeSlotId: String\(previousSlot\.id\)/);
  assert.match(source, /payloadSemanticVersion: REVENUE_SEMANTIC_VERSION/);
  assert.equal(REVENUE_SEMANTIC_VERSION, 1);
});
