'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const penalty = require('../src/employeePenalty');
const penaltyAggregate = require('../src/employeePenaltyAggregate');
const employeeBonus = require('../src/employeeBonus');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json'), 'utf8'));
const build = (overrides = {}) => penalty.buildPenalty({
  period: '2026-08', target: 1_000_000_000, achieved: 780_000_000,
  c45Amount: 7_599_706, costTotal: 42_834_991, config, ...overrides,
});

const rank = { drop_c45: 0, t50_70: 1, t70_90: 2, none: 3 };

function pctCase(pct) {
  return build({ target: 1_000_000_000, achieved: 1_000_000_000 * pct / 100 });
}

test('78%, 1,2 tỷ doanh thu phạt 2,4 triệu; 60% là 0,3%; 95% không phạt', () => {
  const at78 = build({ target: 1_200_000_000 / 0.78, achieved: 1_200_000_000 });
  assert.equal(at78.tier, 't70_90');
  assert.equal(at78.targetAmount, 2_400_000);
  assert.equal(pctCase(60).ratePct, 0.3);
  assert.equal(pctCase(60).targetAmount, 1_800_000);
  assert.equal(pctCase(95).tier, 'none');
  assert.equal(pctCase(95).targetAmount, 0);
});

test('trần target đúng bằng C45 và drop_c45 loại trọn C45 khỏi tổng', () => {
  const capped = build({ achieved: 800_000_000, c45Amount: 500_000 });
  assert.equal(capped.targetAmount, 500_000);
  assert.equal(capped.cappedByC45, true);
  const dropped = pctCase(45);
  assert.equal(dropped.c45Dropped, true);
  assert.equal(dropped.targetAmount, 7_599_706);
  assert.equal(dropped.afterPenaltyTotal, 42_834_991 - 7_599_706);
});

test('mốc chính xác và quét 0..150 không có khe hở', () => {
  assert.equal(pctCase(90).tier, 'none');
  assert.equal(pctCase(70).tier, 't70_90');
  assert.equal(pctCase(50).tier, 'drop_c45');
  assert.equal(pctCase(50.01).tier, 't50_70');
  assert.equal(pctCase(89.5).tier, 't70_90');
  assert.equal(pctCase(69.5).tier, 't50_70');
  assert.equal(pctCase(50.5).tier, 't50_70');
  for (let tenth = 0; tenth <= 1500; tenth += 1) {
    const out = pctCase(tenth / 10);
    assert.ok(Object.hasOwn(rank, out.tier), `unmatched pct ${tenth / 10}`);
  }
});

test('P1/P2 amount paths are unchanged and penalty remains separate', () => {
  const normalized = employeeBonus.loadConfig();
  const input = { target: 1_000_000_000, achieved: 780_000_000, pct: 78 };
  const before = employeeBonus.periodBonus(input, normalized, {});
  const snapshot = { amount: before.amount, baseAmount: before.baseAmount, priorityAmount: before.priorityAmount };
  const out = build();
  const after = employeeBonus.periodBonus(input, normalized, {});
  assert.deepEqual({ amount: after.amount, baseAmount: after.baseAmount, priorityAmount: after.priorityAmount }, snapshot);
  assert.equal(Object.hasOwn(after, 'penaltyAmount'), false);
  assert.equal(out.targetAmount, 1_560_000);
});

test('apply exact recommended gap exits current tier for every pct 0..89.9', () => {
  for (let tenth = 0; tenth <= 899; tenth += 1) {
    const pct = tenth / 10;
    const out = pctCase(pct);
    assert.ok(out.warning, `missing warning at ${pct}`);
    const improved = build({ achieved: 1_000_000_000 * pct / 100 + out.warning.revenueGap });
    assert.ok(rank[improved.tier] > rank[out.tier], `${pct}% + ${out.warning.revenueGap} stayed ${improved.tier}`);
  }
});

