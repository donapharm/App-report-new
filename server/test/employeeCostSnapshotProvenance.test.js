'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const provenance = require('../src/employeeCostSnapshotProvenance');

const tuple = (scope, checksum) => `2026-07:${scope}:rv=3:rc=${checksum}:ca=2026-08-01T00:00:00.000Z:sc=${'c'.repeat(64)}:iv=3:ic=${'d'.repeat(64)}:av=khong-co:ac=khong-co`;

test('T07 accepts complete reconciliation checksums that differ by contractor', () => {
  const employees = new Map([
    ['DN001', { report: { remoteProvenance: [tuple('CT01', 'a'.repeat(64))] } }],
    ['DN002', { report: { remoteProvenance: [tuple('CT02', 'b'.repeat(64))] } }],
  ]);
  assert.equal(provenance.employeeReportsHaveCompleteReconciliationProvenance(employees), true);
});

test('T07 rejects missing, malformed, and explicitly missing reconciliation provenance', () => {
  for (const remoteProvenance of [[], ['2026-07:CT01:THIEU'], ['2026-07:CT01:rv=3:rc=not-a-hash:ca=x']]) {
    assert.equal(provenance.employeeReportsHaveCompleteReconciliationProvenance(new Map([
      ['DN001', { report: { remoteProvenance } }],
    ])), false);
  }
});
