'use strict';

const BLOCKED = new Set(['c32', 'c47']);
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const SEARCHABLE_BASE_KEYS = Object.freeze([
  'date', 'orderCode', 'route', 'c7', 'contractorName', 'c5', 'c16', 'strength', 'c25',
  'bidPrice', 'quantity', 'revenueBeforeVat', 'rowMonthlyTotal', 'note', 'employeeCode', 'employeeName',
]);
const SORTABLE_BASE_KEYS = new Set([...SEARCHABLE_BASE_KEYS, 'stt']);

function normalizeVietnamese(value) {
  return String(value ?? '').toLocaleLowerCase('vi').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function searchTokens(value) {
  return normalizeVietnamese(value).split(/\s+/).filter(Boolean);
}

function searchForms(value) {
  const normalized = normalizeVietnamese(value);
  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  const forms = new Set([normalized, words.join('')]);
  // Vietnamese users often type a compact abbreviation such as "dviet" for
  // "Đức Việt": initials of the leading word(s) + the last word in full.
  // Keep the window bounded so this stays cheap for the ALL-roster search.
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 2; end <= Math.min(words.length, start + 4); end += 1) {
      forms.add(`${words.slice(start, end - 1).map((word) => word[0]).join('')}${words[end - 1]}`);
    }
  }
  return [...forms];
}

function scalarValues(value, target = []) {
  if (value == null) return target;
  if (Array.isArray(value)) {
    value.forEach((item) => scalarValues(item, target));
    return target;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (!BLOCKED.has(String(key).toLowerCase())) scalarValues(item, target);
    });
    return target;
  }
  target.push(value);
  return target;
}

function rowSearchDocument(row = {}, columns = []) {
  const keys = new Set([...SEARCHABLE_BASE_KEYS, ...columns.map((column) => String(column?.key || '').toLowerCase())]);
  const values = [];
  for (const key of keys) {
    if (BLOCKED.has(key)) continue;
    scalarValues(row[key], values);
    if (/^c(?:3[3-9]|4[0-6])$/.test(key)) scalarValues(row.amounts?.[key], values);
  }
  return normalizeVietnamese(values.join(' '));
}

function rowMatches(row, columns, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const forms = searchForms(rowSearchDocument(row, columns));
  return tokens.every((token) => forms.some((form) => form.includes(token)));
}

function normalizeSortKey(value) {
  const key = String(value || '').trim();
  const lower = key.toLowerCase();
  if (SORTABLE_BASE_KEYS.has(key)) return key;
  if (/^c(?:3[3-9]|4[0-6])$/.test(lower) && !BLOCKED.has(lower)) return lower;
  return '';
}

function compareValues(left, right) {
  const leftEmpty = left == null || left === '';
  const rightEmpty = right == null || right === '';
  if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? 0 : (leftEmpty ? 1 : -1);
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right), 'vi', { numeric: true, sensitivity: 'base' });
}

function sortRows(rows, sortKey, sortDir = 'asc') {
  const key = normalizeSortKey(sortKey);
  if (!key || key === 'stt') return [...rows];
  const direction = String(sortDir).toLowerCase() === 'desc' ? -1 : 1;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const compared = compareValues(a.row[key], b.row[key]);
    return compared ? compared * direction : a.index - b.index;
  }).map((item) => item.row);
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function summarizeRows(rows = [], columns = [], baseSummary = null) {
  const costColumns = columns.filter((column) => /^c(?:3[3-9]|4[0-6])$/.test(String(column?.key || '').toLowerCase())
    && !BLOCKED.has(String(column.key).toLowerCase()));
  const annualKeys = new Set(costColumns.filter((column) => column.annual).map((column) => String(column.key).toLowerCase()));
  const columnTotals = Object.fromEntries(costColumns.map((column) => {
    const key = String(column.key).toLowerCase();
    return [key, rows.reduce((sum, row) => sum + numeric(row.amounts?.[key]), 0)];
  }));
  const reliable = baseSummary?.reliable !== false;
  return {
    reliable,
    monthlyTotal: reliable ? rows.reduce((sum, row) => sum + numeric(row.rowMonthlyTotal), 0) : null,
    annualTotal: reliable ? rows.reduce((sum, row) => sum + numeric(row.rowAnnualTotal), 0) : null,
    revenueTotal: rows.reduce((sum, row) => sum + numeric(row.revenue), 0),
    revenueBeforeVatTotal: rows.reduce((sum, row) => sum + numeric(row.revenueBeforeVat), 0),
    columnTotals: reliable ? columnTotals : null,
    annualColumnKeys: [...annualKeys],
    annualLabels: costColumns.filter((column) => annualKeys.has(String(column.key).toLowerCase())).map((column) => column.label),
  };
}

function employeeSubtotals(rows = [], columns = []) {
  const groups = new Map();
  for (const row of rows) {
    const employeeCode = String(row.employeeCode || '').trim().toUpperCase() || '—';
    const group = groups.get(employeeCode) || { employeeCode, employeeName: String(row.employeeName || employeeCode), rows: [] };
    group.rows.push(row);
    groups.set(employeeCode, group);
  }
  return [...groups.values()].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, 'vi', { numeric: true }))
    .map((group) => ({ ...group, rowCount: group.rows.length, ...summarizeRows(group.rows, columns), rows: undefined }));
}

function parsePage(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parsePageSize(value, fallback = DEFAULT_PAGE_SIZE) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, MAX_PAGE_SIZE) : fallback;
}

