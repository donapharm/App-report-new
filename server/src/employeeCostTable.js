'use strict';

const employeeBonus = require('./employeeBonus');
// Danh sách "kết quả nguồn còn dùng được" chỉ có MỘT nơi định nghĩa.
const employeeCost = require('./employeeCost');
const employeePenaltyAggregate = require('./employeePenaltyAggregate');

const BLOCKED = new Set(['c32', 'c47']);
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZES = Object.freeze([20, 50, 100]);
const MAX_PAGE_SIZE = 100;
const UNASSIGNED_PROVINCE = 'Chưa gán tỉnh';
const SEARCHABLE_BASE_KEYS = Object.freeze([
  'date', 'orderCode', 'route', 'c7', 'unitCode', 'contractorName', 'c5', 'c16', 'strength', 'c25',
  'bidPrice', 'quantity', 'revenueBeforeVat', 'rowMonthlyTotal', 'note', 'employeeCode', 'employeeName',
  'province', 'unitGroup', 'unitGroupLabel',
]);
const SORTABLE_BASE_KEYS = new Set([...SEARCHABLE_BASE_KEYS, 'stt']);
const FILTER_KEYS = Object.freeze(['province', 'unitGroup', 'route', 'date']);

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

function exactFilterMatch(left, right) {
  if (right == null || String(right).trim() === '') return true;
  return normalizeVietnamese(left) === normalizeVietnamese(right);
}

function validIsoDate(value) {
  const raw = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : '';
}

function filterValue(row = {}, key) {
  if (key === 'province') return String(row.province || '').trim() || UNASSIGNED_PROVINCE;
  if (key === 'date') return validIsoDate(row.date);
  return row[key];
}

function requestedFilterValue(options = {}, key) {
  const raw = String(options[key] || '').trim();
  if (key === 'date' && raw) return validIsoDate(raw) || '__INVALID_DATE__';
  return raw;
}

function rowMatchesFilters(row = {}, options = {}, excludeKey = '') {
  return FILTER_KEYS.every((key) => key === excludeKey || exactFilterMatch(filterValue(row, key), requestedFilterValue(options, key)));
}

function rowMatchesView(row, columns, options = {}, excludeKey = '') {
  return rowMatchesFilters(row, options, excludeKey) && rowMatches(row, columns, options.q);
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

function numberOrNull(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summarizeRows(rows = [], columns = [], baseSummary = null) {
  const costColumns = columns.filter((column) => /^c(?:3[3-9]|4[0-6])$/.test(String(column?.key || '').toLowerCase())
    && !BLOCKED.has(String(column.key).toLowerCase()) && column?.viewOnly !== true);
  const annualKeys = new Set(costColumns.filter((column) => column.annual).map((column) => String(column.key).toLowerCase()));
  const columnTotals = Object.fromEntries(costColumns.map((column) => {
    const key = String(column.key).toLowerCase();
    return [key, rows.reduce((sum, row) => sum + numeric(row.amounts?.[key]), 0)];
  }));
  const reliable = baseSummary?.reliable !== false;
  // provisional* = tổng phần ĐÃ khớp %, luôn tính để UI hiện kèm nhãn coverage.
  const provisionalMonthlyTotal = rows.reduce((sum, row) => sum + numeric(row.rowMonthlyTotal), 0);
  const provisionalAnnualTotal = rows.reduce((sum, row) => sum + numeric(row.rowAnnualTotal), 0);
  // Màn ALL mang theo snapshot doanh thu TOÀN CÔNG TY từ mergeEmployeeReports().
  // Không được tính lại hay làm rơi provenance này khi transform/filter:
  // transformReport() dùng chính revenueSource để quyết định fail-closed. Bản cũ
  // làm mất trường này rồi tự kết luận snapshot không tồn tại, dù merge
  // vừa chụp đủ doanh thu. Self report không có contract này nên vẫn tính
  // doanh thu từ các dòng đúng scope như trước.
  const companyRevenueSource = baseSummary?.revenueSource === 'app_report_company_store'
    || baseSummary?.revenueSource === 'company_revenue_unavailable';
  return {
    reliable,
    monthlyTotal: reliable ? provisionalMonthlyTotal : null,
    annualTotal: reliable ? provisionalAnnualTotal : null,
    provisionalMonthlyTotal,
    provisionalAnnualTotal,
    provisionalColumnTotals: columnTotals,
    revenueTotal: companyRevenueSource ? numberOrNull(baseSummary?.revenueTotal)
      : rows.reduce((sum, row) => sum + numeric(row.revenue), 0),
    revenueBeforeVatTotal: companyRevenueSource ? numberOrNull(baseSummary?.revenueBeforeVatTotal)
      : rows.reduce((sum, row) => sum + numeric(row.revenueBeforeVat), 0),
    revenueAllocatedRowCount: companyRevenueSource ? numberOrNull(baseSummary?.revenueAllocatedRowCount) : rows.length,
    revenueSource: companyRevenueSource ? baseSummary.revenueSource : undefined,
    revenueUnavailableReason: companyRevenueSource ? String(baseSummary?.revenueUnavailableReason || '') : '',
    columnTotals: reliable ? columnTotals : null,
    annualColumnKeys: [...annualKeys],
    annualLabels: costColumns.filter((column) => annualKeys.has(String(column.key).toLowerCase())).map((column) => column.label),
  };
}

function employeeSubtotals(rows = [], columns = [], penalties = {}) {
  const groups = new Map();
  for (const row of rows) {
    const employeeCode = String(row.employeeCode || '').trim().toUpperCase() || '—';
    const group = groups.get(employeeCode) || { employeeCode, employeeName: String(row.employeeName || employeeCode), rows: [] };
    group.rows.push(row);
    groups.set(employeeCode, group);
  }
  return [...groups.values()].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, 'vi', { numeric: true }))
    .map((group) => ({
      ...group,
      rowCount: group.rows.length,
      ...summarizeRows(group.rows, columns),
      penalty: penalties?.[group.employeeCode] && typeof penalties[group.employeeCode] === 'object'
        ? { ...penalties[group.employeeCode] }
        : null,
      rows: undefined,
    }));
}

