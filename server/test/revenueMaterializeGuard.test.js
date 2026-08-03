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
  resolveApprovedRuleTransition,
  partnerEvidenceDigest,
} = require('../src/revenueMaterializeGuard');
const {
  REVENUE_PARTNER_POLICY_ID,
  PARTNER_EXCLUSION_REASONS,
} = require('../src/revenuePartnerEligibility');
const {
  APP_SALE_REVENUE_MIRROR_ID,
  APP_SALE_RELEASE,
  APP_SALE_SOURCE_SHA256,
  APP_SALE_CATALOG_GUARD_SHA256,
  SQL_SHA256: APP_SALE_SQL_SHA256,
  transitionEvidenceDigest,
} = require('../src/appSaleRevenueMirror');

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

const transitionId = 'VIEC0C_T08_2026_LIVE_PARTITION_V1';
const recoveryTransitionId = 'VIEC0C_T08_2026_LIVE_PARTITION_V2';
const digest = (char) => char.repeat(64);

function livePrevious(patch = {}) {
  return {
    id: 'active-t08-before-viec0c',
    ky: '08.2026',
    totalRows: 3,
    totalRevenue: 110,
    sourceRunId: '327',
    sourceSummary: {
      CRM_MISA: { rows: 2, orders: 1, revenue: 80 },
      APP_WEB_PARTNER: { rows: 1, orders: 1, revenue: 30 },
    },
    ...patch,
  };
}

function evidenceRow(patch = {}) {
  return {
    sourceLineId: 'WEB:21', orderId: '11', orderItemId: '21', orderCode: 'DT-01',
    responseId: '31', responseOrderItemId: '21', tokenId: 'token-21', responseRevisionNo: 1,
    responseSource: 'manual_zalo', respondedAt: '2026-08-03T03:00:00.000Z',
    responseUpdatedAt: '2026-08-03T03:01:00.000Z', invoiceId: '', invoiceRevisionNo: 1,
    invoiceSource: 'RESPONSE_LINE', invoiceNo: 'HD21', invoiceIdentity: 'HD21',
    invoiceCreatedAt: '2026-08-03T03:00:00.000Z', invoiceUpdatedAt: '2026-08-03T03:01:00.000Z',
    deliveredQty: 6, quantity: 6, unitPrice: 10, date: '2026-08-03', revenue: 60,
    eligible: false, reason: PARTNER_EXCLUSION_REASONS.MANUAL_ZALO_CHUA_XAC_NHAN,
    employeeCode: 'DN001', productCode: 'P01', unitCode: 'U01',
    ...patch,
  };
}

function liveProof(patch = {}) {
  const partnerEvidenceRows = patch.partnerEvidenceRows || [
    evidenceRow(),
    evidenceRow({
      sourceLineId: 'WEB:22', orderItemId: '22', responseId: '32', responseOrderItemId: '22',
      tokenId: 'token-22', responseSource: 'partner_web', invoiceSource: 'NONE', invoiceNo: '',
      invoiceIdentity: '', invoiceRevisionNo: 0, invoiceCreatedAt: '', invoiceUpdatedAt: '',
      deliveredQty: 4, quantity: 4, revenue: 40, productCode: 'P02',
      reason: PARTNER_EXCLUSION_REASONS.CHUA_XUAT_HOA_DON,
    }),
    evidenceRow({
      sourceLineId: 'WEB:23', orderId: '12', orderItemId: '23', orderCode: 'DT-02',
      responseId: '33', responseOrderItemId: '23', tokenId: 'token-23', responseSource: 'partner_web',
      invoiceSource: 'ITEM_HEADER', invoiceId: '43', invoiceNo: 'HD23', invoiceIdentity: 'HD23',
      deliveredQty: 2, quantity: 2, revenue: 20, eligible: true, reason: '', productCode: 'P03',
    }),
  ];
  const excludedRows = patch.excludedRows || partnerEvidenceRows.filter((row) => !row.eligible).map((row) => ({
    sourceLineId: row.sourceLineId, orderCode: row.orderCode, productCode: row.productCode,
    unitCode: row.unitCode, employeeCode: row.employeeCode, date: row.date,
    revenue: row.revenue, reason: row.reason,
  }));
  return {
    version: 1,
    policyId: REVENUE_PARTNER_POLICY_ID,
    ky: '08.2026',
    sourceRunId: '328',
    dbSnapshot: '100:101:',
    snapshotCapturedAt: '2026-08-03T03:30:00.000Z',
    projectionDigests: {
      misa: digest('a'), rawPartner: digest('b'), eligiblePartner: digest('c'), includedTotal: digest('d'),
      partnerEvidence: partnerEvidenceDigest(partnerEvidenceRows),
    },
    misa: { rows: 2, orders: 1, revenue: 100 },
    includedTotal: { rows: 3, orders: 2, revenue: 120 },
    rawPartner: { rows: 3, orders: 2, revenue: 120 },
    eligiblePartner: { rows: 1, orders: 1, revenue: 20 },
    excludedPartner: { rows: 2, orders: 1, revenue: 100 },
    excludedRows,
    partnerEvidenceRows,
    partnerEvidenceDigest: partnerEvidenceDigest(partnerEvidenceRows),
    ...patch,
  };
}

