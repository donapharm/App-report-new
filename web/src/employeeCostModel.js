export const EMPLOYEE_COST_DIMENSIONS = Object.freeze([
  { key: 'date', label: 'Ngày', kind: 'dimension' },
  { key: 'orderCode', label: 'Mã đơn hàng', kind: 'dimension' },
  { key: 'route', label: 'Tuyến', kind: 'dimension' },
  { key: 'c7', label: 'Đơn vị', kind: 'dimension' },
  { key: 'contractorName', label: 'Nhà thầu', kind: 'dimension' },
  { key: 'c5', label: 'Mã hàng (QLNB)', kind: 'dimension' },
  { key: 'c10', label: 'C10', kind: 'dimension' },
  { key: 'c16', label: 'Tên hàng', kind: 'dimension' },
  { key: 'strength', label: 'Hàm lượng', kind: 'dimension', tooltip: true },
  { key: 'c25', label: 'ĐVT', kind: 'dimension' },
  { key: 'bidPrice', label: 'Giá trúng thầu', kind: 'money' },
  { key: 'quantity', label: 'Số lượng', kind: 'dimension', format: 'number' },
  { key: 'revenueBeforeVat', label: 'Thành tiền xuất bán (trước VAT)', kind: 'money' },
  { key: 'rowMonthlyTotal', label: 'Thành tiền tháng', kind: 'money' },
  { key: 'note', label: 'Ghi chú', kind: 'dimension' },
]);

const FIELD_BY_KEY = new Map(EMPLOYEE_COST_DIMENSIONS.map((column) => [column.key, column]));
const DEFAULT_PREFIX = ['date', 'orderCode', 'route', 'c7', 'contractorName', 'c5', 'c10', 'c16', 'strength', 'c25', 'bidPrice', 'quantity', 'revenueBeforeVat'];
const DEFAULT_SUFFIX = ['rowMonthlyTotal', 'note'];
const BLOCKED = new Set(['c32', 'c47']);
const EMPTY_NOTE = 'chưa có dữ liệu chi phí kỳ này';

