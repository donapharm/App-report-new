'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const employeeBonus = require('../src/employeeBonus');
const penalty = require('../src/employeePenalty');
const policyModule = require('../src/employeePenaltyPolicy');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-penalty-policy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let tick = 0;
  const store = policyModule.createPolicyStore({
    policyFile: path.join(dir, 'policies.json'),
    auditFile: path.join(dir, 'audit.json'),
    seedConfig: employeeBonus.loadConfig(),
    now: () => new Date(Date.UTC(2026, 6, 30, 1, tick++)),
  });
  return { dir, store };
}

const parameters = (overrides = {}) => ({
  penaltyEnabled: true,
  warningFrom: '2026-07-01',
  enforcedFrom: '2026-08-01',
  dropThresholdPct: 40,
  upperPenaltyThresholdPct: 60,
  noPenaltyThresholdPct: 80,
  lowerRatePct: 0.5,
  upperRatePct: 0.25,
  bottomDropC45: true,
  bottomRatePct: 0.75,
  xuEnabled: false,
  perMissingXu: 300_000,
  ...overrides,
});

const candidate = (overrides = {}) => ({
  effectiveFrom: '2026-08',
  effectiveTo: null,
  previewPeriod: '2026-08',
  note: 'CEO điều chỉnh test',
  parameters: parameters(),
  ...overrides,
});

test('seed v3.4 resolves by period and dynamic thresholds/rates reach evaluator', (t) => {
  const { store } = fixture(t);
  const seed = store.resolve({ period: '07.2026' });
  assert.equal(seed.source.id, 'seed');
  assert.equal(seed.source.version, 0);
  assert.equal(seed.period, '2026-07');
  assert.equal(penalty.buildPenalty({
    period: '2026-07', target: 1000, achieved: 500, c45Amount: 100, costTotal: 500,
    config: seed.config,
  }).mode, 'warn_only');

  const custom = policyModule.configFromParameters(parameters({ bottomDropC45: false, bottomRatePct: 0.8 }));
  assert.equal(penalty.buildPenalty({ period: '2026-08', target: 1000, achieved: 400, c45Amount: 100, costTotal: 500, config: custom }).tier, 'drop_c45');
  assert.equal(penalty.buildPenalty({ period: '2026-08', target: 1000, achieved: 400, c45Amount: 100, costTotal: 500, config: custom }).ratePct, 0.8);
  assert.equal(penalty.buildPenalty({ period: '2026-08', target: 1000, achieved: 610, c45Amount: 100, costTotal: 500, config: custom }).ratePct, 0.25);
  assert.equal(penalty.buildPenalty({ period: '2026-08', target: 1000, achieved: 800, c45Amount: 100, costTotal: 500, config: custom }).tier, 'none');

  const shiftedSchedule = policyModule.configFromParameters(parameters({ warningFrom: '2026-09-01', enforcedFrom: '2026-10-01' }));
  assert.equal(penalty.resolveMode('2026-08', shiftedSchedule), 'off');
  assert.equal(penalty.resolveMode('2026-09', shiftedSchedule), 'warn_only');
  assert.equal(penalty.resolveMode('2026-10', shiftedSchedule), 'enforced');
});

test('preview is canonical, actor-bound, immutable and stale revisions are rejected', (t) => {
  const { store } = fixture(t);
  const first = store.preview(candidate({ id: 'client-controlled-id' }), 'CEO');
  assert.equal(first.candidate.version, 1);
  assert.notEqual(first.candidate.id, 'client-controlled-id');
  assert.match(first.candidate.id, /^penalty-policy-/);
  assert.equal(first.resolved.source.version, 1);
  assert.equal(first.before.source.version, 0);
  assert.match(first.previewHash, /^[a-f0-9]{64}$/);
  assert.throws(() => store.savePreview(first, 'DN001'), { code: 'PENALTY_POLICY_CEO_REQUIRED', status: 403 });

  const saved = store.savePreview(first, 'CEO');
  assert.equal(saved.policy.version, 1);
  assert.equal(store.list().length, 1);
  assert.equal(store.audit().length, 1);
  assert.equal(store.audit()[0].revisionBefore, first.revision);
  assert.equal(store.audit()[0].previewHash, first.previewHash);
  assert.throws(() => store.savePreview(first, 'CEO'), { code: 'PENALTY_POLICY_REVISION_CHANGED' });

  const stale = store.preview(candidate({ effectiveFrom: '2026-09', previewPeriod: '2026-09' }), 'CEO');
  const newer = store.preview(candidate({ effectiveFrom: '2026-10', previewPeriod: '2026-10' }), 'CEO');
  store.savePreview(newer, 'CEO');
  assert.throws(() => store.savePreview(stale, 'CEO'), { code: 'PENALTY_POLICY_REVISION_CHANGED' });
  assert.equal(store.list().length, 2, 'stale save must not append or overwrite');
});

