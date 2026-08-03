const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  createTransitionClaim,
  frozenPeriodFingerprints,
  verifiedActivePayloadFingerprint,
} = require('../src/revenueTransitionSafety');
const { periodSlotsSnapshot } = require('../src/revenueMaterializeGuard');
const { REVENUE_SEMANTIC_VERSION, semanticRevenueRowsHash } = require('../src/revenuePayloadIdentity');

const transitionId = 'VIEC0C_T08_2026_LIVE_PARTITION_V1';
const recoveryTransitionId = 'VIEC0C_T08_2026_LIVE_PARTITION_V2';

test('durable transition claim is mode 0600 and the same id is consumed only once', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-transition-claim-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claimsDir = path.join(root, 'claims');
  const args = {
    transition: { id: transitionId },
    previousSlot: { id: 'before', sourceRunId: '327', totalRows: 3, totalRevenue: 110 },
    previousFingerprint: { slotMetadataSha256: 'a'.repeat(64), payloadSha256: 'b'.repeat(64) },
    candidate: {
      sourceRunId: '328', totalRows: 3, totalRevenue: 120,
      revenueRulePolicy: 'PARTNER_TOKEN_INVOICE_V1',
      ruleTransitionProof: {
        partnerEvidenceDigest: 'c'.repeat(64),
        projectionDigests: { misa: 'd'.repeat(64) },
      },
    },
    frozenPeriods: { '06.2026': { payloadSha256: 'e'.repeat(64) } },
    candidateSha256: 'f'.repeat(64),
    candidateSemanticSha256: '1'.repeat(64),
    semanticVersion: REVENUE_SEMANTIC_VERSION,
    claimsDir,
  };

  const claimFile = createTransitionClaim(args);
  assert.equal(path.basename(claimFile), `${transitionId}.json`);
  assert.equal(fs.statSync(claimFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(claimsDir).mode & 0o777, 0o700);
  const claim = JSON.parse(fs.readFileSync(claimFile, 'utf8'));
  assert.equal(claim.transitionId, transitionId);
  assert.equal(claim.previousFingerprint.payloadSha256, 'b'.repeat(64));
  assert.equal(claim.candidatePolicyId, 'PARTNER_TOKEN_INVOICE_V1');
  assert.equal(claim.candidatePayloadSha256, 'f'.repeat(64));
  assert.equal(claim.candidatePayloadSemanticSha256, '1'.repeat(64));
  assert.equal(claim.candidatePayloadSemanticVersion, REVENUE_SEMANTIC_VERSION);
  assert.equal(claim.partnerEvidenceDigest, 'c'.repeat(64));
  assert.equal(Object.hasOwn(claim, 'candidateSlotId'), false,
    'the claim is written before slot creation and must bind payload identity, not a future slot id');

  assert.throws(() => createTransitionClaim(args), {
    code: 'REVENUE_RULE_TRANSITION_ID_ALREADY_CONSUMED',
  });
});

test('a consumed V1 claim does not authorize reuse but permits the separately approved V2 recovery id', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-transition-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claimsDir = path.join(root, 'claims');
  const base = {
    previousSlot: { id: 'before', sourceRunId: '333', totalRows: 162, totalRevenue: 1187746452 },
    previousFingerprint: { slotMetadataSha256: 'a'.repeat(64), payloadSha256: 'b'.repeat(64) },
    candidate: {
      sourceRunId: '333', totalRows: 143, totalRevenue: 957430732,
      revenueRulePolicy: 'PARTNER_TOKEN_INVOICE_V1',
      ruleTransitionProof: {
        partnerEvidenceDigest: 'c'.repeat(64),
        projectionDigests: { misa: 'd'.repeat(64) },
      },
    },
    frozenPeriods: { '06.2026': { payloadSha256: 'e'.repeat(64) } },
    candidateSha256: 'f'.repeat(64),
    candidateSemanticSha256: '1'.repeat(64),
    semanticVersion: REVENUE_SEMANTIC_VERSION,
    claimsDir,
  };
  createTransitionClaim({ ...base, transition: { id: transitionId } });
  const recoveryClaim = createTransitionClaim({ ...base, transition: { id: recoveryTransitionId } });
  assert.equal(path.basename(recoveryClaim), `${recoveryTransitionId}.json`);
  assert.equal(JSON.parse(fs.readFileSync(recoveryClaim, 'utf8')).transitionId, recoveryTransitionId);
  assert.throws(
    () => createTransitionClaim({ ...base, transition: { id: recoveryTransitionId } }),
    { code: 'REVENUE_RULE_TRANSITION_ID_ALREADY_CONSUMED' },
  );
});

