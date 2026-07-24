'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-warm-cache-auth-'));
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-warm-cache-no-lkg.json');

const store = require('../src/store');
const employeeCost = require('../src/employeeCost');
const catalogManagement = require('../src/catalogManagement');
const revenueRefresh = require('../src/revenueRefresh');
let materializedListener = null;
const originalOnMaterialized = revenueRefresh.onMaterialized;
revenueRefresh.onMaterialized = (listener) => {
  materializedListener = listener;
  return () => { materializedListener = null; };
};
const router = require('../src/routes');

function invokeEmployeeCost(query, session) {
  const layer = router.stack.find((candidate) => candidate.route?.path === '/employee-cost' && candidate.route?.methods?.get);
  assert.ok(layer, 'missing GET /employee-cost');
  const handlers = layer.route.stack.slice(1).map((item) => item.handle);
  return new Promise((resolve, reject) => {
    let index = 0;
    const req = { query: { ...query }, session: { ...session }, headers: {}, body: {}, params: {}, ip: '127.0.0.1' };
    const res = {
      statusCode: 200, headersSent: false,
      set() { return this; }, setHeader() { return this; }, status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
      send(body) { resolve({ status: this.statusCode, body }); }, end() { resolve({ status: this.statusCode }); },
    };
    const next = (error) => {
      if (error) return reject(error);
      const handler = handlers[index++];
      if (!handler) return reject(new Error('route ended without response'));
      try { Promise.resolve(handler(req, res, next)).catch(next); } catch (cause) { next(cause); }
    };
    next();
  });
}

test('successful materialize listener precomputes the shared ALL cache before another admin opens it', async () => {
  assert.equal(typeof materializedListener, 'function', 'routes must register a revenue materialize listener');
  const originalActiveSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;
  let signature = 'warm-slot-a-before-catalog';
  let refreshSignatureOnSnapshot = true;
  let builds = 0;
  let suppressedAudits = 0;
  store.activeDataSignature = () => signature;
  store.employeeCostDataSignature = () => signature;
  store.targetRoster = () => [
    { emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true },
    { emp_code: 'DN003', name: 'NV 3', role: 'sale', has_target: true },
  ];
  catalogManagement.getSnapshot = async () => {
    // Real getSnapshot may persist a refreshed LKG and change the source
    // signature. Warm must derive its key after this stabilization step.
    if (refreshSignatureOnSnapshot) {
      signature = 'warm-slot-a-after-catalog';
      refreshSignatureOnSnapshot = false;
    }
    return { rows: [], catalog: [] };
  };
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    builds += 1;
    if (typeof options.auditImpl === 'function') suppressedAudits += 1;
    return employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to }));
  };
  try {
    assert.equal(await materializedListener({ ky: '07.2026' }), true);
    assert.equal(builds, 2, 'warm must precompute every roster employee exactly once');
    assert.equal(suppressedAudits, 2, 'background warm must not create fake CEO view audit rows');

    const response = await invokeEmployeeCost(
      { emp: 'ALL', from: '2026-07', to: '2026-07', page: '1', pageSize: '20', sortDir: 'asc' },
      { emp_code: 'ADMIN02', role: 'admin', name: 'Admin 2' },
    );
    assert.equal(response.status, 200);
    assert.equal(builds, 2, 'first real admin open must hit the prewarmed shared cache');

    signature = 'warm-slot-b';
    assert.equal(await materializedListener({ ky: '07.2026' }), true);
    assert.equal(builds, 4, 'a new slot signature must invalidate and rebuild the warm cache');
  } finally {
    store.activeDataSignature = originalActiveSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
    revenueRefresh.onMaterialized = originalOnMaterialized;
  }
});