function parsePage(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parsePageSize(value, fallback = DEFAULT_PAGE_SIZE) {
  const number = Number(value);
  return PAGE_SIZES.includes(number) ? number : fallback;
}

function facetOptions(report = {}, options = {}, key, labelKey = key) {
  const values = new Map();
  const selected = requestedFilterValue(options, key);
  const selectedNormalized = normalizeVietnamese(selected);
  for (const period of Array.isArray(report.periods) ? report.periods : [report]) {
    const columns = Array.isArray(period.columns) ? period.columns : [];
    for (const row of Array.isArray(period.rows) ? period.rows : []) {
      const value = String(filterValue(row, key) || '').trim();
      if (selectedNormalized && normalizeVietnamese(value) === selectedNormalized && !values.has(selectedNormalized)) {
        values.set(selectedNormalized, {
          value,
          label: String(row?.[labelKey] || value).trim() || value,
          count: 0,
        });
      }
      if (!rowMatchesView(row, columns, options, key)) continue;
      if (!value) continue;
      const normalized = normalizeVietnamese(value);
      const current = values.get(normalized) || {
        value,
        label: String(row?.[labelKey] || value).trim() || value,
        count: 0,
      };
      current.count += 1;
      values.set(normalized, current);
    }
  }
  return [...values.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi', { numeric: true, sensitivity: 'base' }));
}

function buildFilterOptions(report = {}, options = {}) {
  const provinces = facetOptions(report, options, 'province');
  return {
    province: { available: provinces.length > 0, source: 'official_row_or_config_or_unassigned', options: provinces },
    unitGroup: { available: true, source: 'configurable_prefix_map', options: facetOptions(report, options, 'unitGroup', 'unitGroupLabel') },
    route: { available: true, source: 'sales_row', options: facetOptions(report, options, 'route') },
    date: {
      available: true,
      source: 'sales_row_date',
      options: facetOptions(report, options, 'date').map((option) => ({
        ...option,
        label: option.value.split('-').reverse().join('/'),
      })),
    },
  };
}

function filteredDaily(daily = {}, rows = [], columns = []) {
  if (!daily?.reliable) return daily;
  const costColumns = columns.filter((column) => /^c(?:3[3-9]|4[0-6])$/.test(String(column?.key || '').toLowerCase())
    && !BLOCKED.has(String(column.key).toLowerCase()) && column?.viewOnly !== true);
  const dates = [...new Set(rows.flatMap((row) => Object.keys(row.dailyAmounts || {})))].sort();
  const totals = dates.map((date) => {
    let monthlyTotal = 0;
    let annualTotal = 0;
    for (const row of rows) for (const column of costColumns) {
      const amount = numeric(row.dailyAmounts?.[date]?.[String(column.key).toLowerCase()]);
      if (column.annual) annualTotal += amount;
      else monthlyTotal += amount;
    }
    return { date, monthlyTotal, annualTotal };
  });
  return { ...daily, dates, totals };
}

function transformPeriod(period = {}, options = {}) {
  const sourceRows = Array.isArray(period.rows) ? period.rows : [];
  const columns = Array.isArray(period.columns) ? period.columns.filter((column) => !BLOCKED.has(String(column?.key || '').toLowerCase())) : [];
  const query = String(options.q || '').slice(0, 200);
  const filtered = sourceRows.filter((row) => rowMatchesView(row, columns, { ...options, q: query }));
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
    daily: filteredDaily(period.daily, numbered, columns),
    search: { query, filteredRows: numbered.length, totalRows: sourceRows.length },
    pagination: { page, pageSize, pageCount, filteredRows: numbered.length, totalRows: sourceRows.length },
    employeeSubtotals: options.allEmployees ? employeeSubtotals(numbered, columns, period.employeePenalties) : [],
  };
}

function transformReport(report = {}, options = {}) {
  const filterOptions = buildFilterOptions(report, options);
  const periods = (Array.isArray(report.periods) ? report.periods : [report]).map((period) => transformPeriod(period, options));
  const allRows = periods.flatMap((period) => period.rows);
  const filteredRows = periods.reduce((sum, period) => sum + period.search.filteredRows, 0);
  const totalRows = periods.reduce((sum, period) => sum + period.search.totalRows, 0);
  const reliable = periods.every((period) => period.summary.reliable);
  const allEmployees = !!options.allEmployees;
  const hasCompanyRevenue = allEmployees && periods.length > 0 && periods.every((period) => (
    period.summary.revenueSource === 'app_report_company_store'
      && period.summary.revenueTotal != null
      && period.summary.revenueBeforeVatTotal != null
  ));
  const costKeys = [...new Set(periods.flatMap((period) => period.columns
    .filter((column) => column?.viewOnly !== true)
    .map((column) => String(column.key || '').toLowerCase())
    .filter((key) => /^c(?:3[3-9]|4[0-6])$/.test(key) && !BLOCKED.has(key))))];
  return {
    ...report,
    periods,
    rows: undefined,
    allEmployees,
    filters: Object.fromEntries(FILTER_KEYS.map((key) => {
      const selected = requestedFilterValue(options, key);
      return [key, selected === '__INVALID_DATE__' ? '' : selected];
    })),
    filterOptions,
    search: { query: String(options.q || '').slice(0, 200), filteredRows, totalRows },
    summary: {
      reliable,
      periodTotal: reliable ? periods.reduce((sum, period) => sum + numeric(period.summary.monthlyTotal), 0) : null,
      annualTotal: reliable ? periods.reduce((sum, period) => sum + numeric(period.summary.annualTotal), 0) : null,
      // Fail-closed company snapshot is an ALL-only contract. A self report owns
      // its already-scoped revenue rows and must not be rejected merely because
      // it does not carry the company snapshot used by mergeEmployeeReports().
      revenueTotal: !allEmployees || hasCompanyRevenue
        ? periods.reduce((sum, period) => sum + numeric(period.summary.revenueTotal), 0) : null,
      revenueBeforeVatTotal: !allEmployees || hasCompanyRevenue
        ? periods.reduce((sum, period) => sum + numeric(period.summary.revenueBeforeVatTotal), 0) : null,
      revenueAllocatedRowCount: allEmployees
        ? (hasCompanyRevenue ? periods.reduce((sum, period) => sum + numeric(period.summary.revenueAllocatedRowCount), 0) : null)
        : null,
      revenueSource: allEmployees
        ? (hasCompanyRevenue ? 'app_report_company_store' : 'company_revenue_unavailable')
        : String(report.summary?.revenueSource || 'app_report_employee_rows'),
      revenueUnavailableReason: allEmployees && !hasCompanyRevenue ? 'Chưa lấy được doanh thu toàn đội.' : '',
      columnTotals: reliable ? Object.fromEntries(costKeys.map((key) => [key, periods.reduce((sum, period) => sum + numeric(period.summary.provisionalColumnTotals?.[key]), 0)])) : null,
      // Số "tạm tính" LUÔN có (tổng phần đã khớp %) để UI hiện kèm nhãn coverage,
      // thay vì bỏ trống. Không thay hành vi fail-closed của columnTotals ở trên.
      provisionalPeriodTotal: periods.reduce((sum, period) => sum + numeric(period.summary.provisionalMonthlyTotal), 0),
      provisionalAnnualTotal: periods.reduce((sum, period) => sum + numeric(period.summary.provisionalAnnualTotal), 0),
      provisionalColumnTotals: Object.fromEntries(costKeys.map((key) => [key, periods.reduce((sum, period) => sum + numeric(period.summary.provisionalColumnTotals?.[key]), 0)])),
      annualColumnKeys: [...new Set(periods.flatMap((period) => period.summary.annualColumnKeys || []))],
      // Penalty is calculated before table filters/pagination and represents the
      // full selected employee/team range. Preserve that backend scope instead of
      // subtracting it from a filtered row slice in the client.
      penaltyAppliedAmount: numberOrNull(report.summary?.penaltyAppliedAmount ?? report.penalty?.appliedAmount),
      afterPenaltyTotal: numberOrNull(report.summary?.afterPenaltyTotal ?? report.penalty?.afterPenaltyTotal),
    },
    displayedRows: allRows.length,
  };
}

function mergeEmployeeReports(reports = [], roster = [], { companyRevenueRowsByPeriod = null } = {}) {
  const employeeNames = new Map(roster.map((employee) => [String(employee.emp_code || '').toUpperCase(), String(employee.name || employee.emp_code || '')]));
  const source = reports.filter(Boolean);
  const periodKeys = [...new Set(source.flatMap((report) => (report.periods || []).map((period) => period.period)))].sort();
  const periods = periodKeys.map((periodKey) => {
    const blocks = source.map((report) => ({ report, period: (report.periods || []).find((item) => item.period === periodKey) })).filter((item) => item.period);
    const columnsByKey = new Map();
    const fallbackCostLabels = {};
    const fallbackCostColumns = [];
    const fallbackViewOnlyLabels = {};
    const fallbackViewOnlyColumns = [];
    // ‼ BỐ CỤC CỘT CỦA MÀN "TẤT CẢ NHÂN VIÊN" PHẢI GIỮ ĐỦ CỘT NHẬN DẠNG + DOANH THU.
    // Sự cố 19/08/2026: bản trước lấy template.columns của ALL từ `fallbackCostColumns`,
    // mà danh sách đó lọc bằng /^c(3[3-9]|4[0-6])$/ nên CHỈ còn 5 cột tỷ lệ. Web dùng
    // template.columns làm BỐ CỤC và bố cục này GHI ĐÈ danh sách mặc định, nên bảng chỉ
    // hiện STT · Nhân viên · C36 · C41 · C43 · C44 · C45 — mất sạch ngày, mã đơn hàng,
    // đơn vị, mã hàng, số lượng, và mất luôn cột `revenueBeforeVat` (chi tiết doanh thu).
    // Bố cục phải là bố cục ĐẦY ĐỦ của từng NV, không phải tập con chi phí.
    const fallbackLayoutColumns = [];
    for (const { period } of blocks) for (const column of period.columns || []) {
      const key = String(column?.key || '').toLowerCase();
      if (!key || BLOCKED.has(key) || columnsByKey.has(key)) continue;
      columnsByKey.set(key, column);
    }
    // Lấy bố cục DÀI NHẤT làm gốc (FULL-TIME phủ PART-TIME), rồi bổ sung cột lạ của
    // mẫu khác vào TRƯỚC 'rowMonthlyTotal' để tổng dòng và ghi chú luôn nằm cuối bảng.
    const layoutCandidates = blocks
      .map(({ period }) => (Array.isArray(period.template?.columns) ? period.template.columns : []).map(String))
      .filter((layout) => layout.length > 0)
      .sort((a, b) => b.length - a.length);
    const normalizeLayoutKey = (rawKey) => (/^c\d+$/i.test(rawKey) ? rawKey.toLowerCase() : rawKey);
    layoutCandidates.forEach((layout, index) => {
      for (const rawKey of layout) {
        const key = normalizeLayoutKey(rawKey);
        if (!key || BLOCKED.has(key.toLowerCase()) || fallbackLayoutColumns.includes(key)) continue;
        // Bố cục GỐC giữ NGUYÊN THỨ TỰ của nó. Chỉ cột lạ của mẫu khác mới chèn vào
        // trước 'rowMonthlyTotal' để tổng dòng và ghi chú vẫn nằm cuối bảng.
        const at = index === 0 ? -1 : fallbackLayoutColumns.indexOf('rowMonthlyTotal');
        if (at < 0) fallbackLayoutColumns.push(key);
        else fallbackLayoutColumns.splice(at, 0, key);
      }
    });
    for (const { period } of blocks) {
      for (const rawKey of Array.isArray(period.template?.columns) ? period.template.columns : []) {
        const key = String(rawKey || '').toLowerCase();
        if (/^c(?:3[3-9]|4[0-6])$/.test(key) && !BLOCKED.has(key) && !fallbackCostColumns.includes(key)) fallbackCostColumns.push(key);
      }
      for (const [rawKey, label] of Object.entries(period.template?.costLabels || {})) {
        const key = String(rawKey || '').toLowerCase();
        if (/^c(?:3[3-9]|4[0-6])$/.test(key) && !BLOCKED.has(key) && !fallbackCostLabels[key]) fallbackCostLabels[key] = String(label || key);
      }
      for (const rawKey of Array.isArray(period.template?.viewOnlyColumns) ? period.template.viewOnlyColumns : []) {
        const key = String(rawKey || '').toLowerCase();
        if (/^c(?:3[3-9]|4[0-6])$/.test(key) && !BLOCKED.has(key) && !fallbackViewOnlyColumns.includes(key)) fallbackViewOnlyColumns.push(key);
      }
      for (const [rawKey, label] of Object.entries(period.template?.viewOnlyLabels || {})) {
        const key = String(rawKey || '').toLowerCase();
        if (/^c(?:3[3-9]|4[0-6])$/.test(key) && !BLOCKED.has(key) && !fallbackViewOnlyLabels[key]) fallbackViewOnlyLabels[key] = String(label || key);
      }
    }
    const columns = [...columnsByKey.values()].sort((a, b) => Number(String(a.key).slice(1)) - Number(String(b.key).slice(1)));
    const rows = blocks.flatMap(({ report, period }) => {
      const employeeCode = String(report.empCode || '').toUpperCase();
      const employeeName = employeeNames.get(employeeCode) || employeeCode;
      return (period.rows || []).map((row) => ({ ...row, employeeCode, employeeName }));
    });
    // ‼ Tách 2 nguyên nhân "chưa khớp" — trước đây gộp chung nên coverage ALL
    // (80,3%) đá nhau với tab "Mặt hàng thiếu %" (98,7%):
    //   a) catalog THIẾU % thật  → đúng phần DataHub cần điền (khớp tab thiếu %).
    //   b) NV KHÔNG lấy được nguồn tỷ lệ (sourceOutcome != 'ok') → mọi dòng của NV
    //      đó hiện như chưa khớp, nhưng KHÔNG phải catalog thiếu; đây là lỗi tạm
    //      thời/nguồn. Đưa vào coverage sẽ báo sai và làm số trôi mỗi lần cache.
    // ‼ `ok_stale_rates` = nguồn tươi kẹt nhưng App Report còn bản % đã lưu ⇒ NV đó
    // CÓ SỐ, chỉ là số cũ. Xếp họ vào "không lấy được" là vứt bỏ chính lưới an toàn
    // đã dựng, và là gốc của cảnh "khi đủ khi thiếu" + bot nhắn tin báo thiếu oan.
    const available = blocks.filter(({ report }) => employeeCost.isUsableOutcome(report.sourceOutcome || 'ok'));
    const unavailable = blocks.filter(({ report }) => !employeeCost.isUsableOutcome(report.sourceOutcome || 'ok'));
    // Vẫn phải NÓI RA là số cũ — dùng được không có nghĩa là giấu.
    const staleEmployees = blocks
      .filter(({ report }) => String(report.sourceOutcome || '') === 'ok_stale_rates')
      .map(({ report }) => String(report.empCode || '').toUpperCase()).filter(Boolean);
    const matchedRows = available.reduce((sum, item) => sum + numeric(item.period.match?.matchedRows), 0);
    const totalRows = available.reduce((sum, item) => sum + numeric(item.period.match?.totalRows), 0);
    const unavailableEmployees = unavailable.map(({ report }) => String(report.empCode || '').toUpperCase()).filter(Boolean);
    // Chỉ phát ra reason code allowlist; không đưa message upstream/key/payload vào UI.
    const unavailableReasons = Object.fromEntries(unavailable.map(({ report }) => {
      const emp = String(report.empCode || '').toUpperCase();
      const outcome = String(report.sourceOutcome || '').toLowerCase();
      const reason = outcome === 'not_configured' ? 'not_configured'
        : outcome === 'deadline' ? 'deadline'
          : outcome === 'source_empty' || outcome === 'rate_policy_missing' ? 'source_empty'
          : outcome === 'upstream_busy' ? 'upstream_busy'
          : outcome === 'source_error' ? 'source_error'
            : outcome === 'upstream_rejected' || outcome === 'upstream_unauthorized' || /^upstream_4\d\d$/.test(outcome)
              ? 'upstream_rejected' : 'upstream_unavailable';
      return [emp, reason];
    }).filter(([emp]) => emp));
    const rate = totalRows ? +(matchedRows / totalRows * 100).toFixed(1) : null;
    const threshold = Number(blocks.find((item) => Number.isFinite(Number(item.period.match?.threshold)))?.period.match.threshold || 90);
    const low = rate != null && rate < threshold;
    const rateEffectiveFroms = [...new Set(blocks
      .map(({ period, report }) => {
        const explicit = period.rateEffectiveFrom || report.rateEffectiveFrom;
        if (explicit) return String(explicit);
        // Exact snapshots intentionally stay byte-stable in the employee payload.
        // At ALL merge time, infer "exact this period" only when the upstream was
        // healthy and supplied policy columns; revenue-only fail-closed rows must
        // never be mislabeled as an exact policy.
        // ‼ CỐ Ý đòi 'ok' THẬT (không nhận số cũ): bản % cũ hiển thị được nhưng
        // KHÔNG được đóng dấu là chính sách hiệu lực của kỳ này.
        const exact = report.sourceOutcome === 'ok'
          && Array.isArray(period.columns) && period.columns.length > 0
          ? period.period : '';
        return String(exact || '');
      })
      .filter(Boolean))].sort();
    const rateSources = [...new Set(blocks.map(({ period, report }) => String(period.rateSource || report.rateSource || '')).filter(Boolean))];
    const pinnedAts = [...new Set(blocks.map(({ period, report }) => String(period.ratePinnedAt || report.ratePinnedAt || '')).filter(Boolean))];
    const allPinned = blocks.length > 0 && rateSources.length === 1 && rateSources[0] === 'local_pinned';
    // Report NV dùng kỳ hiển thị `MM.YYYY`, còn snapshot toàn công ty được chụp
    // theo kỳ chuẩn `YYYY-MM`. Khi fan-out chi phí hết hạn, lỗi lệch định dạng này
    // từng làm snapshot doanh thu có thật bị đọc thành mảng rỗng. Chỉ đổi biểu diễn
    // khóa kỳ; tuyệt đối không suy doanh thu từ tập report NV có thể thiếu.
    const uiPeriodMatch = /^(0[1-9]|1[0-2])\.(\d{4})$/.exec(String(periodKey || '').trim());
    const isoPeriodMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(periodKey || '').trim());
    const companyRevenuePeriodKeys = [...new Set([
      String(periodKey || '').trim(),
      uiPeriodMatch ? `${uiPeriodMatch[2]}-${uiPeriodMatch[1]}` : '',
      isoPeriodMatch ? `${isoPeriodMatch[2]}.${isoPeriodMatch[1]}` : '',
    ].filter(Boolean))];
    const companyRevenueSnapshotKey = companyRevenueRowsByPeriod instanceof Map
      ? companyRevenuePeriodKeys.find((key) => companyRevenueRowsByPeriod.has(key))
      : undefined;
    const hasCompanyRevenueSnapshot = companyRevenueSnapshotKey !== undefined;
    const companyRevenueRows = hasCompanyRevenueSnapshot
      ? (companyRevenueRowsByPeriod.get(companyRevenueSnapshotKey) || [])
      : [];
    const unavailableEmployeeSet = new Set(unavailableEmployees);
    const unavailablePairs = hasCompanyRevenueSnapshot
      ? companyRevenueRows.filter((row) => unavailableEmployeeSet.has(String(
        row?.emp_code ?? row?.empCode ?? row?.employeeCode ?? '',
      ).trim().toUpperCase())).length
      : unavailable.reduce((sum, item) => sum + numeric(item.period.match?.totalRows), 0);
    const companyRevenueTotal = companyRevenueRows.reduce((sum, row) => (
      sum + numeric(row?.revenue ?? row?.tong_tien ?? row?.REVENUE ?? row?.TONG_TIEN)
    ), 0);
    const companyRevenueBeforeVatTotal = companyRevenueRows.reduce((sum, row) => {
      const revenue = numeric(row?.revenue ?? row?.tong_tien ?? row?.REVENUE ?? row?.TONG_TIEN);
      return sum + employeeCost.revenueBeforeVatOf(revenue);
    }, 0);
    const allocatedRevenueRowCount = companyRevenueRows.filter((row) => {
      const code = String(row?.emp_code ?? row?.empCode ?? row?.employeeCode ?? '').trim().toUpperCase();
      return code && code !== 'UNALLOCATED';
    }).length;
    return {
      empCode: 'ALL', period: periodKey, columns, rows,
      rateEffectiveFrom: rateEffectiveFroms.length === 1 ? rateEffectiveFroms[0] : '',
      rateEffectiveFroms,
      rateSource: allPinned ? 'local_pinned' : '',
      ratePinnedAt: allPinned && pinnedAts.length === 1 ? pinnedAts[0] : '',
      // Only the report's selected/final month owns a PHẠT v3.4 summary.
      // Keeping the map in the merged backend payload lets filtered ALL
      // subtotals retain the server-calculated penalty without client math.
      employeePenalties: Object.fromEntries(blocks.flatMap(({ report }) => {
        const employeeCode = String(report.empCode || '').toUpperCase();
        return periodKey === report.to && employeeCode && report.penalty
          ? [[employeeCode, { ...report.penalty }]]
          : [];
      })),
      template: {
        key: 'all',
        label: 'TẤT CẢ NHÂN VIÊN',
        // Bố cục ĐẦY ĐỦ; chỉ lùi về tập chi phí khi không NV nào khai được bố cục.
        columns: fallbackLayoutColumns.length ? fallbackLayoutColumns : fallbackCostColumns,
        costLabels: fallbackCostLabels,
        viewOnlyColumns: fallbackViewOnlyColumns, viewOnlyLabels: fallbackViewOnlyLabels,
      },
      match: {
        matchedRows, totalRows, rate, threshold, low,
        unavailablePairs, unavailableEmployees, unavailableEmployeeCount: unavailableEmployees.length,
        unavailableReasons,
        staleEmployees, staleEmployeeCount: staleEmployees.length,
      },
      // Còn NV chưa lấy được nguồn ⇒ tổng chưa đầy đủ ⇒ vẫn để "tạm tính".
      // ALL phải mang doanh thu của chính các dòng đã gộp ngay từ payload thô.
      // Consumer không được phụ thuộc việc transform lại summary mới có số fallback.
      summary: {
        reliable: !low && unavailableEmployees.length === 0,
        // Doanh thu là snapshot TOÀN ĐỘI của kho App Report, không phụ thuộc
        // report chi phí NV nào về kịp. Thiếu DN024 không được làm "tổng"
        // tụt 80% như tai nạn 10/08.
        // Fail closed: tuyệt đối không dựng "tổng đội" từ tập report chi phí
        // có thể thiếu NV. Một số thấp nhưng trông như đủ nguy hiểm hơn dấu —.
        revenueTotal: hasCompanyRevenueSnapshot ? companyRevenueTotal : null,
        revenueBeforeVatTotal: hasCompanyRevenueSnapshot ? companyRevenueBeforeVatTotal : null,
        revenueAllocatedRowCount: hasCompanyRevenueSnapshot ? allocatedRevenueRowCount : null,
        revenueSource: hasCompanyRevenueSnapshot ? 'app_report_company_store' : 'company_revenue_unavailable',
        revenueUnavailableReason: hasCompanyRevenueSnapshot ? '' : 'Chưa lấy được doanh thu toàn đội.',
      },
      daily: { reliable: false, reason: 'Chế độ tất cả nhân viên dùng bảng tổng hợp phân trang.', dates: [], totals: [] },
    };
  });
  const rateEffectiveFroms = [...new Set(periods.flatMap((period) => period.rateEffectiveFroms || []))].sort();
  const pinnedPeriods = periods.filter((period) => period.rateSource === 'local_pinned');
  const pinnedAts = [...new Set(pinnedPeriods.map((period) => period.ratePinnedAt).filter(Boolean))];
  const allPinned = periods.length > 0 && pinnedPeriods.length === periods.length;
  // Hợp đồng KPI thuộc App Report nên metadata tầng ngoài ALL phải nhất quán với
  // từng period. Để `columns: []` ở đây là bẫy: consumer nào đọc top-level thay vì
  // `periods[0]` sẽ làm mất toàn bộ ô khi nguồn không có cột.
  const mergedCostColumns = [...new Set(periods.flatMap((period) => period.template?.columns || []))];
  const mergedCostLabels = Object.fromEntries(periods.flatMap((period) => (
    Object.entries(period.template?.costLabels || {})
  )).filter(([key], index, entries) => entries.findIndex(([candidate]) => candidate === key) === index));
  const mergedViewOnlyColumns = [...new Set(periods.flatMap((period) => period.template?.viewOnlyColumns || []))];
  const mergedViewOnlyLabels = Object.fromEntries(periods.flatMap((period) => (
    Object.entries(period.template?.viewOnlyLabels || {})
  )).filter(([key], index, entries) => entries.findIndex(([candidate]) => candidate === key) === index));
  return {
    empCode: 'ALL', employeeName: 'Tất cả nhân viên', allEmployees: true,
    template: {
      key: 'all', label: 'TẤT CẢ NHÂN VIÊN', columns: mergedCostColumns, costLabels: mergedCostLabels,
      viewOnlyColumns: mergedViewOnlyColumns, viewOnlyLabels: mergedViewOnlyLabels,
    },
    from: source[0]?.from || periodKeys[0] || '', to: source[0]?.to || periodKeys.at(-1) || '',
    rateEffectiveFrom: rateEffectiveFroms.length === 1 ? rateEffectiveFroms[0] : '',
    rateEffectiveFroms,
    rateSource: allPinned ? 'local_pinned' : '',
    ratePinnedAt: allPinned && pinnedAts.length === 1 ? pinnedAts[0] : '',
    periods,
    employees: roster.map((employee) => ({ empCode: employee.emp_code, employeeName: employee.name })),
    bonus: employeeBonus.aggregateBonusSummaries(source, roster),
    penalty: employeePenaltyAggregate.aggregatePenaltySummaries(source),
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  MAX_PAGE_SIZE,
  UNASSIGNED_PROVINCE,
  validIsoDate,
  normalizeVietnamese,
  searchTokens,
  searchForms,
  rowSearchDocument,
  rowMatches,
  rowMatchesFilters,
  rowMatchesView,
  normalizeSortKey,
  sortRows,
  summarizeRows,
  numberOrNull,
  employeeSubtotals,
  facetOptions,
  buildFilterOptions,
  filteredDaily,
  transformPeriod,
  transformReport,
  mergeEmployeeReports,
};
