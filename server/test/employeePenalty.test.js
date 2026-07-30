'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const penalty = require('../src/employeePenalty');
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
  assert.equal(out.appliedAmount, 0);
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
  const gross = penalty.buildXuPenalty({ config: xuConfig, empCode: 'DN001', asOf: '2026-09-30', scoreFn, priorBookedAdjustment: 0 });
  assert.equal(gross.checkpoint.adjustment.quarter_total_estimated, 600_000);
  assert.equal(gross.amount, 600_000);
  const booked = penalty.buildXuPenalty({ config: xuConfig, empCode: 'DN001', asOf: '2026-09-30', scoreFn, priorBookedAdjustment: 600_000 });
  assert.equal(booked.amount, 0);
  const configured = penalty.buildXuPenalty({
    config: { ...xuConfig, xuPenalty: { enabled: true, perMissingXu: 400_000 } },
    empCode: 'DN001', asOf: '2026-09-30', scoreFn, priorBookedAdjustment: 0,
  });
  assert.equal(configured.amount, 800_000);
});

test('employee-cost service route attaches backend penalty using self-scoped payload data', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  const service = /async function employeeCostPayload[\s\S]*?\n}\n\nfunction employeeCostTableOptions/.exec(source)?.[0] || '';
  assert.match(service, /resolveScopedEmployee/);
  assert.match(service, /employeePenalty\.buildPenalty/);
  assert.match(service, /c45Amount: costPeriod\?\.summary\?\.columnTotals/);
  // Payload phạt do backend trả nguyên vẹn, chỉ ĐÍNH THÊM phần diễn giải (tên cột
  // C45 + bảng ngữ cảnh) sinh từ config ở backend — không tính lại tiền, không để
  // frontend tự viết mốc %/tỷ lệ (CEO chốt 30/07).
  assert.match(service, /penalty: penalty \? \{\s*\n\s*\.\.\.penalty,/);
  assert.match(service, /c45Label: penaltyDisplay\.C45_LABEL/);
  assert.match(service, /tiers: penaltyDisplay\.tierTable\(resolvedBonusConfig/);
  assert.match(service, /afterPenaltyTotal/);
});

test('bảng ngữ cảnh phạt sinh từ config, không ghi mốc %/tỷ lệ vào JSX', () => {
  const penaltyDisplay = require('../src/penaltyDisplay');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json'), 'utf8'));
  const tiers = penaltyDisplay.tierTable(config, { activeTier: 't70_90', achieved: 1_000_000_000, c45Amount: 5_000_000 });
  assert.equal(tiers.length, 4);
  assert.deepEqual(tiers.map((tier) => tier.tier), ['none', 't70_90', 't50_70', 'drop_c45']);
  assert.equal(tiers.filter((tier) => tier.active).length, 1);
  // Mọi bậc phải nói rõ trừ ở cột nào bằng TÊN CỘT, không chỉ mã "C45".
  assert.match(tiers.find((tier) => tier.tier === 'drop_c45').effect, /Lương tăng thêm/);
  assert.match(tiers.find((tier) => tier.tier === 't70_90').effect, /Lương tăng thêm/);
  assert.match(tiers.find((tier) => tier.tier === 'drop_c45').range, /Bằng hoặc dưới 50%/);
  assert.match(tiers.find((tier) => tier.tier === 't50_70').range, /Trên 50% đến dưới 70%/);
  assert.match(tiers.find((tier) => tier.tier === 't70_90').range, /Từ 70% đến dưới 90%/);
  assert.match(tiers.find((tier) => tier.tier === 'none').range, /Từ 90% trở lên/);
  // Ví dụ tiền chỉ hiện cho bậc đang đứng và phải là 0,2% × doanh thu thật.
  assert.match(tiers.find((tier) => tier.tier === 't70_90').example, /2\.000\.000đ/);
  assert.equal(tiers.find((tier) => tier.tier === 'none').example, '');
  // Sửa mốc trong config thì chữ đổi theo, không cần sửa code/JSX.
  const moved = penaltyDisplay.tierTable({
    ...config,
    penaltyTiers: config.penaltyTiers.map((tier) => (tier.tier === 't70_90' ? { ...tier, toPct: 95 } : tier)),
  }, {});
  assert.match(moved.find((tier) => tier.tier === 't70_90').range, /đến dưới 95%/);
});

