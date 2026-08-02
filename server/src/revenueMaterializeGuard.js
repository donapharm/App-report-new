const fs = require('fs');
const path = require('path');

const DEFAULT_MIN_TOTAL_RATIO = 0.70;
const REQUIRED_SOURCES = ['CRM_MISA', 'APP_WEB_PARTNER'];

function number(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function isFiniteNumeric(value) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
}

function sourceStat(summary, source) {
  const value = summary?.[source] || {};
  return { rows: number(value.rows), revenue: number(value.revenue) };
}

function ratio(current, previous) {
  return previous > 0 ? current / previous : null;
}

function expectedPeriodRange(ky) {
  const match = String(ky || '').match(/^(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    key: `${match[1]}${match[2]}`,
    dateFrom: `${match[2]}-${match[1]}-01`,
    dateTo: `${match[2]}-${match[1]}-${String(lastDay).padStart(2, '0')}`,
  };
}

const LEGACY_PLACEHOLDER_KEYS = [
  'active', 'data_as_of', 'dateFrom', 'dateTo', 'empCount', 'filename', 'id', 'ky',
  'source', 'sourceRunId', 'sourceSnapshotFinishedAt', 'sourceSummary', 'totalRevenue',
  'totalRows', 'uploadedAt', 'uploadedBy', 'uploadedByName',
].sort();
const LEGACY_PLACEHOLDER_STRING_FIELDS = [
  'data_as_of', 'dateFrom', 'dateTo', 'filename', 'id', 'ky', 'source', 'sourceRunId',
  'sourceSnapshotFinishedAt', 'uploadedAt', 'uploadedBy', 'uploadedByName',
];

function isCanonicalUtcMillis(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

// Legacy pre-period placeholders were generated before the target month and
// contain no business rows. Keep this signature deliberately narrow: an
// inactive real/manual/corrupt slot must continue to trip MISSING_ACTIVE_SLOT.
function isEmptyMaterializerPlaceholder(slot) {
  if (!slot || Object.getPrototypeOf(slot) !== Object.prototype || slot.active !== false) return false;
  if (JSON.stringify(Object.keys(slot).sort()) !== JSON.stringify(LEGACY_PLACEHOLDER_KEYS)) return false;
  if (LEGACY_PLACEHOLDER_STRING_FIELDS.some((field) => typeof slot[field] !== 'string')) return false;
  const period = expectedPeriodRange(slot.ky);
  const id = String(slot.id || '');
  if (!period) return false;
  const idMatch = id.match(new RegExp(`^rev_2src_${period.key}_(\\d{14})$`));
  if (!idMatch || String(slot.filename || '') !== `${id}.json`) return false;
  if (String(slot.dateFrom || '') !== period.dateFrom || String(slot.dateTo || '') !== period.dateTo) return false;
  if (String(slot.uploadedBy || '') !== 'SYSTEM'
    || String(slot.uploadedByName || '') !== 'CRM MISA + APP WEB materializer'
    || String(slot.source || '') !== 'CRM_MISA_PLUS_APP_WEB') return false;
  if (typeof slot.sourceRunId !== 'string' || !/^[1-9]\d*$/.test(slot.sourceRunId)) return false;
  if (typeof slot.totalRows !== 'number' || slot.totalRows !== 0
    || typeof slot.totalRevenue !== 'number' || slot.totalRevenue !== 0
    || typeof slot.empCount !== 'number' || slot.empCount !== 0) return false;
  if (!slot.sourceSummary || Object.getPrototypeOf(slot.sourceSummary) !== Object.prototype
    || Object.keys(slot.sourceSummary).length !== 0) return false;
  if (!isCanonicalUtcMillis(slot.uploadedAt) || !isCanonicalUtcMillis(slot.sourceSnapshotFinishedAt)) return false;
  const uploadedAt = new Date(slot.uploadedAt);
  const sourceFinishedAt = new Date(slot.sourceSnapshotFinishedAt);
  const periodStartVn = new Date(`${period.dateFrom}T00:00:00+07:00`);
  const uploadedStamp = slot.uploadedAt.replace(/[-:T.Z]/g, '').slice(0, 14);
  if (uploadedStamp !== idMatch[1] || uploadedAt >= periodStartVn
    || sourceFinishedAt >= periodStartVn || sourceFinishedAt >= uploadedAt) return false;
  if (slot.data_as_of !== `${period.dateFrom}T07:30:00+07:00`) return false;
  return true;
}

function noFollowOpenFlag(constants = fs.constants) {
  const flag = constants?.O_NOFOLLOW;
  return Number.isInteger(flag) && flag > 0 ? flag : null;
}

function invalidSlotPeriods(slots) {
  if (!Array.isArray(slots)) return [{ index: -1, id: null, kyType: typeof slots, ky: null }];
  const invalid = [];
  slots.forEach((slot, index) => {
    const ky = slot?.ky;
    if (typeof ky !== 'string' || !expectedPeriodRange(ky)) {
      invalid.push({ index, id: typeof slot?.id === 'string' ? slot.id : null, kyType: typeof ky, ky: typeof ky === 'string' ? ky : null });
    }
  });
  return invalid;
}

function selectCanonicalPeriodSlots(slots, ky) {
  const invalidSlots = invalidSlotPeriods(slots);
  if (invalidSlots.length > 0 || typeof ky !== 'string' || !expectedPeriodRange(ky)) {
    const error = new Error('INVALID_SLOT_PERIOD_METADATA');
    error.code = 'INVALID_SLOT_PERIOD_METADATA';
    error.invalidSlots = invalidSlots;
    throw error;
  }
  return slots.filter((slot) => slot.ky === ky);
}

function periodSlotsSnapshot(slots, ky) {
  if (!Array.isArray(slots) || typeof ky !== 'string') return '[]';
  return JSON.stringify(slots.filter((slot) => typeof slot?.ky === 'string' && slot.ky === ky));
}

function canBootstrapFromInactivePlaceholders({ slots, uploadsDir } = {}) {
  if (!Array.isArray(slots) || slots.length === 0 || !uploadsDir) return false;
  const noFollow = noFollowOpenFlag();
  if (noFollow === null) return false;
  try {
    const root = fs.realpathSync(path.resolve(String(uploadsDir)));
    return slots.every((slot) => {
      if (!isEmptyMaterializerPlaceholder(slot)) return false;
      const file = path.resolve(root, String(slot.filename));
      if (path.dirname(file) !== root) return false;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) return false;
      const realFile = fs.realpathSync(file);
      if (path.dirname(realFile) !== root) return false;
      const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
      try {
        if (!fs.fstatSync(fd).isFile()) return false;
        const payload = JSON.parse(fs.readFileSync(fd, 'utf8'));
        return Array.isArray(payload) && payload.length === 0;
      } finally {
        fs.closeSync(fd);
      }
    });
  } catch {
    return false;
  }
}

/**
 * Fail-closed gate for a candidate current-period revenue slot.
 *
 * A materializer run is rejected when a source that existed in the active slot
 * disappears, the aggregate rows/revenue suddenly fall below 70%, or an older
 * MISA snapshot attempts to replace a newer active slot. The previous slot is
 * left untouched so a transient source race cannot become production data.
 */
function evaluateRevenueCandidate({ previousSlot, candidate, minTotalRatio = DEFAULT_MIN_TOTAL_RATIO } = {}) {
  const current = {
    ky: String(candidate?.ky || ''),
    totalRows: number(candidate?.totalRows),
    totalRevenue: number(candidate?.totalRevenue),
    sourceRunId: String(candidate?.sourceRunId || ''),
    sourceRunIdAfterRead: String(candidate?.sourceRunIdAfterRead || candidate?.sourceRunId || ''),
    sourceSummary: candidate?.sourceSummary || {},
  };
  const previous = previousSlot ? {
    id: String(previousSlot.id || ''),
    ky: String(previousSlot.ky || ''),
    totalRows: number(previousSlot.totalRows),
    totalRevenue: number(previousSlot.totalRevenue),
    sourceRunId: String(previousSlot.sourceRunId || ''),
    sourceSummary: previousSlot.sourceSummary || {},
  } : null;
  const reasons = [];

  if (!current.ky || !isFiniteNumeric(candidate?.totalRows) || number(candidate?.totalRows) < 0 || !Number.isInteger(number(candidate?.totalRows)) || !isFiniteNumeric(candidate?.totalRevenue)) {
    reasons.push({ code: 'CANDIDATE_TOTALS_INVALID', totalRows: candidate?.totalRows, totalRevenue: candidate?.totalRevenue });
  }
  const sourceValues = Object.values(current.sourceSummary);
  const sourceRows = sourceValues.reduce((sum, value) => sum + number(value?.rows), 0);
  const sourceRevenue = sourceValues.reduce((sum, value) => sum + number(value?.revenue), 0);
  const malformedSource = sourceValues.some((value) => !isFiniteNumeric(value?.rows) || number(value?.rows) < 0 || !Number.isInteger(number(value?.rows)) || !isFiniteNumeric(value?.revenue));
  if (malformedSource || sourceRows !== current.totalRows || sourceRevenue !== current.totalRevenue) {
    reasons.push({ code: 'SOURCE_SUMMARY_INCONSISTENT', sourceRows, totalRows: current.totalRows, sourceRevenue, totalRevenue: current.totalRevenue });
  }
  if (current.sourceRunId && current.sourceRunIdAfterRead && current.sourceRunId !== current.sourceRunIdAfterRead) {
    reasons.push({ code: 'SOURCE_SNAPSHOT_CHANGED_DURING_READ', selected: current.sourceRunId, latestAfterRead: current.sourceRunIdAfterRead });
  }

  // A new period may legitimately begin at zero or with only one source. It is
  // allowed only after the baseline-independent integrity checks above pass.
  if (!previous || previous.ky !== current.ky) {
    return { ok: reasons.length === 0, reasons, previous, candidate: current, thresholds: { minTotalRatio } };
  }

  const previousRun = Number(previous.sourceRunId);
  const currentRun = Number(current.sourceRunId);
  if (Number.isFinite(previousRun) && previousRun > 0 && Number.isFinite(currentRun) && currentRun > 0 && currentRun < previousRun) {
    reasons.push({ code: 'STALE_MISA_RUN', previous: previous.sourceRunId, candidate: current.sourceRunId });
  }

  for (const source of REQUIRED_SOURCES) {
    const before = sourceStat(previous.sourceSummary, source);
    const after = sourceStat(current.sourceSummary, source);
    if (before.rows > 0 && after.rows <= 0) {
      reasons.push({ code: 'SOURCE_DISAPPEARED', source, previous: before, candidate: after });
    }
  }

  const revenueRatio = ratio(current.totalRevenue, previous.totalRevenue);
  if (revenueRatio != null && revenueRatio < minTotalRatio) {
    reasons.push({
      code: 'TOTAL_REVENUE_ABRUPT_DROP',
      previous: previous.totalRevenue,
      candidate: current.totalRevenue,
      ratio: revenueRatio,
      minimum: minTotalRatio,
    });
  }

  const rowRatio = ratio(current.totalRows, previous.totalRows);
  if (rowRatio != null && rowRatio < minTotalRatio) {
    reasons.push({
      code: 'TOTAL_ROWS_ABRUPT_DROP',
      previous: previous.totalRows,
      candidate: current.totalRows,
      ratio: rowRatio,
      minimum: minTotalRatio,
    });
  }

  return {
    ok: reasons.length === 0,
    reasons,
    previous,
    candidate: current,
    metrics: { revenueRatio, rowRatio },
    thresholds: { minTotalRatio },
  };
}

module.exports = {
  DEFAULT_MIN_TOTAL_RATIO,
  REQUIRED_SOURCES,
  evaluateRevenueCandidate,
  isEmptyMaterializerPlaceholder,
  canBootstrapFromInactivePlaceholders,
  noFollowOpenFlag,
  invalidSlotPeriods,
  selectCanonicalPeriodSlots,
  periodSlotsSnapshot,
};