test('50% threshold must be exceeded and gap always rounds upward with 1,000 buffer', () => {
  const out = build({ target: 1_000_000_000, achieved: 480_000_000 });
  const newPct = (480_000_000 + out.warning.revenueGap) / 1_000_000_000 * 100;
  assert.ok(newPct > 50);
  const raw = 30_000_001;
  assert.equal(penalty.ceil1k(raw), 30_001_000);
  let seed = 123456789;
  for (let i = 0; i < 200; i += 1) {
    seed = (1103515245 * seed + 12345) & 0x7fffffff;
    const value = seed + 0.37;
    assert.ok(penalty.ceil1k(value) >= value);
  }
});

test('warning chooses nearest threshold and contains all mandatory components', () => {
  assert.equal(pctCase(45).warning.nextThresholdPct, 50);
  assert.equal(pctCase(62).warning.nextThresholdPct, 70);
  assert.equal(pctCase(81).warning.nextThresholdPct, 90);
  assert.equal(pctCase(95).warning, null);
  for (const current of [45, 62, 81]) {
    const warning = pctCase(current).warning;
    assert.match(warning.text, /[\d.]đ/, `money missing at ${current}%`);
    assert.match(warning.text, /giá trị đơn hàng \(trước VAT\)/);
    assert.match(warning.text, new RegExp(`${warning.nextThresholdPct}%`));
    assert.match(warning.text, new RegExp(`${current}%`));
  }
  assert.match(pctCase(45).warning.text, /7\.599\.706đ/);
});

test('warning fail-closes missing target and omits unknown C45 money', () => {
  assert.equal(build({ target: 0 }).warning, null);
  const out = build({ c45Amount: null });
  assert.equal(out.penaltyStatus, 'c45_unavailable');
  assert.equal(out.targetAmount, null);
  assert.equal(out.appliedAmount, null, 'enforced unknown must stay null, never become zero');
  assert.equal(out.afterPenaltyTotal, null);
  assert.equal(out.warning.moneyAtRisk, null);
  assert.match(out.warning.text, /giá trị đơn hàng \(trước VAT\)/);
  assert.doesNotMatch(out.warning.text, /MẤT TRẮNG [\d.]+đ/);
});

test('closed period uses past-tense wording, never tells employee to try harder', () => {
  const out = build({ closed: true, achieved: 450_000_000 });
  assert.match(out.warning.text, /không được tính vào chi phí tháng/);
  assert.doesNotMatch(out.warning.text, /nếu không|cố gắng/i);
  assert.match(out.label, /ĐÃ CHỐT KỲ/);
});

test('period-derived schedule is deterministic and honors emergency off switch', () => {
  const july = build({ period: '2026-07', achieved: 450_000_000 });
  assert.equal(july.mode, 'warn_only');
  assert.equal(july.appliedAmount, 0);
  assert.equal(july.afterPenaltyTotal, 42_834_991);
  assert.equal(july.c45Dropped, false, 'T07 chạy thử không được đánh dấu C45 đã bị loại');
  assert.equal(july.c45WouldDrop, true, 'T07 chỉ giữ cờ riêng cho tình huống giả lập');
  assert.ok(july.warning);
  assert.match(july.label, /chưa trừ tiền/i);
  assert.match(july.label, /01\/08\/2026/);
  const closedJuly = build({ period: '2026-07', achieved: 450_000_000, closed: true });
  assert.equal(closedJuly.appliedAmount, 0);
  assert.match(closedJuly.warning.text, /CHƯA TRỪ TIỀN/);
  assert.match(closedJuly.warning.text, /Kỳ đã đóng/);
  assert.doesNotMatch(closedJuly.warning.text, /không được tính vào chi phí tháng/);
  const august = build({ period: '2026-08', achieved: 450_000_000 });
  assert.equal(august.mode, 'enforced');
  assert.equal(august.c45Dropped, true);
  assert.equal(august.c45WouldDrop, false);
  assert.equal(august.appliedAmount, august.total);
  assert.equal(august.afterPenaltyTotal, 42_834_991 - august.total);
  assert.equal(penalty.resolveMode('2026-07-31', config), 'warn_only');
  assert.equal(penalty.resolveMode('2026-08-01', config), 'enforced');
  for (const fakeNow of ['2026-07-05', '2026-07-31', '2026-08-01', '2026-09-20']) {
    assert.equal(penalty.resolveMode('2026-08', config, fakeNow), 'enforced');
  }
  assert.equal(penalty.resolveMode('2026-09', { ...config, penaltyEnabled: false }), 'off');
});