function liveCandidate(patch = {}) {
  return {
    ky: '08.2026',
    totalRows: 3,
    totalRevenue: 120,
    sourceRunId: '328',
    sourceRunIdAfterRead: '328',
    sourceSummary: {
      CRM_MISA: { rows: 2, orders: 1, revenue: 100 },
      APP_WEB_PARTNER: { rows: 1, orders: 1, revenue: 20 },
    },
    revenueRulePolicy: REVENUE_PARTNER_POLICY_ID,
    ruleTransitionProof: liveProof(),
    ...patch,
  };
}

test('VIỆC 0C transition is mandatory and audited even when the candidate grows', () => {
  const previousSlot = livePrevious();
  const exactCandidate = liveCandidate();
  const missingApproval = evaluateRevenueCandidate({ previousSlot, candidate: exactCandidate });
  assert.equal(missingApproval.ok, false);
  assert.deepEqual(codes(missingApproval), ['REVENUE_RULE_TRANSITION_REQUIRED']);

  const approvedTransition = resolveApprovedRuleTransition(transitionId, '08.2026');
  const accepted = evaluateRevenueCandidate({ previousSlot, candidate: exactCandidate, approvedTransition });
  assert.equal(accepted.ok, true);
  assert.deepEqual(codes(accepted), []);
  assert.equal(accepted.transition?.id, transitionId);
  assert.equal(accepted.transition?.status, 'APPROVED_LIVE_PARTITION_RULE_TRANSITION');
  assert.equal(accepted.transition?.partnerPartition?.partnerEvidenceDigest, exactCandidate.ruleTransitionProof.partnerEvidenceDigest);
});

