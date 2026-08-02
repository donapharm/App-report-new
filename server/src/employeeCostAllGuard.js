'use strict';

const MIB = 1024 * 1024;
const DEFAULT_ERROR_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_RSS_MIB = 768;
const DEFAULT_RSS_HEADROOM_MIB = 192;
const DEFAULT_BUILD_CONCURRENCY = 2;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function errorTtlMs(value = process.env.EMPLOYEE_COST_ALL_ERROR_TTL_MS) {
  // Runtime config may retry sooner, never pin degraded data longer than the
  // reviewed two-minute ceiling.
  return boundedInteger(value, DEFAULT_ERROR_TTL_MS, 30 * 1000, DEFAULT_ERROR_TTL_MS);
}

function maxRssBytes(value = process.env.EMPLOYEE_COST_ALL_MAX_RSS_MB) {
  // Runtime config may tighten this gate, never raise it above the reviewed cap.
  return boundedInteger(value, DEFAULT_MAX_RSS_MIB, 256, DEFAULT_MAX_RSS_MIB) * MIB;
}

function buildConcurrency(value = process.env.EMPLOYEE_COST_ALL_BUILD_CONCURRENCY) {
  // Runtime config may serialize to one, but can never restore the old fan-out=3.
  // This is a pressure reducer, not a throughput override.
  return boundedInteger(value, DEFAULT_BUILD_CONCURRENCY, 1, DEFAULT_BUILD_CONCURRENCY);
}

function admissionLimitBytes(limitBytes = maxRssBytes()) {
  const limit = Number(limitBytes);
  if (!Number.isFinite(limit) || limit <= DEFAULT_RSS_HEADROOM_MIB * MIB) return 0;
  // Reserve enough room for response parsing, merge and table transforms. The
  // hard ceiling is still checked during fan-out; this lower threshold decides
  // whether a new heavy build may start at all.
  return limit - DEFAULT_RSS_HEADROOM_MIB * MIB;
}

function unavailableEmployees(payload = {}) {
  const periods = Array.isArray(payload?.periods) ? payload.periods : [];
  return [...new Set(periods.flatMap((period) => {
    const employees = Array.isArray(period?.match?.unavailableEmployees)
      ? period.match.unavailableEmployees
      : [];
    return employees.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
  }))].sort();
}

function unavailableCatalogPeriods(payload = {}) {
  const periods = Array.isArray(payload?.sourceHealth?.catalogUnavailablePeriods)
    ? payload.sourceHealth.catalogUnavailablePeriods
    : [];
  return [...new Set(periods.map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function isDegradedPayload(payload = {}) {
  return unavailableEmployees(payload).length > 0 || unavailableCatalogPeriods(payload).length > 0;
}

function ttlForPayload(payload, healthyTtlMs, degradedTtlMs = errorTtlMs()) {
  return isDegradedPayload(payload) ? degradedTtlMs : healthyTtlMs;
}

function memoryPressureError() {
  return Object.assign(new Error('Máy chủ đang bảo vệ bộ nhớ cho bảng Tất cả NV. Vui lòng thử lại sau.'), {
    status: 503,
    code: 'EMPLOYEE_COST_ALL_MEMORY_PRESSURE',
  });
}

function assertMemoryBudget({ memoryUsage = process.memoryUsage, limitBytes = maxRssBytes() } = {}) {
  let snapshot;
  try {
    snapshot = typeof memoryUsage === 'function' ? memoryUsage() : memoryUsage;
  } catch {
    throw memoryPressureError();
  }
  const rss = Number(snapshot?.rss);
  const limit = Number(limitBytes);
  if (!Number.isFinite(rss) || rss < 0 || !Number.isFinite(limit) || limit <= 0 || rss >= limit) {
    throw memoryPressureError();
  }
  return { rss, limitBytes: limit };
}

module.exports = {
  MIB,
  DEFAULT_ERROR_TTL_MS,
  DEFAULT_MAX_RSS_MIB,
  DEFAULT_RSS_HEADROOM_MIB,
  DEFAULT_BUILD_CONCURRENCY,
  boundedInteger,
  errorTtlMs,
  maxRssBytes,
  buildConcurrency,
  admissionLimitBytes,
  unavailableEmployees,
  unavailableCatalogPeriods,
  isDegradedPayload,
  ttlForPayload,
  memoryPressureError,
  assertMemoryBudget,
};