test('ALL aggregation sums backend employee penalties without inventing a team tier or pct', () => {
  const firstPenalty = build({ period: '2026-07', achieved: 780_000_000, costTotal: 42_834_991 });
  const secondPenalty = build({ period: '2026-07', achieved: 450_000_000, c45Amount: 3_000_000, costTotal: 20_000_000 });
  const aggregate = penaltyAggregate.aggregatePenaltySummaries([
    { empCode: 'DN001', penalty: firstPenalty, summary: { periodTotal: 100_000_000, afterPenaltyTotal: 100_000_000 } },
    { empCode: 'DN002', penalty: secondPenalty, summary: { periodTotal: 60_000_000, afterPenaltyTotal: 60_000_000 } },
  ]);
  assert.equal(aggregate.aggregate, true);
  assert.equal(aggregate.scope, 'team_full_range');
  assert.equal(aggregate.employeeCount, 2);
  assert.equal(aggregate.contributors, 2);
  assert.equal(aggregate.complete, true);
  assert.equal(aggregate.total, firstPenalty.total + secondPenalty.total);
  assert.equal(aggregate.provisionalTotal, aggregate.total);
  assert.equal(aggregate.appliedAmount, 0, 'T07 warn-only must aggregate to zero applied');
  assert.equal(aggregate.baseTotal, 160_000_000);
  assert.equal(aggregate.afterPenaltyTotal, 160_000_000, 'range total comes from report summary, not only final month');
  assert.equal(aggregate.targetPct, null);
  assert.equal(aggregate.ratePct, null);
  assert.equal(aggregate.tier, 'aggregate');
  assert.match(aggregate.formulaText, /backend tính/);
});

test('ALL aggregation keeps incomplete totals null and exposes only an explicit provisional subtotal', () => {
  const known = build({ period: '2026-08', achieved: 780_000_000, costTotal: 40_000_000 });
  const unavailable = build({ period: '2026-08', achieved: 450_000_000, c45Amount: null, costTotal: null });
  const aggregate = penaltyAggregate.aggregatePenaltySummaries([
    { empCode: 'DN001', penalty: known, summary: { periodTotal: 80_000_000, afterPenaltyTotal: 80_000_000 - known.appliedAmount } },
    { empCode: 'DN002', penalty: unavailable, summary: { periodTotal: null, afterPenaltyTotal: null } },
  ]);
  assert.equal(aggregate.total, null);
  assert.equal(aggregate.provisionalTotal, known.total);
  assert.equal(aggregate.appliedAmount, null, 'enforced unknown must not become an applied zero');
  assert.equal(aggregate.provisionalAppliedAmount, known.appliedAmount);
  assert.equal(aggregate.appliedContributors, 1);
  assert.equal(aggregate.complete, false);
  assert.equal(aggregate.contributors, 1);
  assert.equal(aggregate.unavailableCount, 1);
  assert.deepEqual(aggregate.unavailableEmployees, ['DN002']);
  assert.equal(aggregate.baseTotal, null);
  assert.equal(aggregate.afterPenaltyTotal, null);
  assert.match(aggregate.label, /Tạm tính 1\/2 NV/);
});

