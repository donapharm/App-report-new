'use strict';

function reconciliationTupleValid(value) {
  const text = String(value || '');
  if (!text || text.endsWith(':THIEU')) return false;
  return /(?:^|:)rc=[a-f0-9]{64}(?=:|$)/.test(text);
}

function employeeReportsHaveCompleteReconciliationProvenance(employees, options = {}) {
  const allowExplicitLocalOnly = options.allowExplicitLocalOnly === true;
  if (!(employees instanceof Map) || employees.size === 0) return false;
  for (const record of employees.values()) {
    const report = record?.report;
    const provenance = report?.remoteProvenance;
    if (!Array.isArray(provenance)) return false;
    if (provenance.length === 0) {
      // An explicit empty array has one safe meaning: this local-pinned report did
      // not consume a reconciliation package. Do not invent an `rc` from the rate
      // snapshot checksum; those are different artifacts. Missing provenance,
      // remote failures, stale/local-sync rates, or any other outcome remain closed.
      if (!allowExplicitLocalOnly
        || report?.rateSource !== 'local_pinned'
        || report?.sourceOutcome !== 'ok'
        || !Array.isArray(report?.remoteProvenanceFailures)
        || report.remoteProvenanceFailures.length !== 0) return false;
      continue;
    }
    if (provenance.some((item) => !reconciliationTupleValid(item))) return false;
  }
  return true;
}

module.exports = { reconciliationTupleValid, employeeReportsHaveCompleteReconciliationProvenance };
