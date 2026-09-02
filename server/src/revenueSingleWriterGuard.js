'use strict';

const policy = require('./groupDonaRevenuePolicy');

function fail(code, details = {}) {
  const error = new Error(code); error.code = code; error.status = 409; error.details = details; throw error;
}

function assertGenericCommitAllowed({ ky } = {}) {
  if (policy.isCutoverPeriod(ky)) fail('REVENUE_SINGLE_WRITER_GENERIC_UPLOAD_BLOCKED', { ky });
  return true;
}

function assertActivationAllowed({ slot } = {}) {
  if (!slot || !policy.isCutoverPeriod(slot.ky)) return true;
  if (slot.source !== 'DEBTS_ONLY_GROUP_DONA' || slot.selectorPolicy !== 'GROUP_DONA_DEBTS_FROM_2026_09') {
    fail('REVENUE_SINGLE_WRITER_ACTIVATION_BLOCKED', { ky: slot.ky, source: slot.source || 'unknown' });
  }
  return true;
}

module.exports = { assertGenericCommitAllowed, assertActivationAllowed };