test('warn-only unknown potential penalty still has exact applied zero and known after-total', () => {
  const known = build({ period: '2026-07', achieved: 780_000_000, costTotal: 40_000_000 });
  const unavailable = build({ period: '2026-07', achieved: 450_000_000, c45Amount: null, costTotal: 30_000_000 });
  const aggregate = penaltyAggregate.aggregatePenaltySummaries([
    { empCode: 'DN001', penalty: known, summary: { periodTotal: 40_000_000, afterPenaltyTotal: 40_000_000 } },
    { empCode: 'DN002', penalty: unavailable, summary: { periodTotal: 30_000_000, afterPenaltyTotal: 30_000_000 } },
  ]);
  assert.equal(aggregate.total, null);
  assert.equal(aggregate.appliedAmount, 0);
  assert.equal(aggregate.appliedContributors, 2);
  assert.equal(aggregate.baseTotal, 70_000_000);
  assert.equal(aggregate.afterPenaltyTotal, 70_000_000);
});

test('ALL aggregation preserves C45-drop and Xu disabled/pending/unavailable states', () => {
  const dropped = build({ period: '2026-08', achieved: 450_000_000, c45Amount: 3_000_000, costTotal: 20_000_000 });
  const c45 = penaltyAggregate.aggregatePenaltySummaries([
    { empCode: 'DN001', penalty: dropped, summary: { periodTotal: 20_000_000, afterPenaltyTotal: 17_000_000 } },
  ]);
  assert.equal(c45.c45Dropped, true);
  assert.equal(c45.total, 3_000_000);
  assert.equal(c45.appliedAmount, 3_000_000);

  const base = { ...dropped, total: 3_000_000, appliedAmount: 3_000_000 };
  const xu = penaltyAggregate.aggregatePenaltySummaries([
    { empCode: 'DN001', penalty: { ...base, xuStatus: 'provisional', xuAmount: 600_000, xuMissing: 2 }, summary: { periodTotal: 20_000_000, afterPenaltyTotal: 17_000_000 } },
    { empCode: 'DN002', penalty: { ...base, xuStatus: 'xu_source_unavailable', xuAmount: null, xuMissing: null }, summary: { periodTotal: 20_000_000, afterPenaltyTotal: 17_000_000 } },
    { empCode: 'DN003', penalty: { ...base, xuStatus: 'disabled', xuAmount: null, xuMissing: null }, summary: { periodTotal: 20_000_000, afterPenaltyTotal: 17_000_000 } },
  ]);
  assert.equal(xu.xuStatus, 'partially_unavailable');
  assert.equal(xu.xuAmount, null);
  assert.equal(xu.provisionalXuAmount, 600_000);
  assert.equal(xu.xuEmployeeCount, 2);
  assert.equal(xu.xuContributors, 1);

  const pending = penaltyAggregate.aggregatePenaltySummaries([
    { empCode: 'DN001', penalty: { ...base, xuStatus: 'quarter_pending', xuAmount: null }, summary: { periodTotal: 20_000_000, afterPenaltyTotal: 17_000_000 } },
  ]);
  assert.equal(pending.xuStatus, 'quarter_pending');
  assert.equal(pending.xuAmount, null);

  const xuPendingConfig = { ...config, xuPenalty: { enabled: true, perMissingXu: 300_000 } };
  const pendingPenalty = build({
    period: '2026-08', achieved: 780_000_000, costTotal: 20_000_000,
    config: xuPendingConfig, xu: { amount: null, status: 'quarter_pending', missing: 2 },
  });
  assert.equal(pendingPenalty.total, null);
  assert.ok(pendingPenalty.provisionalTotal > 0);
  const pendingSubtotal = penaltyAggregate.aggregatePenaltySummaries([
    { empCode: 'DN001', penalty: pendingPenalty, summary: { periodTotal: 20_000_000, afterPenaltyTotal: null } },
  ]);
  assert.equal(pendingSubtotal.total, null);
  assert.equal(pendingSubtotal.provisionalTotal, pendingPenalty.provisionalTotal);
  assert.equal(pendingSubtotal.provisionalContributors, 1);
  assert.equal(pendingSubtotal.contributors, 0);
  assert.equal(pendingSubtotal.appliedAmount, null);
  assert.equal(pendingSubtotal.afterPenaltyTotal, null);
  const absent = penaltyAggregate.aggregatePenaltySummaries([
    { empCode: 'DN404', penalty: null, summary: { periodTotal: null, afterPenaltyTotal: null } },
  ]);
  assert.equal(absent.xuStatus, 'partially_unavailable');
  assert.equal(absent.xuAmount, null);
  assert.equal(penaltyAggregate.aggregatePenaltySummaries([]), null, 'empty team remains explicit null, never an invented zero');
});

