'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bonus = require('../src/employeeBonus');

const v2Config = {
  schemaVersion: 2,
  version: 'bonus-v2-test',
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
  totalCapPct: null,
};

function priority(groupRevenue = {}, sourceAvailable = true) {
  const totalRevenue = Object.values(groupRevenue).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    source: 'datahub_catalog_c10', sourceAvailable,
    groupRevenue: Object.fromEntries(bonus.PRIORITY_GROUPS.map((group) => [group, Number(groupRevenue[group] || 0)])),
    totalRevenue, classifiedRevenue: sourceAvailable ? totalRevenue : 0,
    unclassifiedRevenue: sourceAvailable ? 0 : totalRevenue,
    invalidRevenue: 0, conflictRevenue: 0, coveragePct: sourceAvailable ? 100 : 0,
  };
}

function summary(pct, achieved = 100_000_000, config = v2Config, groupRevenue = {}) {
  const projection = priority(groupRevenue);
  return bonus.buildBonusSummary({
    ky: '07.2026', quarter_label: 'Q3/2026',
    month: { target: 100_000_000, achieved, pct },
    quarter: { target: 300_000_000, achieved, pct },
  }, config, { month: projection, quarter: projection });
}

test('invalid, legacy, gapped or overlapping v2 configs fail closed', () => {
  for (const config of [
    { ...v2Config, schemaVersion: 1 },
    { base: 'revenue_before_vat', tiers: [{ fromPct: 0, toPct: 90, bonusPct: 0 }] },
    { ...v2Config, baseTiers: [] },
    { ...v2Config, baseTiers: [{ fromPct: 90, toPct: null, bonusPct: 0.1 }] },
    { ...v2Config, baseTiers: [{ fromPct: 0, toPct: 100, bonusPct: 0 }, { fromPct: 90, toPct: null, bonusPct: 0.1 }] },
    { ...v2Config, priorityRates: { ...v2Config.priorityRates, 'H.B': -1 } },
  ]) {
    const result = bonus.buildBonusSummary({ month: { target: 1, achieved: 1, pct: 100 } }, config);
    assert.equal(result.configured, false);
    assert.equal(result.message, 'Chưa cấu hình mức thưởng');
    assert.equal(result.month.amount, null);
  }
});

test('base tier boundaries match CEO formula and use pre-VAT achieved revenue', () => {
  assert.deepEqual([89.9, 90, 99.999, 100, 109.999, 110, 129.999, 130].map((pct) => {
    const result = summary(pct, 200_000_000);
    return [result.month.baseBonusPct, result.month.baseAmount, result.month.status];
  }), [
    [0, 0, 'matched'],
    [0.1, 200_000, 'matched'],
    [0.1, 200_000, 'matched'],
    [0.15, 300_000, 'matched'],
    [0.15, 300_000, 'matched'],
    [0.18, 360_000, 'matched'],
    [0.18, 360_000, 'matched'],
    [0.25, 500_000, 'matched'],
  ]);
});

test('priority part starts at total attainment 101% and adds each official C10 group rate', () => {
  const groups = { 'H.A*': 10_000_000, 'H.A': 20_000_000, 'H.B': 30_000_000, 'H.C': 40_000_000, 'H.D': 50_000_000 };
  const below = summary(100.9, 200_000_000, v2Config, groups).month;
  assert.equal(below.baseAmount, 300_000);
  assert.equal(below.priorityAmount, 0);
  assert.equal(below.amount, 300_000);
  assert.equal(below.priorityStatus, 'below_threshold');

  const matched = summary(101, 200_000_000, v2Config, groups).month;
  assert.equal(matched.baseAmount, 300_000);
  assert.deepEqual(matched.priorityGroups.map((item) => [item.group, item.amount]), [
    ['H.A*', 100_000], ['H.A', 160_000], ['H.B', 150_000], ['H.C', 40_000], ['H.D', 50_000],
  ]);
  assert.equal(matched.priorityAmount, 500_000);
  assert.equal(matched.amount, 800_000);
});