test('tổng hợp phạt toàn đội chỉ CỘNG số đã tính riêng, không coi thiếu dữ liệu là 0đ', () => {
  const aggregateModule = require('../src/employeePenaltyAggregate');
  const items = [
    { empCode: 'DN001', employeeName: 'A', mode: 'enforced', tier: 't70_90', targetPct: 72, targetAmount: 1_000_000, total: 1_000_000, appliedAmount: 1_000_000, c45Amount: 4_000_000, xuAmount: null, warning: { revenueGap: 9_000_000 } },
    { empCode: 'DN002', employeeName: 'B', mode: 'enforced', tier: 'drop_c45', targetPct: 41, targetAmount: 3_000_000, total: 3_000_000, appliedAmount: 3_000_000, c45Amount: 3_000_000, c45Dropped: true, xuAmount: null },
    { empCode: 'DN003', employeeName: 'C', mode: 'enforced', tier: 'none', targetPct: 118, targetAmount: 0, total: 0, appliedAmount: 0, c45Amount: 2_000_000, xuAmount: null },
    // C45 chưa về ⇒ total null ⇒ KHÔNG được cộng thành 0đ, phải đếm là còn thiếu.
    { empCode: 'DN004', employeeName: 'D', mode: 'enforced', tier: 't50_70', targetPct: 55, targetAmount: null, total: null, appliedAmount: 0, c45Amount: null, xuAmount: null },
  ];
  const result = aggregateModule.aggregate({ penalties: items, periodTotal: 100_000_000 });
  assert.equal(result.aggregate, true);
  assert.equal(result.available, true);
  assert.equal(result.employees, 4);
  assert.equal(result.counted, 3);
  assert.equal(result.missing, 1);
  assert.equal(result.incomplete, true);
  assert.equal(result.total, 4_000_000);
  assert.equal(result.appliedAmount, 4_000_000);
  assert.equal(result.afterPenaltyTotal, 96_000_000);
  assert.equal(result.c45DroppedCount, 1);
  assert.equal(result.tierCounts.drop_c45, 1);
  assert.equal(result.tierAmounts.t70_90, 1_000_000);
  assert.equal(result.atRisk.length, 3);
  assert.equal(result.atRisk[0].empCode, 'DN002');
  // Tổng gốc bị khoá (coverage thấp) thì không suy ra tổng sau phạt.
  assert.equal(aggregateModule.aggregate({ penalties: items, periodTotal: null }).afterPenaltyTotal, null);
  const empty = aggregateModule.aggregate({ penalties: [] });
  assert.equal(empty.available, false);
  assert.equal(empty.total, null);
});

test('màn "Tất cả NV" nhận tổng hợp phạt từ backend, frontend không tự cộng', () => {
  const table = fs.readFileSync(path.join(__dirname, '..', 'src', 'employeeCostTable.js'), 'utf8');
  assert.match(table, /employeePenaltyAggregate\.aggregate\(\{/);
  assert.match(table, /options\.allEmployees\s*\n?\s*\?\s*employeePenaltyAggregate\.aggregate/);
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'pages', 'EmployeeCost.jsx'), 'utf8');
  const kpiGrid = /const columnKpis[\s\S]*?<\/div>\n\n    \{targetModalOpen/.exec(page)?.[0] || page;
  // Không còn ô nào ghi "Chọn 1 NV" cho 4 ô phạt/chi phí sau phạt.
  assert.doesNotMatch(kpiGrid, /label="Phạt dự kiến" value="Chọn 1 NV"/);
  assert.match(kpiGrid, /<AggregateAfterPenaltyKpi penalty=\{model\.penalty\}/);
  assert.match(kpiGrid, /<AggregatePenaltyKpi penalty=\{model\.penalty\}/);
  assert.match(kpiGrid, /<AggregateXuPenaltyKpi penalty=\{model\.penalty\}/);
  // Frontend chỉ đọc số backend cộng sẵn: không có phép cộng dồn phạt ở JSX.
  const aggregateComponents = /function AggregatePenaltyKpi[\s\S]*?function AggregatePenaltyDetailModal/.exec(page)?.[0] || '';
  assert.doesNotMatch(aggregateComponents, /reduce\(/);
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
