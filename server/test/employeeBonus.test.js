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

test('missing manual group target auto-infers by employee revenue share; explicit auto-off keeps old fail-closed option', () => {
  const config = { ...v3Config, priorityTargets: { ...v3Config.priorityTargets, 'H.A*': null } };
  const result = summary(110, 100_000_000, config, { 'H.A*': 80_000_000, 'H.A': 20_000_000 }).month;
  const star = result.priorityGroups.find((item) => item.group === 'H.A*');
  assert.equal(star.target, 80_000_000);
  assert.equal(star.targetSource, 'auto');
  assert.equal(star.excess, 0);
  assert.equal(star.amount, 0);
  assert.equal(star.reason, 'at_or_below_target');
  assert.equal(star.targetPeriods[0].source.formula, 'employee_target_x_group_revenue_share');

  const disabled = summary(110, 100_000_000, { ...config, autoGroupTargets: false }, { 'H.A*': 80_000_000, 'H.A': 20_000_000 }).month;
  const disabledStar = disabled.priorityGroups.find((item) => item.group === 'H.A*');
  assert.equal(disabledStar.target, null);
  assert.equal(disabledStar.reason, 'target_missing');
  assert.equal(disabled.priorityStatus, 'partially_missing_targets');
});

test('DN006 hand-check: auto targets and P2 match target × C10 share on 729,579,687 total excess', () => {
  const config = { ...v3Config, priorityTargets: Object.fromEntries(bonus.PRIORITY_GROUPS.map((group) => [group, null])) };
  const target = 2_693_559_151;
  const achieved = 3_423_138_838;
  const groups = { 'H.A*': 1_534_009_669, 'H.A': 978_570_038, 'H.B': 591_166_846, 'H.C': 192_728_667, 'H.D': 101_977_905 };
  const coverage = priority(groups, true, ['2026-07']);
  coverage.totalRevenue = achieved;
  coverage.employeeTargetsByPeriod = { '2026-07': target };
  const result = bonus.periodBonus({ target, achieved, pct: 127.1 }, bonus.validateConfig(config), coverage);
  assert.equal(achieved - target, 729_579_687);
  assert.deepEqual(result.priorityGroups.map((item) => [item.group, item.target, item.excess, item.amount, item.targetSource]), [
    ['H.A*', 1_207_063_452, 326_946_217, 3_269_462, 'auto'],
    ['H.A', 770_005_660, 208_564_378, 1_668_515, 'auto'],
    ['H.B', 465_170_402, 125_996_444, 629_982, 'auto'],
    ['H.C', 151_652_062, 41_076_605, 41_077, 'auto'],
    ['H.D', 80_243_172, 21_734_733, 21_735, 'auto'],
  ]);
  assert.equal(result.priorityAmount, 5_630_771);
  assert.ok(result.priorityAmount > 0);
});

test('manual layered target overrides auto for exactly that group and exposes manual source', () => {
  const config = { ...v3Config, priorityTargets: Object.fromEntries(bonus.PRIORITY_GROUPS.map((group) => [group, null])) };
  const coverage = priority({ 'H.A*': 80, 'H.A': 20 }, true, ['2026-07']);
  coverage.employeeTargetsByPeriod = { '2026-07': 90 };
  coverage.targetResolver = () => ({
    config: bonus.validateConfig({ ...config, priorityTargets: { ...config.priorityTargets, 'H.A*': 60 } }),
    priorityTargetSources: { 'H.A*': { id: 'employee-manual-v4', version: 4, scope: { type: 'employee', value: 'DN006' } } },
  });
  const result = bonus.periodBonus({ target: 90, achieved: 100, pct: 111.1 }, bonus.validateConfig(config), coverage);
  const star = result.priorityGroups.find((item) => item.group === 'H.A*');
  const a = result.priorityGroups.find((item) => item.group === 'H.A');
  assert.deepEqual([star.target, star.targetSource, star.targetPeriods[0].source.id], [60, 'manual', 'employee-manual-v4']);
  assert.deepEqual([a.target, a.targetSource], [18, 'auto']);
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

test('quarter group target and revenue use average of assigned months (T07-only and full three-month average)', () => {
  const coverage = priority({ 'H.A*': 30_000_000 }, true, ['2026-07', '2026-08', '2026-09']);
  coverage.aggregation = 'average';
  coverage.employeeTargetsByPeriod = { '2026-07': 100_000_000, '2026-08': 120_000_000, '2026-09': 140_000_000 };
  coverage.targetResolver = ({ period }) => ({
    config: bonus.validateConfig({ ...v3Config, priorityTargets: { ...v3Config.priorityTargets, 'H.A*': period === '2026-08' ? 6_000_000 : 5_000_000 } }),
    priorityTargetSources: { 'H.A*': { id: period, scope: { type: 'employee', value: 'DN006' } } },
  });
  const ok = bonus.periodBonus({ target: 120_000_000, achieved: 132_000_000, pct: 110 }, bonus.validateConfig(v3Config), coverage);
  const group = ok.priorityGroups.find((item) => item.group === 'H.A*');
  assert.equal(group.target, 5_333_333);
  assert.equal(group.excess, 24_666_667);
  assert.equal(group.amount, 246_667);

  const july = priority({ 'H.A*': 10_000_000 }, true, ['2026-07']);
  july.aggregation = 'average';
  july.employeeTargetsByPeriod = { '2026-07': 100_000_000 };
  july.targetResolver = coverage.targetResolver;
  const julyOnly = bonus.periodBonus({ target: 100_000_000, achieved: 110_000_000, pct: 110 }, bonus.validateConfig(v3Config), july);
  assert.equal(julyOnly.priorityGroups.find((item) => item.group === 'H.A*').target, 5_000_000);
});

test('quarter auto group targets average each assigned month formula together with group revenue', () => {
  const config = bonus.validateConfig({
    ...v3Config,
    priorityTargets: Object.fromEntries(bonus.PRIORITY_GROUPS.map((group) => [group, null])),
  });
  const month = (period, totalRevenue, groupRevenue) => {
    const item = priority({ 'H.A*': groupRevenue }, true, [period]);
    item.totalRevenue = totalRevenue;
    return item;
  };
  const coverage = bonus.mergePriorityRevenue([
    month('2026-07', 100_000_000, 60_000_000),
    month('2026-08', 200_000_000, 100_000_000),
    month('2026-09', 300_000_000, 90_000_000),
  ], { aggregation: 'average' });
  coverage.employeeTargetsByPeriod = { '2026-07': 80_000_000, '2026-08': 120_000_000, '2026-09': 160_000_000 };
  const result = bonus.periodBonus({ target: 120_000_000, achieved: 200_000_000, pct: 166.7 }, config, coverage);
  const star = result.priorityGroups.find((item) => item.group === 'H.A*');
  assert.equal(star.revenue, 83_333_333);
  assert.equal(star.target, 52_000_000); // avg(48m, 60m, 48m)
  assert.equal(star.targetSource, 'auto');
  assert.deepEqual(star.targetPeriods.map((item) => item.target), [48_000_000, 60_000_000, 48_000_000]);
  assert.equal(star.amount, 313_333);
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
