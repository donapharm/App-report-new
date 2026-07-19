'use strict';

const ExcelJS = require('exceljs');
const crypto = require('crypto');
const dormant = require('./dormantQlnb');
const { reviewState } = require('./dormantNotifications');
const { STATE_NAME } = require('./dormantService');

const FILTER_ENUMS = Object.freeze({
  cst_band: new Set(['all', 'missing', 'le10', '10_30', 'gt30', 'full']),
  dormant_status: new Set(['all', 'dormant', 'not_activated', 'normal']),
  review_status: new Set(['all', 'unplanned', 'in_progress', 'upcoming', 'due', 'overdue']),
  c30_status: new Set(['all', 'available', 'actionable', 'none']),
});
const CRITICAL_EXPORT_FIELDS = Object.freeze([
  'emp_code', 'unit_code', 'qlnb_code', 'contractor_code', 'product_name',
  'cst_initial', 'cst_remaining',
]);
const MONEY_FMT = '#,##0;[Red](#,##0)';
const QTY_FMT = '#,##0.##;[Red](#,##0.##)';
const BLUE = '1F4E78';
const GREEN = '1F6F54';

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function dateOnly(value) { const s = text(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function normalizeSearch(value) {
  return text(value).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function uniqueList(value, { upperCase = false, max = 100 } = {}) {
  const source = Array.isArray(value) ? value : text(value).split(',');
  return [...new Set(source.map((x) => upperCase ? upper(x) : text(x)).filter(Boolean))].slice(0, max);
}
function enumValue(value, name) {
  const normalized = text(value || 'all').toLowerCase();
  return FILTER_ENUMS[name].has(normalized) ? normalized : 'all';
}
function normalizePeriod(value) {
  const raw = text(value);
  let match = raw.match(/^(\d{2})\.(\d{4})$/);
  if (match) return `${match[2]}-${match[1]}`;
  match = raw.match(/^(\d{4})-(\d{2})$/);
  return match ? raw : raw;
}
function normalizeFilters(input = {}) {
  return {
    period: normalizePeriod(input.period || input.ky),
    emp_codes: uniqueList(input.emp_codes || input.empCodes, { upperCase: true, max: 80 }),
    provinces: uniqueList(input.provinces || input.province, { max: 30 }),
    routes: uniqueList(input.routes || input.route, { upperCase: true, max: 10 }),
    units: uniqueList(input.units || input.unit, { max: 200 }),
    contractors: uniqueList(input.contractors || input.contractor, { upperCase: true, max: 100 }),
    qlnb_codes: uniqueList(input.qlnb_codes || input.qlnbCodes || input.qlnb, { max: 500 }),
    query: text(input.query || input.q).slice(0, 160),
    cst_band: enumValue(input.cst_band || input.cstBand, 'cst_band'),
    dormant_status: enumValue(input.dormant_status || input.dormantStatus, 'dormant_status'),
    review_status: enumValue(input.review_status || input.reviewStatus, 'review_status'),
    c30_status: enumValue(input.c30_status || input.c30Status, 'c30_status'),
  };
}
function hubToUi(period) {
  const match = text(period).match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}.${match[1]}` : text(period);
}
function pairKey(unitCode, qlnbCode) { return `${text(unitCode)}\u001f${text(qlnbCode)}`; }
function businessKey(empCode, unitCode, qlnbCode) { return `${upper(empCode)}\u001f${text(unitCode)}\u001f${text(qlnbCode)}`; }
function activeInPeriod(row, period) {
  return row?.active !== false && text(row?.effective_from) <= period && (!row?.effective_to || text(row.effective_to) >= period);
}
function cstPct(row) {
  const initial = Number(row?.cst_initial);
  const remaining = Number(row?.cst_remaining);
  return Number.isFinite(initial) && initial > 0 && Number.isFinite(remaining) ? remaining / initial * 100 : null;
}
function cstBandMatch(row, band) {
  if (band === 'all') return true;
  const pct = cstPct(row);
  if (band === 'missing') return pct == null;
  if (pct == null) return false;
  if (band === 'le10') return pct <= 10;
  if (band === '10_30') return pct > 10 && pct <= 30;
  if (band === 'gt30') return pct > 30;
  if (band === 'full') return pct >= 99.5;
  return true;
}
function rowSearchText(row) {
  return normalizeSearch([
    row.emp_code, row.emp_name, row.province, row.route, row.contractor_code,
    row.unit_code, row.qlnb_code, row.product_name, row.active_ingredient, row.strength, row.uom,
  ].filter(Boolean).join(' '));
}
function c30Match(row, status) {
  if (status === 'all') return true;
  const available = number(row.c30_option_qty) > 0;
  const actionable = row.c30_actionable === true;
  if (status === 'available') return available;
  if (status === 'actionable') return actionable;
  return !available;
}
function filterCatalogRows(rows = [], filters = {}) {
  const q = normalizeSearch(filters.query);
  return rows.filter((row) => {
    if (filters.emp_codes.length && !filters.emp_codes.includes(upper(row.emp_code))) return false;
    if (filters.provinces.length && !filters.provinces.includes(text(row.province))) return false;
    if (filters.routes.length && !filters.routes.includes(upper(row.route))) return false;
    if (filters.units.length && !filters.units.includes(text(row.unit_code))) return false;
    if (filters.contractors.length && !filters.contractors.includes(upper(row.contractor_code))) return false;
    if (filters.qlnb_codes.length && !filters.qlnb_codes.includes(text(row.qlnb_code))) return false;
    if (q && !q.split(' ').every((token) => rowSearchText(row).includes(token))) return false;
    if (!cstBandMatch(row, filters.cst_band)) return false;
    if (filters.dormant_status !== 'all' && row.dormant_status !== filters.dormant_status) return false;
    if (filters.review_status !== 'all' && row.review_status !== filters.review_status) return false;
    if (!c30Match(row, filters.c30_status)) return false;
    return true;
  });
}
function periodValue(ky) {
  const match = text(ky).match(/^(\d{2})\.(\d{4})$/);
  return match ? Number(`${match[2]}${match[1]}`) : 0;
}
function resolveAsOf(store, salesRows, selectedKy) {
  const period = store.listPeriods().find((item) => item.ky === selectedKy);
  if (selectedKy && typeof store.periodFreshness === 'function') {
    const through = dateOnly(store.periodFreshness(selectedKy)?.throughDate);
    if (through) return through;
  }
  return dateOnly(period?.dateTo) || dormant.resolveDataAsOf({ salesRows });
}
function stateAtDate(rawState, asOf) {
  const source = rawState && typeof rawState === 'object' ? rawState : { version: 1, items: {} };
  const items = {};
  for (const [key, value] of Object.entries(source.items || {})) {
    const audit = (value?.audit || []).filter((entry) => {
      const at = dateOnly(entry?.at);
      return !at || at <= asOf;
    });
    const starts = audit.filter((entry) => ['detected_dormant', 'reopened_dormant'].includes(entry?.type));
    if (!starts.length) {
      const firstDetected = dateOnly(value?.first_detected_at);
      if (firstDetected && firstDetected <= asOf) items[key] = { ...value, audit };
      continue;
    }
    const start = starts.at(-1);
    const startIndex = audit.lastIndexOf(start);
    const historical = {
      first_detected_at: dateOnly(start.at),
      last_activity_at: dateOnly(start?.changes?.last_activity_at),
      status: null,
      next_follow_up: null,
      note: '',
      resolved_at: null,
      resolution: null,
      cycle: starts.length,
      action_cycle: 0,
      audit,
    };
    for (const entry of audit.slice(startIndex + 1)) {
      const changes = entry?.changes && typeof entry.changes === 'object' ? entry.changes : {};
      if (entry.type === 'action_updated') {
        Object.assign(historical, changes, { action_updated_at: dateOnly(entry.at) });
      } else if (entry.type === 'reactivated') {
        Object.assign(historical, changes, { resolved_at: dateOnly(entry.at), resolution: 'reactivated_by_positive_order' });
      }
    }
    items[key] = historical;
  }
  return { ...source, items };
}
function analyzeEmployeeReadOnly({ store, persist, empCode, periodUi }) {
  const scope = { empCode: upper(empCode) };
  const selectedValue = periodValue(periodUi);
  const kys = store.periodKys().filter((ky) => !selectedValue || periodValue(ky) <= selectedValue);
  const salesRows = store.getRowsRange({ kys, scope });
  const selectedPeriod = /^\d{2}\.\d{4}$/.test(periodUi) ? `${periodUi.slice(3)}-${periodUi.slice(0, 2)}` : '';
  const cstRows = store.getCst({ scope }).filter((row) => !selectedPeriod || activeInPeriod(row, selectedPeriod));
  const asOf = resolveAsOf(store, salesRows, periodUi);
  if (!asOf) return { as_of: null, items: [], not_activated: [], summary: { dormant: 0, not_activated: 0 } };
  const state = stateAtDate(persist.load(STATE_NAME, { version: 1, items: {} }), asOf);
  return dormant.analyze({
    salesRows,
    cstRows,
    dataAsOf: asOf,
    scope,
    state,
    maxPriority: 5,
  });
}
function saleStatsByPair(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = pairKey(row.unit_code, row.iit_code);
    if (key === '\u001f') continue;
    const current = map.get(key) || { revenue: 0, quantity: 0, last_order_date: null };
    current.revenue += number(row.revenue);
    current.quantity += number(row.quantity);
    const positive = number(row.revenue) > 0 || number(row.quantity) > 0;
    const date = dateOnly(row.date);
    if (positive && date && (!current.last_order_date || date > current.last_order_date)) current.last_order_date = date;
    map.set(key, current);
  }
  return map;
}
function attachEmployeeSignals({ rows, empCode, analysis, c30ByPair, periodSales, reviewAsOf = null }) {
  const dormantByKey = new Map((analysis.items || []).map((item) => [businessKey(item.emp_code, item.unit_code, item.iit_code), item]));
  const notActivated = new Map((analysis.not_activated || []).map((item) => [businessKey(item.emp_code, item.unit_code, item.iit_code), item]));
  const salesByPair = saleStatsByPair(periodSales);
  const today = reviewAsOf || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return rows.map((row) => {
    const key = businessKey(empCode, row.unit_code, row.qlnb_code);
    const dormantItem = dormantByKey.get(key);
    const inactiveItem = notActivated.get(key);
    const c30 = c30ByPair.get(pairKey(row.unit_code, row.qlnb_code))?.c30 || null;
    const sales = salesByPair.get(pairKey(row.unit_code, row.qlnb_code)) || { revenue: 0, quantity: 0, last_order_date: null };
    const review = dormantItem ? reviewState(dormantItem, today) : { status: 'none', days_left: null, overdue_days: 0 };
    return {
      ...row,
      cst_pct: cstPct(row),
      dormant_status: dormantItem ? 'dormant' : inactiveItem ? 'not_activated' : 'normal',
      days_idle: dormantItem?.days_idle ?? null,
      last_order_date: dormantItem?.last_activity_at || sales.last_order_date || null,
      action_status: dormantItem?.action?.status || null,
      action_note: dormantItem?.action?.note || '',
      next_follow_up: dormantItem?.action?.next_follow_up || null,
      review_status: review.status,
      review_days_left: review.days_left,
      overdue_days: review.overdue_days,
      c30_option_qty: c30?.option_qty ?? null,
      c30_status: c30?.status_label || '',
      c30_actionable: c30?.actionable === true,
      period_revenue: sales.revenue,
      period_quantity: sales.quantity,
    };
  });
}
function assertEmployeeIsolation(rows, empCode) {
  const emp = upper(empCode);
  const leaked = rows.find((row) => upper(row.emp_code) !== emp);
  if (leaked) throw Object.assign(new Error(`Báo cáo ${emp} chứa dữ liệu ngoài phạm vi nhân viên.`), { code: 'FILTERED_REPORT_SCOPE_LEAK', status: 500 });
  return true;
}
function summarizeEmployee({ store, empCode, periodUi, allPeriodSales, filteredRows, analysis }) {
  const employeeRevenue = allPeriodSales.reduce((sum, row) => sum + number(row.revenue), 0);
  const filteredRevenue = filteredRows.reduce((sum, row) => sum + number(row.period_revenue), 0);
  const target = store.getTargets({ ky: periodUi, scope: { empCode } }).reduce((sum, row) => sum + number(row.target), 0);
  const revenueBeforeVat = Math.round(employeeRevenue / 1.05);
  const cstInitial = filteredRows.reduce((sum, row) => sum + number(row.cst_initial), 0);
  const cstRemaining = filteredRows.reduce((sum, row) => sum + number(row.cst_remaining), 0);
  const reviews = filteredRows.reduce((result, row) => {
    result[row.review_status] = (result[row.review_status] || 0) + 1;
    return result;
  }, {});
  return {
    emp_code: empCode,
    emp_name: store.findUserByCode(empCode)?.name || empCode,
    period: periodUi,
    row_count: filteredRows.length,
    unit_count: new Set(filteredRows.map((row) => row.unit_code).filter(Boolean)).size,
    qlnb_count: new Set(filteredRows.map((row) => row.qlnb_code).filter(Boolean)).size,
    cst_initial: cstInitial,
    cst_remaining: cstRemaining,
    cst_remaining_pct: cstInitial > 0 ? +(cstRemaining / cstInitial * 100).toFixed(1) : null,
    dormant_count: filteredRows.filter((row) => row.dormant_status === 'dormant').length,
    not_activated_count: filteredRows.filter((row) => row.dormant_status === 'not_activated').length,
    c30_count: filteredRows.filter((row) => number(row.c30_option_qty) > 0).length,
    review_due_count: number(reviews.due) + number(reviews.overdue),
    review_overdue_count: number(reviews.overdue),
    employee_revenue: employeeRevenue,
    employee_revenue_before_vat: revenueBeforeVat,
    filtered_revenue: filteredRevenue,
    target,
    target_pct: target > 0 ? +(revenueBeforeVat / target * 100).toFixed(1) : null,
    as_of: analysis.as_of || null,
  };
}
function safeExcelText(value) {
  const valueText = text(value);
  return /^[=+\-@]/.test(valueText) ? `'${valueText}` : valueText;
}
function setHeader(row, color = GREEN) {
  row.height = 30;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
}
function setupPrint(sheet, titleRows = '1:2') {
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: titleRows, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  sheet.headerFooter = { oddFooter: '&LApp Report · Báo cáo cá nhân&RTrang &P/&N' };
}
function addSummarySheet(workbook, report) {
  const sheet = workbook.addWorksheet('Tổng quan cá nhân', { views: [{ state: 'frozen', ySplit: 2 }] });
  sheet.columns = [{ width: 30 }, { width: 24 }, { width: 30 }, { width: 24 }];
  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = `BÁO CÁO CÁ NHÂN — ${report.summary.emp_code} · ${report.summary.emp_name} — ${report.summary.period}`;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BLUE}` } };
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;
  const values = [
    ['Phạm vi', 'Giá trị', 'Kết quả', 'Giá trị'],
    ['Nhân viên', `${report.summary.emp_code} · ${report.summary.emp_name}`, 'Kỳ báo cáo', report.summary.period],
    ['Danh mục sau lọc', report.summary.row_count, 'Đơn vị / QLNB', `${report.summary.unit_count} / ${report.summary.qlnb_count}`],
    ['CST ban đầu', report.summary.cst_initial, 'CST còn lại', report.summary.cst_remaining],
    ['Tỷ lệ CST còn lại', report.summary.cst_remaining_pct == null ? '—' : report.summary.cst_remaining_pct / 100, 'Có C30', report.summary.c30_count],
    ['QLNB ngủ đông', report.summary.dormant_count, 'Chưa kích hoạt', report.summary.not_activated_count],
    ['Đến/quá hạn review', report.summary.review_due_count, 'Quá hạn', report.summary.review_overdue_count],
    ['Doanh thu kỳ của NV', report.summary.employee_revenue, 'Doanh thu trong phạm vi lọc', report.summary.filtered_revenue],
    ['Doanh thu trước VAT', report.summary.employee_revenue_before_vat, 'Target tháng', report.summary.target],
    ['Tỷ lệ đạt target', report.summary.target_pct == null ? '—' : report.summary.target_pct / 100, 'Dữ liệu đến', report.summary.as_of || '—'],
    ['Bộ lọc áp dụng', report.filter_text || 'Tất cả phạm vi được giao', '', ''],
    ['Nguồn C30', report.c30_source?.ready ? `Sẵn sàng · ${number(report.c30_source.rowCount)} dòng nguồn` : 'Chưa sẵn sàng · để trống C30, không suy diễn', '', ''],
  ];
  values.forEach((row, index) => {
    const excelRow = sheet.addRow(row);
    if (index === 0) setHeader(excelRow, BLUE);
  });
  ['B5', 'D5'].forEach((cell) => { sheet.getCell(cell).numFmt = QTY_FMT; });
  ['B9', 'D9', 'B10', 'D10'].forEach((cell) => { sheet.getCell(cell).numFmt = MONEY_FMT; });
  ['B6', 'B11'].forEach((cell) => { sheet.getCell(cell).numFmt = '0.0%'; });
  [12, 13].forEach((rowNumber) => { sheet.getRow(rowNumber).height = 42; sheet.getCell(`B${rowNumber}`).alignment = { wrapText: true, vertical: 'top' }; });
  setupPrint(sheet, '1:2');
}
function addCatalogSheet(workbook, report, { actionOnly = false } = {}) {
  const rows = actionOnly ? report.rows.filter((row) => row.dormant_status !== 'normal' || ['due', 'overdue', 'upcoming', 'unplanned'].includes(row.review_status)) : report.rows;
  const sheet = workbook.addWorksheet(actionOnly ? 'QLNB cần hành động' : 'Danh mục CST', { views: [{ state: 'frozen', ySplit: 2 }] });
  const columns = [
    ['STT', 'stt', 7], ['Tuyến', 'route', 9], ['Mã nhà thầu', 'contractor_code', 16], ['Mã đơn vị', 'unit_code', 24],
    ['Mã QLNB', 'qlnb_code', 27], ['Tên thuốc', 'product_name', 27], ['Hoạt chất + hàm lượng', 'ingredient', 31], ['ĐVT', 'uom', 10],
    ['Giá trúng thầu', 'bid_price', 16], ['CST ban đầu', 'cst_initial', 15], ['CST còn lại', 'cst_remaining', 15], ['% CST còn lại', 'cst_pct', 13],
    ['SL tùy chọn C30', 'c30_option_qty', 17], ['Trạng thái QLNB', 'dormant_label', 16], ['Đơn dương cuối', 'last_order_date', 13], ['Số ngày ngủ', 'days_idle', 12],
    ['Kết quả triển khai', 'action_status', 18], ['Trạng thái review', 'review_status', 16], ['Ngày theo dõi', 'next_follow_up', 13], ['Ghi chú kế hoạch', 'action_note', 30],
    ['Doanh thu kỳ theo cặp', 'period_revenue', 19], ['Số lượng kỳ', 'period_quantity', 14],
  ];
  sheet.columns = columns.map(([, key, width]) => ({ key, width }));
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell(1, 1).value = `${actionOnly ? 'QLNB CẦN HÀNH ĐỘNG' : 'DANH MỤC – CST'} — ${report.summary.emp_code} · ${rows.length.toLocaleString('vi-VN')} dòng`;
  sheet.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BLUE}` } };
  sheet.getCell(1, 1).alignment = { horizontal: 'center' };
  const header = sheet.getRow(2); columns.forEach(([label], index) => { header.getCell(index + 1).value = label; }); setHeader(header);
  rows.forEach((row, index) => {
    const excelRow = sheet.addRow({
      stt: index + 1, route: safeExcelText(row.route), contractor_code: safeExcelText(row.contractor_code), unit_code: safeExcelText(row.unit_code),
      qlnb_code: safeExcelText(row.qlnb_code), product_name: safeExcelText(row.product_name), ingredient: safeExcelText([row.active_ingredient, row.strength].filter(Boolean).join(' · ')), uom: safeExcelText(row.uom),
      bid_price: row.bid_price == null ? null : number(row.bid_price), cst_initial: row.cst_initial == null ? null : number(row.cst_initial), cst_remaining: row.cst_remaining == null ? null : number(row.cst_remaining), cst_pct: row.cst_pct == null ? null : row.cst_pct / 100,
      c30_option_qty: row.c30_option_qty == null ? null : number(row.c30_option_qty), dormant_label: row.dormant_status === 'dormant' ? 'Ngủ đông ≥60 ngày' : row.dormant_status === 'not_activated' ? 'Chưa kích hoạt' : 'Đang hoạt động',
      last_order_date: row.last_order_date || '', days_idle: row.days_idle, action_status: safeExcelText(row.action_status), review_status: safeExcelText(row.review_status === 'none' ? '' : row.review_status),
      next_follow_up: row.next_follow_up || '', action_note: safeExcelText(row.action_note), period_revenue: number(row.period_revenue), period_quantity: number(row.period_quantity),
    });
    excelRow.height = 32;
  });
  ['bid_price', 'period_revenue'].forEach((key) => { sheet.getColumn(key).numFmt = MONEY_FMT; });
  ['cst_initial', 'cst_remaining', 'c30_option_qty', 'period_quantity'].forEach((key) => { sheet.getColumn(key).numFmt = QTY_FMT; });
  sheet.getColumn('cst_pct').numFmt = '0.0%';
  sheet.eachRow((row, rowNumber) => row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle', horizontal: rowNumber === 2 ? 'center' : undefined, wrapText: true };
    cell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
  }));
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };
  setupPrint(sheet, '1:2');
}
async function excelBuffer(report) {
  assertEmployeeIsolation(report.rows, report.summary.emp_code);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DONAPHARM App Report'; workbook.created = new Date();
  addSummarySheet(workbook, report);
  addCatalogSheet(workbook, report);
  addCatalogSheet(workbook, report, { actionOnly: true });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
async function summaryExcelBuffer(result) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DONAPHARM App Report'; workbook.created = new Date();
  const sheet = workbook.addWorksheet('Tổng hợp CEO', { views: [{ state: 'frozen', ySplit: 3 }] });
  const columns = [
    ['Mã NV', 'emp_code', 12], ['Họ tên', 'emp_name', 23], ['Số dòng', 'row_count', 11], ['Đơn vị', 'unit_count', 10], ['QLNB', 'qlnb_count', 10],
    ['CST ban đầu', 'cst_initial', 15], ['CST còn lại', 'cst_remaining', 15], ['% CST còn lại', 'cst_remaining_pct', 14],
    ['Ngủ đông', 'dormant_count', 11], ['Chưa kích hoạt', 'not_activated_count', 14], ['Có C30', 'c30_count', 10],
    ['Đến/quá hạn review', 'review_due_count', 17], ['Quá hạn', 'review_overdue_count', 11], ['Doanh thu kỳ NV', 'employee_revenue', 19],
    ['Doanh thu trước VAT', 'employee_revenue_before_vat', 20], ['Target', 'target', 18], ['% đạt target', 'target_pct', 13], ['Doanh thu phạm vi lọc', 'filtered_revenue', 22],
  ];
  sheet.columns = columns.map(([, key, width]) => ({ key, width }));
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell(1, 1).value = `TỔNG HỢP BÁO CÁO NHÂN VIÊN — ${result.period_ui} — ${result.reports.length} báo cáo`;
  sheet.getCell(1, 1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BLUE}` } };
  sheet.getCell(1, 1).alignment = { horizontal: 'center' };
  sheet.mergeCells(2, 1, 2, columns.length);
  sheet.getCell(2, 1).value = `Phạm vi: ${result.filter_text || 'Tất cả phạm vi được giao'}`;
  sheet.getCell(2, 1).alignment = { wrapText: true };
  const header = sheet.getRow(3); columns.forEach(([label], index) => { header.getCell(index + 1).value = label; }); setHeader(header, BLUE);
  result.reports.forEach((report) => sheet.addRow({ ...report.summary, cst_remaining_pct: report.summary.cst_remaining_pct == null ? null : report.summary.cst_remaining_pct / 100, target_pct: report.summary.target_pct == null ? null : report.summary.target_pct / 100 }));
  ['cst_initial', 'cst_remaining'].forEach((key) => { sheet.getColumn(key).numFmt = QTY_FMT; });
  ['employee_revenue', 'employee_revenue_before_vat', 'target', 'filtered_revenue'].forEach((key) => { sheet.getColumn(key).numFmt = MONEY_FMT; });
  ['cst_remaining_pct', 'target_pct'].forEach((key) => { sheet.getColumn(key).numFmt = '0.0%'; });
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };
  setupPrint(sheet, '1:3');
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
function previewSignature(filters) {
  const normalized = normalizeFilters(filters);
  return JSON.stringify({ ...normalized, emp_codes: [...normalized.emp_codes].sort() });
}
function reportDigest(report) {
  const rows = (report.rows || []).map((row) => [
    upper(row.emp_code), text(row.route), text(row.unit_code), text(row.qlnb_code), text(row.contractor_code),
    text(row.product_name), text(row.active_ingredient), text(row.strength), text(row.uom), row.bid_price,
    row.cst_initial, row.cst_remaining, row.dormant_status, row.review_status,
    row.c30_option_qty, text(row.c30_status), row.period_revenue, row.period_quantity, row.action_status,
    text(row.action_note), row.next_follow_up, row.last_order_date, row.days_idle,
  ]);
  return crypto.createHash('sha256').update(JSON.stringify({ summary: report.summary, rows })).digest('hex');
}
function filterText(filters) {
  const parts = [];
  if (filters.provinces.length) parts.push(`Tỉnh: ${filters.provinces.join(', ')}`);
  if (filters.routes.length) parts.push(`Tuyến: ${filters.routes.join(', ')}`);
  if (filters.units.length) parts.push(`Đơn vị: ${filters.units.join(', ')}`);
  if (filters.contractors.length) parts.push(`Nhà thầu: ${filters.contractors.join(', ')}`);
  if (filters.qlnb_codes.length) parts.push(`QLNB: ${filters.qlnb_codes.join(', ')}`);
  if (filters.query) parts.push(`Tìm: ${filters.query}`);
  if (filters.cst_band !== 'all') parts.push(`Mức CST: ${filters.cst_band}`);
  if (filters.dormant_status !== 'all') parts.push(`QLNB: ${filters.dormant_status}`);
  if (filters.review_status !== 'all') parts.push(`Review: ${filters.review_status}`);
  if (filters.c30_status !== 'all') parts.push(`C30: ${filters.c30_status}`);
  return parts.join(' · ') || 'Tất cả phạm vi được giao';
}

function createFilteredEmployeeReportService({ store, catalogManagement, appSaleCst, persist, previewTtlMs = 20 * 60 * 1000 } = {}) {
  if (!store || !catalogManagement || !appSaleCst || !persist) throw new Error('Filtered report service thiếu dependency');
  const previews = new Map();
  const cleanPreviews = () => {
    const now = Date.now();
    for (const [id, item] of previews) if (item.expires_at <= now) previews.delete(id);
  };

  async function build(payload = {}) {
    const filters = normalizeFilters(payload);
    const period = catalogManagement.toHubPeriod(filters.period || store.latestKy());
    filters.period = period;
    const snapshot = await catalogManagement.getSnapshot(period);
    const cstRows = store.getCst({ scope: null });
    const activeSourceRows = snapshot.rows.filter((row) => activeInPeriod(row, period));
    const availableEmpCodes = [...new Set(activeSourceRows.map((row) => upper(row.emp_code)).filter(Boolean))].sort();
    const selected = filters.emp_codes.length ? filters.emp_codes.filter((code) => availableEmpCodes.includes(code)) : availableEmpCodes;
    if (!selected.length) throw Object.assign(new Error('Không có nhân viên hợp lệ trong phạm vi đã chọn.'), { status: 400 });
    if (selected.length > 80) throw Object.assign(new Error('Danh sách nhân viên vượt quá giới hạn báo cáo.'), { status: 400 });

    const tenderQuota = await appSaleCst.fetchTenderQuota().catch(() => ({ rows: [] }));
    const c30Result = appSaleCst.enrichCstRowsWithC30(cstRows, tenderQuota);
    const c30Source = { ...(c30Result.meta || {}), ready: !!(c30Result.meta?.available && c30Result.meta?.complete && !c30Result.meta?.stale) };
    if (filters.c30_status !== 'all' && !c30Source.ready) {
      throw Object.assign(new Error('Nguồn C30 chưa sẵn sàng; không thể lọc C30 để tránh kết luận sai.'), { code: 'FILTERED_REPORT_C30_UNAVAILABLE', status: 409 });
    }
    const periodUi = hubToUi(period);
    const reports = [];

    for (const empCode of selected) {
      const scope = { empCode };
      const employeeSource = activeSourceRows.filter((row) => upper(row.emp_code) === empCode);
      const employeeCst = store.getCst({ scope }).filter((row) => activeInPeriod(row, period));
      const employeeCatalog = catalogManagement.buildCatalogRows(employeeSource, employeeCst).filter((row) => upper(row.emp_code) === empCode);
      const employeeC30 = appSaleCst.enrichCstRowsWithC30(employeeCst, tenderQuota);
      const employeeC30ByPair = new Map((employeeC30.rows || []).map((row) => [pairKey(row.unit_code, row.iit_code), row]));
      const analysis = analyzeEmployeeReadOnly({ store, persist, empCode, periodUi });
      const periodSales = store.getRows({ ky: periodUi, scope });
      const reviewAsOf = periodUi === store.latestKy() ? null : analysis.as_of;
      const signaled = attachEmployeeSignals({ rows: employeeCatalog, empCode, analysis, c30ByPair: employeeC30ByPair, periodSales, reviewAsOf });
      const filteredRows = filterCatalogRows(signaled, { ...filters, emp_codes: [empCode] });
      assertEmployeeIsolation(filteredRows, empCode);
      const summary = summarizeEmployee({ store, empCode, periodUi, allPeriodSales: periodSales, filteredRows, analysis });
      reports.push({ period, period_ui: periodUi, filters, filter_text: filterText(filters), rows: filteredRows, summary, c30_source: c30Source });
    }
    return { period, period_ui: periodUi, filters, filter_text: filterText(filters), reports, source_meta: snapshot.meta, c30_source: c30Source };
  }

  async function preview(payload = {}, actorKey = '') {
    cleanPreviews();
    const result = await build(payload);
    const previewId = crypto.randomUUID();
    const expiresAt = Date.now() + previewTtlMs;
    const exportable = result.reports.filter((report) => report.summary.row_count > 0);
    previews.set(previewId, {
      expires_at: expiresAt,
      actor_key: upper(actorKey),
      signature: previewSignature(result.filters),
      emp_codes: exportable.map((report) => report.summary.emp_code),
      report_digests: Object.fromEntries(exportable.map((report) => [report.summary.emp_code, reportDigest(report)])),
    });
    return {
      ok: true,
      preview_id: previewId,
      preview_expires_at: new Date(expiresAt).toISOString(),
      period: result.period,
      period_ui: result.period_ui,
      filters: result.filters,
      filter_text: result.filter_text,
      source_meta: result.source_meta,
      c30_source: result.c30_source,
      selected_employees: result.reports.length,
      total_employees: exportable.length,
      empty_employees: result.reports.length - exportable.length,
      total_rows: exportable.reduce((sum, report) => sum + report.summary.row_count, 0),
      employees: result.reports.map((report) => ({ ...report.summary, exportable: report.summary.row_count > 0 })),
      send_enabled: false,
    };
  }

  function approvedPreview(payload, empCode = null, actorKey = '') {
    cleanPreviews();
    const previewId = text(payload.preview_id || payload.previewId);
    const approved = previews.get(previewId);
    if (!approved || approved.actor_key !== upper(actorKey) || approved.signature !== previewSignature(payload) || (empCode && !approved.emp_codes.includes(empCode))) {
      throw Object.assign(new Error('Vui lòng xem trước lại phạm vi trước khi xuất báo cáo.'), { code: 'FILTERED_REPORT_PREVIEW_REQUIRED', status: 409 });
    }
    return approved;
  }

  function assertPreviewDataFresh(report, approved) {
    if (approved.report_digests?.[report.summary.emp_code] !== reportDigest(report)) {
      throw Object.assign(new Error('Dữ liệu đã thay đổi sau khi xem trước; vui lòng xem trước lại.'), { code: 'FILTERED_REPORT_PREVIEW_STALE', status: 409 });
    }
  }

  async function employeeReport(payload = {}, empCodeInput, actorKey = '') {
    const empCode = upper(empCodeInput || payload.emp_code || payload.empCode);
    if (!empCode) throw Object.assign(new Error('Thiếu mã nhân viên cần xuất báo cáo.'), { status: 400 });
    const approved = approvedPreview(payload, empCode, actorKey);
    const result = await build({ ...payload, emp_codes: [empCode] });
    const report = result.reports.find((item) => item.summary.emp_code === empCode);
    if (!report || report.summary.row_count <= 0) throw Object.assign(new Error('Nhân viên không có dữ liệu trong phạm vi đã chọn.'), { status: 404 });
    assertPreviewDataFresh(report, approved);
    return report;
  }

  async function summaryReport(payload = {}, actorKey = '') {
    const approved = approvedPreview(payload, null, actorKey);
    const result = await build(payload);
    result.reports = result.reports.filter((report) => report.summary.row_count > 0 && approved.emp_codes.includes(report.summary.emp_code));
    if (!result.reports.length) throw Object.assign(new Error('Không có báo cáo nào có dữ liệu trong phạm vi đã xem trước.'), { status: 404 });
    result.reports.forEach((report) => assertPreviewDataFresh(report, approved));
    return result;
  }

  return { build, preview, employeeReport, summaryReport, excelBuffer, summaryExcelBuffer };
}

module.exports = {
  FILTER_ENUMS, CRITICAL_EXPORT_FIELDS,
  normalizeFilters, filterCatalogRows, cstPct, cstBandMatch, pairKey, businessKey,
  stateAtDate, analyzeEmployeeReadOnly, attachEmployeeSignals, assertEmployeeIsolation, summarizeEmployee,
  excelBuffer, summaryExcelBuffer, createFilteredEmployeeReportService,
};
