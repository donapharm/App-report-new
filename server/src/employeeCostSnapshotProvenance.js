'use strict';

function reconciliationTupleValid(value) {
  const text = String(value || '');
  if (!text || text.endsWith(':THIEU')) return false;
  return /(?:^|:)rc=[a-f0-9]{64}(?=:|$)/.test(text);
}

function employeeReportsHaveCompleteReconciliationProvenance(employees) {
  if (!(employees instanceof Map) || employees.size === 0) return false;
  for (const record of employees.values()) {
    const provenance = record?.report?.remoteProvenance;
    if (!Array.isArray(provenance) || provenance.length === 0
      || provenance.some((item) => !reconciliationTupleValid(item))) return false;
  }
  return true;
}

module.exports = { reconciliationTupleValid, employeeReportsHaveCompleteReconciliationProvenance };
