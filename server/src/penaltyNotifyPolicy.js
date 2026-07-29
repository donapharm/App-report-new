'use strict';

// Reserved for a later CEO-approved notification batch. Existing Telegram/email
// builders intentionally do not import this module and remain byte-for-byte unchanged.
function enabled(env = process.env) {
  return env.PENALTY_NOTIFY === '1' || env.PENALTY_NOTIFY === 'true';
}

module.exports = { enabled };
