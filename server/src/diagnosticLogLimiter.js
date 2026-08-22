'use strict';

const MINUTE_MS = 60_000;

function createDiagnosticLogLimiter({
  stream,
  limit = 12,
  nowMs = Date.now,
  detail,
  summary,
}) {
  let minute = Math.floor(nowMs() / MINUTE_MS);
  let emitted = 0;
  let suppressed = 0;

  function emitSummary() {
    if (suppressed > 0) {
      summary({ stream, minute, suppressedCount: suppressed, detailLimitPerMinute: limit });
    }
  }

  function rollover() {
    const currentMinute = Math.floor(nowMs() / MINUTE_MS);
    if (currentMinute === minute) return;
    emitSummary();
    minute = currentMinute;
    emitted = 0;
    suppressed = 0;
  }

  return {
    record(payload) {
      rollover();
      if (emitted < limit) {
        emitted += 1;
        detail(payload);
        return true;
      }
      suppressed += 1;
      return false;
    },
    flush: rollover,
  };
}

module.exports = { createDiagnosticLogLimiter, MINUTE_MS };
