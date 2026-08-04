'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const WEB_ID = /^WEB:(\d+)$/;
const SLOT_ID = /^[0-9A-Za-z._-]+$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableWebIdentity(row = {}) {
  const raw = String(row.source_line_id ?? row.sourceLineId ?? '').trim().toUpperCase();
  const match = raw.match(WEB_ID);
  if (!match) return null;
  // order_item_id is numeric. Canonicalising removes harmless leading zeroes
  // without converting through Number (which would lose precision for large IDs).
  return `WEB:${BigInt(match[1]).toString()}`;
}

function isWebRow(row = {}) {
  const source = String(row.source || '').trim().toUpperCase();
  const rawIdentity = String(row.source_line_id ?? row.sourceLineId ?? '').trim().toUpperCase();
  return source === 'APP_WEB_PARTNER' || rawIdentity.startsWith('WEB:');
}

class CrossPeriodWebVerificationError extends Error {
  constructor(code, details = {}) {
    super(`${code}:${JSON.stringify(details)}`);
    this.name = 'CrossPeriodWebVerificationError';
    this.code = code;
    this.details = details;
  }
}

function verifiedSlotRows(slot, uploadsDir) {
  const slotId = String(slot?.id || '');
  const ky = String(slot?.ky || '');
  if (!ky) throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_SLOT_PERIOD_MISSING', { slotId });
  if (!SLOT_ID.test(slotId)) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_SLOT_ID_INVALID', { slotId, ky });
  }
  if (!uploadsDir) throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_UPLOADS_DIR_MISSING', { slotId, ky });
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || fs.constants.O_NOFOLLOW <= 0) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_NO_NOFOLLOW_SUPPORT', { slotId, ky });
  }

  let root;
  try { root = fs.realpathSync(uploadsDir); } catch (error) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_UPLOADS_DIR_UNREADABLE', {
      slotId, ky, message: String(error.message || error),
    });
  }
  const file = path.resolve(root, `${slotId}.json`);
  if (path.dirname(file) !== root) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_PAYLOAD_PATH_INVALID', { slotId, ky });
  }

  let fd;
  let bytes;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('payload is not a regular non-symlink file');
    }
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (!fs.fstatSync(fd).isFile()) throw new Error('opened payload is not a regular file');
    bytes = fs.readFileSync(fd);
  } catch (error) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_ACTIVE_PAYLOAD_UNREADABLE', {
      slotId, ky, message: String(error.message || error),
    });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  let rows;
  try { rows = JSON.parse(bytes.toString('utf8')); } catch (error) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_ACTIVE_PAYLOAD_JSON_INVALID', {
      slotId, ky, message: String(error.message || error),
    });
  }
  if (!Array.isArray(rows)) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_ACTIVE_PAYLOAD_NOT_ARRAY', { slotId, ky });
  }

  const payloadSha256 = sha256(bytes);
  if (slot.payloadSha256 && String(slot.payloadSha256) !== payloadSha256) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_ACTIVE_PAYLOAD_HASH_MISMATCH', {
      slotId, ky, expected: String(slot.payloadSha256), actual: payloadSha256,
    });
  }
  if (slot.totalRows !== undefined && Number(slot.totalRows) !== rows.length) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_ACTIVE_PAYLOAD_ROW_COUNT_MISMATCH', {
      slotId, ky, expected: Number(slot.totalRows), actual: rows.length,
    });
  }
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row?.revenue || 0), 0);
  if (slot.totalRevenue !== undefined && Number(slot.totalRevenue) !== totalRevenue) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_ACTIVE_PAYLOAD_REVENUE_MISMATCH', {
      slotId, ky, expected: Number(slot.totalRevenue), actual: totalRevenue,
    });
  }

  const webRows = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const identity = stableWebIdentity(row);
    if (isWebRow(row) && !identity) {
      throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_IDENTITY_UNVERIFIABLE', {
        slotId, ky, rowIndex: index, source: String(row.source || ''),
        sourceLineId: String(row.source_line_id ?? row.sourceLineId ?? ''),
      });
    }
    if (identity) {
      webRows.push({
        identity,
        rowIndex: index,
        orderCode: String(row.source_order ?? row.order_code ?? row.orderCode ?? ''),
        revenue: Number(row.revenue || 0),
      });
    }
  }
  return { slotId, ky, payloadSha256, totalRows: rows.length, totalRevenue, webRows };
}

