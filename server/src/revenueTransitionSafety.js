'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { selectCanonicalPeriodSlots, periodSlotsSnapshot } = require('./revenueMaterializeGuard');
const { REVENUE_SEMANTIC_VERSION, semanticRevenueRowsHash } = require('./revenuePayloadIdentity');

const number = (value) => Number(value || 0);

function safeFrozenPayloadFingerprint(slotId, uploadsDir) {
  if (!uploadsDir) throw new Error('FROZEN_PERIOD_UPLOADS_DIR_MISSING');
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || fs.constants.O_NOFOLLOW <= 0) {
    throw new Error('FROZEN_PERIOD_NO_NOFOLLOW_SUPPORT');
  }
  const root = fs.realpathSync(uploadsDir);
  const id = String(slotId || '');
  if (!/^[0-9A-Za-z._-]+$/.test(id)) throw new Error(`FROZEN_PERIOD_SLOT_ID_INVALID:${id}`);
  // Runtime store.js resolves revenue payloads by slot.id, not slot.filename.
  // filename remains covered by manifestSha256 as metadata only.
  const file = path.resolve(root, `${id}.json`);
  if (path.dirname(file) !== root) throw new Error(`FROZEN_PERIOD_PAYLOAD_PATH_INVALID:${id}`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`FROZEN_PERIOD_PAYLOAD_NOT_REGULAR:${id}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`FROZEN_PERIOD_PAYLOAD_NOT_REGULAR:${id}`);
    bytes = fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  let rows;
  try { rows = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`FROZEN_PERIOD_PAYLOAD_JSON_INVALID:${id}`); }
  if (!Array.isArray(rows)) throw new Error(`FROZEN_PERIOD_PAYLOAD_NOT_ARRAY:${id}`);
  return {
    payloadSha256: createHash('sha256').update(bytes).digest('hex'),
    totalRows: rows.length,
    totalRevenue: rows.reduce((sum, row) => sum + number(row?.revenue), 0),
  };
}

function safePayloadSha256(slotId, uploadsDir) {
  return safeFrozenPayloadFingerprint(slotId, uploadsDir).payloadSha256;
}

function frozenPeriodFingerprints(slots, expectedPins, uploadsDir) {
  const fingerprints = {};
  for (const [ky, expected] of Object.entries(expectedPins || {})) {
    const periodSlots = selectCanonicalPeriodSlots(slots, ky);
    const active = periodSlots.filter((slot) => slot.active);
    if (active.length !== 1) throw new Error(`FROZEN_PERIOD_ACTIVE_SLOT_INVALID:${ky}:${active.length}`);
    const slot = active[0];
    const payload = safeFrozenPayloadFingerprint(slot.id, uploadsDir);
    for (const key of ['totalRows', 'totalRevenue']) {
      const slotValue = number(slot[key]);
      if (payload[key] !== slotValue) {
        throw new Error(`FROZEN_PERIOD_PAYLOAD_METADATA_MISMATCH:${ky}:${key}:${payload[key]}:${slotValue}`);
      }
      if (payload[key] !== expected?.[key]) {
        throw new Error(`FROZEN_PERIOD_PAYLOAD_PIN_MISMATCH:${ky}:${key}:${payload[key]}:${expected?.[key]}`);
      }
    }
    const actual = {
      manifestSha256: createHash('sha256').update(periodSlotsSnapshot(slots, ky)).digest('hex'),
      activeSlotId: String(slot.id || ''),
      totalRows: number(slot.totalRows),
      totalRevenue: number(slot.totalRevenue),
      payloadSha256: payload.payloadSha256,
    };
    const pinKeys = ['activeSlotId', 'manifestSha256', 'totalRows', 'totalRevenue', 'payloadSha256'];
    if (Object.prototype.hasOwnProperty.call(expected || {}, 'sourceRunId')) {
      actual.sourceRunId = String(slot.sourceRunId || '');
      pinKeys.push('sourceRunId');
    }
    for (const key of pinKeys) {
      if (actual[key] !== expected?.[key]) {
        throw new Error(`FROZEN_PERIOD_PIN_MISMATCH:${ky}:${key}:${actual[key]}:${expected?.[key]}`);
      }
    }
    fingerprints[ky] = actual;
  }
  return fingerprints;
}

function verifiedActivePayloadFingerprint(slot, uploadsDir) {
  const id = String(slot?.id || '');
  if (!uploadsDir) throw new Error('ACTIVE_PAYLOAD_UPLOADS_DIR_MISSING');
  if (!/^[0-9A-Za-z._-]+$/.test(id)) throw new Error(`ACTIVE_PAYLOAD_SLOT_ID_INVALID:${id}`);
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || fs.constants.O_NOFOLLOW <= 0) {
    throw new Error('ACTIVE_PAYLOAD_NO_NOFOLLOW_SUPPORT');
  }
  const root = fs.realpathSync(uploadsDir);
  const file = path.resolve(root, `${id}.json`);
  if (path.dirname(file) !== root) throw new Error(`ACTIVE_PAYLOAD_PATH_INVALID:${id}`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`ACTIVE_PAYLOAD_NOT_REGULAR:${id}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`ACTIVE_PAYLOAD_NOT_REGULAR:${id}`);
    bytes = fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  let rows;
  try { rows = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`ACTIVE_PAYLOAD_JSON_INVALID:${id}`); }
  if (!Array.isArray(rows)) throw new Error(`ACTIVE_PAYLOAD_NOT_ARRAY:${id}`);
  const fingerprint = {
    payloadSha256: createHash('sha256').update(bytes).digest('hex'),
    payloadSemanticSha256: semanticRevenueRowsHash(rows),
    payloadSemanticVersion: REVENUE_SEMANTIC_VERSION,
    totalRows: rows.length,
    totalRevenue: rows.reduce((sum, row) => sum + number(row?.revenue), 0),
  };
  for (const key of ['payloadSha256', 'payloadSemanticSha256', 'payloadSemanticVersion', 'totalRows', 'totalRevenue']) {
    if (fingerprint[key] !== slot?.[key]) {
      throw new Error(`ACTIVE_PAYLOAD_METADATA_MISMATCH:${id}:${key}:${fingerprint[key]}:${slot?.[key]}`);
    }
  }
  return fingerprint;
}

