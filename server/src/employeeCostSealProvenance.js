'use strict';

const REQUIRED_C32_FIELDS = Object.freeze([
  'c32SidecarRowsChecksum',
  'c32SidecarRowCount',
  'c32SidecarArtifactId',
  'c32SidecarProvenanceKind',
  'c32SidecarAuditChainChecksum',
]);

const APP_REPORT_RAW_CAPTURE_INDEX = 'a513c1cbf7fcb97c751cc8934b87f6b100b23b347c6bc888c1f64abdaf6690f6';
const CERTAINTY_STATEMENT = 'Ràng buộc xuất xứ theo KHAI BÁO của DataHub. App Report KHÔNG tự băm lại được sidecar C32 vì response không có sourceRowId. Kiểm độc lập tại chỗ chỉ gồm số dòng.';

function responseRowCount(raw) {
  if (Array.isArray(raw?.periods)) {
    return raw.periods.reduce((sum, period) => sum + (Array.isArray(period?.rows) ? period.rows.length : 0), 0);
  }
  if (raw?.months && typeof raw.months === 'object' && !Array.isArray(raw.months)) {
    return Object.values(raw.months).reduce((sum, period) => {
      if (Array.isArray(period)) return sum + period.length;
      return sum + (Array.isArray(period?.rows) ? period.rows.length : 0);
    }, 0);
  }
  return Array.isArray(raw?.rows) ? raw.rows.length : 0;
}

// Preserve DataHub's declarations byte-for-byte at the JSON value level. Missing
// keys stay missing; validation at the seal boundary decides whether sealing is safe.
function capture(raw) {
  const output = { appReportResponseRowCount: responseRowCount(raw) };
  for (const field of REQUIRED_C32_FIELDS) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, field)) output[field] = raw[field];
  }
  return output;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validCaptured(value) {
  if (!value || typeof value !== 'object') return false;
  if (!Number.isSafeInteger(value.c32SidecarRowCount) || value.c32SidecarRowCount <= 0) return false;
  if (!Number.isSafeInteger(value.appReportResponseRowCount) || value.appReportResponseRowCount <= 0) return false;
  if (value.c32SidecarRowCount !== value.appReportResponseRowCount) return false;
  return REQUIRED_C32_FIELDS.filter((field) => field !== 'c32SidecarRowCount')
    .every((field) => nonEmpty(value[field]));
}

function sameDeclaration(left, right) {
  return REQUIRED_C32_FIELDS.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]))
    && left.appReportResponseRowCount === right.appReportResponseRowCount;
}

function gmt7Timestamp(date = new Date()) {
  const instant = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(instant.getTime())) return '';
  return new Date(instant.getTime() + 7 * 60 * 60 * 1000).toISOString().replace('Z', '+07:00');
}

function buildEnvelope(reports, { observedAt = new Date() } = {}) {
  if (!Array.isArray(reports) || !reports.length) return null;
  const captured = reports.map((report) => report?.c32SidecarProvenance);
  if (!captured.every(validCaptured)) return null;
  if (!captured.every((item) => sameDeclaration(item, captured[0]))) return null;
  const observedAtGmt7 = gmt7Timestamp(observedAt);
  if (!observedAtGmt7) return null;
  return {
    ...Object.fromEntries(REQUIRED_C32_FIELDS.map((field) => [field, captured[0][field]])),
    appReportResponseRowCount: captured[0].appReportResponseRowCount,
    appReportRawCaptureIndex: APP_REPORT_RAW_CAPTURE_INDEX,
    observedAtGmt7,
    certaintyStatement: CERTAINTY_STATEMENT,
  };
}

function validEnvelope(value) {
  if (!validCaptured(value)) return false;
  if (value.appReportRawCaptureIndex !== APP_REPORT_RAW_CAPTURE_INDEX) return false;
  if (value.certaintyStatement !== CERTAINTY_STATEMENT) return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+07:00$/.test(String(value.observedAtGmt7 || ''));
}

module.exports = {
  REQUIRED_C32_FIELDS,
  APP_REPORT_RAW_CAPTURE_INDEX,
  CERTAINTY_STATEMENT,
  responseRowCount,
  capture,
  validCaptured,
  buildEnvelope,
  validEnvelope,
  gmt7Timestamp,
};
