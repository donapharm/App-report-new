'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bonus = require('../src/employeeBonus');

const v3Config = {
  schemaVersion: 3,
  version: 'bonus-v3-test',
  effectiveFrom: '2026-07-01',
  base: 'revenue_before_vat',
  currency: 'VND',
  baseTiers: [
    { fromPct: 0, toPct: 90, bonusPct: 0 },
    { fromPct: 90, toPct: 100, bonusPct: 0.1 },
    { fromPct: 100, toPct: 110, bonusPct: 0.15 },
    { fromPct: 110, toPct: 130, bonusPct: 0.18 },
    { fromPct: 130, toPct: null, bonusPct: 0.25 },
  ],
  priorityThresholdPct: 101,
  priorityRates: { 'H.A*': 1, 'H.A': 0.8, 'H.B': 0.5, 'H.C': 0.1, 'H.D': 0.1 },
  priorityTargets: { 'H.A*': 5_000_000, 'H.A': 10_000_000, 'H.B': 20_000_000, 'H.C': 30_000_000, 'H.D': 60_000_000 },
  totalCapPct: null,
};

function priority(groupRevenue = {}, sourceAvailable = true, periods = ['2026-07']) {
  const totalRevenue = Object.values(groupRevenue).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    source: 'datahub_catalog_c10', sourceAvailable, periods,
    groupRevenue: Object.fromEntries(bonus.PRIORITY_GROUPS.map((group) => [group, Number(groupRevenue[group] || 0)])),
    totalRevenue, classifiedRevenue: sourceAvailable ? totalRevenue : 0,
    unclassifiedRevenue: sourceAvailable ? 0 : totalRevenue,
    invalidRevenue: 0, conflictRevenue: 0, coveragePct: sourceAvailable ? 100 : 0,
  };
}

function summary(pct, achieved = 100_000_000, config = v3Config, groupRevenue = {}) {
  const month = priority(groupRevenue, true, ['2026-07']);
  const quarter = priority(groupRevenue, true, ['2026-07', '2026-08', '2026-09']);
  return bonus.buildBonusSummary({
    ky: '07.2026', quarter_label: 'Q3/2026',
    month: { target: 100_000_000, achieved, pct },
    quarter: { target: 300_000_000, achieved, pct },
  }, config, { month, quarter });
}

test('invalid, legacy, gapped or malformed v3 configs fail closed', () => {
  for (const config of [
    { ...v3Config, schemaVersion: 2 },
    { base: 'revenue_before_vat', tiers: [{ fromPct: 0, toPct: 90, bonusPct: 0 }] },
    { ...v3Config, baseTiers: [] },
    { ...v3Config, baseTiers: [{ fromPct: 90, toPct: null, bonusPct: 0.1 }] },
    { ...v3Config, baseTiers: [{ fromPct: 0, toPct: 100, bonusPct: 0 }, { fromPct: 90, toPct: null, bonusPct: 0.1 }] },
    { ...v3Config, priorityRates: { ...v3Config.priorityRates, 'H.B': -1 } },
    { ...v3Config, priorityTargets: { ...v3Config.priorityTargets, 'H.B': -1 } },
    { ...v3Config, priorityTargets: { 'H.A*': null } },
  ]) {
    const result = bonus.buildBonusSummary({ month: { target: 1, achieved: 1, pct: 100 } }, config);
    assert.equal(result.configured, false);
    assert.equal(result.message, 'Chưa cấu hình mức thưởng');
    assert.equal(result.month.amount, null);
  }
});

test('P1 boundaries stay unchanged and >=130% remains 0.25% on pre-VAT achieved revenue', () => {
  assert.deepEqual([89.9, 90, 99.999, 100, 109.999, 110, 129.999, 130, 150].map((pct) => {
    const result = summary(pct, 200_000_000);
    return [result.month.baseBonusPct, result.month.baseAmount, result.month.status];
  }), [
    [0, 0, 'matched'], [0.1, 200_000, 'matched'], [0.1, 200_000, 'matched'],
    [0.15, 300_000, 'matched'], [0.15, 300_000, 'matched'],
    [0.18, 360_000, 'matched'], [0.18, 360_000, 'matched'],
    [0.25, 500_000, 'matched'], [0.25, 500_000, 'matched'],
  ]);
});