test('effective ranges resolve historically with deterministic overlap precedence and copy-forward', (t) => {
  const { store } = fixture(t);
  const p1 = store.preview(candidate({ effectiveFrom: '2026-07', effectiveTo: '2026-10', previewPeriod: '2026-07' }), 'CEO');
  store.savePreview(p1, 'CEO');
  assert.throws(() => store.preview(candidate({
    effectiveFrom: '2026-08', previewPeriod: '2026-08', copiedFromVersion: 1,
    parameters: parameters({ noPenaltyThresholdPct: 85 }),
  }), 'CEO'), { code: 'PENALTY_POLICY_COPY_SOURCE_MISMATCH' });
  const p2 = store.preview(candidate({ effectiveFrom: '2026-08', effectiveTo: '2026-09', previewPeriod: '2026-08', parameters: parameters({ noPenaltyThresholdPct: 85 }) }), 'CEO');
  store.savePreview(p2, 'CEO');

  assert.equal(store.resolve({ period: '2026-07' }).source.version, 1);
  assert.equal(store.resolve({ period: '2026-08' }).source.version, 2);
  assert.equal(store.resolve({ period: '2026-09' }).source.version, 2);
  assert.equal(store.resolve({ period: '2026-10' }).source.version, 1, 'older range resumes after narrower override ends');
  assert.equal(store.resolve({ period: '2026-11' }).source.version, 0, 'seed resumes after all saved ranges end');

  const p3 = store.preview(candidate({
    effectiveFrom: '2026-11', previewPeriod: '2026-11', copiedFromVersion: 1,
    parameters: p1.candidate.parameters,
  }), 'CEO');
  store.savePreview(p3, 'CEO');
  assert.equal(store.resolve({ period: '2026-11' }).source.version, 3);
  assert.equal(store.audit()[0].copiedFromVersion, 1);
  assert.throws(() => store.preview(candidate({ copiedFromVersion: 999 }), 'CEO'), { code: 'PENALTY_POLICY_COPY_SOURCE_INVALID' });
});

test('historical months become immutable once the calendar advances', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-penalty-policy-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = policyModule.createPolicyStore({
    policyFile: path.join(dir, 'policies.json'),
    auditFile: path.join(dir, 'audit.json'),
    seedConfig: employeeBonus.loadConfig(),
    now: () => new Date(Date.UTC(2026, 8, 2)),
  });
  assert.throws(() => store.preview(candidate({ effectiveFrom: '2026-08', previewPeriod: '2026-08' }), 'CEO'), {
    code: 'PENALTY_POLICY_CLOSED_PERIOD', status: 409,
  });
  assert.doesNotThrow(() => store.preview(candidate({ effectiveFrom: '2026-09', previewPeriod: '2026-09' }), 'CEO'));
});

