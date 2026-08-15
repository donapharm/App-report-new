'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.EMPLOYEE_COST_ALL_WARM_DISABLED = '1';
process.env.EMPLOYEE_COST_CRON_DISABLED = '1';

const employeeCost = require('../src/employeeCost');
const routes = require('../src/routes');
const runtime = routes.employeeCostSnapshotWatcherRuntime;

function freshResult(empCode = 'DN001') {
  return {
    outcome: 'ok', attempts: 1,
    sourceRange: { from: '2026-08', to: '2026-08' },
    sourceGeneration: 'V31.4',
    payload: {
      empCode, from: '2026-08', to: '2026-08',
      periods: [{ period: '2026-08', columns: [{ key: 'c44', label: 'C44' }], rows: [{ key: 'ROW-1', c44: 1 }] }],
    },
  };
}

test('watcher probe uses raw network result and preserves declared generation', async (t) => {
  const originalRaw = employeeCost.fetchRawEmployeeCost;
  const originalDisplay = employeeCost.fetchEmployeeCost;
  t.after(() => { employeeCost.fetchRawEmployeeCost = originalRaw; employeeCost.fetchEmployeeCost = originalDisplay; });
  let rawCalls = 0;
  employeeCost.fetchRawEmployeeCost = async () => { rawCalls += 1; return freshResult(); };
  employeeCost.fetchEmployeeCost = async () => { throw new Error('display/local-first adapter must not be called'); };

  const result = await runtime.probeEmployee('DN001', { period: '2026-08', roster: [{ emp_code: 'DN001' }] });
  assert.equal(rawCalls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sourceRange, { from: '2026-08', to: '2026-08' });
  assert.equal(result.sourceGeneration, 'V31.4');
});

test('network rejection stays failed even when display adapter could return local data', async (t) => {
  const originalRaw = employeeCost.fetchRawEmployeeCost;
  const originalDisplay = employeeCost.fetchEmployeeCost;
  t.after(() => { employeeCost.fetchRawEmployeeCost = originalRaw; employeeCost.fetchEmployeeCost = originalDisplay; });
  employeeCost.fetchRawEmployeeCost = async () => ({
    outcome: 'upstream_rejected', attempts: 1, payload: { empCode: 'DN001', from: '2026-08', to: '2026-08', periods: [] },
  });
  employeeCost.fetchEmployeeCost = async () => ({ ...freshResult(), pinned: true, payload: { ...freshResult().payload, rateSource: 'local_sync' } });

  const result = await runtime.probeEmployee('DN001', { period: '2026-08', roster: [{ emp_code: 'DN001' }] });
  assert.equal(result.ok, false);
  assert.equal(result.sourceOutcome, 'upstream_rejected');
  assert.equal(result.sourceGeneration, '');
});

