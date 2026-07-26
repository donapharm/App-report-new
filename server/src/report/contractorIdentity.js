'use strict';

function normalizedAscii(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Normalize historical contractor aliases only at the report/deck output boundary.
 * Source uploads remain byte-for-byte historical records.
 */
function reportContractorLabel(value) {
  const raw = String(value ?? '').trim();
  const normalized = normalizedAscii(raw);
  if (/\bdonapharm\b/.test(normalized)) return 'DONAPHARM';
  if (/\bafp\s+pharma\b/.test(normalized)) return 'AFP PHARMA';
  return raw;
}

module.exports = {
  reportContractorLabel,
};