test('invalid dates, ranges, thresholds and rates fail closed before preview', (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.preview(candidate({ effectiveFrom: '2026-06', previewPeriod: '2026-06' }), 'CEO'), { code: 'PENALTY_POLICY_CLOSED_PERIOD' });
  assert.throws(() => store.preview(candidate({ effectiveTo: '2026-07' }), 'CEO'), { code: 'PENALTY_POLICY_RANGE_INVALID' });
  assert.throws(() => store.preview(candidate({ previewPeriod: '2026-07' }), 'CEO'), { code: 'PENALTY_POLICY_PREVIEW_PERIOD_OUTSIDE_RANGE' });
  assert.throws(() => store.preview(candidate({ parameters: parameters({ dropThresholdPct: 60, upperPenaltyThresholdPct: 60 }) }), 'CEO'), { code: 'PENALTY_POLICY_THRESHOLDS_INVALID' });
  assert.throws(() => store.preview(candidate({ parameters: parameters({ warningFrom: '2026-09-01', enforcedFrom: '2026-08-01' }) }), 'CEO'), { code: 'PENALTY_POLICY_DATES_INVALID' });
  assert.throws(() => store.preview(candidate({ parameters: parameters({ lowerRatePct: -1 }) }), 'CEO'), { code: 'PENALTY_POLICY_NUMBER_INVALID' });
  assert.throws(() => store.preview(candidate({ parameters: parameters({ warningFrom: '2026-07-15' }) }), 'CEO'), { code: 'PENALTY_POLICY_DATE_INVALID' });
});

test('corrupt JSON and corrupt store structures surface explicit 500 errors', (t) => {
  const { dir, store } = fixture(t);
  fs.writeFileSync(store.files.policyFile, '{bad-json');
  assert.throws(() => store.list(), { code: 'PENALTY_POLICY_STORE_CORRUPT', status: 500 });

  fs.writeFileSync(store.files.policyFile, JSON.stringify({ schemaVersion: 99, policies: [] }));
  assert.throws(() => store.list(), { code: 'PENALTY_POLICY_STORE_CORRUPT', status: 500 });

  fs.rmSync(store.files.policyFile, { force: true });
  const preview = store.preview(candidate(), 'CEO');
  fs.writeFileSync(store.files.auditFile, JSON.stringify({ audit: [] }));
  assert.throws(() => store.audit(), { code: 'PENALTY_POLICY_STORE_CORRUPT', status: 500 });
  assert.throws(() => store.savePreview(preview, 'CEO'), { code: 'PENALTY_POLICY_STORE_CORRUPT', status: 500 });
  assert.equal(store.list().length, 0, 'corrupt audit must fail before policy mutation');
  assert.ok(fs.existsSync(dir));
});

test('audit history is append-only and is not truncated after 2,000 events', (t) => {
  const { store } = fixture(t);
  const oldAudit = Array.from({ length: 2001 }, (_, index) => ({ action: 'legacy', index }));
  fs.writeFileSync(store.files.auditFile, JSON.stringify(oldAudit));
  const preview = store.preview(candidate(), 'CEO');
  store.savePreview(preview, 'CEO');
  const rows = store.audit();
  assert.equal(rows.length, 2002);
  assert.equal(rows[0].action, 'penalty_policy_saved');
  assert.equal(rows.at(-1).index, 2000);
});

test('enabled Xu remains unknown until checkpoint data is complete; warn-only applied is exact zero', () => {
  const config = policyModule.configFromParameters(parameters({ xuEnabled: true }));
  const warned = penalty.buildPenalty({
    period: '2026-07', target: 1000, achieved: 650, c45Amount: 100, costTotal: 500,
    config, xu: { amount: null, status: 'quarter_pending' },
  });
  assert.equal(warned.total, null);
  assert.ok(warned.provisionalTotal > 0);
  assert.equal(warned.appliedAmount, 0);
  assert.equal(warned.afterPenaltyTotal, 500);

  const enforced = penalty.buildPenalty({
    period: '2026-08', target: 1000, achieved: 650, c45Amount: 100, costTotal: 500,
    config, xu: { amount: null, status: 'xu_source_unavailable' },
  });
  assert.equal(enforced.total, null);
  assert.equal(enforced.appliedAmount, null);
  assert.equal(enforced.afterPenaltyTotal, null);
  const adjusted = penalty.applyToCostPeriod({
    summary: { monthlyTotal: 500 },
    daily: { reliable: true, totals: [{ date: '2026-08-01', monthlyTotal: 500 }] },
  }, enforced);
  assert.equal(adjusted.summary.penaltyAppliedAmount, null);
  assert.equal(adjusted.summary.afterPenaltyTotal, null);
  assert.equal(adjusted.daily.totals[0].penaltyAmount, null);
  assert.equal(adjusted.daily.totals[0].afterPenaltyTotal, null);
});
