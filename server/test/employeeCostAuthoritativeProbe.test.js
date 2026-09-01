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

test('watcher probe uses App Report local result and never calls raw network', async (t) => {
  const originalRaw = employeeCost.fetchRawEmployeeCost;
  const originalDisplay = employeeCost.fetchEmployeeCost;
  t.after(() => { employeeCost.fetchRawEmployeeCost = originalRaw; employeeCost.fetchEmployeeCost = originalDisplay; });
  let rawCalls = 0; let localCalls = 0;
  employeeCost.fetchRawEmployeeCost = async () => { rawCalls += 1; throw new Error('raw network must not be called'); };
  employeeCost.fetchEmployeeCost = async () => { localCalls += 1; return freshResult(); };

  const result = await runtime.probeEmployee('DN001', { period: '2026-08', roster: [{ emp_code: 'DN001' }] });
  assert.equal(rawCalls, 0);
  assert.equal(localCalls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sourceRange, { from: '2026-08', to: '2026-08' });
  assert.equal(result.sourceGeneration, 'V31.4');
});

test('local projection rejection stays failed even when raw network could return data', async (t) => {
  const originalRaw = employeeCost.fetchRawEmployeeCost;
  const originalDisplay = employeeCost.fetchEmployeeCost;
  t.after(() => { employeeCost.fetchRawEmployeeCost = originalRaw; employeeCost.fetchEmployeeCost = originalDisplay; });
  let rawCalls = 0;
  employeeCost.fetchRawEmployeeCost = async () => { rawCalls += 1; return freshResult(); };
  employeeCost.fetchEmployeeCost = async () => ({
    outcome: 'local_only_missing', attempts: 0, payload: { empCode: 'DN001', from: '2026-08', to: '2026-08', periods: [] },
  });

  const result = await runtime.probeEmployee('DN001', { period: '2026-08', roster: [{ emp_code: 'DN001' }] });
  assert.equal(result.ok, false);
  assert.equal(result.sourceOutcome, 'local_only_missing');
  assert.equal(result.sourceGeneration, '');
  assert.equal(rawCalls, 0);
});
