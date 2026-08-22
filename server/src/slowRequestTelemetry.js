'use strict';

const { vnSecond } = require('./tickTelemetry');
const { createDiagnosticLogLimiter } = require('./diagnosticLogLimiter');

const SLOW_REQUEST_MS = 500;
const DETAIL_LIMIT_PER_MINUTE = 12;

function safeMethod(value) {
  const method = String(value || 'UNKNOWN').toUpperCase();
  return /^[A-Z]{1,16}$/.test(method) ? method : 'UNKNOWN';
}

function matchedRoutePath(req) {
  const path = req?.route?.path;
  if (typeof path !== 'string') return '<unmatched>';
  return /^[A-Za-z0-9_/:*?().-]{1,160}$/.test(path) ? path : '<redacted>';
}

function createSlowRequestTelemetry({
  thresholdMs = SLOW_REQUEST_MS,
  detailLimitPerMinute = DETAIL_LIMIT_PER_MINUTE,
  nowNs = process.hrtime.bigint,
  nowMs = Date.now,
  timestamp = vnSecond,
  warn = console.warn,
  autoFlush = true,
} = {}) {
  const limiter = createDiagnosticLogLimiter({
    stream: 'slow-request',
    limit: detailLimitPerMinute,
    nowMs,
    detail: (record) => warn('[slow-request]', record),
    summary: (record) => warn('[slow-request-suppressed]', { at: timestamp(), ...record }),
  });
  const flushTimer = autoFlush ? setInterval(limiter.flush, 1_000) : null;
  if (typeof flushTimer?.unref === 'function') flushTimer.unref();

  return {
    begin(req) {
      const startedAt = nowNs();
      let done = false;
      return {
        finish() {
          if (done) return null;
          done = true;
          const durationMs = Math.round(Number(nowNs() - startedAt) / 1e5) / 10;
          if (durationMs <= thresholdMs) return null;
          const record = {
            at: timestamp(),
            method: safeMethod(req?.method),
            route: matchedRoutePath(req),
            durationMs,
          };
          limiter.record(record);
          return record;
        },
      };
    },
    flush: limiter.flush,
    stop() { if (flushTimer) clearInterval(flushTimer); },
  };
}

module.exports = {
  createSlowRequestTelemetry,
  matchedRoutePath,
  SLOW_REQUEST_MS,
  DETAIL_LIMIT_PER_MINUTE,
};