test('missing, empty, invalid and conflicting C10 fail closed without reading App Sale priority', () => {
  const revenueRows = [
    { iit_code: 'A', revenue: 110 },
    { iit_code: 'B', revenue: 220, priority: 'H.A*', tech_rank: 'H.A*' },
    { iit_code: 'C', revenue: 330 },
    { iit_code: 'D', revenue: 440 },
  ];
  const unavailable = bonus.buildPriorityRevenue(revenueRows, [
    { c5: 'A', priority: 'H.A*' }, { c5: 'B', tech_rank: 'H.A*' },
  ], { vatDivisor: 1.1 });
  assert.equal(unavailable.sourceAvailable, false);
  assert.equal(unavailable.classifiedRevenue, 0);
  assert.equal(unavailable.unclassifiedRevenue, 1_000);

  const strict = bonus.buildPriorityRevenue(revenueRows, [
    { c5: 'A', c10: 'H.A*' },
    { c5: 'B', c10: '' },
    { c5: 'C', c10: 'H.E' },
    { c5: 'D', c10: 'H.A' },
    { c5: 'D', c10: 'H.B' },
  ], { vatDivisor: 1.1 });
  assert.equal(strict.sourceAvailable, true);
  assert.equal(strict.groupRevenue['H.A*'], 100);
  assert.equal(strict.classifiedRevenue, 100);
  assert.equal(strict.unclassifiedRevenue, 900);
  assert.equal(strict.invalidRevenue, 300);
  assert.equal(strict.conflictRevenue, 400);
  assert.equal(strict.c10InvalidCodes, 1);
  assert.equal(strict.c10ConflictCodes, 1);

  const result = summary(110, 1_000_000, v2Config).month;
  const noSource = bonus.periodBonus({ target: 100, achieved: 110, pct: 110 }, bonus.validateConfig(v2Config), unavailable);
  assert.equal(result.priorityAmount, 0);
  assert.equal(noSource.baseAmount, 0); // 110 VND × 0.18% rounds to zero
  assert.equal(noSource.priorityAmount, 0);
  assert.equal(noSource.priorityStatus, 'source_unavailable');
});

test('optional total cap applies only when configured; no legacy 0.5% hard cap exists', () => {
  const uncapped = summary(130, 100_000_000, v2Config, { 'H.A*': 100_000_000 }).month;
  assert.equal(uncapped.baseAmount, 250_000);
  assert.equal(uncapped.priorityAmount, 1_000_000);
  assert.equal(uncapped.amount, 1_250_000);
  assert.equal(uncapped.capped, false);

  const capped = summary(130, 100_000_000, { ...v2Config, totalCapPct: 0.5 }, { 'H.A*': 100_000_000 }).month;
  assert.equal(capped.uncappedAmount, 1_250_000);
  assert.equal(capped.amount, 500_000);
  assert.equal(capped.capped, true);
});

test('config is re-read from disk and ALL totals add each employee award', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-bonus-v2-'));
  const file = path.join(directory, 'tiers.json');
  fs.writeFileSync(file, JSON.stringify({ ...v2Config, baseTiers: [] }));
  assert.equal(bonus.loadConfig(file).configured, false);
  fs.writeFileSync(file, JSON.stringify(v2Config));
  assert.equal(bonus.buildBonusSummary({ month: { target: 100, achieved: 100_000_000, pct: 100 } }, bonus.loadConfig(file)).month.baseAmount, 150_000);
  fs.rmSync(directory, { recursive: true, force: true });

  const first = { empCode: 'DN001', bonus: summary(100, 100_000_000) };
  const second = { empCode: 'DN002', bonus: summary(130, 100_000_000, v2Config, { 'H.A*': 10_000_000 }) };
  const aggregate = bonus.aggregateBonusSummaries([first, second], [
    { emp_code: 'DN001', name: 'Một' }, { emp_code: 'DN002', name: 'Hai' },
  ]);
  assert.equal(aggregate.aggregate, true);
  assert.equal(aggregate.month.baseAmount, 400_000);
  assert.equal(aggregate.month.priorityAmount, 100_000);
  assert.equal(aggregate.month.amount, 500_000);
  assert.equal(aggregate.month.contributors, 2);
});

test('ALL totals exclude missing awards and stay unavailable when nobody has a target', () => {
  const valid = { empCode: 'DN001', bonus: summary(100, 100_000_000) };
  const missing = { empCode: 'DN002', bonus: bonus.buildBonusSummary({
    ky: '07.2026', month: { target: 0, achieved: 0, pct: null }, quarter: { target: 0, achieved: 0, pct: null },
  }, v2Config) };
  const mixed = bonus.aggregateBonusSummaries([valid, missing]);
  assert.equal(mixed.month.amount, 150_000);
  assert.equal(mixed.month.contributors, 1);
  const empty = bonus.aggregateBonusSummaries([missing]);
  assert.equal(empty.month.amount, null);
  assert.equal(empty.month.contributors, 0);
});