export function currentMonthValue(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[2]}/${match[1]}` : String(value || '—');
}

export function isAllowedCostColumn(column) {
  const key = String(column?.key || column || '').trim().toLowerCase();
  const match = /^c(\d+)$/.exec(key);
  if (!match || BLOCKED.has(key)) return false;
  const pos = Number(match[1]);
  return pos >= 33 && pos <= 46;
}

export function buildEmployeeCostColumns(columns = [], template = {}) {
  const costs = new Map();
  for (const raw of Array.isArray(columns) ? columns : []) {
    const key = String(raw?.key || '').trim().toLowerCase();
    if (!isAllowedCostColumn(key) || costs.has(key)) continue;
    costs.set(key, {
      key,
      label: String(raw.label || key),
      shortLabel: key.toUpperCase(),
      kind: 'percent',
      annual: !!raw.annual,
    });
  }
  const requestedLayout = Array.isArray(template?.columns) ? template.columns.map(String) : [];
  // Layout do template quy định sẽ GHI ĐÈ danh sách mặc định. Template hiện hành
  // (FULL-TIME/PART-TIME) chưa liệt kê 'c10' nên cột C10 không bao giờ hiện dù đã
  // khai báo ở DEFAULT_PREFIX. C10 là căn cứ chia thưởng P2 (CEO 27/07) nên phải
  // luôn có: chèn ngay SAU 'c5' (mã QLNB) khi template thiếu.
  if (requestedLayout.length && !requestedLayout.includes('c10')) {
    const at = requestedLayout.indexOf('c5');
    if (at >= 0) requestedLayout.splice(at + 1, 0, 'c10');
  }
  const layout = requestedLayout.length ? requestedLayout : [...DEFAULT_PREFIX, ...costs.keys(), ...DEFAULT_SUFFIX];
  const seen = new Set();
  const result = [];
  for (const rawKey of layout) {
    const key = isAllowedCostColumn(rawKey) ? String(rawKey).toLowerCase() : String(rawKey);
    if (seen.has(key)) continue;
    const column = costs.get(key) || FIELD_BY_KEY.get(key);
    if (!column) continue;
    seen.add(key);
    result.push({ ...column });
  }
  return result;
}

export function formatEmployeeCostCell(value, column = {}) {
  if (value == null || value === '') return '—';
  if (column.key === 'date') return String(value).split('-').reverse().join('/');
  const number = Number(value);
  if (column.format === 'money' || column.kind === 'money') {
    return Number.isFinite(number) ? number.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ' : String(value);
  }
  if (column.format === 'number') {
    return Number.isFinite(number) ? number.toLocaleString('vi-VN', { maximumFractionDigits: 4 }) : String(value);
  }
  if (column.kind === 'dimension') return String(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: 1,
    maximumFractionDigits: 4,
  });
}

export function formatMatchRate(match = {}) {
  if (match.rate == null || match.rate === '') return '—';
  const rate = Number(match.rate);
  return Number.isFinite(rate) ? rate.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—';
}

export function employeeCostKpiMatch(model = {}) {
  const fallback = model.match || {};
  if (!model.allEmployees) return fallback;
  const periodMatches = (Array.isArray(model.periods) ? model.periods : [])
    .map((period) => period?.match)
    .filter(Boolean);
  if (!periodMatches.length) return fallback;
  if (periodMatches.length === 1) return periodMatches[0];
  const matchedRows = periodMatches.reduce((sum, match) => sum + Number(match.matchedRows || 0), 0);
  const totalRows = periodMatches.reduce((sum, match) => sum + Number(match.totalRows || 0), 0);
  const unavailablePairs = periodMatches.reduce((sum, match) => sum + Number(match.unavailablePairs || 0), 0);
  const unavailableEmployees = [...new Set(periodMatches.flatMap((match) => Array.isArray(match.unavailableEmployees) ? match.unavailableEmployees.map(String) : []))].sort();
  const unavailableEmployeeCount = unavailableEmployees.length
    || Math.max(0, ...periodMatches.map((match) => Number(match.unavailableEmployeeCount || 0)));
  const threshold = Number(periodMatches.find((match) => Number.isFinite(Number(match.threshold)))?.threshold ?? 90);
  const rate = totalRows ? +(matchedRows / totalRows * 100).toFixed(1) : null;
  return { matchedRows, totalRows, rate, threshold, low: rate != null && rate < threshold, unavailablePairs, unavailableEmployeeCount, unavailableEmployees };
}

function normalizedMatch(rawMatch = {}, rowCount = 0) {
  return {
    matchedRows: Number(rawMatch.matchedRows || 0),
    totalRows: Number(rawMatch.totalRows ?? rowCount),
    rate: rawMatch.rate == null ? null : Number(rawMatch.rate),
    threshold: Number(rawMatch.threshold ?? 90),
    low: !!rawMatch.low,
    // Cặp thuộc NV chưa lấy được nguồn tỷ lệ — KHÔNG phải catalog thiếu %.
    // Nêu ĐÍCH DANH mã NV để không ai phải đi dò xem "NV nào".
    unavailablePairs: Number(rawMatch.unavailablePairs || 0),
    unavailableEmployeeCount: Number(rawMatch.unavailableEmployeeCount || 0),
    unavailableEmployees: Array.isArray(rawMatch.unavailableEmployees) ? rawMatch.unavailableEmployees.map(String) : [],
  };
}

function normalizedColumnTotals(rawTotals, costColumns) {
  if (!rawTotals || typeof rawTotals !== 'object' || Array.isArray(rawTotals)) return null;
  return Object.fromEntries(costColumns.map((column) => {
    const raw = rawTotals[column.key];
    const value = raw == null ? null : Number(raw);
    return [column.key, Number.isFinite(value) ? value : null];
  }));
}

function normalizedFilterFacet(raw = {}, fallbackAvailable = true) {
  return {
    available: raw.available == null ? fallbackAvailable : !!raw.available,
    source: String(raw.source || ''),
    options: (Array.isArray(raw.options) ? raw.options : []).map((option) => ({
      value: String(option?.value || ''),
      label: String(option?.label || option?.value || ''),
      count: Number(option?.count || 0),
    })).filter((option) => option.value),
  };
}

function normalizedBonusPeriod(raw = {}) {
  const numberOrNull = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  return {
    target: numberOrNull(raw.target),
    achieved: numberOrNull(raw.achieved),
    pct: numberOrNull(raw.pct),
    bonusPct: numberOrNull(raw.bonusPct),
    baseBonusPct: numberOrNull(raw.baseBonusPct),
    baseAmount: numberOrNull(raw.baseAmount),
    priorityAmount: numberOrNull(raw.priorityAmount),
    priorityThresholdPct: numberOrNull(raw.priorityThresholdPct),
    priorityEligible: raw.priorityEligible === true,
    priorityStatus: String(raw.priorityStatus || ''),
    priorityTargetTotal: numberOrNull(raw.priorityTargetTotal),
    priorityTargetAssignedCount: numberOrNull(raw.priorityTargetAssignedCount),
    priorityTargetWarning: String(raw.priorityTargetWarning || ''),
    priorityGroups: (Array.isArray(raw.priorityGroups) ? raw.priorityGroups : []).map((item) => ({
      group: String(item?.group || ''),
      revenue: numberOrNull(item?.revenue),
      target: numberOrNull(item?.target),
      targetStatus: String(item?.targetStatus || ''),
      targetSource: String(item?.targetSource || ''),
      targetPeriods: (Array.isArray(item?.targetPeriods) ? item.targetPeriods : []).map((period) => ({
        period: String(period?.period || ''),
        target: numberOrNull(period?.target),
        targetSource: String(period?.targetSource || ''),
      })),
      excess: numberOrNull(item?.excess),
      ratePct: numberOrNull(item?.ratePct),
      amount: numberOrNull(item?.amount),
      reason: String(item?.reason || ''),
    })).filter((item) => item.group),
    priorityCoverage: {
      source: String(raw.priorityCoverage?.source || ''),
      sourceAvailable: raw.priorityCoverage?.sourceAvailable === true,
      totalRevenue: numberOrNull(raw.priorityCoverage?.totalRevenue),
      classifiedRevenue: numberOrNull(raw.priorityCoverage?.classifiedRevenue),
      unclassifiedRevenue: numberOrNull(raw.priorityCoverage?.unclassifiedRevenue),
      coveragePct: numberOrNull(raw.priorityCoverage?.coveragePct),
      c10ConflictCodes: numberOrNull(raw.priorityCoverage?.c10ConflictCodes),
      c10InvalidCodes: numberOrNull(raw.priorityCoverage?.c10InvalidCodes),
    },
    amount: numberOrNull(raw.amount),
    uncappedAmount: numberOrNull(raw.uncappedAmount),
    capAmount: numberOrNull(raw.capAmount),
    capped: raw.capped === true,
    status: String(raw.status || ''),
    contributors: numberOrNull(raw.contributors),
    tier: raw.tier && typeof raw.tier === 'object' ? {
      fromPct: numberOrNull(raw.tier.fromPct),
      toPct: numberOrNull(raw.tier.toPct),
      bonusPct: numberOrNull(raw.tier.bonusPct),
    } : null,
  };
}

export function employeeBonusViewModel(raw = {}) {
  return {
    configured: raw.configured === true,
    aggregate: raw.aggregate === true,
    message: String(raw.message || (raw.configured === true ? '' : 'Chưa cấu hình mức thưởng')),
    base: String(raw.base || 'revenue_before_vat'),
    currency: String(raw.currency || 'VND'),
    schemaVersion: Number(raw.schemaVersion || 0),
    version: String(raw.version || ''),
    effectiveFrom: String(raw.effectiveFrom || ''),
    capPct: raw.capPct == null || !Number.isFinite(Number(raw.capPct)) ? null : Number(raw.capPct),
    totalCapPct: raw.totalCapPct == null || !Number.isFinite(Number(raw.totalCapPct)) ? null : Number(raw.totalCapPct),
    priorityThresholdPct: raw.priorityThresholdPct == null || !Number.isFinite(Number(raw.priorityThresholdPct)) ? null : Number(raw.priorityThresholdPct),
    priorityRates: raw.priorityRates && typeof raw.priorityRates === 'object' ? raw.priorityRates : {},
    priorityTargets: raw.priorityTargets && typeof raw.priorityTargets === 'object' ? raw.priorityTargets : {},
    autoGroupTargets: raw.autoGroupTargets !== false,
    disclaimer: String(raw.disclaimer || 'Dự kiến/tham khảo, không phải payroll.'),
    ky: String(raw.ky || ''),
    quarterLabel: String(raw.quarterLabel || ''),
    month: normalizedBonusPeriod(raw.month),
    quarter: normalizedBonusPeriod(raw.quarter),
    employeeSubtotals: (Array.isArray(raw.employeeSubtotals) ? raw.employeeSubtotals : []).map((item) => ({
      empCode: String(item?.empCode || ''),
      employeeName: String(item?.employeeName || item?.empCode || ''),
      month: normalizedBonusPeriod(item?.month),
      quarter: normalizedBonusPeriod(item?.quarter),
      // Chỉ nhận số phạt đã được backend tính theo đúng scope. Frontend không tự
      // suy phạt của nhân viên khác trong màn ALL.
      penalty: item?.penalty && typeof item.penalty === 'object' ? employeePenaltyViewModel(item.penalty) : null,
    })),
  };
}

function numberOrNull(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function employeePenaltyViewModel(raw = {}) {
  const warning = raw.warning && typeof raw.warning === 'object' ? {
    kind: String(raw.warning.kind || ''),
    nextThresholdPct: numberOrNull(raw.warning.nextThresholdPct),
    mustExceed: raw.warning.mustExceed === true,
    revenueGap: numberOrNull(raw.warning.revenueGap),
    moneyAtRisk: numberOrNull(raw.warning.moneyAtRisk),
    text: String(raw.warning.text || ''),
  } : null;
  return {
    // Bản tổng hợp toàn đội tự khai available=false khi không có NV nào có số phạt;
    // tôn trọng cờ đó thay vì cứ thấy object là coi như có dữ liệu.
    available: !!raw && typeof raw === 'object' && Object.keys(raw).length > 0 && raw.available !== false,
    mode: String(raw.mode || 'off'),
    effectiveFrom: String(raw.effectiveFrom || ''),
    enabled: raw.enabled === true,
    targetPct: numberOrNull(raw.targetPct),
    tier: String(raw.tier || ''),
    ratePct: numberOrNull(raw.ratePct),
    c45Amount: numberOrNull(raw.c45Amount),
    targetAmount: numberOrNull(raw.targetAmount),
    targetStatus: String(raw.targetStatus || raw.penaltyStatus || ''),
    penaltyStatus: String(raw.penaltyStatus || raw.targetStatus || ''),
    c45Dropped: raw.c45Dropped === true,
    c45WouldDrop: raw.c45WouldDrop === true,
    xuAmount: numberOrNull(raw.xuAmount),
    xuStatus: String(raw.xuStatus || ''),
    xuMissing: numberOrNull(raw.xuMissing),
    total: numberOrNull(raw.total),
    appliedAmount: numberOrNull(raw.appliedAmount),
    cappedByC45: raw.cappedByC45 === true,
    provisional: raw.provisional === true,
    formulaText: String(raw.formulaText || ''),
    label: String(raw.label || 'Dự kiến/tham khảo — chưa trừ lương'),
    warning,
    afterPenaltyTotal: numberOrNull(raw.afterPenaltyTotal),
    // Diễn giải cho người xem (CEO chốt 30/07): tên cột C45 và bảng 4 ngữ cảnh phạt
    // do BACKEND sinh từ config (penaltyDisplay). Frontend không tự viết mốc %.
    c45Label: String(raw.c45Label || ''),
    modeText: String(raw.modeText || ''),
    tiers: Array.isArray(raw.tiers) ? raw.tiers.map((tier) => ({
      tier: String(tier?.tier || ''),
      range: String(tier?.range || ''),
      effect: String(tier?.effect || ''),
      example: String(tier?.example || ''),
      ratePct: numberOrNull(tier?.ratePct),
      dropC45: tier?.dropC45 === true,
      active: tier?.active === true,
      employees: numberOrNull(tier?.employees),
      amount: numberOrNull(tier?.amount),
    })) : [],
    // Tổng hợp toàn đội ở màn "Tất cả NV" — backend cộng sẵn, frontend chỉ hiển thị.
    aggregate: raw.aggregate === true,
    employees: numberOrNull(raw.employees),
    counted: numberOrNull(raw.counted),
    missing: numberOrNull(raw.missing),
    incomplete: raw.incomplete === true,
    c45DroppedCount: numberOrNull(raw.c45DroppedCount),
    c45WouldDropCount: numberOrNull(raw.c45WouldDropCount),
    atRisk: Array.isArray(raw.atRisk) ? raw.atRisk.map((item) => ({
      empCode: String(item?.empCode || '').toUpperCase(),
      employeeName: String(item?.employeeName || item?.empCode || ''),
      tier: String(item?.tier || ''),
      targetPct: numberOrNull(item?.targetPct),
      targetAmount: numberOrNull(item?.targetAmount),
      c45Amount: numberOrNull(item?.c45Amount),
      revenueGap: numberOrNull(item?.revenueGap),
    })) : [],
  };
}

function normalizedTargetPeriod(raw = {}) {
  const numberOrNull = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  return {
    ky: String(raw.ky || ''),
    label: String(raw.label || raw.ky || ''),
    target: numberOrNull(raw.target),
    achieved: numberOrNull(raw.achieved),
    pct: numberOrNull(raw.pct),
    assigned: raw.assigned === true,
    source: String(raw.source || ''),
    sourceLabel: String(raw.source_label || (raw.assigned === true ? '' : 'Chưa giao target')),
    sourceKy: String(raw.source_ky || ''),
    reference: raw.reference === true,
  };
}

export function employeeTargetViewModel(raw = {}) {
  const month = normalizedTargetPeriod(raw.month);
  return {
    available: !!raw.emp_code && !!raw.ky,
    empCode: String(raw.emp_code || ''),
    ky: String(raw.ky || ''),
    basis: String(raw.basis || ''),
    basisLabel: String(raw.basis_label || ''),
    month,
    quarter: {
      label: String(raw.quarter?.label || ''),
      target: raw.quarter?.target == null || !Number.isFinite(Number(raw.quarter.target)) ? null : Number(raw.quarter.target),
      achieved: raw.quarter?.achieved == null || !Number.isFinite(Number(raw.quarter.achieved)) ? null : Number(raw.quarter.achieved),
      pct: raw.quarter?.pct == null || !Number.isFinite(Number(raw.quarter.pct)) ? null : Number(raw.quarter.pct),
      months: (Array.isArray(raw.quarter?.months) ? raw.quarter.months : []).map(normalizedTargetPeriod),
      unassignedKys: (Array.isArray(raw.quarter?.unassigned_kys) ? raw.quarter.unassigned_kys : []).map(String),
      calculation: String(raw.quarter?.calculation || ''),
      calculationLabel: String(raw.quarter?.calculation_label || ''),
      clarification: String(raw.quarter?.clarification || ''),
    },
  };
}

function periodViewModel(payload = {}) {
  const template = {
    key: String(payload.template?.key || ''),
    label: String(payload.template?.label || ''),
    calculationGroup: String(payload.template?.calculationGroup || ''),
    columns: Array.isArray(payload.template?.columns) ? payload.template.columns.map(String) : [],
  };
  const columns = buildEmployeeCostColumns(payload.columns, template);
  const dimensionColumns = columns.filter((column) => column.kind === 'dimension');
  const costColumns = columns.filter((column) => column.kind === 'percent');
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map((source, rowIndex) => {
    const row = {
      rowIndex,
      stt: Number(source?.stt) || null,
      sourceLineId: String(source?.sourceLineId || `line-${rowIndex + 1}`),
      employeeCode: String(source?.employeeCode || ''),
      employeeName: String(source?.employeeName || ''),
      dailyAmounts: source?.dailyAmounts || null,
      dayRevenueMatched: !!source?.dayRevenueMatched,
      rowMonthlyTotal: source?.rowMonthlyTotal ?? null,
      rowAnnualTotal: source?.rowAnnualTotal ?? null,
    };
    for (const column of columns) {
      if (source && Object.prototype.hasOwnProperty.call(source, column.key)) row[column.key] = source[column.key];
    }
    return row;
  });
  const match = normalizedMatch(payload.match, rows.length);
  const rawSummary = payload.summary || {};
  const summary = {
    reliable: rawSummary.reliable !== false,
    monthlyTotal: rawSummary.monthlyTotal == null ? null : Number(rawSummary.monthlyTotal),
    annualTotal: rawSummary.annualTotal == null ? null : Number(rawSummary.annualTotal),
    revenueBeforeVatTotal: rawSummary.revenueBeforeVatTotal == null ? null : Number(rawSummary.revenueBeforeVatTotal),
    columnTotals: normalizedColumnTotals(rawSummary.columnTotals, costColumns),
    provisionalMonthlyTotal: rawSummary.provisionalMonthlyTotal == null ? null : Number(rawSummary.provisionalMonthlyTotal),
    provisionalAnnualTotal: rawSummary.provisionalAnnualTotal == null ? null : Number(rawSummary.provisionalAnnualTotal),
    provisionalColumnTotals: normalizedColumnTotals(rawSummary.provisionalColumnTotals, costColumns),
    annualColumnKeys: Array.isArray(rawSummary.annualColumnKeys) ? rawSummary.annualColumnKeys.map(String) : [],
    annualLabels: Array.isArray(rawSummary.annualLabels) ? rawSummary.annualLabels.map(String) : [],
    penaltyAppliedAmount: numberOrNull(rawSummary.penaltyAppliedAmount),
    afterPenaltyTotal: numberOrNull(rawSummary.afterPenaltyTotal),
  };
  const rawDaily = payload.daily || {};
  const dates = rawDaily.reliable && Array.isArray(rawDaily.dates) ? rawDaily.dates.map(String) : [];
  const dailyRows = dates.flatMap((date) => rows
    .filter((row) => row.dailyAmounts?.[date])
    .map((row) => {
      const dailyRow = { ...row, date };
      let monthlyTotal = 0;
      let hasMonthlyAmount = false;
      for (const column of costColumns) {
        const amount = row.dailyAmounts[date]?.[column.key] ?? null;
        if (!column.annual && amount != null) { monthlyTotal += Number(amount); hasMonthlyAmount = true; }
      }
      dailyRow.rowMonthlyTotal = hasMonthlyAmount ? monthlyTotal : null;
      return dailyRow;
    }));
  return {
    empCode: String(payload.empCode || ''),
    period: String(payload.period || ''),
    template,
    columns,
    dimensionColumns,
    costColumns,
    rows,
    match,
    summary,
    daily: {
      reliable: !!rawDaily.reliable,
      reason: String(rawDaily.reason || ''),
      dates,
      totals: Array.isArray(rawDaily.totals) ? rawDaily.totals : [],
      rows: dailyRows,
    },
    note: String(payload.note || (rows.length ? '' : EMPTY_NOTE)),
    dynamicCount: costColumns.length,
    search: {
      query: String(payload.search?.query || ''),
      filteredRows: Number(payload.search?.filteredRows ?? rows.length),
      totalRows: Number(payload.search?.totalRows ?? rows.length),
    },
    pagination: {
      page: Number(payload.pagination?.page || 1),
      pageSize: Number(payload.pagination?.pageSize || Math.max(rows.length, 1)),
      pageCount: Number(payload.pagination?.pageCount || 1),
      filteredRows: Number(payload.pagination?.filteredRows ?? rows.length),
      totalRows: Number(payload.pagination?.totalRows ?? rows.length),
    },
    employeeSubtotals: Array.isArray(payload.employeeSubtotals) ? payload.employeeSubtotals : [],
  };
}

export function employeeCostViewModel(payload = {}) {
  const hasPeriods = Array.isArray(payload.periods);
  const periods = (hasPeriods ? payload.periods : [payload]).map(periodViewModel);
  const rows = periods.flatMap((period) => period.rows);
  const rawMatch = payload.match || {};
  const aggregateMatch = hasPeriods ? normalizedMatch(rawMatch, rows.length) : periods[0].match;
  const rawSummary = payload.summary || {};
  const reliable = hasPeriods ? rawSummary.reliable === true : periods[0].summary.reliable;
  const first = periods[0] || periodViewModel({});
  const summary = hasPeriods ? {
    reliable,
    periodTotal: rawSummary.periodTotal == null ? null : Number(rawSummary.periodTotal),
    annualTotal: rawSummary.annualTotal == null ? null : Number(rawSummary.annualTotal),
    revenueBeforeVatTotal: rawSummary.revenueBeforeVatTotal == null ? null : Number(rawSummary.revenueBeforeVatTotal),
    columnTotals: normalizedColumnTotals(rawSummary.columnTotals, first.costColumns),
    // Số tạm tính (tổng phần đã khớp %) — dùng để hiển thị kèm nhãn coverage khi
    // chưa đạt ngưỡng, thay vì để trống làm người xem tưởng hỏng.
    provisionalPeriodTotal: rawSummary.provisionalPeriodTotal == null ? null : Number(rawSummary.provisionalPeriodTotal),
    provisionalAnnualTotal: rawSummary.provisionalAnnualTotal == null ? null : Number(rawSummary.provisionalAnnualTotal),
    provisionalColumnTotals: normalizedColumnTotals(rawSummary.provisionalColumnTotals, first.costColumns),
    annualColumnKeys: Array.isArray(rawSummary.annualColumnKeys) ? rawSummary.annualColumnKeys.map(String) : [],
    monthlyTotal: periods.length === 1 ? periods[0].summary.monthlyTotal : null,
    annualLabels: [...new Set(periods.flatMap((period) => period.summary.annualLabels))],
    penaltyAppliedAmount: numberOrNull(rawSummary.penaltyAppliedAmount),
    afterPenaltyTotal: numberOrNull(rawSummary.afterPenaltyTotal),
  } : {
    ...periods[0].summary,
    periodTotal: periods[0].summary.monthlyTotal,
    provisionalPeriodTotal: periods[0].summary.provisionalMonthlyTotal ?? null,
  };
  return {
    empCode: String(payload.empCode || first.empCode || ''),
    from: String(payload.from || first.period || ''),
    to: String(payload.to || first.period || ''),
    periods,
    period: first.period,
    template: first.template,
    columns: first.columns,
    dimensionColumns: first.dimensionColumns,
    costColumns: first.costColumns,
    rows,
    match: aggregateMatch,
    summary,
    note: String(payload.note || (rows.length ? '' : EMPTY_NOTE)),
    dynamicCount: periods.reduce((sum, period) => sum + period.dynamicCount, 0),
    allEmployees: !!payload.allEmployees,
    filters: {
      province: String(payload.filters?.province || ''),
      unitGroup: String(payload.filters?.unitGroup || ''),
      route: String(payload.filters?.route || ''),
      date: String(payload.filters?.date || ''),
    },
    filterOptions: {
      province: normalizedFilterFacet(payload.filterOptions?.province, false),
      unitGroup: normalizedFilterFacet(payload.filterOptions?.unitGroup),
      route: normalizedFilterFacet(payload.filterOptions?.route),
      date: normalizedFilterFacet(payload.filterOptions?.date),
    },
    search: {
      query: String(payload.search?.query || ''),
      filteredRows: Number(payload.search?.filteredRows ?? rows.length),
      totalRows: Number(payload.search?.totalRows ?? rows.length),
    },
    target: employeeTargetViewModel(payload.target),
    bonus: employeeBonusViewModel(payload.bonus),
    penalty: employeePenaltyViewModel(payload.penalty),
  };
}

export function normalizeEmployeeCostSearch(value) {
  return String(value ?? '').toLocaleLowerCase('vi').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function employeeCostPageItems(page, pageCount) {
  const current = Math.min(Math.max(1, Number(page) || 1), Math.max(1, Number(pageCount) || 1));
  const total = Math.max(1, Number(pageCount) || 1);
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const keep = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]
    .filter((value) => value >= 1 && value <= total));
  if (current <= 4) [2, 3, 4, 5].forEach((value) => keep.add(value));
  if (current >= total - 3) [total - 4, total - 3, total - 2, total - 1].forEach((value) => keep.add(value));
  const pages = [...keep].sort((a, b) => a - b);
  return pages.flatMap((value, index) => index && value - pages[index - 1] > 1 ? ['…', value] : [value]);
}

export function employeeCostSearchTokens(value) {
  return normalizeEmployeeCostSearch(value).split(/\s+/).filter(Boolean);
}

function employeeCostSearchForms(value) {
  const normalized = normalizeEmployeeCostSearch(value);
  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  const forms = new Set([normalized, words.join('')]);
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 2; end <= Math.min(words.length, start + 4); end += 1) {
      forms.add(`${words.slice(start, end - 1).map((word) => word[0]).join('')}${words[end - 1]}`);
    }
  }
  return [...forms];
}

function employeeCostSearchTextIncludes(value, token) {
  return employeeCostSearchForms(value).some((form) => form.includes(token));
}

function rowSearchText(row = {}, columns = []) {
  const values = [row.employeeCode, row.employeeName];
  for (const column of columns) {
    values.push(row[column.key]);
    if (column.kind === 'percent') values.push(row.amounts?.[column.key]);
  }
  return normalizeEmployeeCostSearch(values.filter((value) => value != null).join(' '));
}

export function filterSortEmployeeCostRows(rows = [], columns = [], query = '', sort = {}) {
  const tokens = employeeCostSearchTokens(query);
  const filtered = rows.filter((row) => {
    if (!tokens.length) return true;
    const forms = employeeCostSearchForms(rowSearchText(row, columns));
    return tokens.every((token) => forms.some((form) => form.includes(token)));
  });
  const key = String(sort.key || '');
  const direction = sort.dir === 'desc' ? -1 : 1;
  const sorted = key ? filtered.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = left.row[key]; const b = right.row[key];
    const aEmpty = a == null || a === ''; const bEmpty = b == null || b === '';
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? left.index - right.index : (aEmpty ? 1 : -1);
    const an = Number(a); const bn = Number(b);
    const compared = Number.isFinite(an) && Number.isFinite(bn)
      ? an - bn
      : String(a).localeCompare(String(b), 'vi', { numeric: true, sensitivity: 'base' });
    return compared ? compared * direction : left.index - right.index;
  }).map((item) => item.row) : filtered;
  return sorted.map((row, index) => ({ ...row, stt: index + 1 }));
}

export function employeeCostHighlightParts(value, query) {
  const text = String(value ?? '');
  const tokens = employeeCostSearchTokens(query);
  if (!text || !tokens.length) return [{ text, match: false }];
  const normalized = [];
  const sourceIndex = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text[index].toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    for (const char of unit) {
      if (/[a-z0-9]/.test(char)) { normalized.push(char); sourceIndex.push(index); }
      else if (normalized.at(-1) !== ' ') { normalized.push(' '); sourceIndex.push(index); }
    }
  }
  const haystack = normalized.join('');
  const ranges = [];
  for (const token of tokens) {
    let cursor = 0; let directlyMatched = false;
    while ((cursor = haystack.indexOf(token, cursor)) >= 0) {
      ranges.push([sourceIndex[cursor], (sourceIndex[cursor + token.length - 1] ?? sourceIndex[cursor]) + 1]);
      directlyMatched = true; cursor += token.length;
    }
    if (!directlyMatched && employeeCostSearchTextIncludes(text, token)) ranges.push([0, text.length]);
  }
  if (!ranges.length) return [{ text, match: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = ranges.reduce((result, range) => {
    const last = result.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else result.push([...range]);
    return result;
  }, []);
  const parts = []; let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: text.slice(start, end), match: true }); cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

export function employeeCostColumnKpis(model = {}) {
  const annualKeys = new Set(Array.isArray(model.summary?.annualColumnKeys) ? model.summary.annualColumnKeys : []);
  const totals = model.summary?.columnTotals;
  // Khi coverage chưa đạt ngưỡng, `columnTotals` bị khóa null (fail-closed) làm ô
  // KPI trống trơn. Vẫn hiện số tổng của PHẦN ĐÃ KHỚP nhưng gắn cờ `provisional`
  // để UI ghi rõ "tạm tính · chưa gồm mã thiếu %", không để người xem hiểu nhầm.
  const provisional = totals == null;
  const source = provisional ? model.summary?.provisionalColumnTotals : totals;
  return (Array.isArray(model.costColumns) ? model.costColumns : []).map((column) => ({
    key: column.key,
    label: column.label,
    annual: annualKeys.has(column.key),
    value: source?.[column.key] ?? null,
    provisional: provisional && source?.[column.key] != null,
  }));
}
