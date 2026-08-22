'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const provenance = require('../src/employeeCostSealProvenance');

const FIELDS = Object.freeze({
  c32SidecarRowsChecksum: 'rows-checksum-from-datahub',
  c32SidecarRowCount: 27719,
  c32SidecarArtifactId: 'artifact-c32-t07-r1',
  c32SidecarProvenanceKind: 'locked_snapshot_sidecar',
  c32SidecarAuditChainChecksum: 'audit-chain-from-datahub',
});

function report(overrides = {}) {
  return {
    c32SidecarProvenance: {
      ...FIELDS,
      appReportResponseRowCount: 1,
      ...overrides,
    },
  };
}

test('T07 seal provenance: 21 complete declarations summing to the period total produce an exact GMT+7 envelope', () => {
  const rowCounts = [10982, 396, 1573, 130, 219, 879, 67, 3139, 1041, 864, 106, 123, 1262, 53, 1275, 1432, 15, 469, 25, 3596, 73];
  const envelope = provenance.buildEnvelope(rowCounts.map((appReportResponseRowCount) => report({ appReportResponseRowCount })), { observedAt: new Date('2026-08-18T05:00:00.000Z') });
  assert.ok(envelope);
  for (const field of provenance.REQUIRED_C32_FIELDS) assert.deepEqual(envelope[field], FIELDS[field]);
  assert.equal(envelope.appReportResponseRowCount, 27719);
  assert.equal(envelope.observedAtGmt7, '2026-08-18T12:00:00.000+07:00');
  assert.equal(envelope.appReportRawCaptureIndex, provenance.APP_REPORT_RAW_CAPTURE_INDEX);
  assert.equal(envelope.certaintyStatement, provenance.CERTAINTY_STATEMENT);
  assert.equal(provenance.validEnvelope(envelope), true);
});

test('T07 seal provenance: one missing declaration fails closed', () => {
  const item = report();
  delete item.c32SidecarProvenance.c32SidecarArtifactId;
  assert.equal(provenance.buildEnvelope([item]), null);
});

test('T07 seal provenance: one blank declaration fails closed', () => {
  assert.equal(provenance.buildEnvelope([report({ c32SidecarProvenanceKind: '   ' })]), null);
});

test('T07 seal provenance: declared row count must equal App Report raw response count', () => {
  const captures = Array.from({ length: provenance.EXPECTED_SOURCE_CAPTURE_COUNT }, () => report({ appReportResponseRowCount: 1 }));
  assert.equal(provenance.buildEnvelope(captures), null);
});

test('T07 seal provenance: exactly 21 source captures are mandatory', () => {
  const captures = Array.from({ length: provenance.EXPECTED_SOURCE_CAPTURE_COUNT - 1 }, () => report({ appReportResponseRowCount: 1 }));
  assert.equal(provenance.buildEnvelope(captures), null);
});

test('T07 seal provenance: independent employee responses must declare the same artifact', () => {
  const captures = Array.from({ length: provenance.EXPECTED_SOURCE_CAPTURE_COUNT }, () => report({ appReportResponseRowCount: 1 }));
  captures[captures.length - 1] = report({ appReportResponseRowCount: 27719 - captures.length + 1, c32SidecarArtifactId: 'other' });
  assert.equal(provenance.buildEnvelope(captures), null);
});

test('capture counts raw DataHub rows without requiring sourceRowId and preserves packageChecksum=null', () => {
  const raw = {
    ...FIELDS,
    packageChecksum: null,
    periods: [{ period: '2026-07', rows: Array.from({ length: 3 }, () => ({})) }],
  };
  const captured = provenance.capture(raw);
  assert.equal(captured.appReportResponseRowCount, 3);
  assert.equal(captured.c32SidecarRowsChecksum, FIELDS.c32SidecarRowsChecksum);
  assert.equal(Object.prototype.hasOwnProperty.call(captured, 'packageChecksum'), false);
});