test('daily C45 drop reconciles exactly to adjusted monthly total', () => {
  const out = build({ achieved: 450_000_000, c45Amount: 3_000, costTotal: 13_000 });
  const period = {
    summary: { monthlyTotal: 13_000 },
    rows: [
      { dailyAmounts: { '2026-08-01': { c45: 1_000 } } },
      { dailyAmounts: { '2026-08-02': { c45: 2_000 } } },
    ],
    daily: { reliable: true, totals: [
      { date: '2026-08-01', monthlyTotal: 5_000 },
      { date: '2026-08-02', monthlyTotal: 8_000 },
    ] },
  };
  const adjusted = penalty.applyToCostPeriod(period, out);
  assert.equal(adjusted.summary.afterPenaltyTotal, 10_000);
  assert.equal(adjusted.daily.totals.reduce((sum, day) => sum + day.penaltyAmount, 0), 3_000);
  assert.equal(adjusted.daily.totals.reduce((sum, day) => sum + day.afterPenaltyTotal, 0), 10_000);
});

test('Xu reuses checkpoint semantics: 2 missing = 600k and prior-booked prevents double charge', () => {
  const xuConfig = { ...config, xuPenalty: { enabled: true, perMissingXu: 300000 } };
  const scoreFn = () => ({ diem_thang: 2, xu_thang: 0, diem_quy: 2, xu_quy: 0, xu_tuan: 0 });
  const gross = penalty.buildXuPenalty({ config: xuConfig, empCode: 'DN002', asOf: '2026-09-30', scoreFn, priorBookedAdjustment: 0 });
  assert.equal(gross.checkpoint.adjustment.quarter_total_estimated, 600_000);
  assert.equal(gross.amount, 600_000);
  const booked = penalty.buildXuPenalty({ config: xuConfig, empCode: 'DN002', asOf: '2026-09-30', scoreFn, priorBookedAdjustment: 600_000 });
  assert.equal(booked.amount, 0);
  const configured = penalty.buildXuPenalty({
    config: { ...xuConfig, xuPenalty: { enabled: true, perMissingXu: 400_000 } },
    empCode: 'DN002', asOf: '2026-09-30', scoreFn, priorBookedAdjustment: 0,
  });
  assert.equal(configured.amount, 800_000);
});

test('phạt Xu fail-closed ngoài allowlist DN002/DN004/DN022', () => {
  const xuConfig = { ...config, xuPenalty: { enabled: true, perMissingXu: 300000 } };
  const scoreFn = () => ({ diem_thang: 2, xu_thang: 0, diem_quy: 2, xu_quy: 0, xu_tuan: 0 });
  for (const empCode of ['DN001', 'DN021', 'DN023', 'VP004', 'VP018']) {
    assert.deepEqual(
      penalty.buildXuPenalty({ config: xuConfig, empCode, asOf: '2026-09-30', scoreFn }),
      { amount: null, status: 'disabled', missing: null, checkpoint: null },
      `${empCode} không được tính phạt Xu`,
    );
  }
});

test('DN022 bỏ toàn bộ phạt target/C45 nhưng vẫn giữ kết quả phạt Xu', () => {
  const out = penalty.buildPenalty({
    empCode: 'DN022', period: '2026-09', target: 1_000_000_000, achieved: 400_000_000,
    c45Amount: 8_000_000, costTotal: 20_000_000, closed: true, config,
    xu: { amount: 600_000, status: 'final', missing: 2 },
  });
  assert.equal(out.mode, 'xu_only');
  assert.equal(out.targetPct, null);
  assert.equal(out.tier, null);
  assert.equal(out.c45Amount, null);
  assert.equal(out.targetAmount, null);
  assert.equal(out.c45Dropped, false);
  assert.equal(out.xuAmount, 600_000);
  assert.equal(out.total, 600_000);
  assert.equal(out.appliedAmount, 600_000);
  assert.equal(out.afterPenaltyTotal, 19_400_000);
  assert.match(out.formulaText, /chờ công thức thưởng\/phạt riêng/i);
});

