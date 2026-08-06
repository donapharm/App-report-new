'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCostRevenueRatio,
  buildUnallocatedRevenue,
  buildTargetForecast,
  buildEmployeeCostHealthKpis,
} = require('../src/employeeCostHealthKpis');

function costPeriod(period = '2026-08', {
  cost = 286_350_733,
  beforeVat = 3_860_878_168,
  revenue = 4_246_965_985,
  reliable = true,
  lineId = 'L1',
} = {}) {
  return {
    period,
    columns: [{ key: 'c33', label: 'C33' }],
    rows: [{
      sourceLineId: lineId,
      revenue,
      revenueBeforeVat: beforeVat,
      rowMonthlyTotal: cost,
      rowAnnualTotal: 0,
      amounts: { c33: cost },
    }],
    summary: { reliable },
  };
}

test('CP/DT dùng đúng hai vế cùng snapshot và so kỳ trước theo điểm phần trăm', () => {
  const card = buildCostRevenueRatio({
    currentPeriod: costPeriod(),
    previousPeriod: costPeriod('2026-07', { cost: 80, beforeVat: 1_000, revenue: 1_100 }),
    penalty: { complete: true, afterPenaltyTotal: 270_000_000 },
    snapshotConsistent: true,
  });
  assert.equal(card.available, true);
  assert.equal(card.raw.ratioPct, 7.4);
  assert.equal(card.raw.previousPct, 8);
  assert.equal(card.raw.deltaPoints, -0.6);
  assert.equal(card.raw.afterPenaltyPct, 7);
  assert.match(card.value, /7,4%/);
  assert.match(card.sub, /T07: 8,0%/);
});

test('CP/DT fail closed khi thiếu một vế hoặc hai snapshot lệch; không hiện 0% giả', () => {
  const missing = buildCostRevenueRatio({ currentPeriod: costPeriod('2026-08', { reliable: false }) });
  assert.equal(missing.available, false);
  assert.equal(missing.value, '—');
  assert.doesNotMatch(missing.value, /0%/);

  const mismatch = buildCostRevenueRatio({ currentPeriod: costPeriod(), snapshotConsistent: false });
  assert.equal(mismatch.available, false);
  assert.equal(mismatch.value, '—');
  assert.equal(mismatch.sub, 'snapshot lệch — bấm Làm mới');
});

test('doanh thu chưa phân bổ dựng lại ca DH479816174 đúng 1.795.600đ · 1 dòng và cân tổng', () => {
  const currentPeriod = costPeriod('2026-08', { cost: 100, beforeVat: 1_000, revenue: 1_100, lineId: 'ALLOCATED-1' });
  const sourceRows = [
    { source_line_id: 'ALLOCATED-1', emp_code: 'DN001', revenue: 1_100 },
    { source_line_id: 'DH479816174', emp_code: 'UNALLOCATED', attribution_status: 'ROSTER_CONFLICT_QUARANTINED', revenue: 1_795_600 },
  ];
  const card = buildUnallocatedRevenue({ sourceRows, currentPeriod, sourceAvailable: true, snapshotConsistent: true });
  assert.equal(card.available, true);
  assert.equal(card.raw.amount, 1_795_600);
  assert.equal(card.raw.rows, 1);
  assert.equal(card.raw.quarantineRows, 1);
  assert.equal(card.raw.incompleteRows, 0);
  assert.equal(card.raw.balanced, true);
  assert.equal(card.value, '1.795.600đ · 1 dòng');
});

test('doanh thu chưa phân bổ dùng nhóm INCOMPLETE sẵn có và không đếm dòng đã phân bổ', () => {
  const currentPeriod = costPeriod('2026-08', { cost: 100, beforeVat: 1_000, revenue: 1_100, lineId: 'ALLOCATED-1' });
  const sourceRows = [
    { source_line_id: 'ALLOCATED-1', emp_code: 'DN001', revenue: 1_100 },
    { source_line_id: 'MISSING-CATALOG', emp_code: 'DN001', revenue: 500 },
  ];
  const syncReport = { rows: [
    { lineId: 'ALLOCATED-1', group: 'incomplete', amount: 1_100 },
    { lineId: 'MISSING-CATALOG', group: 'incomplete', amount: 500 },
  ] };
  const card = buildUnallocatedRevenue({ sourceRows, currentPeriod, syncReport, sourceAvailable: true, snapshotConsistent: true });
  assert.equal(card.available, true);
  assert.equal(card.raw.amount, 500);
  assert.equal(card.raw.incompleteRows, 1);
  assert.equal(card.raw.quarantineRows, 0);
});

