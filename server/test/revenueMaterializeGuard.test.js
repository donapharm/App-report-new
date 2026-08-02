const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  evaluateRevenueCandidate,
  isEmptyMaterializerPlaceholder,
  canBootstrapFromInactivePlaceholders,
  noFollowOpenFlag,
  invalidSlotPeriods,
  selectCanonicalPeriodSlots,
  periodSlotsSnapshot,
} = require('../src/revenueMaterializeGuard');

const goodSlot = {
  id: 'rev-good',
  active: true,
  ky: '07.2026',
  totalRows: 1847,
  totalRevenue: 28457691443,
  sourceRunId: '262',
  sourceSummary: {
    CRM_MISA: { rows: 1310, orders: 495, revenue: 19075894863 },
    APP_WEB_PARTNER: { rows: 537, orders: 318, revenue: 9381796580 },
  },
};

function candidate(patch = {}) {
  return {
    ky: '07.2026',
    totalRows: 1859,
    totalRevenue: 28575193243,
    sourceRunId: '270',
    sourceSummary: {
      CRM_MISA: { rows: 1319, orders: 501, revenue: 19171667663 },
      APP_WEB_PARTNER: { rows: 540, orders: 320, revenue: 9403525580 },
    },
    ...patch,
  };
}

const codes = (result) => result.reasons.map((reason) => reason.code);

test('first materialization is allowed without a comparable active slot', () => {
  assert.equal(evaluateRevenueCandidate({ previousSlot: null, candidate: candidate() }).ok, true);
  assert.equal(evaluateRevenueCandidate({ previousSlot: null, candidate: {
    ky: '08.2026', totalRows: 0, totalRevenue: 0, sourceRunId: '300', sourceSummary: {},
  } }).ok, true, 'a new period may legitimately start with no sales');
});

function legacyPlaceholder(patch = {}) {
  const id = patch.id || 'rev_2src_082026_20260709141059';
  return {
    id,
    ky: '08.2026',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31',
    totalRows: 0,
    totalRevenue: 0,
    empCount: 0,
    filename: `${id}.json`,
    uploadedBy: 'SYSTEM',
    uploadedByName: 'CRM MISA + APP WEB materializer',
    uploadedAt: '2026-07-09T14:10:59.535Z',
    active: false,
    source: 'CRM_MISA_PLUS_APP_WEB',
    sourceRunId: '52',
    sourceSnapshotFinishedAt: '2026-07-09T13:36:33.016Z',
    sourceSummary: {},
    data_as_of: '2026-08-01T07:30:00+07:00',
    ...patch,
  };
}

test('the exact pre-period zero-row legacy signature bootstraps only from a regular empty-array payload', (t) => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-placeholder-'));
  t.after(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));
  const placeholder = legacyPlaceholder();
  fs.writeFileSync(path.join(uploadsDir, placeholder.filename), '[]\n');
  assert.equal(isEmptyMaterializerPlaceholder(placeholder), true);
  assert.equal(canBootstrapFromInactivePlaceholders({ slots: [placeholder], uploadsDir }), true);

  fs.writeFileSync(path.join(uploadsDir, placeholder.filename), '[{"revenue":1}]\n');
  assert.equal(canBootstrapFromInactivePlaceholders({ slots: [placeholder], uploadsDir }), false,
    'non-empty payload must remain fail-closed even when metadata claims zero rows');
});