function inspectActiveSlots({ slots, candidateKy, uploadsDir, includeCandidatePeriod = true }) {
  if (!Array.isArray(slots)) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_SLOT_MANIFEST_INVALID', {
      candidateKy, manifestType: typeof slots,
    });
  }
  const targetKy = String(candidateKy || '');
  if (!targetKy) throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_CANDIDATE_PERIOD_MISSING');
  const relevant = slots.filter((slot) => slot?.active
    && (includeCandidatePeriod || String(slot.ky || '') !== targetKy));
  const seenSlotIds = new Set();
  const inspected = relevant.map((slot) => {
    const slotId = String(slot?.id || '');
    if (seenSlotIds.has(slotId)) {
      throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_DUPLICATE_ACTIVE_SLOT_ID', {
        slotId, candidateKy: targetKy,
      });
    }
    seenSlotIds.add(slotId);
    return verifiedSlotRows(slot, uploadsDir);
  }).sort((left, right) => left.ky.localeCompare(right.ky) || left.slotId.localeCompare(right.slotId));

  const snapshot = inspected.map((slot) => ({
    slotId: slot.slotId,
    ky: slot.ky,
    payloadSha256: slot.payloadSha256,
    totalRows: slot.totalRows,
    totalRevenue: slot.totalRevenue,
  }));
  return {
    candidateKy: targetKy,
    slots: inspected,
    snapshot,
    snapshotSha256: sha256(JSON.stringify(snapshot)),
  };
}

function inspectOtherActiveSlots(options) {
  return inspectActiveSlots({ ...options, includeCandidatePeriod: false });
}

function evaluateExistingActivePeriods(activeInspection) {
  if (!activeInspection || !Array.isArray(activeInspection.slots)) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_ACTIVE_INSPECTION_INVALID');
  }
  const byIdentity = new Map();
  for (const slot of activeInspection.slots) {
    for (const row of slot.webRows) {
      const hits = byIdentity.get(row.identity) || [];
      hits.push({ ky: slot.ky, activeSlotId: slot.slotId, ...row });
      byIdentity.set(row.identity, hits);
    }
  }
  const duplicates = [...byIdentity.entries()].flatMap(([identity, hits]) => {
    const periods = [...new Set(hits.map((hit) => hit.ky))].sort();
    return periods.length > 1 ? [{ identity, periods, hits }] : [];
  }).sort((left, right) => left.identity.localeCompare(right.identity));
  return {
    ok: duplicates.length === 0,
    status: duplicates.length ? 'existing_active_cross_period_web_duplicate' : 'clean',
    duplicateCount: duplicates.length,
    duplicates,
    decision: duplicates.length ? 'STOP_AND_REPORT_DO_NOT_AUTO_SELECT_PERIOD' : 'ALLOW',
  };
}

function candidateWebRows(rows) {
  if (!Array.isArray(rows)) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_CANDIDATE_PAYLOAD_NOT_ARRAY');
  }
  const webRows = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const identity = stableWebIdentity(row);
    if (isWebRow(row) && !identity) {
      throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_CANDIDATE_IDENTITY_UNVERIFIABLE', {
        rowIndex: index,
        source: String(row.source || ''),
        sourceLineId: String(row.source_line_id ?? row.sourceLineId ?? ''),
      });
    }
    if (identity) {
      webRows.push({
        identity,
        rowIndex: index,
        orderCode: String(row.source_order ?? row.order_code ?? row.orderCode ?? ''),
        revenue: Number(row.revenue || 0),
      });
    }
  }
  return webRows;
}

function evaluateCandidateAgainstActivePeriods({ rows, candidateKy, activeInspection }) {
  const targetKy = String(candidateKy || '');
  if (!activeInspection || activeInspection.candidateKy !== targetKy) {
    throw new CrossPeriodWebVerificationError('CROSS_PERIOD_WEB_ACTIVE_INSPECTION_INVALID', { candidateKy: targetKy });
  }
  const candidates = candidateWebRows(rows);
  const candidateByIdentity = new Map();
  for (const row of candidates) {
    const hits = candidateByIdentity.get(row.identity) || [];
    hits.push(row);
    candidateByIdentity.set(row.identity, hits);
  }

  const otherPeriodSlots = activeInspection.slots.filter((slot) => slot.ky !== targetKy);
  const duplicates = [];
  for (const slot of otherPeriodSlots) {
    for (const activeRow of slot.webRows) {
      const candidateHits = candidateByIdentity.get(activeRow.identity);
      if (!candidateHits) continue;
      duplicates.push({
        identity: activeRow.identity,
        candidateKy: targetKy,
        candidateHits,
        activeKy: slot.ky,
        activeSlotId: slot.slotId,
        activeHit: activeRow,
      });
    }
  }
  duplicates.sort((left, right) => left.identity.localeCompare(right.identity)
    || left.activeKy.localeCompare(right.activeKy)
    || left.activeSlotId.localeCompare(right.activeSlotId));

  return {
    ok: duplicates.length === 0,
    status: duplicates.length ? 'cross_period_web_duplicate' : 'clean',
    candidateKy: targetKy,
    candidateWebRows: candidates.length,
    checkedActiveSlots: otherPeriodSlots.length,
    checkedActivePeriods: [...new Set(otherPeriodSlots.map((slot) => slot.ky))].sort(),
    duplicateCount: duplicates.length,
    duplicates,
    decision: duplicates.length ? 'REJECT_CANDIDATE_KEEP_EXISTING_PERIOD_AUTHORITATIVE_DO_NOT_AUTO_SELECT' : 'ALLOW',
  };
}

module.exports = {
  CrossPeriodWebVerificationError,
  stableWebIdentity,
  inspectActiveSlots,
  inspectOtherActiveSlots,
  evaluateExistingActivePeriods,
  evaluateCandidateAgainstActivePeriods,
};