test('VIỆC 0C recovery V2 changes only the one-shot identity and keeps the exact audited scope', () => {
  const v1 = resolveApprovedRuleTransition(transitionId, '08.2026');
  const v2 = resolveApprovedRuleTransition(recoveryTransitionId, '08.2026');
  assert.deepEqual({ ...v2, id: v1.id }, v1,
    'recovery must not change policy, period, proof version or frozen pins');

  const accepted = evaluateRevenueCandidate({
    previousSlot: livePrevious(),
    candidate: liveCandidate(),
    approvedTransition: v2,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.transition?.id, recoveryTransitionId);
  assert.throws(
    () => resolveApprovedRuleTransition(recoveryTransitionId, '09.2026'),
    /REVENUE_RULE_TRANSITION_EFFECTIVE_PERIOD_MISMATCH/,
  );
});

test('partner evidence token, invoice, quantity, date, reason and digest tampering fail closed', () => {
  const approvedTransition = resolveApprovedRuleTransition(transitionId, '08.2026');
  const base = liveCandidate();
  const mutateEvidence = (index, patch) => {
    const partnerEvidenceRows = base.ruleTransitionProof.partnerEvidenceRows.map((row, i) => i === index ? { ...row, ...patch } : row);
    return { partnerEvidenceRows, partnerEvidenceDigest: partnerEvidenceDigest(partnerEvidenceRows) };
  };
  const duplicateEvidence = base.ruleTransitionProof.partnerEvidenceRows.map((row, index) => index === 1
    ? { ...row, sourceLineId: 'WEB:21', orderItemId: '21', responseOrderItemId: '21' } : row);
  const mutations = [
    { partnerEvidenceDigest: digest('f') },
    mutateEvidence(2, { tokenId: '' }),
    { partnerEvidenceRows: base.ruleTransitionProof.partnerEvidenceRows.map((row, index) => index === 2
      ? { ...row, invoiceNo: 'TAMPERED', invoiceIdentity: 'TAMPERED' } : row) },
    mutateEvidence(2, { quantity: 7 }),
    mutateEvidence(2, { date: '2026-09-01' }),
    mutateEvidence(0, { reason: 'UNKNOWN_REASON' }),
    { partnerEvidenceRows: duplicateEvidence, partnerEvidenceDigest: partnerEvidenceDigest(duplicateEvidence) },
    { excludedPartner: { rows: 2, orders: 1, revenue: 0 } },
    { sourceRunId: '999' },
    { policyId: 'OTHER_POLICY' },
    { ky: '09.2026' },
    { misa: { rows: 2, orders: 1, revenue: 99 } },
    { projectionDigests: { ...base.ruleTransitionProof.projectionDigests, includedTotal: 'bad' } },
  ];
  for (const [index, mutation] of mutations.entries()) {
    const ruleTransitionProof = { ...base.ruleTransitionProof, ...mutation };
    const result = evaluateRevenueCandidate({
      previousSlot: livePrevious(),
      candidate: { ...base, ruleTransitionProof },
      approvedTransition,
    });
    assert.equal(result.ok, false, `mutation ${index} must fail`);
    assert.ok(codes(result).includes('APPROVED_TRANSITION_SIGNATURE_MISMATCH'), `mutation ${index} must fail transition proof validation`);
  }
});

test('transition never waives CRM disappearance or source-run races', () => {
  const approvedTransition = resolveApprovedRuleTransition(transitionId, '08.2026');
  const noCrmProof = liveProof({
    misa: { rows: 0, orders: 0, revenue: 0 },
    includedTotal: { rows: 1, orders: 1, revenue: 20 },
  });
  const noCrm = evaluateRevenueCandidate({
    previousSlot: livePrevious(),
    candidate: liveCandidate({
      totalRows: 1,
      totalRevenue: 20,
      sourceSummary: { APP_WEB_PARTNER: { rows: 1, orders: 1, revenue: 20 } },
      ruleTransitionProof: noCrmProof,
    }),
    approvedTransition,
  });
  assert.equal(noCrm.ok, false);
  assert.ok(noCrm.reasons.some((reason) => reason.code === 'SOURCE_DISAPPEARED' && reason.source === 'CRM_MISA'));
  assert.doesNotMatch(codes(noCrm).join(','), /TOTAL_(?:ROWS|REVENUE)_ABRUPT_DROP/);

  const race = evaluateRevenueCandidate({
    previousSlot: livePrevious(),
    candidate: liveCandidate({ sourceRunIdAfterRead: '329' }),
    approvedTransition,
  });
  assert.equal(race.ok, false);
  assert.ok(codes(race).includes('SOURCE_SNAPSHOT_CHANGED_DURING_READ'));

  const missingRecheck = evaluateRevenueCandidate({
    previousSlot: livePrevious(),
    candidate: liveCandidate({ sourceRunIdAfterRead: '' }),
    approvedTransition,
  });
  assert.equal(missingRecheck.ok, false);
  assert.ok(codes(missingRecheck).includes('SOURCE_SNAPSHOT_RECHECK_MISSING'));
});

test('transition id cannot be reused and policy cannot be rolled back', () => {
  const approvedTransition = resolveApprovedRuleTransition(transitionId, '08.2026');
  const applied = livePrevious({
    totalRevenue: 120,
    sourceRunId: '328',
    sourceSummary: liveCandidate().sourceSummary,
    revenueRulePolicy: REVENUE_PARTNER_POLICY_ID,
    materializeGuard: { transition: { id: transitionId } },
  });
  const next = liveCandidate({ sourceRunId: '329', sourceRunIdAfterRead: '329', ruleTransitionProof: null });
  assert.deepEqual(codes(evaluateRevenueCandidate({ previousSlot: applied, candidate: next, approvedTransition })),
    ['APPROVED_TRANSITION_ALREADY_APPLIED']);
  assert.equal(evaluateRevenueCandidate({ previousSlot: applied, candidate: next }).ok, true,
    'normal scheduler runs continue after the one-time transition id is removed');
  const rollback = evaluateRevenueCandidate({
    previousSlot: applied,
    candidate: { ...next, revenueRulePolicy: '' },
  });
  assert.equal(rollback.ok, false);
  assert.ok(codes(rollback).includes('REVENUE_RULE_POLICY_MISMATCH'));
});

test('transition config rejects unknown ids, wrong periods and missing baselines', () => {
  assert.equal(resolveApprovedRuleTransition('', '08.2026'), null);
  assert.throws(
    () => resolveApprovedRuleTransition('UNKNOWN', '08.2026'),
    /INVALID_REVENUE_RULE_TRANSITION_ID/,
  );
  assert.throws(
    () => resolveApprovedRuleTransition(transitionId, '09.2026'),
    /REVENUE_RULE_TRANSITION_EFFECTIVE_PERIOD_MISMATCH/,
  );
  const approvedTransition = resolveApprovedRuleTransition(transitionId, '08.2026');
  const missing = evaluateRevenueCandidate({ previousSlot: null, candidate: liveCandidate(), approvedTransition });
  assert.equal(missing.ok, false);
  assert.ok(codes(missing).includes('APPROVED_TRANSITION_BASELINE_MISSING'));
});

const mirrorTransitionId = 'VIEC0D_T08_2026_APP_SALE_SQL_MIRROR_V1';

function appSaleMirrorPrevious(patch = {}) {
  return livePrevious({
    id: 'active-t08-viec0c-v2',
    totalRows: 4,
    totalRevenue: 140,
    sourceRunId: '337',
    sourceSummary: {
      CRM_MISA: { rows: 2, orders: 1, revenue: 100 },
      APP_WEB_PARTNER: { rows: 2, orders: 1, revenue: 40 },
    },
    revenueRulePolicy: REVENUE_PARTNER_POLICY_ID,
    materializeGuard: { transition: { id: recoveryTransitionId } },
    ...patch,
  });
}

function appSaleMirrorProof(patch = {}) {
  const proof = {
    version: 1,
    mirrorId: APP_SALE_REVENUE_MIRROR_ID,
    appSaleRelease: APP_SALE_RELEASE,
    appSaleSourceSha256: APP_SALE_SOURCE_SHA256,
    catalogGuardSha256: APP_SALE_CATALOG_GUARD_SHA256,
    ky: '08.2026',
    from: '2026-08-01',
    to: '2026-08-31',
    timeZone: 'Asia/Bangkok',
    dateFields: {
      crm: 'misa_revenue_snapshot_lines.sale_order_date',
      partner: 'orders.created_at',
    },
    sourceRunId: '338',
    dbSnapshot: '106742:106742:',
    snapshotCapturedAt: '2026-08-03T09:33:56.632Z',
    catalogVersionNo: 31,
    sqlSha256: APP_SALE_SQL_SHA256,
    projectionDigests: {
      misa: '1'.repeat(64),
      partner: '2'.repeat(64),
      includedTotal: '3'.repeat(64),
    },
    crm: { rows: 3, orders: 2, revenue: 120 },
    partner: { rows: 2, orders: 1, revenue: 60 },
    partnerKpi: {
      rows: 2, orders: 1, revenue: 60, totalPlaced: 90,
      noResponse: 20, debt: 10, partition: 90, delta: 0,
      excludedCancelledOrders: 0, excludedCancelledAmount: 0,
    },
    includedTotal: { rows: 5, orders: 3, revenue: 180 },
    ...patch,
  };
  proof.transitionEvidenceDigest = transitionEvidenceDigest(proof);
  return proof;
}

function appSaleMirrorCandidate(patch = {}) {
  return {
    ky: '08.2026',
    totalRows: 5,
    totalRevenue: 180,
    sourceRunId: '338',
    sourceRunIdAfterRead: '338',
    sourceSummary: {
      CRM_MISA: { rows: 3, orders: 2, revenue: 120 },
      APP_WEB_PARTNER: { rows: 2, orders: 1, revenue: 60 },
    },
    revenueRulePolicy: null,
    revenueSourceMirror: APP_SALE_REVENUE_MIRROR_ID,
    ruleTransitionProof: appSaleMirrorProof(),
    ...patch,
  };
}

test('VIỆC 0D requires the explicit App Sale SQL mirror transition and removes V1 policy', () => {
  const previousSlot = appSaleMirrorPrevious();
  const exactCandidate = appSaleMirrorCandidate();
  const missing = evaluateRevenueCandidate({ previousSlot, candidate: exactCandidate });
  assert.equal(missing.ok, false);
  assert.ok(codes(missing).includes('REVENUE_RULE_POLICY_MISMATCH'));

  const approvedTransition = resolveApprovedRuleTransition(mirrorTransitionId, '08.2026');
  const accepted = evaluateRevenueCandidate({ previousSlot, candidate: exactCandidate, approvedTransition });
  assert.equal(accepted.ok, true);
  assert.deepEqual(codes(accepted), []);
  assert.equal(accepted.transition.id, mirrorTransitionId);
  assert.equal(accepted.transition.kind, 'APP_SALE_SQL_MIRROR');
  assert.equal(accepted.transition.status, 'APPROVED_APP_SALE_SQL_MIRROR_TRANSITION');
  assert.equal(accepted.transition.previousPolicyId, REVENUE_PARTNER_POLICY_ID);
  assert.equal(accepted.transition.mirrorId, APP_SALE_REVENUE_MIRROR_ID);
  assert.equal(accepted.transition.sourceSnapshot.transitionEvidenceDigest, exactCandidate.ruleTransitionProof.transitionEvidenceDigest);
});

test('VIỆC 0D proof tampering fails closed across provenance, SQL, dates and aggregates', () => {
  const approvedTransition = resolveApprovedRuleTransition(mirrorTransitionId, '08.2026');
  const base = appSaleMirrorCandidate();
  const mutations = [
    { appSaleRelease: 'other' },
    { appSaleSourceSha256: '0'.repeat(64) },
    { catalogGuardSha256: '0'.repeat(64) },
    { from: '2026-08-02' },
    { to: '2026-08-30' },
    { timeZone: 'UTC' },
    { dateFields: { crm: 'revenue_date', partner: 'orders.created_at' } },
    { sourceRunId: '999' },
    { dbSnapshot: 'invalid' },
    { catalogVersionNo: 0 },
    { sqlSha256: { ...APP_SALE_SQL_SHA256, partnerKpi: '0'.repeat(64) } },
    { projectionDigests: null },
    { crm: { rows: 3, orders: 2, revenue: 121 } },
    { partner: { rows: 2, orders: 1, revenue: 61 } },
    { partnerKpi: { ...base.ruleTransitionProof.partnerKpi, delta: 1 } },
    { includedTotal: { rows: 5, orders: 3, revenue: 181 } },
  ];
  for (const [index, patch] of mutations.entries()) {
    const proof = appSaleMirrorProof(patch);
    const result = evaluateRevenueCandidate({
      previousSlot: appSaleMirrorPrevious(),
      candidate: { ...base, ruleTransitionProof: proof },
      approvedTransition,
    });
    assert.equal(result.ok, false, `mutation ${index} must fail`);
    assert.ok(codes(result).includes('APPROVED_TRANSITION_SIGNATURE_MISMATCH'), `mutation ${index} must fail signature`);
  }
  for (const staleDigestProof of [
    { ...appSaleMirrorProof(), partnerKpi: { ...appSaleMirrorProof().partnerKpi, debt: 11 } },
    { ...appSaleMirrorProof(), projectionDigests: { ...appSaleMirrorProof().projectionDigests, partner: '0'.repeat(64) } },
  ]) {
    const staleDigest = evaluateRevenueCandidate({
      previousSlot: appSaleMirrorPrevious(),
      candidate: { ...base, ruleTransitionProof: staleDigestProof },
      approvedTransition,
    });
    assert.ok(codes(staleDigest).includes('APPROVED_TRANSITION_SIGNATURE_MISMATCH'));
  }
});

test('VIỆC 0D transition never waives source disappearance or source-run races', () => {
  const approvedTransition = resolveApprovedRuleTransition(mirrorTransitionId, '08.2026');
  const noCrm = evaluateRevenueCandidate({
    previousSlot: appSaleMirrorPrevious(),
    candidate: appSaleMirrorCandidate({
      totalRows: 2,
      totalRevenue: 60,
      sourceSummary: { APP_WEB_PARTNER: { rows: 2, orders: 1, revenue: 60 } },
      ruleTransitionProof: appSaleMirrorProof({
        crm: { rows: 0, orders: 0, revenue: 0 },
        includedTotal: { rows: 2, orders: 1, revenue: 60 },
      }),
    }),
    approvedTransition,
  });
  assert.equal(noCrm.ok, false);
  assert.ok(noCrm.reasons.some((reason) => reason.code === 'SOURCE_DISAPPEARED' && reason.source === 'CRM_MISA'));

  const race = evaluateRevenueCandidate({
    previousSlot: appSaleMirrorPrevious(),
    candidate: appSaleMirrorCandidate({ sourceRunIdAfterRead: '339' }),
    approvedTransition,
  });
  assert.equal(race.ok, false);
  assert.ok(codes(race).includes('SOURCE_SNAPSHOT_CHANGED_DURING_READ'));
});

test('VIỆC 0D transition is one-shot and subsequent scheduler runs require the same mirror', () => {
  const approvedTransition = resolveApprovedRuleTransition(mirrorTransitionId, '08.2026');
  const applied = appSaleMirrorPrevious({
    totalRows: 5,
    totalRevenue: 180,
    sourceRunId: '338',
    sourceSummary: appSaleMirrorCandidate().sourceSummary,
    revenueRulePolicy: null,
    revenueSourceMirror: APP_SALE_REVENUE_MIRROR_ID,
    materializeGuard: { transition: { id: mirrorTransitionId } },
  });
  const next = appSaleMirrorCandidate({ sourceRunId: '339', sourceRunIdAfterRead: '339', ruleTransitionProof: null });
  assert.deepEqual(codes(evaluateRevenueCandidate({ previousSlot: applied, candidate: next, approvedTransition })),
    ['APPROVED_TRANSITION_ALREADY_APPLIED']);
  assert.equal(evaluateRevenueCandidate({ previousSlot: applied, candidate: next }).ok, true);

  const mirrorRemoved = evaluateRevenueCandidate({
    previousSlot: applied,
    candidate: { ...next, revenueSourceMirror: '' },
  });
  assert.equal(mirrorRemoved.ok, false);
  assert.ok(codes(mirrorRemoved).includes('REVENUE_SOURCE_MIRROR_MISMATCH'));
  assert.throws(() => resolveApprovedRuleTransition(mirrorTransitionId, '09.2026'),
    /REVENUE_RULE_TRANSITION_EFFECTIVE_PERIOD_MISMATCH/);
});