test('inactive real, manual, malformed, mixed or missing slots cannot bypass the missing-active guard', (t) => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-placeholder-reject-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-placeholder-outside-'));
  t.after(() => {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
  const base = legacyPlaceholder();
  assert.equal(canBootstrapFromInactivePlaceholders({ slots: [base], uploadsDir }), false, 'missing payload fails closed');
  fs.writeFileSync(path.join(uploadsDir, base.filename), '[]\n');

  for (const field of [
    'data_as_of', 'dateFrom', 'dateTo', 'filename', 'id', 'ky', 'source', 'sourceRunId',
    'sourceSnapshotFinishedAt', 'uploadedAt', 'uploadedBy', 'uploadedByName',
  ]) {
    assert.equal(isEmptyMaterializerPlaceholder({ ...base, [field]: [base[field]] }), false,
      `${field} array must not be coerced to string`);
    assert.equal(isEmptyMaterializerPlaceholder({ ...base, [field]: { value: base[field] } }), false,
      `${field} object must not be coerced to string`);
  }

  const malformedId = legacyPlaceholder({ id: 'rev_2src_082026_20260709141059_bad' });
  const duringPeriod = legacyPlaceholder({
    id: 'rev_2src_082026_20260802141059',
    uploadedAt: '2026-08-02T14:10:59.000Z',
    sourceSnapshotFinishedAt: '2026-08-02T13:36:33.000Z',
  });
  fs.writeFileSync(path.join(uploadsDir, duringPeriod.filename), '[]\n');
  for (const slot of [
    { ...base, totalRows: 1 },
    { ...base, totalRows: '0' },
    { ...base, unexpectedField: true },
    { ...base, uploadedBy: 'ADMIN' },
    { ...base, sourceSummary: null },
    { ...base, dateTo: undefined },
    { ...base, active: undefined },
    { ...base, uploadedAt: '2026-07-09T14:10:59.535+00:00' },
    { ...base, sourceSnapshotFinishedAt: '2026-07-09T13:36:33.016+00:00' },
    { ...base, data_as_of: '2026-08-01Tnot-a-timestamp' },
    { ...base, data_as_of: '2026-08-01T07:30:00Z' },
    { ...base, data_as_of: '2026-08-01T08:00:00+07:00' },
    { ...base, data_as_of: '2026-08-01T07:30:00.000+07:00' },
    { ...base, filename: `../${base.filename}` },
    malformedId,
    duringPeriod,
  ]) assert.equal(isEmptyMaterializerPlaceholder(slot), false);
  assert.equal(canBootstrapFromInactivePlaceholders({ slots: [base, { ...base, totalRows: 1 }], uploadsDir }), false,
    'one invalid slot keeps a mixed set fail-closed');

  fs.unlinkSync(path.join(uploadsDir, base.filename));
  const outsideFile = path.join(outsideDir, base.filename);
  fs.writeFileSync(outsideFile, '[]\n');
  fs.symlinkSync(outsideFile, path.join(uploadsDir, base.filename));
  assert.equal(canBootstrapFromInactivePlaceholders({ slots: [base], uploadsDir }), false,
    'an in-directory symlink to an external payload must be rejected');
});

test('malformed ky metadata is rejected before period selection and cannot become a new-period bypass', () => {
  const arrayKy = legacyPlaceholder({ ky: ['08.2026'] });
  const valid = legacyPlaceholder();
  assert.equal(invalidSlotPeriods([arrayKy]).length, 1);
  assert.throws(() => selectCanonicalPeriodSlots([arrayKy], '08.2026'), { code: 'INVALID_SLOT_PERIOD_METADATA' });
  assert.throws(() => selectCanonicalPeriodSlots([valid, arrayKy], '08.2026'), { code: 'INVALID_SLOT_PERIOD_METADATA' });
  assert.deepEqual(selectCanonicalPeriodSlots([valid], '08.2026'), [valid]);
  assert.equal(periodSlotsSnapshot([arrayKy], '08.2026'), '[]', 'snapshot selection must never coerce malformed ky');
});

test('missing O_NOFOLLOW support and any commit-time period-slot mutation fail closed', () => {
  assert.equal(noFollowOpenFlag({}), null);
  assert.equal(noFollowOpenFlag({ O_NOFOLLOW: 0 }), null);
  assert.equal(noFollowOpenFlag({ O_NOFOLLOW: 131072 }), 131072);

  const baseline = [legacyPlaceholder(), { id: 'july', ky: '07.2026', active: true }];
  const snapshot = periodSlotsSnapshot(baseline, '08.2026');
  assert.equal(periodSlotsSnapshot(structuredClone(baseline), '08.2026'), snapshot);
  assert.notEqual(periodSlotsSnapshot([...baseline, legacyPlaceholder({ id: 'rev_2src_082026_20260710141059', uploadedAt: '2026-07-10T14:10:59.000Z' })], '08.2026'), snapshot,
    'a newly inserted inactive slot must be detected');
  assert.notEqual(periodSlotsSnapshot([{ ...baseline[0], totalRows: 1 }, baseline[1]], '08.2026'), snapshot,
    'placeholder metadata mutation must be detected');
  assert.notEqual(periodSlotsSnapshot([{ ...baseline[0], active: true }, baseline[1]], '08.2026'), snapshot,
    'active state mutation must be detected');
});

test('candidate totals and source summary must be internally consistent even without a baseline', () => {
  const malformed = evaluateRevenueCandidate({
    previousSlot: null,
    candidate: { ky: '08.2026', totalRows: 'bad', totalRevenue: 10, sourceRunId: '300', sourceSummary: {} },
  });
  assert.equal(malformed.ok, false);
  assert.deepEqual(codes(malformed), ['CANDIDATE_TOTALS_INVALID', 'SOURCE_SUMMARY_INCONSISTENT']);
});

test('normal growth and a small correction remain allowed', () => {
  assert.equal(evaluateRevenueCandidate({ previousSlot: goodSlot, candidate: candidate() }).ok, true);
  assert.equal(evaluateRevenueCandidate({ previousSlot: goodSlot, candidate: candidate({
    totalRows: 1800,
    totalRevenue: 28000000000,
    sourceSummary: {
      CRM_MISA: { rows: 1265, orders: 490, revenue: 18600000000 },
      APP_WEB_PARTNER: { rows: 535, orders: 316, revenue: 9400000000 },
    },
  }) }).ok, true);
});

test('reproduces 29/07 13:00 race and rejects the candidate when CRM MISA disappears', () => {
  const result = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRows: 537,
      totalRevenue: 9381796580,
      sourceRunId: '263',
      sourceSummary: {
        APP_WEB_PARTNER: { rows: 537, orders: 318, revenue: 9381796580 },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), [
    'SOURCE_DISAPPEARED',
    'TOTAL_REVENUE_ABRUPT_DROP',
    'TOTAL_ROWS_ABRUPT_DROP',
  ]);
  assert.equal(result.reasons[0].source, 'CRM_MISA');
});

