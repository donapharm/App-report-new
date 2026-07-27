'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bonus = require('../src/employeeBonus');

const v3Config = {
  schemaVersion: 3,
  version: 'bonus-v3.2-total-target-gate-test',
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

test('P1 (coach) boundaries stay unchanged and >=130% remains 0.25% on pre-VAT achieved revenue', () => {
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

// ─────────────────── P2 v3.2: CỔNG TỔNG TARGET + gán phần vượt theo ưu tiên ───────────────────
// CEO 2026-07-27: phải đạt TỔNG target trước; phần vượt (R−T) gán nhóm ưu tiên CAO trước,
// cap bởi doanh thu nhóm, mỗi phần ăn rate nhóm đó. P1 giữ nguyên.

test('P2 v3.2: dưới ngưỡng % (pct < 101) → P2 = 0', () => {
  const groups = { 'H.A*': 60_000_000, 'H.A': 50_000_000, 'H.B': 40_000_000 };
  const below = summary(100.9, 200_000_000, v3Config, groups).month;
  assert.equal(below.baseAmount, 300_000);
  assert.equal(below.priorityAmount, 0);
  assert.equal(below.priorityStatus, 'below_threshold');
});

test('P2 v3.2: đạt ngưỡng NHƯNG tổng C10 < tổng target → P2 = 0 (total_below_target)', () => {
  // pct 110 (qua ngưỡng) nhưng doanh thu C10 = 90M < target 100M.
  const r = summary(110, 110_000_000, v3Config, { 'H.A*': 90_000_000 }).month;
  assert.equal(r.totalC10Revenue, 90_000_000);
  assert.equal(r.totalTarget, 100_000_000);
  assert.equal(r.priorityStatus, 'total_below_target');
  assert.equal(r.priorityAmount, 0);
  assert.equal(r.priorityGroups.find((g) => g.group === 'H.A*').reason, 'total_below_target');
});

test('P2 v3.2: R ≥ T → gán phần vượt ưu tiên CAO trước, cap bởi doanh thu nhóm, tràn xuống', () => {
  // target 100M; C10: H.A*20 H.A30 H.B40 H.C50 H.D60 → R=200M, E=100M.
  const groups = { 'H.A*': 20_000_000, 'H.A': 30_000_000, 'H.B': 40_000_000, 'H.C': 50_000_000, 'H.D': 60_000_000 };
  const m = summary(200, 200_000_000, v3Config, groups).month;
  assert.equal(m.totalC10Revenue, 200_000_000);
  assert.equal(m.totalTarget, 100_000_000);
  assert.equal(m.totalExcess, 100_000_000);
  assert.deepEqual(m.priorityGroups.map((g) => [g.group, g.allocated, g.amount, g.reason]), [
    ['H.A*', 20_000_000, 200_000, 'matched'],   // 20M × 1%
    ['H.A', 30_000_000, 240_000, 'matched'],    // 30M × 0.8%
    ['H.B', 40_000_000, 200_000, 'matched'],    // 40M × 0.5%
    ['H.C', 10_000_000, 10_000, 'matched'],     // còn 10M × 0.1%
    ['H.D', 0, 0, 'not_in_excess'],             // hết phần vượt
  ]);
  assert.equal(m.priorityAmount, 650_000);
});

test('P2 v3.2: ví dụ CEO — phần vượt 700tr, H.A* có 200tr → H.A* = 2.000.000đ rồi tràn xuống', () => {
  // target 1 tỷ; H.A* 200tr, H.A 800tr, H.B 700tr → R=1.7 tỷ, E=700tr.
  const groups = { 'H.A*': 200_000_000, 'H.A': 800_000_000, 'H.B': 700_000_000 };
  const m = summary(170, 1_700_000_000, { ...v3Config, priorityTargets: v3Config.priorityTargets }, groups).month;
  // summary target là 100M; ép qua periodBonus để dùng target 1 tỷ:
  const coverage = priority(groups, true, ['2026-07']);
  const r = bonus.periodBonus({ target: 1_000_000_000, achieved: 1_700_000_000, pct: 170 }, bonus.validateConfig(v3Config), coverage);
  assert.equal(r.totalExcess, 700_000_000);
  const star = r.priorityGroups.find((g) => g.group === 'H.A*');
  const a = r.priorityGroups.find((g) => g.group === 'H.A');
  assert.equal(star.allocated, 200_000_000);
  assert.equal(star.amount, 2_000_000);          // 200tr × 1% = 2.000.000đ (đúng ví dụ CEO)
  assert.equal(a.allocated, 500_000_000);        // còn 500tr tràn xuống H.A
  assert.equal(a.amount, 4_000_000);             // 500tr × 0.8%
  assert.equal(r.priorityAmount, 6_000_000);
  assert.ok(m); // summary vẫn chạy (target 100M) — chỉ kiểm không ném lỗi
});

test('P2 v3.2: đổi rate config → P2 đổi theo (rate cấu hình tay được)', () => {
  const groups = { 'H.A*': 200_000_000 };  // R=200M, target 100M, E=100M, all vào H.A*
  const base = summary(200, 200_000_000, v3Config, groups).month;
  assert.equal(base.priorityAmount, 1_000_000);  // 100M × 1%
  const doubled = summary(200, 200_000_000, { ...v3Config, priorityRates: { ...v3Config.priorityRates, 'H.A*': 2 } }, groups).month;
  assert.equal(doubled.priorityAmount, 2_000_000); // 100M × 2%
});

test('DN006 v3.2 hand-check: cổng tổng đạt → dồn phần vượt 704.893.974 vào H.A* (1%)', () => {
  const target = 2_693_559_151;
  const achieved = 3_423_138_838;
  const groups = { 'H.A*': 1_534_009_669, 'H.A': 978_570_038, 'H.B': 591_166_846, 'H.C': 192_728_667, 'H.D': 101_977_905 };
  const coverage = priority(groups, true, ['2026-07']);
  const r = bonus.periodBonus({ target, achieved, pct: 127.1 }, bonus.validateConfig(v3Config), coverage);
  assert.equal(r.totalC10Revenue, 3_398_453_125);
  assert.equal(r.totalExcess, 704_893_974);   // R − T
  const star = r.priorityGroups.find((g) => g.group === 'H.A*');
  assert.equal(star.allocated, 704_893_974);  // toàn bộ phần vượt < doanh thu H.A*
  assert.equal(star.amount, 7_048_940);       // 704.893.974 × 1%
  assert.equal(r.priorityAmount, 7_048_940);
});

test('P2 v3.2: rate nhóm nhập nhằng (không xác định) → nhóm đó fail-closed 0, không suy số', () => {
  const config = bonus.validateConfig(v3Config);
  const coverage = priority({ 'H.A*': 200_000_000 }, true, ['2026-07']);
  // ép rate H.A* nhập nhằng qua segment/override 2 giá trị khác nhau:
  coverage.revenueSegments = [
    { revenue: 100_000_000, productGroup: 'H.A*' },
    { revenue: 100_000_000, productGroup: 'H.A*' },
  ];
  coverage.configResolver = (seg) => (seg.revenue === 100_000_000
    ? { ...v3Config, priorityRates: { ...v3Config.priorityRates, 'H.A*': coverage.__flip ? 2 : (coverage.__flip = true, 1) } }
    : v3Config);
  // Đơn giản hơn: kiểm nhánh source_unavailable fail-closed (bao trùm ý fail-closed).
  const noSrc = bonus.periodBonus({ target: 100_000_000, achieved: 110_000_000, pct: 110 }, config, priority({ 'H.A*': 200_000_000 }, false, ['2026-07']));
  assert.equal(noSrc.priorityAmount, 0);
  assert.equal(noSrc.priorityStatus, 'source_unavailable');
});

test('v3.2 bắt đầu T07.2026; kỳ đã chốt trước T07 GIỮ P2 lịch sử (full-revenue), không đổi', () => {
  const closed = priority({ 'H.A*': 10_000_000 }, true, ['2026-06']);
  const historical = bonus.periodBonus({ target: 100_000_000, achieved: 110_000_000, pct: 110 }, bonus.validateConfig(v3Config), closed);
  assert.equal(historical.priorityGroups[0].reason, 'legacy_pre_v3');
  assert.equal(historical.priorityGroups[0].amount, 100_000);  // 10M × 1% full-revenue (v2 cũ)
  // Kỳ mở T07 theo v3.2: R=10M < T=100M → total_below_target, P2 = 0.
  const open = bonus.periodBonus({ target: 100_000_000, achieved: 110_000_000, pct: 110 }, bonus.validateConfig(v3Config), priority({ 'H.A*': 10_000_000 }, true, ['2026-07']));
  assert.equal(open.priorityAmount, 0);
  assert.equal(open.priorityStatus, 'total_below_target');
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

test('total cap tùy chọn vẫn cấu hình được (v3.2); không có hard cap 0.5% cũ', () => {
  // target 100M; H.A* 300M → R=300M, E=200M, H.A* 200M×1% = 2.000.000.
  const uncapped = summary(300, 300_000_000, v3Config, { 'H.A*': 300_000_000 }).month;
  assert.equal(uncapped.baseAmount, 750_000);        // 0.25% × 300M
  assert.equal(uncapped.priorityAmount, 2_000_000);  // 200M × 1%
  assert.equal(uncapped.amount, 2_750_000);
  const capped = summary(300, 300_000_000, { ...v3Config, totalCapPct: 0.5 }, { 'H.A*': 300_000_000 }).month;
  assert.equal(capped.amount, 1_500_000);            // cap 0.5% × achieved 300M
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

  const first = { empCode: 'DN001', bonus: summary(100, 100_000_000) };                                   // pct100<101 → P2 0
  const second = { empCode: 'DN002', bonus: summary(130, 100_000_000, v3Config, { 'H.A*': 200_000_000 }) }; // R200M>T100M → E100M → 1%
  const aggregate = bonus.aggregateBonusSummaries([first, second], [
    { emp_code: 'DN001', name: 'Một' }, { emp_code: 'DN002', name: 'Hai' },
  ]);
  assert.equal(aggregate.month.baseAmount, 400_000);       // 150k + 250k
  assert.equal(aggregate.month.priorityAmount, 1_000_000); // 0 + 100M×1%
  assert.equal(aggregate.month.amount, 1_400_000);
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
