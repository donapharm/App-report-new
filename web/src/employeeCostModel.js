export const EMPLOYEE_COST_DIMENSIONS = Object.freeze([
  { key: 'date', label: 'Ngày', kind: 'dimension' },
  { key: 'orderCode', label: 'Mã đơn hàng', kind: 'dimension' },
  { key: 'route', label: 'Tuyến', kind: 'dimension' },
  { key: 'c7', label: 'Đơn vị', kind: 'dimension' },
  { key: 'contractorName', label: 'Nhà thầu', kind: 'dimension' },
  { key: 'c5', label: 'Mã hàng (QLNB)', kind: 'dimension' },
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
const DEFAULT_PREFIX = ['date', 'orderCode', 'route', 'c7', 'contractorName', 'c5', 'c16', 'strength', 'c25', 'bidPrice', 'quantity', 'revenueBeforeVat'];
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
      kind: 'percent',
      annual: !!raw.annual,
    });
  }
  const requestedLayout = Array.isArray(template?.columns) ? template.columns.map(String) : [];
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

function normalizedMatch(rawMatch = {}, rowCount = 0) {
  return {
    matchedRows: Number(rawMatch.matchedRows || 0),
    totalRows: Number(rawMatch.totalRows ?? rowCount),
    rate: rawMatch.rate == null ? null : Number(rawMatch.rate),
    threshold: Number(rawMatch.threshold ?? 90),
    low: !!rawMatch.low,
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
      sourceLineId: String(source?.sourceLineId || `line-${rowIndex + 1}`),
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
    annualColumnKeys: Array.isArray(rawSummary.annualColumnKeys) ? rawSummary.annualColumnKeys.map(String) : [],
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
    annualColumnKeys: Array.isArray(rawSummary.annualColumnKeys) ? rawSummary.annualColumnKeys.map(String) : [],
    monthlyTotal: periods.length === 1 ? periods[0].summary.monthlyTotal : null,
    annualLabels: [...new Set(periods.flatMap((period) => period.summary.annualLabels))],
  } : { ...periods[0].summary, periodTotal: periods[0].summary.monthlyTotal };
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
  };
}

export function employeeCostColumnKpis(model = {}) {
  const annualKeys = new Set(Array.isArray(model.summary?.annualColumnKeys) ? model.summary.annualColumnKeys : []);
  const totals = model.summary?.columnTotals;
  return (Array.isArray(model.costColumns) ? model.costColumns : []).map((column) => ({
    key: column.key,
    label: column.label,
    annual: annualKeys.has(column.key),
    value: totals?.[column.key] ?? null,
  }));
}
