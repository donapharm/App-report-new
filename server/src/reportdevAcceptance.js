'use strict';

const crypto = require('crypto');

const PRINCIPAL = 'reportdev_acceptance_bot_v1';
const ALLOWED_PERIODS = new Set(['2026-07', '2026-08']);
const OUTPUT_FIELDS = Object.freeze(['principal', 'period', 'catalogRows', 'employeeCount', 'balanced', 'checksum']);

function reject(code) {
  throw Object.assign(new Error(code), { code });
}

function normalizeRequest(input = {}) {
  const period = String(input.period || '');
  if (!ALLOWED_PERIODS.has(period)) reject('ACCEPTANCE_PERIOD_FORBIDDEN');
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'period')) reject('ACCEPTANCE_REQUEST_FIELD_FORBIDDEN');
  return { period };
}

function projectCounters(period, counters = {}) {
  const raw = {
    principal: PRINCIPAL,
    period,
    catalogRows: Number(counters.catalogRows),
    employeeCount: Number(counters.employeeCount),
    balanced: counters.balanced,
  };
  if (!Number.isSafeInteger(raw.catalogRows) || raw.catalogRows < 0
    || !Number.isSafeInteger(raw.employeeCount) || raw.employeeCount < 0
    || typeof raw.balanced !== 'boolean') reject('ACCEPTANCE_COUNTERS_INVALID');
  const checksum = crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  return Object.freeze({ ...raw, checksum });
}

async function runAcceptance(input, { loadCounters, audit = () => {} } = {}) {
  const { period } = normalizeRequest(input);
  if (typeof loadCounters !== 'function') reject('ACCEPTANCE_PROVIDER_REQUIRED');
  const result = projectCounters(period, await loadCounters(period));
  if (Object.keys(result).some((key) => !OUTPUT_FIELDS.includes(key))) reject('ACCEPTANCE_OUTPUT_FIELD_FORBIDDEN');
  audit(Object.freeze({ principal: PRINCIPAL, kind: 'machine_acceptance', period,
    schema: 'reportdev-acceptance-counters-v1', checksum: result.checksum }));
  return result;
}

module.exports = { PRINCIPAL, ALLOWED_PERIODS, OUTPUT_FIELDS, normalizeRequest, projectCounters, runAcceptance };
