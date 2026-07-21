export const EMPLOYEE_COST_DIMENSIONS = Object.freeze([
  { key: 'c5', label: 'Quản lý', kind: 'dimension' },
  { key: 'c7', label: 'Đơn vị', kind: 'dimension' },
  { key: 'c16', label: 'Sản phẩm', kind: 'dimension' },
  { key: 'c25', label: 'ĐVT', kind: 'dimension' },
]);

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
  const key = String(column?.key || '').trim().toLowerCase();
  const match = /^c(\d+)$/.exec(key);
  if (!match || BLOCKED.has(key)) return false;
  const pos = Number(match[1]);
  return pos >= 33 && pos <= 46;
}

export function buildEmployeeCostColumns(columns = []) {
  const seen = new Set(EMPLOYEE_COST_DIMENSIONS.map((column) => column.key));
  const costColumns = [];
  for (const raw of Array.isArray(columns) ? columns : []) {
    const key = String(raw?.key || '').trim().toLowerCase();
    if (!isAllowedCostColumn(raw) || seen.has(key)) continue;
    seen.add(key);
    costColumns.push({
      key,
      amountKey: `${key}_amount`,
      label: String(raw.label || key),
      kind: 'percent',
      annual: !!raw.annual,
    });
  }
  return [
    ...EMPLOYEE_COST_DIMENSIONS,
    ...costColumns.flatMap((column) => [
      column,
      { key: column.amountKey, sourceKey: column.key, label: 'Thành tiền', kind: 'money', annual: column.annual },
    ]),
  ];
}

export function formatEmployeeCostCell(value, column) {
  if (value == null || value === '') return '—';
  if (column.kind === 'dimension') return String(value);
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (column.kind === 'money') return number.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ';
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

function normalizedMatch(rawMatch = {}, rowCount = 0) {
  return {
    matchedRows: Number(rawMatch.matchedRows || 0),
    totalRows: Number(rawMatch.totalRows ?? rowCount),
    rate: rawMatch.rate == null ? null : Number(rawMatch.rate),
    threshold: Number(rawMatch.threshold ?? 90),
    low: !!rawMatch.low,
  };
}

function periodViewModel(payload = {}) {
  const columns = buildEmployeeCostColumns(payload.columns);
  const dimensionColumns = columns.filter((column) => column.kind === 'dimension');
  const costColumns = columns.filter((column) => column.kind === 'percent');
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map((source, rowIndex) => {
    const row = { rowIndex, dailyAmounts: source?.dailyAmounts || null, dayRevenueMatched: !!source?.dayRevenueMatched };
    for (const column of dimensionColumns) {
      if (source && Object.prototype.hasOwnProperty.call(source, column.key)) row[column.key] = source[column.key];
    }
    for (const column of costColumns) {
      if (source && Object.prototype.hasOwnProperty.call(source, column.key)) row[column.key] = source[column.key];
      row[column.amountKey] = source?.amounts?.[column.key] ?? null;
    }
    return row;
  });
  const match = normalizedMatch(payload.match, rows.length);
  const rawSummary = payload.summary || {};
  const summary = {
    reliable: rawSummary.reliable !== false,
    monthlyTotal: rawSummary.monthlyTotal == null ? null : Number(rawSummary.monthlyTotal),
    annualTotal: rawSummary.annualTotal == null ? null : Number(rawSummary.annualTotal),
    annualLabels: Array.isArray(rawSummary.annualLabels) ? rawSummary.annualLabels.map(String) : [],
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
        dailyRow[column.amountKey] = amount;
        if (!column.annual && amount != null) { monthlyTotal += Number(amount); hasMonthlyAmount = true; }
      }
      dailyRow.monthlyTotal = hasMonthlyAmount ? monthlyTotal : null;
      return dailyRow;
    }));
  return {
    empCode: String(payload.empCode || ''),
    period: String(payload.period || ''),
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
  const summary = hasPeriods ? {
    reliable,
    periodTotal: rawSummary.periodTotal == null ? null : Number(rawSummary.periodTotal),
    annualTotal: rawSummary.annualTotal == null ? null : Number(rawSummary.annualTotal),
    // Legacy aliases keep older single-period callers/tests compatible.
    monthlyTotal: periods.length === 1 ? periods[0].summary.monthlyTotal : null,
    annualLabels: [...new Set(periods.flatMap((period) => period.summary.annualLabels))],
  } : { ...periods[0].summary, periodTotal: periods[0].summary.monthlyTotal };
  const first = periods[0] || periodViewModel({});
  return {
    empCode: String(payload.empCode || first.empCode || ''),
    from: String(payload.from || first.period || ''),
    to: String(payload.to || first.period || ''),
    periods,
    // Legacy aliases for one-period rendering consumers.
    period: first.period,
    columns: first.columns,
    dimensionColumns: first.dimensionColumns,
    costColumns: first.costColumns,
    rows,
    match: aggregateMatch,
    summary,
    note: String(payload.note || (rows.length ? '' : EMPTY_NOTE)),
    dynamicCount: periods.reduce((sum, period) => sum + period.dynamicCount, 0),
  };
}