test('source disappearance is rejected even if another source masks the total drop', () => {
  const result = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRows: 1900,
      totalRevenue: 29000000000,
      sourceSummary: {
        APP_WEB_PARTNER: { rows: 1900, orders: 900, revenue: 29000000000 },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['SOURCE_DISAPPEARED']);
});

test('abrupt aggregate revenue or row loss is rejected at the 70% boundary', () => {
  const lowRevenue = goodSlot.totalRevenue * 0.69;
  const revenueDrop = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRevenue: lowRevenue,
      sourceSummary: {
        CRM_MISA: { rows: 1319, orders: 501, revenue: lowRevenue - 9403525580 },
        APP_WEB_PARTNER: { rows: 540, orders: 320, revenue: 9403525580 },
      },
    }),
  });
  const lowRows = Math.floor(goodSlot.totalRows * 0.69);
  const rowDrop = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRows: lowRows,
      sourceSummary: {
        CRM_MISA: { rows: lowRows - 540, orders: 300, revenue: 19171667663 },
        APP_WEB_PARTNER: { rows: 540, orders: 320, revenue: 9403525580 },
      },
    }),
  });
  assert.deepEqual(codes(revenueDrop), ['TOTAL_REVENUE_ABRUPT_DROP']);
  assert.deepEqual(codes(rowDrop), ['TOTAL_ROWS_ABRUPT_DROP']);
});

test('snapshot changing during source reads is rejected', () => {
  const result = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({ sourceRunId: '270', sourceRunIdAfterRead: '271' }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['SOURCE_SNAPSHOT_CHANGED_DURING_READ']);
});

test('a present source with rows and zero net revenue is not treated as disappeared', () => {
  const result = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRows: 1900,
      totalRevenue: 29000000000,
      sourceSummary: {
        CRM_MISA: { rows: 1300, orders: 480, revenue: 0 },
        APP_WEB_PARTNER: { rows: 600, orders: 350, revenue: 29000000000 },
      },
    }),
  });
  assert.equal(result.ok, true);
});

test('an older MISA run cannot replace a newer active slot', () => {
  const result = evaluateRevenueCandidate({ previousSlot: goodSlot, candidate: candidate({ sourceRunId: '261' }) });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['STALE_MISA_RUN']);
});