function createTransitionClaim({
  transition,
  previousSlot,
  previousFingerprint,
  candidate,
  candidateSha256,
  candidateSemanticSha256,
  semanticVersion,
  frozenPeriods,
  claimsDir,
}) {
  const id = String(transition?.id || '');
  if (!/^[A-Z0-9_]+$/.test(id)) throw new Error(`INVALID_TRANSITION_CLAIM_ID:${id}`);
  if (!claimsDir) throw new Error('TRANSITION_CLAIMS_DIRECTORY_MISSING');
  const sha256 = String(candidateSha256 || '');
  const semanticSha256 = String(candidateSemanticSha256 || '');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('TRANSITION_CLAIM_CANDIDATE_PAYLOAD_SHA256_INVALID');
  if (!/^[a-f0-9]{64}$/.test(semanticSha256)) throw new Error('TRANSITION_CLAIM_CANDIDATE_PAYLOAD_SEMANTIC_SHA256_INVALID');
  if (!Number.isInteger(semanticVersion) || semanticVersion !== REVENUE_SEMANTIC_VERSION) {
    throw new Error('TRANSITION_CLAIM_CANDIDATE_PAYLOAD_SEMANTIC_VERSION_INVALID');
  }
  const proof = candidate?.ruleTransitionProof || {};
  const evidenceDigest = String(proof.transitionEvidenceDigest || proof.partnerEvidenceDigest || '');
  if (!/^[a-f0-9]{64}$/.test(evidenceDigest)) {
    throw new Error('TRANSITION_CLAIM_EVIDENCE_DIGEST_INVALID');
  }
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || fs.constants.O_NOFOLLOW <= 0) {
    throw new Error('TRANSITION_CLAIM_NO_NOFOLLOW_SUPPORT');
  }
  const claimRoot = path.resolve(claimsDir);
  try {
    fs.mkdirSync(claimRoot, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const claimRootStat = fs.lstatSync(claimRoot);
  if (!claimRootStat.isDirectory() || claimRootStat.isSymbolicLink()) {
    throw new Error('TRANSITION_CLAIMS_DIRECTORY_INVALID');
  }
  fs.chmodSync(claimRoot, 0o700);
  const claimFile = path.join(claimRoot, `${id}.json`);
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  let fd;
  try {
    fd = fs.openSync(claimFile, flags, 0o600);
    const claim = {
      transitionId: id,
      claimedAt: new Date().toISOString(),
      previousSlotId: String(previousSlot?.id || ''),
      previousSourceRunId: String(previousSlot?.sourceRunId || ''),
      previousTotalRows: number(previousSlot?.totalRows),
      previousTotalRevenue: number(previousSlot?.totalRevenue),
      previousFingerprint,
      candidatePolicyId: String(candidate?.revenueRulePolicy || ''),
      candidateSourceMirror: String(candidate?.revenueSourceMirror || ''),
      candidateSourceRunId: String(candidate?.sourceRunId || ''),
      candidateTotalRows: number(candidate?.totalRows),
      candidateTotalRevenue: number(candidate?.totalRevenue),
      candidatePayloadSha256: sha256,
      candidatePayloadSemanticSha256: semanticSha256,
      candidatePayloadSemanticVersion: semanticVersion,
      transitionEvidenceDigest: evidenceDigest,
      partnerEvidenceDigest: proof.partnerEvidenceDigest || null,
      sourceProjectionDigests: proof.projectionDigests || null,
      sourceSqlDigests: proof.sqlSha256 || null,
      frozenPeriods,
    };
    fs.writeFileSync(fd, `${JSON.stringify(claim, null, 2)}\n`, { encoding: 'utf8' });
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const claimed = new Error(`REVENUE_RULE_TRANSITION_ID_ALREADY_CONSUMED:${id}`);
      claimed.code = 'REVENUE_RULE_TRANSITION_ID_ALREADY_CONSUMED';
      throw claimed;
    }
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const dirFd = fs.openSync(claimRoot, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  return claimFile;
}

module.exports = {
  safePayloadSha256,
  safeFrozenPayloadFingerprint,
  frozenPeriodFingerprints,
  createTransitionClaim,
  verifiedActivePayloadFingerprint,
};