test('P2 starts at 101% and applies rate only to excess over each assigned C10 group target', () => {
  const groups = { 'H.A*': 10_000_000, 'H.A': 20_000_000, 'H.B': 30_000_000, 'H.C': 40_000_000, 'H.D': 50_000_000 };
  const below = summary(100.9, 200_000_000, v3Config, groups).month;
  assert.equal(below.baseAmount, 300_000);
  assert.equal(below.priorityAmount, 0);
  assert.equal(below.priorityStatus, 'below_threshold');

  const matched = summary(101, 200_000_000, v3Config, groups).month;
  assert.deepEqual(matched.priorityGroups.map((item) => [item.group, item.revenue, item.target, item.excess, item.amount, item.reason]), [
    ['H.A*', 10_000_000, 5_000_000, 5_000_000, 50_000, 'matched'],
    ['H.A', 20_000_000, 10_000_000, 10_000_000, 80_000, 'matched'],
    ['H.B', 30_000_000, 20_000_000, 10_000_000, 50_000, 'matched'],
    ['H.C', 40_000_000, 30_000_000, 10_000_000, 10_000, 'matched'],
    ['H.D', 50_000_000, 60_000_000, 0, 0, 'at_or_below_target'],
  ]);
  assert.equal(matched.priorityAmount, 190_000);
  assert.equal(matched.amount, 490_000);
});

test('missing group target fails closed and is never treated as zero', () => {
  const config = { ...v3Config, priorityTargets: { ...v3Config.priorityTargets, 'H.A*': null } };
  const result = summary(110, 100_000_000, config, { 'H.A*': 80_000_000, 'H.A': 20_000_000 }).month;
  const star = result.priorityGroups.find((item) => item.group === 'H.A*');
  assert.equal(star.target, null);
  assert.equal(star.excess, null);
  assert.equal(star.amount, 0);
  assert.equal(star.reason, 'target_missing');
  assert.equal(result.priorityStatus, 'partially_missing_targets');
});

test('ambiguous route/unit employee scope keeps the affected group P2 at zero', () => {
  const coverage = priority({ 'H.A*': 80_000_000 }, true, ['2026-07']);
  coverage.targetResolver = () => ({
    config: bonus.validateConfig(v3Config),
    priorityTargetStatuses: { 'H.A*': 'ambiguous_scope' },
  });
  const result = bonus.periodBonus({ target: 100_000_000, achieved: 110_000_000, pct: 110 }, bonus.validateConfig(v3Config), coverage);
  const star = result.priorityGroups.find((item) => item.group === 'H.A*');
  assert.equal(star.target, null);
  assert.equal(star.amount, 0);
  assert.equal(star.reason, 'ambiguous_scope');
  assert.equal(result.priorityStatus, 'partially_missing_targets');
});

test('quarter target is sum of all three monthly group targets; one missing month fails closed', () => {
  const coverage = priority({ 'H.A*': 30_000_000 }, true, ['2026-07', '2026-08', '2026-09']);
  coverage.targetResolver = ({ period }) => ({
    config: bonus.validateConfig({ ...v3Config, priorityTargets: { ...v3Config.priorityTargets, 'H.A*': period === '2026-08' ? 6_000_000 : 5_000_000 } }),
    priorityTargetSources: { 'H.A*': { id: period, scope: { type: 'employee', value: 'DN006' } } },
  });
  const ok = bonus.periodBonus({ target: 300_000_000, achieved: 330_000_000, pct: 110 }, bonus.validateConfig(v3Config), coverage);
  const group = ok.priorityGroups.find((item) => item.group === 'H.A*');
  assert.equal(group.target, 16_000_000);
  assert.equal(group.excess, 14_000_000);
  assert.equal(group.amount, 140_000);

  coverage.targetResolver = ({ period }) => ({
    config: bonus.validateConfig({ ...v3Config, priorityTargets: { ...v3Config.priorityTargets, 'H.A*': period === '2026-08' ? null : 5_000_000 } }),
    priorityTargetSources: { 'H.A*': null },
  });
  const missing = bonus.periodBonus({ target: 300_000_000, achieved: 330_000_000, pct: 110 }, bonus.validateConfig(v3Config), coverage);
  assert.equal(missing.priorityGroups.find((item) => item.group === 'H.A*').reason, 'target_missing');
  assert.equal(missing.priorityGroups.find((item) => item.group === 'H.A*').amount, 0);
});

test('v3 starts T07.2026 while a closed pre-July period retains historical full-revenue P2', () => {
  const closed = priority({ 'H.A*': 10_000_000 }, true, ['2026-06']);
  const historical = bonus.periodBonus({ target: 100_000_000, achieved: 110_000_000, pct: 110 }, bonus.validateConfig(v3Config), closed);
  assert.equal(historical.priorityGroups[0].reason, 'legacy_pre_v3');
  assert.equal(historical.priorityGroups[0].amount, 100_000);
  const open = bonus.periodBonus({ target: 100_000_000, achieved: 110_000_000, pct: 110 }, bonus.validateConfig(v3Config), priority({ 'H.A*': 10_000_000 }, true, ['2026-07']));
  assert.equal(open.priorityGroups[0].amount, 50_000);
});

