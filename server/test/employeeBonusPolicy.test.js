'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const employeeBonus = require('../src/employeeBonus');
const { createPolicyStore } = require('../src/employeeBonusPolicy');

const seed = {
  schemaVersion: 3, version: 'seed-v3', effectiveFrom: '2026-07-01', base: 'revenue_before_vat', currency: 'VND',
  baseTiers: [
    { fromPct: 0, toPct: 90, bonusPct: 0 }, { fromPct: 90, toPct: 100, bonusPct: 0.1 },
    { fromPct: 100, toPct: 110, bonusPct: 0.15 }, { fromPct: 110, toPct: 130, bonusPct: 0.18 },
    { fromPct: 130, toPct: null, bonusPct: 0.25 },
  ],
  priorityThresholdPct: 101,
  priorityRates: { 'H.A*': 1, 'H.A': 0.8, 'H.B': 0.5, 'H.C': 0.1, 'H.D': 0.1 },
  priorityTargets: { 'H.A*': null, 'H.A': null, 'H.B': null, 'H.C': null, 'H.D': null },
  totalCapPct: null,
};

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonus-policy-v3-'));
  const store = createPolicyStore({ policyFile: path.join(dir, 'policies.json'), auditFile: path.join(dir, 'audit.json'), seedConfig: seed });
  return { dir, store };
}

