'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../src/employeeCostAllGuard');

test('degraded ALL payload gets short TTL while healthy payload keeps long TTL', () => {
  const healthyTtl = 6 * 60 * 60 * 1000;
  const degradedTtl = 2 * 60 * 1000;
  const healthy = { periods: [{ match: { unavailableEmployees: [], unavailableEmployeeCount: 0 } }] };
  const degraded = { periods: [{ match: { unavailableEmployees: ['dn002', 'DN001', 'DN002'] } }] };
  const catalogDegraded = { periods: [], sourceHealth: { catalogUnavailablePeriods: ['2026-08', '2026-07', '2026-08'] } };
  assert.deepEqual(guard.unavailableEmployees(healthy), []);
  assert.deepEqual(guard.unavailableEmployees(degraded), ['DN001', 'DN002']);
  assert.deepEqual(guard.unavailableCatalogPeriods(catalogDegraded), ['2026-07', '2026-08']);
  assert.equal(guard.ttlForPayload(healthy, healthyTtl, degradedTtl), healthyTtl);
  assert.equal(guard.ttlForPayload(degraded, healthyTtl, degradedTtl), degradedTtl);
  assert.equal(guard.ttlForPayload(catalogDegraded, healthyTtl, degradedTtl), degradedTtl);
});

test('guard defaults are bounded and runtime config cannot loosen reviewed caps', () => {
  assert.equal(guard.errorTtlMs(undefined), guard.DEFAULT_ERROR_TTL_MS);
  assert.equal(guard.errorTtlMs('29999'), guard.DEFAULT_ERROR_TTL_MS);
  assert.equal(guard.errorTtlMs(String(guard.DEFAULT_ERROR_TTL_MS)), guard.DEFAULT_ERROR_TTL_MS);
  assert.equal(guard.errorTtlMs(String(guard.DEFAULT_ERROR_TTL_MS + 1)), guard.DEFAULT_ERROR_TTL_MS);
  assert.equal(guard.maxRssBytes(undefined), guard.DEFAULT_MAX_RSS_MIB * guard.MIB);
  assert.equal(guard.maxRssBytes('255'), guard.DEFAULT_MAX_RSS_MIB * guard.MIB);
  assert.equal(guard.maxRssBytes('769'), guard.DEFAULT_MAX_RSS_MIB * guard.MIB);
  assert.equal(guard.buildConcurrency(undefined), 2);
  assert.equal(guard.buildConcurrency('1'), 1);
  assert.equal(guard.buildConcurrency('2'), 2);
  assert.equal(guard.buildConcurrency('3'), 2);
  assert.equal(
    guard.admissionLimitBytes(guard.DEFAULT_MAX_RSS_MIB * guard.MIB),
    (guard.DEFAULT_MAX_RSS_MIB - guard.DEFAULT_RSS_HEADROOM_MIB) * guard.MIB,
  );
  assert.equal(guard.admissionLimitBytes(guard.DEFAULT_RSS_HEADROOM_MIB * guard.MIB), 0);
});

test('RAM admission fails closed at/above limit and never exposes measurements in message', () => {
  const limitBytes = 512 * guard.MIB;
  assert.deepEqual(
    guard.assertMemoryBudget({ memoryUsage: () => ({ rss: limitBytes - 1 }), limitBytes }),
    { rss: limitBytes - 1, limitBytes },
  );
  for (const memoryUsage of [
    () => ({ rss: limitBytes }),
    () => ({ rss: limitBytes + 1 }),
    () => ({ rss: Number.NaN }),
    () => { throw new Error('telemetry failed'); },
  ]) {
    assert.throws(() => guard.assertMemoryBudget({ memoryUsage, limitBytes }), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'EMPLOYEE_COST_ALL_MEMORY_PRESSURE');
      assert.doesNotMatch(error.message, /512|536870912|rss/i);
      return true;
    });
  }
});
