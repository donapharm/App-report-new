export const EMPLOYEE_COST_DIMENSIONS = Object.freeze([
  { key: 'c5', label: 'Quản lý', kind: 'dimension' },
  { key: 'c7', label: 'Đơn vị', kind: 'dimension' },
  { key: 'c16', label: 'Sản phẩm', kind: 'dimension' },
  { key: 'c25', label: 'ĐVT', kind: 'dimension' },
]);

const BLOCKED = new Set(['c32', 'c47']);

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
  if (column.kind === 'money') {
    return number.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ';
  }
  // CEO chốt: ô tỷ lệ chỉ hiện số với dấu chấm thập phân, không có ký hiệu %.
  return number.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: 1,
    maximumFractionDigits: 4,
  });
}

export function formatMatchRate(match = {}) {
  const rate = Number(match.rate);
  return Number.isFinite(rate) ? rate.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—';
}

export function employeeCostViewModel(payload = {}) {
  const columns = buildEmployeeCostColumns(payload.columns);
  const dimensionColumns = columns.filter((column) => column.kind === 'dimension');
  const costColumns = columns.filter((column) => column.kind === 'percent');
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map((source) => {
    const row = {};
    for (const column of dimensionColumns) {
      if (source && Object.prototype.hasOwnProperty.call(source, column.key)) row[column.key] = source[column.key];
    }
    for (const column of costColumns) {
      if (source && Object.prototype.hasOwnProperty.call(source, column.key)) row[column.key] = source[column.key];
      row[column.amountKey] = source?.amounts?.[column.key] ?? null;
    }
    return row;
  });
  const rawMatch = payload.match || {};
  const match = {
    matchedRows: Number(rawMatch.matchedRows || 0),
    totalRows: Number(rawMatch.totalRows ?? rows.length),
    rate: rawMatch.rate == null ? null : Number(rawMatch.rate),
    threshold: Number(rawMatch.threshold ?? 90),
    low: !!rawMatch.low,
  };
  const rawSummary = payload.summary || {};
  const summary = {
    reliable: rawSummary.reliable !== false,
    monthlyTotal: rawSummary.monthlyTotal == null ? null : Number(rawSummary.monthlyTotal),
    annualTotal: rawSummary.annualTotal == null ? null : Number(rawSummary.annualTotal),
    annualLabels: Array.isArray(rawSummary.annualLabels) ? rawSummary.annualLabels.map(String) : [],
  };
  return {
    empCode: String(payload.empCode || ''),
    period: String(payload.period || ''),
    columns,
    dimensionColumns,
    costColumns,
    rows,
    match,
    summary,
    note: String(payload.note || (rows.length ? '' : 'chưa có dữ liệu chi phí kỳ này')),
    dynamicCount: costColumns.length,
  };
}
