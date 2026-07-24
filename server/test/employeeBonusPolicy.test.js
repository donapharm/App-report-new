'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const employeeBonus = require('../src/employeeBonus');
const { createPolicyStore } = require('../src/employeeBonusPolicy');

const seed = {
  schemaVersion: 2, version: 'seed', effectiveFrom: '2026-07-01', base: 'revenue_before_vat', currency: 'VND',
  baseTiers: [
    { fromPct: 0, toPct: 90, bonusPct: 0 }, { fromPct: 90, toPct: 100, bonusPct: 0.1 },
    { fromPct: 100, toPct: 110, bonusPct: 0.15 }, { fromPct: 110, toPct: 130, bonusPct: 0.18 },
    { fromPct: 130, toPct: null, bonusPct: 0.25 },
  ],
  priorityThresholdPct: 101,
  priorityRates: { 'H.A*': 1, 'H.A': 0.8, 'H.B': 0.5, 'H.C': 0.1, 'H.D': 0.1 },
  totalCapPct: null,
};

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonus-policy-'));
  const store = createPolicyStore({ policyFile: path.join(dir, 'policies.json'), auditFile: path.join(dir, 'audit.json'), seedConfig: seed });
  return { dir, store };
}

test('versioned policy saves atomically, audits actor and keeps old periods on old config', () => {
  const { dir, store } = fixture();
  const first = store.save({ effectiveFrom: '07.2026', scope: { type: 'default' }, patch: { priorityThresholdPct: 102 }, note: 'July' }, 'CEO');
  const second = store.save({ effectiveFrom: '08.2026', scope: { type: 'default' }, patch: { priorityThresholdPct: 103 }, note: 'August' }, 'ADMIN');
  assert.equal(first.policy.version, 1);
  assert.equal(second.policy.version, 2);
  assert.equal(store.resolve({ period: '07.2026' }).config.priorityThresholdPct, 102);
  assert.equal(store.resolve({ period: '08.2026' }).config.priorityThresholdPct, 103);
  assert.deepEqual(store.audit().map((event) => [event.version, event.actor]), [[2, 'ADMIN'], [1, 'CEO']]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('override precedence is default → product group → route → unit → employee', () => {
  const { dir, store } = fixture();
  const save = (scope, rate) => store.save({ effectiveFrom: '07.2026', scope, patch: { priorityRates: { 'H.A*': rate } } }, 'CEO');
  save({ type: 'default' }, 1.1);
  save({ type: 'productGroup', value: 'H.A*' }, 1.2);
  save({ type: 'route', value: 'CL' }, 1.3);
  save({ type: 'unit', value: '001' }, 1.4);
  save({ type: 'employee', value: 'DN009' }, 1.5);
  const context = { productGroup: 'H.A*', route: 'cl', unit: '001', employee: 'dn009' };
  const result = store.resolve({ period: '2026-07', context });
  assert.equal(result.config.priorityRates['H.A*'], 1.5);
  assert.deepEqual(result.sources.map((source) => source.scope.type), ['default', 'productGroup', 'route', 'unit', 'employee']);
  assert.equal(store.resolve({ period: '2026-07', context: { productGroup: 'H.A*', route: 'CL', unit: '001', employee: 'DN008' } }).config.priorityRates['H.A*'], 1.4);
  assert.equal(store.resolve({ period: '2026-07', context: { productGroup: 'H.A*', route: 'NT', unit: '999', employee: 'DN008' } }).config.priorityRates['H.A*'], 1.2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('engine applies layered policy per revenue segment for both base and C10 parts', () => {
  const { dir, store } = fixture();
  store.save({ effectiveFrom: '07.2026', scope: { type: 'route', value: 'CL' }, patch: {
    baseTiers: [
      { fromPct: 0, toPct: 90, bonusPct: 0 }, { fromPct: 90, toPct: 100, bonusPct: 0.1 },
      { fromPct: 100, toPct: 110, bonusPct: 0.2 }, { fromPct: 110, toPct: 130, bonusPct: 0.2 },
      { fromPct: 130, toPct: null, bonusPct: 0.2 },
    ],
    priorityRates: { 'H.A*': 2 },
  } }, 'CEO');
  store.save({ effectiveFrom: '07.2026', scope: { type: 'unit', value: '001' }, patch: { priorityRates: { 'H.A*': 3 } } }, 'CEO');
  const coverage = {
    source: 'datahub_catalog_c10', sourceAvailable: true,
    groupRevenue: { 'H.A*': 100_000_000, 'H.A': 0, 'H.B': 0, 'H.C': 0, 'H.D': 0 },
    totalRevenue: 100_000_000, classifiedRevenue: 100_000_000, unclassifiedRevenue: 0,
    revenueSegments: [
      { productGroup: 'H.A*', group: 'H.A*', route: 'CL', unit: '001', revenue: 40_000_000 },
      { productGroup: 'H.A*', group: 'H.A*', route: 'CL', unit: '002', revenue: 10_000_000 },
      { productGroup: 'H.A*', group: 'H.A*', route: 'NT', unit: '003', revenue: 50_000_000 },
    ],
    configResolver: (segment) => store.resolve({ period: '07.2026', context: { employee: 'DN009', ...segment } }),
  };
  const result = employeeBonus.periodBonus({ target: 100_000_000, achieved: 105_000_000, pct: 105 }, store.resolve({ period: '07.2026', context: { employee: 'DN009' } }).config, coverage);
  // Base: 50m CL × 0.20% + 50m NT × 0.15% = 175k.
  assert.equal(result.baseAmount, 175_000);
  // Priority: 40m unit 001 × 3% + 10m CL × 2% + 50m default × 1% = 1.9m.
  assert.equal(result.priorityAmount, 1_900_000);
  assert.equal(result.amount, 2_075_000);
  assert.equal(result.overrideApplied, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('preview does not write and invalid/missing scope or config fails closed before save', () => {
  const { dir, store } = fixture();
  const preview = store.preview({ effectiveFrom: '07.2026', scope: { type: 'employee', value: 'DN009' }, patch: { totalCapPct: 0.7 }, previewPeriod: '07.2026' }, 'CEO');
  assert.equal(preview.resolved.config.totalCapPct, 0.7);
  assert.equal(store.list().length, 0);
  assert.equal(store.audit().length, 0);
  assert.throws(() => store.save({ effectiveFrom: '07.2026', scope: { type: 'productGroup', value: 'H.E' }, patch: { priorityThresholdPct: 101 } }, 'CEO'), (error) => error.code === 'BONUS_POLICY_GROUP_INVALID');
  assert.throws(() => store.save({ effectiveFrom: '07.2026', scope: { type: 'employee', value: 'DN9' }, patch: { priorityThresholdPct: 101 } }, 'CEO'), (error) => error.code === 'BONUS_POLICY_EMPLOYEE_INVALID');
  assert.throws(() => store.save({ effectiveFrom: '08.2026', effectiveTo: '07.2026', scope: { type: 'default' }, patch: { priorityThresholdPct: 101 } }, 'CEO'), (error) => error.code === 'BONUS_POLICY_RANGE_INVALID');
  assert.throws(() => store.save({ effectiveFrom: '07.2026', scope: { type: 'default' }, patch: {} }, 'CEO'), (error) => error.code === 'BONUS_POLICY_PATCH_EMPTY');
  fs.rmSync(dir, { recursive: true, force: true });
});
