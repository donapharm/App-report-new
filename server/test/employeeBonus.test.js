'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bonus = require('../src/employeeBonus');

const tierConfig = {
  base: 'revenue_before_vat',
  currency: 'VND',
  capPct: 0.5,
  tiers: [
    { fromPct: 100, toPct: 110, bonusPct: 0.2 },
    { fromPct: 110, toPct: 120, bonusPct: 0.3 },
    { fromPct: 120, toPct: 130, bonusPct: 0.4 },
    { fromPct: 130, toPct: 99999, bonusPct: 0.5 },
  ],
};

function summary(pct, achieved = 100_000_000, config = tierConfig) {
  return bonus.buildBonusSummary({
    ky: '07.2026', quarter_label: 'Q3/2026',
    month: { target: 100_000_000, achieved, pct },
    quarter: { target: 300_000_000, achieved, pct },
  }, config);
}

test('empty or placeholder tiers fail closed with the exact unconfigured message', () => {
  for (const config of [
    { base: 'revenue_before_vat', capPct: 0.5, tiers: [] },
    { base: 'revenue_before_vat', capPct: 0.5, tiers: [{ fromPct: 0, toPct: 0, bonusPct: 0 }] },
    { base: 'revenue_before_vat', capPct: 0.5, tiers: [{ fromPct: 100, toPct: 110, bonus: 200_000 }] },
    { base: 'revenue_before_vat', capPct: 0.5, tiers: [{ fromPct: null, toPct: 110, bonusPct: 0.2 }] },
    { base: 'revenue_before_vat', capPct: 0.5, tiers: [{ fromPct: '100', toPct: 110, bonusPct: 0.2 }] },
    { base: 'revenue_before_vat', capPct: 0.5, tiers: [{ fromPct: 100, toPct: 110, bonusPct: true }] },
  ]) {
    const result = bonus.buildBonusSummary({ month: { target: 1, achieved: 1, pct: 100 } }, config);
    assert.equal(result.configured, false);
    assert.equal(result.message, 'Chưa cấu hình mức thưởng');
    assert.equal(result.month.amount, null);
  }
});

test('tier boundaries use [fromPct, toPct), below threshold is zero and amounts use pre-VAT achieved revenue', () => {
  assert.deepEqual([99.9, 100, 109.999, 110, 120, 130].map((pct) => {
    const result = summary(pct, 200_000_000);
    return [result.month.bonusPct, result.month.amount, result.month.status];
  }), [
    [0, 0, 'below_tier'],
    [0.2, 400_000, 'matched'],
    [0.2, 400_000, 'matched'],
    [0.3, 600_000, 'matched'],
    [0.4, 800_000, 'matched'],
    [0.5, 1_000_000, 'matched'],
  ]);
});

test('cap is hard-limited to 0.5% and overlapping tiers fail closed', () => {
  const capped = summary(130, 300_000_000, {
    base: 'revenue_before_vat', capPct: 9,
    tiers: [{ fromPct: 100, toPct: 99999, bonusPct: 4 }],
  });
  assert.equal(capped.capPct, 0.5);
  assert.equal(capped.month.bonusPct, 0.5);
  assert.equal(capped.month.amount, 1_500_000);

  const invalid = bonus.validateConfig({
    base: 'revenue_before_vat', capPct: 0.5,
    tiers: [
      { fromPct: 100, toPct: 120, bonusPct: 0.2 },
      { fromPct: 110, toPct: 130, bonusPct: 0.3 },
    ],
  });
  assert.equal(invalid.configured, false);
  assert.equal(invalid.reason, 'overlapping_tiers');
});

test('config is re-read from disk so tier changes require no code change or restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-bonus-'));
  const file = path.join(directory, 'tiers.json');
  fs.writeFileSync(file, JSON.stringify({ ...tierConfig, tiers: [] }));
  assert.equal(bonus.loadConfig(file).configured, false);
  fs.writeFileSync(file, JSON.stringify(tierConfig));
  assert.equal(bonus.buildBonusSummary({ month: { target: 100_000_000, achieved: 100_000_000, pct: 100 } }, bonus.loadConfig(file)).month.amount, 200_000);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('ALL totals add each employee award instead of applying a tier to aggregate revenue', () => {
  const first = { empCode: 'DN001', bonus: summary(100, 100_000_000) };
  const second = { empCode: 'DN002', bonus: summary(130, 100_000_000) };
  const aggregate = bonus.aggregateBonusSummaries([first, second], [
    { emp_code: 'DN001', name: 'Một' }, { emp_code: 'DN002', name: 'Hai' },
  ]);
  assert.equal(aggregate.aggregate, true);
  assert.equal(aggregate.month.amount, 700_000);
  assert.equal(aggregate.month.contributors, 2);
  assert.deepEqual(aggregate.employeeSubtotals.map((item) => [item.empCode, item.employeeName, item.month.amount]), [
    ['DN001', 'Một', 200_000], ['DN002', 'Hai', 500_000],
  ]);
});

test('ALL totals exclude missing awards and stay unavailable when nobody has a target', () => {
  const valid = { empCode: 'DN001', bonus: summary(100, 100_000_000) };
  const missing = { empCode: 'DN002', bonus: bonus.buildBonusSummary({
    ky: '07.2026', month: { target: 0, achieved: 0, pct: null }, quarter: { target: 0, achieved: 0, pct: null },
  }, tierConfig) };
  const mixed = bonus.aggregateBonusSummaries([valid, missing]);
  assert.equal(mixed.month.amount, 200_000);
  assert.equal(mixed.month.contributors, 1);
  const empty = bonus.aggregateBonusSummaries([missing]);
  assert.equal(empty.month.amount, null);
  assert.equal(empty.month.contributors, 0);
});
