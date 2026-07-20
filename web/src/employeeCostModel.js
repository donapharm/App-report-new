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
  const dynamic = [];
  for (const raw of Array.isArray(columns) ? columns : []) {
    const key = String(raw?.key || '').trim().toLowerCase();
    if (!isAllowedCostColumn(raw) || seen.has(key)) continue;
    seen.add(key);
    dynamic.push({
      key,
      label: String(raw.label || key),
      kind: raw.type === 'money' || raw.format === 'money' || raw.unit === 'VND' ? 'money' : 'percent',
    });
  }
  return [...EMPLOYEE_COST_DIMENSIONS, ...dynamic];
}

export function formatEmployeeCostCell(value, column) {
  if (value == null || value === '') return '—';
  if (column.kind === 'dimension') return String(value);
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (column.kind === 'money') {
    return number.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ';
  }
  return number.toLocaleString('vi-VN', { maximumFractionDigits: 4 }) + '%';
}

export function employeeCostViewModel(payload = {}) {
  const columns = buildEmployeeCostColumns(payload.columns);
  const allowed = new Set(columns.map((column) => column.key));
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map((source) => {
    const row = {};
    for (const key of allowed) {
      if (source && Object.prototype.hasOwnProperty.call(source, key)) row[key] = source[key];
    }
    return row;
  });
  return {
    empCode: String(payload.empCode || ''),
    columns,
    rows,
    note: String(payload.note || (rows.length ? '' : 'chưa có dữ liệu chi phí kỳ này')),
    hasMoney: columns.some((column) => column.kind === 'money'),
    dynamicCount: columns.filter((column) => column.kind !== 'dimension').length,
  };
}
