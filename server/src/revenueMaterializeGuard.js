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

module.exports = { DEFAULT_MIN_TOTAL_RATIO, REQUIRED_SOURCES, evaluateRevenueCandidate };
