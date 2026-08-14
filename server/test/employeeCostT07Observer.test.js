'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { observeT07Availability } = require('../src/employeeCostT07Observer');
const rows = () => Array.from({ length: 21 }, (_, index) => ({ empCode: `DN${index}`, ok: true, sourceOutcome: 'ok', sourceRange: { from: '2026-07', to: '2026-07' }, sourceGeneration: 'source-t07-1' }));

test('T07 exact-range opening writes high-priority marker without executing seal/snapshot', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't07-marker-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'marker.json');
  const marker = observeT07Availability({ results: rows(), dependencyStable: true, markerFile: file, now: () => new Date('2026-08-14T01:00:00.000Z') });
  assert.equal(marker.state, 'open'); assert.equal(marker.priority, 'high'); assert.equal(marker.requestedAction, 'fresh_seal_snapshot'); assert.equal(marker.executed, false);
  assert.equal(marker.sourceGeneration, 'source-t07-1'); assert.equal(marker.evidence, 'source_declared_generation');
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), marker);
});

test('T07 partial/drift stays waiting and never requests execution', () => {
  const partial = rows().slice(0, 20);
  assert.equal(observeT07Availability({ results: partial, dependencyStable: true }).state, 'waiting');
  assert.equal(observeT07Availability({ results: rows(), dependencyStable: false }).executed, false);
  const missing = rows(); delete missing[20].sourceGeneration;
  const missingMarker = observeT07Availability({ results: missing, dependencyStable: true });
  assert.equal(missingMarker.state, 'waiting'); assert.equal(missingMarker.evidence, 'insufficient_source_generation_evidence');
  assert.deepEqual(missingMarker.missingGeneration, ['DN20']);
  const mixed = rows(); mixed[20].sourceGeneration = 'source-t07-2';
  assert.equal(observeT07Availability({ results: mixed, dependencyStable: true }).state, 'waiting');
  const blank = rows(); blank[20].sourceGeneration = ' ';
  assert.equal(observeT07Availability({ results: blank, dependencyStable: true }).state, 'waiting');
});