test('invalid or missing candidate fingerprints fail before a transition claim is created', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-transition-invalid-candidate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claimsDir = path.join(root, 'claims');
  const base = {
    transition: { id: transitionId }, claimsDir,
    candidateSha256: 'a'.repeat(64),
    candidateSemanticSha256: 'b'.repeat(64),
    semanticVersion: REVENUE_SEMANTIC_VERSION,
    candidate: { ruleTransitionProof: { partnerEvidenceDigest: 'c'.repeat(64) } },
  };
  for (const [patch, error] of [
    [{ candidateSha256: '' }, /CANDIDATE_PAYLOAD_SHA256_INVALID/],
    [{ candidateSha256: `0${'a'.repeat(64)}` }, /CANDIDATE_PAYLOAD_SHA256_INVALID/],
    [{ candidateSemanticSha256: 'tampered' }, /CANDIDATE_PAYLOAD_SEMANTIC_SHA256_INVALID/],
    [{ semanticVersion: null }, /CANDIDATE_PAYLOAD_SEMANTIC_VERSION_INVALID/],
    [{ semanticVersion: REVENUE_SEMANTIC_VERSION + 1 }, /CANDIDATE_PAYLOAD_SEMANTIC_VERSION_INVALID/],
  ]) {
    assert.throws(() => createTransitionClaim({ ...base, ...patch }), error);
    assert.equal(fs.existsSync(claimsDir), false, 'validation must happen before claim directory/file creation');
  }
});

test('transition claim directory itself may not be a symlink', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-transition-symlink-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const actual = path.join(root, 'actual');
  const link = path.join(root, 'claims');
  fs.mkdirSync(actual);
  fs.symlinkSync(actual, link);
  assert.throws(() => createTransitionClaim({
    transition: { id: transitionId },
    candidateSha256: 'a'.repeat(64),
    candidateSemanticSha256: 'b'.repeat(64),
    semanticVersion: REVENUE_SEMANTIC_VERSION,
    candidate: { ruleTransitionProof: { partnerEvidenceDigest: 'c'.repeat(64) } },
    claimsDir: link,
  }), /TRANSITION_CLAIMS_DIRECTORY_INVALID/);
});

test('T06/T07 frozen fingerprints bind exact pins and resolve payload by slot.id, not filename', (t) => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-frozen-periods-'));
  t.after(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(uploadsDir, 'june.json'), '[{"revenue":28403136096}]\n');
  fs.writeFileSync(path.join(uploadsDir, 'july.json'), '[{"revenue":30917892673}]\n');
  const slots = [
    { id: 'june', ky: '06.2026', active: true, totalRows: 1, totalRevenue: 28403136096, filename: 'wrong-legacy-name.json' },
    { id: 'july', ky: '07.2026', active: true, totalRows: 1, totalRevenue: 30917892673, filename: 'wrong-current-name.json' },
  ];
  const pin = (slot, ky) => ({
    activeSlotId: slot.id,
    manifestSha256: createHash('sha256').update(periodSlotsSnapshot(slots, ky)).digest('hex'),
    totalRows: slot.totalRows,
    totalRevenue: slot.totalRevenue,
    payloadSha256: createHash('sha256').update(fs.readFileSync(path.join(uploadsDir, `${slot.id}.json`))).digest('hex'),
  });
  const expected = { '06.2026': pin(slots[0], '06.2026'), '07.2026': pin(slots[1], '07.2026') };
  const before = frozenPeriodFingerprints(slots, expected, uploadsDir);
  assert.deepEqual(before, expected);

  fs.appendFileSync(path.join(uploadsDir, 'july.json'), ' ');
  assert.throws(() => frozenPeriodFingerprints(slots, expected, uploadsDir),
    /FROZEN_PERIOD_PIN_MISMATCH:07\.2026:payloadSha256/);
  fs.writeFileSync(path.join(uploadsDir, 'july.json'), '[{"revenue":30917892673}]\n');
  assert.throws(
    () => frozenPeriodFingerprints(slots, { ...expected, '07.2026': { ...expected['07.2026'], totalRevenue: 1 } }, uploadsDir),
    /FROZEN_PERIOD_PAYLOAD_PIN_MISMATCH:07\.2026:totalRevenue/,
  );

  const tamperedBytes = '[{"revenue":30917892672}]\n';
  fs.writeFileSync(path.join(uploadsDir, 'july.json'), tamperedBytes);
  const tamperedHashPin = {
    ...expected,
    '07.2026': {
      ...expected['07.2026'],
      payloadSha256: createHash('sha256').update(tamperedBytes).digest('hex'),
    },
  };
  assert.throws(() => frozenPeriodFingerprints(slots, tamperedHashPin, uploadsDir),
    /FROZEN_PERIOD_PAYLOAD_METADATA_MISMATCH:07\.2026:totalRevenue/,
    'parsed payload totals must fail even when the expected byte hash is changed to bless tampered bytes');
  fs.writeFileSync(path.join(uploadsDir, 'july.json'), '{"revenue":30917892673}\n');
  assert.throws(() => frozenPeriodFingerprints(slots, expected, uploadsDir),
    /FROZEN_PERIOD_PAYLOAD_NOT_ARRAY:july/);
  fs.writeFileSync(path.join(uploadsDir, 'july.json'), '[invalid]\n');
  assert.throws(() => frozenPeriodFingerprints(slots, expected, uploadsDir),
    /FROZEN_PERIOD_PAYLOAD_JSON_INVALID:july/);
  fs.writeFileSync(path.join(uploadsDir, 'july.json'), '[{"revenue":30917892673}]\n');

  fs.unlinkSync(path.join(uploadsDir, 'june.json'));
  fs.symlinkSync(path.join(uploadsDir, 'july.json'), path.join(uploadsDir, 'june.json'));
  assert.throws(() => frozenPeriodFingerprints(slots, expected, uploadsDir),
    /FROZEN_PERIOD_PAYLOAD_NOT_REGULAR/);
});