test('DN021/DN023 không bao giờ sinh phạt dù nguồn target, C45 và Xu đều có số', () => {
  for (const empCode of ['DN021', 'DN023']) {
    const out = build({
      empCode, target: 1_000_000_000, achieved: 100_000_000,
      c45Amount: 20_000_000, costTotal: 50_000_000,
      xu: { amount: 9_000_000, status: 'final', missing: 30 },
    });
    assert.equal(out.mode, 'target_only');
    assert.equal(out.enabled, false);
    assert.equal(out.targetStatus, 'target_only_no_incentive');
    assert.equal(out.penaltyStatus, 'target_only_no_incentive');
    for (const key of ['targetAmount', 'xuAmount', 'total', 'provisionalTotal', 'appliedAmount', 'afterPenaltyTotal']) {
      assert.equal(out[key], null, `${empCode}.${key} phải là unknown/not-applicable, không phải 0 giả`);
    }
    assert.equal(out.warning, null);
  }
});

test('target-only không làm tổng phạt toàn đội thành thiếu dữ liệu', () => {
  const normal = build({ empCode: 'DN001', period: '2026-08', achieved: 780_000_000 });
  const targetOnly = build({ empCode: 'DN021', achieved: 1, c45Amount: 99_000_000 });
  const aggregate = penaltyAggregate.aggregatePenaltySummaries([
    { empCode: 'DN021', penalty: targetOnly, summary: { periodTotal: null, afterPenaltyTotal: null } },
    { empCode: 'DN001', penalty: normal, summary: { periodTotal: 42_834_991, afterPenaltyTotal: 42_834_991 - normal.appliedAmount } },
  ]);
  assert.equal(aggregate.complete, true);
  assert.equal(aggregate.total, normal.total);
  assert.equal(aggregate.policyEmployeeCount, 1);
  assert.equal(aggregate.targetOnlyCount, 1);
  assert.deepEqual(aggregate.targetOnlyEmployees, ['DN021']);
  assert.equal(aggregate.unavailableCount, 0);
});

test('employee-cost service route attaches backend penalty using self-scoped payload data', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  const service = /async function employeeCostPayload[\s\S]*?\n}\n\nfunction employeeCostTableOptions/.exec(source)?.[0] || '';
  assert.match(service, /resolveScopedEmployee/);
  assert.match(service, /employeePenalty\.buildPenalty/);
  assert.match(service, /employeePenalty\.buildPenalty\(\{\s*empCode,/);
  assert.match(service, /c45Amount: costPeriod\?\.summary\?\.columnTotals/);
  // v3.5 chèn `periodClose` giữa bonus và penalty: payload phải mang trạng thái khoá
  // sổ để giao diện dán nhãn DỰ KIẾN/CHÍNH THỨC, nên khoá luôn thứ tự này.
  assert.match(service, /bonus,\s*\n[\s\S]*?periodClose: \{[\s\S]*?\n\s*penalty,/);
  assert.match(service, /afterPenaltyTotal/);
});

test('PENALTY_NOTIFY defaults off without changing existing message builders', () => {
  const notifyPolicy = require('../src/penaltyNotifyPolicy');
  assert.equal(notifyPolicy.enabled({}), false);
  assert.equal(notifyPolicy.enabled({ PENALTY_NOTIFY: '0' }), false);
  assert.equal(notifyPolicy.enabled({ PENALTY_NOTIFY: '1' }), true);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'bonusNotify.js'), 'utf8');
  const builders = source.match(/function messageFor[\s\S]*?function monthEndMessage[\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(builders, /penalty|phạt/i);
});