function transformPeriod(period = {}, options = {}) {
  const sourceRows = Array.isArray(period.rows) ? period.rows : [];
  const columns = Array.isArray(period.columns) ? period.columns.filter((column) => !BLOCKED.has(String(column?.key || '').toLowerCase())) : [];
  const query = String(options.q || '').slice(0, 200);
  const filtered = sourceRows.filter((row) => rowMatches(row, columns, query));
  const sorted = sortRows(filtered, options.sortKey, options.sortDir);
  const numbered = sorted.map((row, index) => ({ ...row, stt: index + 1 }));
  const pageSize = parsePageSize(options.pageSize);
  const pageCount = Math.max(1, Math.ceil(numbered.length / pageSize));
  const page = Math.min(parsePage(options.page), pageCount);
  const rows = options.paginate === false ? numbered : numbered.slice((page - 1) * pageSize, page * pageSize);
  const summary = summarizeRows(numbered, columns, period.summary);
  return {
    ...period,
    columns,
    rows,
    summary,
    search: { query, filteredRows: numbered.length, totalRows: sourceRows.length },
    pagination: { page, pageSize, pageCount, filteredRows: numbered.length, totalRows: sourceRows.length },
    employeeSubtotals: options.allEmployees ? employeeSubtotals(numbered, columns) : [],
  };
}

function transformReport(report = {}, options = {}) {
  const periods = (Array.isArray(report.periods) ? report.periods : [report]).map((period) => transformPeriod(period, options));
  const allRows = periods.flatMap((period) => period.rows);
  const filteredRows = periods.reduce((sum, period) => sum + period.search.filteredRows, 0);
  const totalRows = periods.reduce((sum, period) => sum + period.search.totalRows, 0);
  const reliable = periods.every((period) => period.summary.reliable);
  const costKeys = [...new Set(periods.flatMap((period) => period.columns.map((column) => String(column.key || '').toLowerCase())
    .filter((key) => /^c(?:3[3-9]|4[0-6])$/.test(key) && !BLOCKED.has(key))))];
  return {
    ...report,
    periods,
    rows: undefined,
    allEmployees: !!options.allEmployees,
    search: { query: String(options.q || '').slice(0, 200), filteredRows, totalRows },
    summary: {
      reliable,
      periodTotal: reliable ? periods.reduce((sum, period) => sum + numeric(period.summary.monthlyTotal), 0) : null,
      annualTotal: reliable ? periods.reduce((sum, period) => sum + numeric(period.summary.annualTotal), 0) : null,
      revenueTotal: periods.reduce((sum, period) => sum + numeric(period.summary.revenueTotal), 0),
      revenueBeforeVatTotal: periods.reduce((sum, period) => sum + numeric(period.summary.revenueBeforeVatTotal), 0),
      columnTotals: reliable ? Object.fromEntries(costKeys.map((key) => [key, periods.reduce((sum, period) => sum + numeric(period.summary.columnTotals?.[key]), 0)])) : null,
      annualColumnKeys: [...new Set(periods.flatMap((period) => period.summary.annualColumnKeys || []))],
    },
    displayedRows: allRows.length,
  };
}

function mergeEmployeeReports(reports = [], roster = []) {
  const employeeNames = new Map(roster.map((employee) => [String(employee.emp_code || '').toUpperCase(), String(employee.name || employee.emp_code || '')]));
  const source = reports.filter(Boolean);
  const periodKeys = [...new Set(source.flatMap((report) => (report.periods || []).map((period) => period.period)))].sort();
  const periods = periodKeys.map((periodKey) => {
    const blocks = source.map((report) => ({ report, period: (report.periods || []).find((item) => item.period === periodKey) })).filter((item) => item.period);
    const columnsByKey = new Map();
    for (const { period } of blocks) for (const column of period.columns || []) {
      const key = String(column?.key || '').toLowerCase();
      if (!key || BLOCKED.has(key) || columnsByKey.has(key)) continue;
      columnsByKey.set(key, column);
    }
    const columns = [...columnsByKey.values()].sort((a, b) => Number(String(a.key).slice(1)) - Number(String(b.key).slice(1)));
    const rows = blocks.flatMap(({ report, period }) => {
      const employeeCode = String(report.empCode || '').toUpperCase();
      const employeeName = employeeNames.get(employeeCode) || employeeCode;
      return (period.rows || []).map((row) => ({ ...row, employeeCode, employeeName }));
    });
    const matchedRows = blocks.reduce((sum, item) => sum + numeric(item.period.match?.matchedRows), 0);
    const totalRows = blocks.reduce((sum, item) => sum + numeric(item.period.match?.totalRows), 0);
    const rate = totalRows ? +(matchedRows / totalRows * 100).toFixed(1) : null;
    const threshold = Number(blocks.find((item) => Number.isFinite(Number(item.period.match?.threshold)))?.period.match.threshold || 90);
    const low = rate != null && rate < threshold;
    return {
      empCode: 'ALL', period: periodKey, columns, rows,
      template: { key: 'all', label: 'TẤT CẢ NHÂN VIÊN', columns: [] },
      match: { matchedRows, totalRows, rate, threshold, low },
      summary: { reliable: !low },
      daily: { reliable: false, reason: 'Chế độ tất cả nhân viên dùng bảng tổng hợp phân trang.', dates: [], totals: [] },
    };
  });
  return {
    empCode: 'ALL', employeeName: 'Tất cả nhân viên', allEmployees: true,
    from: source[0]?.from || periodKeys[0] || '', to: source[0]?.to || periodKeys.at(-1) || '',
    periods,
    employees: roster.map((employee) => ({ empCode: employee.emp_code, employeeName: employee.name })),
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizeVietnamese,
  searchTokens,
  searchForms,
  rowSearchDocument,
  rowMatches,
  normalizeSortKey,
  sortRows,
  summarizeRows,
  employeeSubtotals,
  transformPeriod,
  transformReport,
  mergeEmployeeReports,
};