test('versioned policy saves atomically, audits patch and keeps month history', () => {
  const { dir, store } = fixture();
  const first = store.save({ effectiveFrom: '07.2026', scope: { type: 'default' }, patch: { priorityTargets: { 'H.A*': 10_000_000 } }, note: 'July' }, 'CEO');
  const second = store.save({ effectiveFrom: '08.2026', scope: { type: 'default' }, patch: { priorityTargets: { 'H.A*': 12_000_000 } }, note: 'August' }, 'ADMIN');
  assert.equal(first.policy.version, 1);
  assert.equal(second.policy.version, 2);
  assert.equal(store.resolve({ period: '07.2026' }).config.priorityTargets['H.A*'], 10_000_000);
  assert.equal(store.resolve({ period: '08.2026' }).config.priorityTargets['H.A*'], 12_000_000);
  assert.deepEqual(store.audit().map((event) => [event.version, event.actor]), [[2, 'ADMIN'], [1, 'CEO']]);
  assert.deepEqual(store.audit()[0].patch.priorityTargets, { 'H.A*': 12_000_000 });
  assert.equal(store.audit()[0].beforeConfig.priorityTargets['H.A*'], 10_000_000);
  assert.equal(store.audit()[0].afterConfig.priorityTargets['H.A*'], 12_000_000);
  assert.match(store.audit()[0].candidateHash, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(store.audit()[0].beforeSources));
  assert.ok(Array.isArray(store.audit()[0].afterSources));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rate precedence stays default → product group → route → unit → employee', () => {
  const { dir, store } = fixture();
  const save = (scope, rate) => store.save({ effectiveFrom: '07.2026', scope, patch: { priorityRates: { 'H.A*': rate } } }, 'CEO');
  save({ type: 'default' }, 1.1);
  save({ type: 'productGroup', value: 'H.A*' }, 1.2);
  save({ type: 'route', value: 'CL' }, 1.3);
  save({ type: 'unit', value: '001' }, 1.4);
  save({ type: 'employee', value: 'DN009' }, 1.5);
  const result = store.resolve({ period: '2026-07', context: { productGroup: 'H.A*', route: 'cl', unit: '001', employee: 'dn009' } });
  assert.equal(result.config.priorityRates['H.A*'], 1.5);
  assert.deepEqual(result.sources.map((source) => source.scope.type), ['default', 'productGroup', 'route', 'unit', 'employee']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('group target precedence is default → route → unit → employee and null explicitly blocks inheritance', () => {
  const { dir, store } = fixture();
  const save = (scope, value) => store.save({ effectiveFrom: '07.2026', scope, patch: { priorityTargets: { 'H.A*': value } } }, 'CEO');
  save({ type: 'default' }, 100);
  save({ type: 'route', value: 'CL' }, 90);
  save({ type: 'unit', value: '001' }, 80);
  save({ type: 'employee', value: 'DN006' }, 70);
  let result = store.resolve({ period: '07.2026', context: { route: 'CL', unit: '001', employee: 'DN006' } });
  assert.equal(result.config.priorityTargets['H.A*'], 70);
  assert.equal(result.priorityTargetSources['H.A*'].scope.type, 'employee');
  result = store.resolve({ period: '07.2026', context: { route: 'CL', unit: '001', employee: 'DN007' } });
  assert.equal(result.config.priorityTargets['H.A*'], 80);
  assert.equal(result.priorityTargetSources['H.A*'].scope.type, 'unit');
  save({ type: 'employee', value: 'DN007' }, null);
  result = store.resolve({ period: '07.2026', context: { route: 'CL', unit: '001', employee: 'DN007' } });
  assert.equal(result.config.priorityTargets['H.A*'], null);
  assert.equal(result.priorityTargetSources['H.A*'].scope.type, 'employee');
  assert.throws(() => store.save({ effectiveFrom: '07.2026', scope: { type: 'productGroup', value: 'H.A*' }, patch: { priorityTargets: { 'H.A*': 1 } } }, 'CEO'), (error) => error.code === 'BONUS_POLICY_TARGET_SCOPE_INVALID');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('route/unit group target fails closed when employee organizational scope is unavailable', () => {
  const { dir, store } = fixture();
  store.save({ effectiveFrom: '07.2026', scope: { type: 'default' }, patch: { priorityTargets: { 'H.A*': 100 } } }, 'CEO');
  store.save({ effectiveFrom: '07.2026', scope: { type: 'route', value: 'CL' }, patch: { priorityTargets: { 'H.A*': 90 } } }, 'CEO');
  let result = store.resolve({ period: '07.2026', context: { employee: 'DN006', targetScopeStrict: true } });
  assert.equal(result.priorityTargetStatuses['H.A*'], 'ambiguous_scope');
  // Explicit employee null is intentional "chưa giao" and wins over ambiguous lower layers.
  store.save({ effectiveFrom: '07.2026', scope: { type: 'employee', value: 'DN006' }, patch: { priorityTargets: { 'H.A*': null } } }, 'CEO');
  result = store.resolve({ period: '07.2026', context: { employee: 'DN006', targetScopeStrict: true } });
  assert.equal(result.config.priorityTargets['H.A*'], null);
  assert.equal(result.priorityTargetStatuses['H.A*'], null);
  assert.equal(result.priorityTargetSources['H.A*'].scope.type, 'employee');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('engine uses layered rates for P1 but P2 fails closed when a group rate is ambiguous', () => {
  const { dir, store } = fixture();
  store.save({ effectiveFrom: '07.2026', scope: { type: 'default' }, patch: { priorityTargets: { 'H.A*': 50_000_000 } } }, 'CEO');
  store.save({ effectiveFrom: '07.2026', scope: { type: 'route', value: 'CL' }, patch: {
    baseTiers: [
      { fromPct: 0, toPct: 90, bonusPct: 0 }, { fromPct: 90, toPct: 100, bonusPct: 0.1 },
      { fromPct: 100, toPct: 110, bonusPct: 0.2 }, { fromPct: 110, toPct: 130, bonusPct: 0.2 },
      { fromPct: 130, toPct: null, bonusPct: 0.2 },
    ],
    priorityRates: { 'H.A*': 2 },
  } }, 'CEO');
  const coverage = {
    source: 'datahub_catalog_c10', sourceAvailable: true, periods: ['2026-07'],
    groupRevenue: { 'H.A*': 100_000_000, 'H.A': 0, 'H.B': 0, 'H.C': 0, 'H.D': 0 },
    totalRevenue: 100_000_000, classifiedRevenue: 100_000_000, unclassifiedRevenue: 0,
    revenueSegments: [
      { period: '2026-07', productGroup: 'H.A*', route: 'CL', unit: '001', revenue: 50_000_000 },
      { period: '2026-07', productGroup: 'H.A*', route: 'NT', unit: '003', revenue: 50_000_000 },
    ],
    configResolver: (segment) => store.resolve({ period: segment.period, context: { employee: 'DN009', ...segment } }),
    targetResolver: ({ period }) => store.resolve({ period, context: { employee: 'DN009' } }),
  };
  const result = employeeBonus.periodBonus({ target: 100_000_000, achieved: 105_000_000, pct: 105 }, store.resolve({ period: '07.2026', context: { employee: 'DN009' } }).config, coverage);
  assert.equal(result.baseAmount, 175_000);
  assert.equal(result.priorityGroups[0].reason, 'rate_ambiguous');
  assert.equal(result.priorityAmount, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('preview stores canonical candidate/hash and savePreview rejects revision races', () => {
  const { dir, store } = fixture();
  const preview = store.preview({ effectiveFrom: '07.2026', scope: { type: 'employee', value: 'DN006' }, patch: { priorityTargets: { 'H.A*': 100 } }, previewPeriod: '07.2026' }, 'CEO');
  assert.equal(preview.resolved.config.priorityTargets['H.A*'], 100);
  assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
  assert.equal(store.list().length, 0);
  const saved = store.savePreview(preview, 'CEO');
  assert.equal(saved.policy.patch.priorityTargets['H.A*'], 100);
  assert.equal(store.audit()[0].previewHash, preview.previewHash);
  assert.throws(() => store.savePreview(preview, 'CEO'), (error) => error.code === 'BONUS_POLICY_REVISION_CHANGED');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('invalid config and pre-v3 closed periods fail before write', () => {
  const { dir, store } = fixture();
  assert.throws(() => store.save({ effectiveFrom: '06.2026', scope: { type: 'default' }, patch: { priorityThresholdPct: 101 } }, 'CEO'), (error) => error.code === 'BONUS_POLICY_CLOSED_PERIOD');
  assert.throws(() => store.save({ effectiveFrom: '07.2026', scope: { type: 'employee', value: 'DN9' }, patch: { priorityThresholdPct: 101 } }, 'CEO'), (error) => error.code === 'BONUS_POLICY_EMPLOYEE_INVALID');
  assert.throws(() => store.save({ effectiveFrom: '08.2026', effectiveTo: '07.2026', scope: { type: 'default' }, patch: { priorityThresholdPct: 101 } }, 'CEO'), (error) => error.code === 'BONUS_POLICY_RANGE_INVALID');
  assert.throws(() => store.save({ effectiveFrom: '07.2026', scope: { type: 'default' }, patch: {} }, 'CEO'), (error) => error.code === 'BONUS_POLICY_PATCH_EMPTY');
  assert.throws(() => store.save({ effectiveFrom: '07.2026', scope: { type: 'default' }, patch: { priorityTargets: { 'H.A*': -1 } } }, 'CEO'), (error) => error.code === 'BONUS_POLICY_TARGET_INVALID');
  assert.equal(store.list().length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
