'use strict';

/**
 * Ba KPI sức khoẻ hàng cuối màn Chi phí của tôi — chỉ dành cho payload ALL.
 *
 * Backend sở hữu toàn bộ phép tính và chuỗi hiển thị. Frontend chỉ render `cards`.
 * Mọi đầu vào thiếu/mâu thuẫn đều fail closed; không biến null thành 0.
 */
const employeeCostTable = require('./employeeCostTable');
const syncExceptionCatalog = require('./syncExceptionCatalog');
const vnWorkingDays = require('./vnWorkingDays');

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function rounded(value) {
  const number = finite(value);
  return number == null ? null : Math.round(number);
}
function sum(list, selector) {
  return list.reduce((total, item, index) => total + Number(selector(item, index) || 0), 0);
}
function money(value) {
  const number = rounded(value);
  return number == null ? '—' : `${number.toLocaleString('vi-VN')}đ`;
}
function percent(value) {
  const number = finite(value);
  return number == null ? '—' : `${number.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function signedPoints(value) {
  const number = finite(value);
  if (number == null) return '—';
  const sign = number > 0 ? '+' : number < 0 ? '−' : '±';
  return `${sign}${Math.abs(number).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} điểm`;
}
function monthLabel(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  return match ? `T${match[2]}` : 'kỳ trước';
}
function previousMonth(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}
function unavailableCard(key, label, reason, extra = {}) {
  return { key, label, available: false, value: '—', sub: String(reason || 'chưa đủ dữ liệu'), tone: 'employee-cost-tone-neutral', ...extra };
}
function sourceRevenue(row) {
  const raw = row?.revenue ?? row?.tong_tien ?? row?.REVENUE ?? row?.TONG_TIEN;
  return finite(raw);
}
function sourceLineId(row, index) {
  return String(row?.source_line_id ?? row?.line_id ?? row?.SOURCE_LINE_ID ?? row?.LINE_ID ?? `source-${index + 1}`).trim();
}
function sourceKey(row, index) {
  const lineId = sourceLineId(row, index);
  // Actual materialized rows have durable source_line_id. The fallback deliberately
  // includes the index: if a legacy row cannot be reconciled, the balance invariant
  // fails closed instead of merging two transactions with coincident dimensions.
  return lineId || `source-${index + 1}`;
}
function teamLineKey(row, index) {
  return String(row?.sourceLineId || `team-${index + 1}`).trim();
}
function quarantined(row = {}) {
  return String(row.emp_code || row.empCode || '').trim().toUpperCase() === 'UNALLOCATED'
    || String(row.attribution_status || row.attributionStatus || '').toUpperCase().includes('QUARANTINED');
}

function periodFacts(period) {
  if (!period || typeof period !== 'object') return null;
  const rows = Array.isArray(period.rows) ? period.rows : [];
  const columns = Array.isArray(period.columns) ? period.columns : [];
  const summary = employeeCostTable.summarizeRows(rows, columns, period.summary);
  return { period: String(period.period || ''), rows, columns, summary };
}

function buildCostRevenueRatio({ currentPeriod, previousPeriod, penalty, snapshotConsistent = true } = {}) {
  const current = periodFacts(currentPeriod);
  if (!snapshotConsistent) return unavailableCard('costRevenueRatio', 'CP/DT · hiệu quả chi phí', 'snapshot lệch — bấm Làm mới');
  if (!current || current.summary.reliable !== true || finite(current.summary.monthlyTotal) == null) {
    return unavailableCard('costRevenueRatio', 'CP/DT · hiệu quả chi phí', 'chưa đủ nguồn chi phí gốc');
  }
  const cost = finite(current.summary.monthlyTotal);
  const revenue = finite(current.summary.revenueBeforeVatTotal);
  if (revenue == null || revenue <= 0) {
    return unavailableCard('costRevenueRatio', 'CP/DT · hiệu quả chi phí', 'chưa có doanh thu chưa VAT đã phân bổ');
  }
  const ratioPct = +(cost / revenue * 100).toFixed(1);
  const expectedPrevious = previousMonth(current.period);
  const previous = periodFacts(previousPeriod);
  let comparison = 'kỳ trước: —';
  let previousPct = null;
  let deltaPoints = null;
  if (previous && previous.period === expectedPrevious && previous.summary.reliable === true) {
    const previousCost = finite(previous.summary.monthlyTotal);
    const previousRevenue = finite(previous.summary.revenueBeforeVatTotal);
    if (previousCost != null && previousRevenue != null && previousRevenue > 0) {
      previousPct = +(previousCost / previousRevenue * 100).toFixed(1);
      deltaPoints = +(ratioPct - previousPct).toFixed(1);
      comparison = `${monthLabel(previous.period)}: ${percent(previousPct)} → ${signedPoints(deltaPoints)}`;
    }
  }
  const afterPenaltyTotal = penalty?.complete === true ? finite(penalty.afterPenaltyTotal) : null;
  const afterPenaltyPct = afterPenaltyTotal == null ? null : +(afterPenaltyTotal / revenue * 100).toFixed(1);
  const sub = [
    afterPenaltyPct == null ? 'chi phí gốc' : `sau phạt: ${percent(afterPenaltyPct)}`,
    comparison,
  ].join(' · ');
  return {
    key: 'costRevenueRatio',
    label: 'CP/DT · hiệu quả chi phí',
    available: true,
    value: percent(ratioPct),
    sub,
    tone: 'employee-cost-tone-base',
    raw: { cost, allocatedRevenueBeforeVat: revenue, ratioPct, previousPeriod: expectedPrevious, previousPct, deltaPoints, afterPenaltyPct },
  };
}

function incompleteLineIds(syncReport) {
  const rows = Array.isArray(syncReport?.rows) ? syncReport.rows : [];
  return new Set(rows.filter((row) => row?.group === syncExceptionCatalog.INCOMPLETE)
    .map((row) => String(row.lineId || '').trim()).filter(Boolean));
}

function buildUnallocatedRevenue({ sourceRows = [], currentPeriod, syncReport = null, sourceAvailable = true, snapshotConsistent = true } = {}) {
  if (!sourceAvailable || !Array.isArray(sourceRows)) {
    return unavailableCard('unallocatedRevenue', 'Doanh thu chưa phân bổ NV', 'chưa lấy được nguồn');
  }
  if (!snapshotConsistent) {
    return unavailableCard('unallocatedRevenue', 'Doanh thu chưa phân bổ NV', 'snapshot lệch — bấm Làm mới');
  }
  const current = periodFacts(currentPeriod);
  if (!current) return unavailableCard('unallocatedRevenue', 'Doanh thu chưa phân bổ NV', 'chưa lấy được nguồn');
  const sourceAmounts = sourceRows.map(sourceRevenue);
  if (sourceAmounts.some((value) => value == null)) {
    return unavailableCard('unallocatedRevenue', 'Doanh thu chưa phân bổ NV', 'chưa lấy được nguồn');
  }
  // Ô chưa phân bổ đối soát với tổng doanh thu App Sale ĐÃ GỒM VAT. Đây là lý do
  // ca DH479816174 phải hiện đúng 1.795.600đ (không phải số đã chia VAT). CP/DT ở
  // ô bên cạnh mới dùng doanh thu chưa VAT.
  const allocatedAmounts = current.rows.map((row) => finite(row?.revenue));
  if (allocatedAmounts.some((value) => value == null)) {
    return unavailableCard('unallocatedRevenue', 'Doanh thu chưa phân bổ NV', 'chưa lấy được nguồn');
  }

  const allocatedIds = new Set(current.rows.map(teamLineKey).filter(Boolean));
  const incompleteIds = incompleteLineIds(syncReport);
  const classified = [];
  const unexplained = [];
  sourceRows.forEach((row, index) => {
    const key = sourceKey(row, index);
    if (allocatedIds.has(key)) return;
    if (quarantined(row)) classified.push({ row, index, key, category: 'quarantine' });
    else if (incompleteIds.has(key)) classified.push({ row, index, key, category: 'incomplete' });
    else unexplained.push({ row, index, key });
  });

  const sourceTotal = sum(sourceAmounts, (amount) => amount);
  const allocatedTotal = sum(allocatedAmounts, (amount) => amount);
  const quarantineRows = classified.filter((item) => item.category === 'quarantine');
  const incompleteRows = classified.filter((item) => item.category === 'incomplete');
  const amountOf = (item) => sourceRevenue(item.row);
  const quarantineAmount = sum(quarantineRows, amountOf);
  const incompleteAmount = sum(incompleteRows, amountOf);
  const total = quarantineAmount + incompleteAmount;
  const amountDiff = sourceTotal - allocatedTotal - total;
  const rowDiff = sourceRows.length - current.rows.length - classified.length;
  // Revenue can contain fractional đồng after removing VAT. The invariant is exact
  // to less than one đồng; display remains rounded to whole đồng like the rest of UI.
  const balanced = unexplained.length === 0 && Math.abs(amountDiff) < 1 && rowDiff === 0;
  if (!balanced) {
    return unavailableCard('unallocatedRevenue', 'Doanh thu chưa phân bổ NV', 'tổng chưa cân', {
      raw: { sourceTotal, allocatedTotal, unallocatedTotal: total, amountDiff, rowDiff, unexplainedRows: unexplained.length },
    });
  }
  const rows = classified.length;
  return {
    key: 'unallocatedRevenue',
    label: 'Doanh thu chưa phân bổ NV',
    available: true,
    value: `${money(total)} · ${rows.toLocaleString('vi-VN')} dòng`,
    sub: `cách ly: ${money(quarantineAmount)} · thiếu danh mục: ${money(incompleteAmount)}`,
    tone: total === 0 && rows === 0 ? 'employee-cost-tone-neutral' : 'employee-cost-tone-penalty-soft',
    action: 'open_data_quality',
    raw: {
      amount: rounded(total), rows,
      quarantineAmount: rounded(quarantineAmount), quarantineRows: quarantineRows.length,
      incompleteAmount: rounded(incompleteAmount), incompleteRows: incompleteRows.length,
      sourceTotal: rounded(sourceTotal), allocatedTotal: rounded(allocatedTotal),
      amountDiff, rowDiff, balanced: true,
    },
  };
}

function monthEndLabel(period) {
  const bounds = vnWorkingDays.monthBounds(period);
  return `${bounds.to.slice(8, 10)}/${bounds.to.slice(5, 7)}`;
}

function buildTargetForecast({ period, today, currentRevenue, target, sourceAvailable = true } = {}) {
  const current = finite(currentRevenue);
  const assignedTarget = finite(target);
  if (!sourceAvailable || current == null) return unavailableCard('targetForecast', 'Dự báo đạt target cuối tháng', 'chưa lấy được nguồn');
  if (assignedTarget == null || assignedTarget <= 0) return unavailableCard('targetForecast', 'Dự báo đạt target cuối tháng', 'kỳ chưa có target');
  let totalWorkingDays; let elapsedWorkingDays; let remainingWorkingDays; let calendar;
  try {
    totalWorkingDays = vnWorkingDays.workingDaysInMonth(period);
    elapsedWorkingDays = vnWorkingDays.workingDaysElapsed(period, today);
    remainingWorkingDays = vnWorkingDays.workingDaysRemaining(period, today);
    calendar = vnWorkingDays.calendarStatus(Number(String(period).slice(0, 4)));
  } catch {
    return unavailableCard('targetForecast', 'Dự báo đạt target cuối tháng', 'kỳ hoặc ngày dự báo không hợp lệ');
  }
  const warning = calendar.calendarMissing ? `⚠ chưa nạp lịch nghỉ lễ ${calendar.year}` : '';
  if (elapsedWorkingDays <= 0) {
    return unavailableCard('targetForecast', 'Dự báo đạt target cuối tháng', ['chưa đủ ngày để dự báo', warning].filter(Boolean).join(' · '), {
      raw: { target: assignedTarget, currentRevenue: current, totalWorkingDays, elapsedWorkingDays, remainingWorkingDays, calendarMissing: calendar.calendarMissing },
    });
  }
  const pace = current / elapsedWorkingDays;
  const forecastRevenue = pace * totalWorkingDays;
  const forecastPct = +(forecastRevenue / assignedTarget * 100).toFixed(1);
  const exceededBy = current > assignedTarget ? current - assignedTarget : 0;
  const neededPerWorkingDay = exceededBy > 0 || remainingWorkingDays <= 0
    ? null : Math.max(0, assignedTarget - current) / remainingWorkingDays;
  let sub;
  if (exceededBy > 0) sub = `đã vượt target — +${money(exceededBy)}`;
  else if (remainingWorkingDays > 0) sub = `cần ${money(neededPerWorkingDay)}/ngày làm việc · còn ${remainingWorkingDays.toLocaleString('vi-VN')} ngày làm việc (tới hết ${monthEndLabel(period)})`;
  else sub = `đã hết ngày làm việc · còn thiếu ${money(Math.max(0, assignedTarget - current))}`;
  if (warning) sub = `${sub} · ${warning}`;
  return {
    key: 'targetForecast',
    label: 'Dự báo đạt target cuối tháng',
    available: true,
    value: `Dự báo: ~${percent(forecastPct)} target`,
    sub,
    tone: forecastPct >= 100 ? 'employee-cost-tone-target' : 'employee-cost-tone-neutral',
    raw: {
      period, today, target: rounded(assignedTarget), currentRevenue: rounded(current),
      pacePerElapsedWorkingDay: rounded(pace), forecastRevenue: rounded(forecastRevenue), forecastPct,
      neededPerWorkingDay: rounded(neededPerWorkingDay), exceededBy: rounded(exceededBy),
      totalWorkingDays, elapsedWorkingDays, remainingWorkingDays,
      calendarMissing: calendar.calendarMissing, calendarYear: calendar.year,
    },
  };
}

function buildEmployeeCostHealthKpis({
  period,
  today,
  currentPeriod,
  previousPeriod,
  penalty,
  sourceRows,
  syncReport,
  sourceAvailable,
  snapshotConsistent,
  target,
} = {}) {
  const currentFacts = periodFacts(currentPeriod);
  const currentRevenue = currentFacts?.summary?.revenueBeforeVatTotal;
  const ratioCard = buildCostRevenueRatio({ currentPeriod, previousPeriod, penalty, snapshotConsistent });
  const unallocatedCard = buildUnallocatedRevenue({ sourceRows, currentPeriod, syncReport, sourceAvailable, snapshotConsistent });
  // Chỉ dự báo khi phép cân nguồn ở ô chưa phân bổ đã PASS. Nếu một NV bị timeout
  // hoặc một dòng biến mất, doanh thu phân bổ trong merged bị thấp giả và dự báo
  // cũng phải fail closed theo, dù store nguồn vẫn đọc được.
  const forecastCard = buildTargetForecast({
    period, today, currentRevenue, target,
    sourceAvailable: sourceAvailable && snapshotConsistent && unallocatedCard.available === true,
  });
  return { period: String(period || ''), today: String(today || ''), backendOwned: true, cards: [ratioCard, unallocatedCard, forecastCard] };
}

module.exports = {
  finite,
  previousMonth,
  periodFacts,
  buildCostRevenueRatio,
  buildUnallocatedRevenue,
  buildTargetForecast,
  buildEmployeeCostHealthKpis,
};