test('doanh thu chưa phân bổ fail closed khi nguồn lỗi hoặc tổng không cân', () => {
  const currentPeriod = costPeriod('2026-08', { cost: 100, beforeVat: 1_000, revenue: 1_100, lineId: 'ALLOCATED-1' });
  const unavailable = buildUnallocatedRevenue({ sourceRows: [], currentPeriod, sourceAvailable: false });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.value, '—');
  assert.equal(unavailable.sub, 'chưa lấy được nguồn');

  const unbalanced = buildUnallocatedRevenue({
    sourceRows: [
      { source_line_id: 'ALLOCATED-1', emp_code: 'DN001', revenue: 1_100 },
      { source_line_id: 'VANISHED', emp_code: 'DN001', revenue: 500 },
    ],
    currentPeriod,
    sourceAvailable: true,
    snapshotConsistent: true,
  });
  assert.equal(unbalanced.available, false);
  assert.equal(unbalanced.value, '—');
  assert.equal(unbalanced.sub, 'tổng chưa cân');
});

test('dự báo fail closed khi mới qua 2/21 ngày làm việc và giữ đủ bốn đầu vào audit', () => {
  const card = buildTargetForecast({
    period: '2026-08', today: '2026-08-05', currentRevenue: 100, target: 1_000,
  });
  assert.equal(card.available, false);
  assert.equal(card.value, '—');
  assert.equal(card.raw.totalWorkingDays, 21);
  assert.equal(card.raw.elapsedWorkingDays, 2);
  assert.equal(card.raw.remainingWorkingDays, 19);
  assert.equal(card.raw.currentRevenue, 100);
  assert.equal(card.raw.target, 1_000);
  assert.equal(card.sub, 'đã qua 2/21 ngày làm việc, chưa đủ để dự báo');
});

test('dự báo bắt đầu ở ngày làm việc thứ 5 và gắn nhãn ước lượng sớm', () => {
  const card = buildTargetForecast({
    period: '2026-08', today: '2026-08-08', currentRevenue: 500, target: 1_000,
  });
  assert.equal(card.available, true);
  assert.equal(card.raw.totalWorkingDays, 21);
  assert.equal(card.raw.elapsedWorkingDays, 5);
  assert.equal(card.raw.currentRevenue, 500);
  assert.equal(card.raw.target, 1_000);
  assert.match(card.value, /Dự báo:/);
  assert.match(card.sub, /ước lượng sớm/);
});

test('dự báo từ ngày làm việc thứ 10 không còn nhãn ước lượng sớm', () => {
  const card = buildTargetForecast({
    period: '2026-08', today: '2026-08-15', currentRevenue: 1_000, target: 2_000,
  });
  assert.equal(card.available, true);
  assert.equal(card.raw.totalWorkingDays, 21);
  assert.equal(card.raw.elapsedWorkingDays, 10);
  assert.match(card.value, /Dự báo:/);
  assert.doesNotMatch(card.sub, /ước lượng sớm/);
});

test('dự báo fail closed đầu tháng và khi không có target; vượt target có nhãn riêng', () => {
  const early = buildTargetForecast({ period: '2026-08', today: '2026-08-01', currentRevenue: 0, target: 1_000 });
  assert.equal(early.available, false);
  assert.equal(early.value, '—');
  assert.match(early.sub, /chưa đủ để dự báo/);

  const noTarget = buildTargetForecast({ period: '2026-08', today: '2026-08-05', currentRevenue: 100, target: null });
  assert.equal(noTarget.available, false);
  assert.equal(noTarget.sub, 'kỳ chưa có target');

  const exceeded = buildTargetForecast({ period: '2026-08', today: '2026-08-15', currentRevenue: 1_100, target: 1_000 });
  assert.equal(exceeded.available, true);
  assert.equal(exceeded.raw.exceededBy, 100);
  assert.equal(exceeded.raw.neededPerWorkingDay, null);
  assert.match(exceeded.sub, /đã vượt target/);
});

test('dự báo năm chưa nạp lịch vẫn trừ cuối tuần và đeo cảnh báo', () => {
  const card = buildTargetForecast({ period: '2027-01', today: '2027-01-09', currentRevenue: 100, target: 1_000 });
  assert.equal(card.available, true);
  assert.equal(card.raw.calendarMissing, true);
  assert.equal(card.raw.elapsedWorkingDays, 5);
  assert.match(card.sub, /ước lượng sớm/);
  assert.match(card.sub, /⚠ chưa nạp lịch nghỉ lễ 2027/);
});

test('payload hợp đồng có đúng ba card backend-owned theo thứ tự spec', () => {
  const currentPeriod = costPeriod('2026-08', { lineId: 'L1' });
  const payload = buildEmployeeCostHealthKpis({
    period: '2026-08', today: '2026-08-15', currentPeriod,
    sourceRows: [{ source_line_id: 'L1', emp_code: 'DN001', revenue: 4_246_965_985 }],
    sourceAvailable: true, snapshotConsistent: true, target: 4_000_000_000,
  });
  assert.equal(payload.backendOwned, true);
  assert.deepEqual(payload.cards.map((card) => card.key), ['costRevenueRatio', 'unallocatedRevenue', 'targetForecast']);
  for (const card of payload.cards) {
    assert.equal(typeof card.value, 'string');
    assert.equal(typeof card.sub, 'string');
  }
});