test('active transition baseline verifies bytes, semantic hash, row count and revenue before claim', (t) => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-active-proof-'));
  t.after(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));
  const rows = [{ source_line_id: 'WEB:1', revenue: 120 }];
  const bytes = `${JSON.stringify(rows, null, 2)}\n`;
  fs.writeFileSync(path.join(uploadsDir, 'active.json'), bytes);
  const slot = {
    id: 'active', totalRows: 1, totalRevenue: 120,
    payloadSha256: createHash('sha256').update(bytes).digest('hex'),
    payloadSemanticSha256: semanticRevenueRowsHash(rows),
    payloadSemanticVersion: REVENUE_SEMANTIC_VERSION,
  };
  assert.deepEqual(verifiedActivePayloadFingerprint(slot, uploadsDir), {
    payloadSha256: slot.payloadSha256,
    payloadSemanticSha256: slot.payloadSemanticSha256,
    payloadSemanticVersion: REVENUE_SEMANTIC_VERSION,
    totalRows: 1,
    totalRevenue: 120,
  });
  assert.throws(() => verifiedActivePayloadFingerprint({ ...slot, totalRevenue: 121 }, uploadsDir),
    /ACTIVE_PAYLOAD_METADATA_MISMATCH:active:totalRevenue/);
  assert.throws(() => verifiedActivePayloadFingerprint({ ...slot, payloadSemanticSha256: '0'.repeat(64) }, uploadsDir),
    /ACTIVE_PAYLOAD_METADATA_MISMATCH:active:payloadSemanticSha256/);
});

test('App Sale mirror claim binds mirror id, SQL digests and transition evidence independently of VIỆC 0C', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-appsale-mirror-claim-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const transitionId0d = 'VIEC0D_T08_2026_APP_SALE_SQL_MIRROR_V1';
  const claimFile = createTransitionClaim({
    transition: { id: transitionId0d },
    previousSlot: { id: 'before-0d', sourceRunId: '337', totalRows: 264, totalRevenue: 1647400772 },
    previousFingerprint: { slotMetadataSha256: 'a'.repeat(64), payloadSha256: 'b'.repeat(64) },
    candidate: {
      sourceRunId: '338', totalRows: 284, totalRevenue: 2084024772,
      revenueRulePolicy: null,
      revenueSourceMirror: 'APP_SALE_REVENUE_KPI_SQL_0E820022',
      ruleTransitionProof: {
        transitionEvidenceDigest: 'c'.repeat(64),
        sqlSha256: { crmKpi: 'd'.repeat(64), partnerKpi: 'e'.repeat(64) },
        projectionDigests: { misa: '3'.repeat(64), partner: '4'.repeat(64), includedTotal: '5'.repeat(64) },
      },
    },
    frozenPeriods: { '06.2026': { payloadSha256: 'f'.repeat(64) } },
    candidateSha256: '1'.repeat(64),
    candidateSemanticSha256: '2'.repeat(64),
    semanticVersion: REVENUE_SEMANTIC_VERSION,
    claimsDir: path.join(root, 'claims'),
  });
  const claim = JSON.parse(fs.readFileSync(claimFile, 'utf8'));
  assert.equal(claim.transitionId, transitionId0d);
  assert.equal(claim.candidatePolicyId, '');
  assert.equal(claim.candidateSourceMirror, 'APP_SALE_REVENUE_KPI_SQL_0E820022');
  assert.equal(claim.transitionEvidenceDigest, 'c'.repeat(64));
  assert.equal(claim.partnerEvidenceDigest, null);
  assert.deepEqual(claim.sourceProjectionDigests, {
    misa: '3'.repeat(64), partner: '4'.repeat(64), includedTotal: '5'.repeat(64),
  });
  assert.deepEqual(claim.sourceSqlDigests, { crmKpi: 'd'.repeat(64), partnerKpi: 'e'.repeat(64) });
});