test('missing, invalid and conflicting C10 fail closed without reading App Sale priority', () => {
  const revenueRows = [
    { iit_code: 'A', revenue: 110 },
    { iit_code: 'B', revenue: 220, priority: 'H.A*', tech_rank: 'H.A*' },
    { iit_code: 'C', revenue: 330 }, { iit_code: 'D', revenue: 440 },
  ];
  const unavailable = bonus.buildPriorityRevenue(revenueRows, [
    { c5: 'A', priority: 'H.A*' }, { c5: 'B', tech_rank: 'H.A*' },
  ], { vatDivisor: 1.1, period: '2026-07' });
  assert.equal(unavailable.sourceAvailable, false);
  assert.equal(unavailable.classifiedRevenue, 0);
  assert.equal(unavailable.unclassifiedRevenue, 1_000);

  const strict = bonus.buildPriorityRevenue(revenueRows, [
    { c5: 'A', c10: 'H.A*' }, { c5: 'B', c10: '' }, { c5: 'C', c10: 'H.E' },
    { c5: 'D', c10: 'H.A' }, { c5: 'D', c10: 'H.B' },
  ], { vatDivisor: 1.1, period: '2026-07' });
  assert.equal(strict.groupRevenue['H.A*'], 100);
  assert.equal(strict.classifiedRevenue, 100);
  assert.equal(strict.unclassifiedRevenue, 900);
  assert.equal(strict.invalidRevenue, 300);
  assert.equal(strict.conflictRevenue, 400);
  const noSource = bonus.periodBonus({ target: 100, achieved: 110, pct: 110 }, bonus.validateConfig(v3Config), unavailable);
  assert.equal(noSource.priorityAmount, 0);
  assert.equal(noSource.priorityStatus, 'source_unavailable');
});

test('optional total cap remains configurable; no legacy 0.5% hard cap exists', () => {
  const uncapped = summary(130, 100_000_000, v3Config, { 'H.A*': 100_000_000 }).month;
  assert.equal(uncapped.baseAmount, 250_000);
  assert.equal(uncapped.priorityAmount, 950_000);
  assert.equal(uncapped.amount, 1_200_000);
  const capped = summary(130, 100_000_000, { ...v3Config, totalCapPct: 0.5 }, { 'H.A*': 100_000_000 }).month;
  assert.equal(capped.amount, 500_000);
  assert.equal(capped.capped, true);
});

test('config is re-read and ALL adds each employee award instead of recalculating pooled revenue', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-bonus-v3-'));
  const file = path.join(directory, 'tiers.json');
  fs.writeFileSync(file, JSON.stringify({ ...v3Config, baseTiers: [] }));
  assert.equal(bonus.loadConfig(file).configured, false);
  fs.writeFileSync(file, JSON.stringify(v3Config));
  assert.equal(bonus.buildBonusSummary({ month: { target: 100, achieved: 100_000_000, pct: 100 } }, bonus.loadConfig(file)).month.baseAmount, 150_000);
  fs.rmSync(directory, { recursive: true, force: true });

  const first = { empCode: 'DN001', bonus: summary(100, 100_000_000) };
  const second = { empCode: 'DN002', bonus: summary(130, 100_000_000, v3Config, { 'H.A*': 10_000_000 }) };
  const aggregate = bonus.aggregateBonusSummaries([first, second], [
    { emp_code: 'DN001', name: 'Một' }, { emp_code: 'DN002', name: 'Hai' },
  ]);
  assert.equal(aggregate.month.baseAmount, 400_000);
  assert.equal(aggregate.month.priorityAmount, 50_000);
  assert.equal(aggregate.month.amount, 450_000);
  assert.equal(aggregate.month.contributors, 2);
});

test('ALL excludes missing awards and stays unavailable when nobody has a total target', () => {
  const valid = { empCode: 'DN001', bonus: summary(100, 100_000_000) };
  const missing = { empCode: 'DN002', bonus: bonus.buildBonusSummary({
    ky: '07.2026', month: { target: 0, achieved: 0, pct: null }, quarter: { target: 0, achieved: 0, pct: null },
  }, v3Config) };
  const mixed = bonus.aggregateBonusSummaries([valid, missing]);
  assert.equal(mixed.month.amount, 150_000);
  assert.equal(mixed.month.contributors, 1);
  const empty = bonus.aggregateBonusSummaries([missing]);
  assert.equal(empty.month.amount, null);
  assert.equal(empty.month.contributors, 0);
});
