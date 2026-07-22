'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const COMPANY_NAME = 'Công ty TNHH Dược phẩm Donapharm';
const SOURCE_FOOTER = 'Nguồn số: DataHub (SSOT) · chỉ hiển thị chi phí của chính nhân viên';
const COST_TITLE = 'BÁO CÁO CHI PHÍ CỦA TÔI';
const GAP_TITLE = 'DANH SÁCH MẶT HÀNG CHƯA CÓ % CHI PHÍ';
const GAP_NOTE = "Điền cột '% cần điền' hoặc xác nhận ánh xạ, rồi gửi DataHub cập nhật catalog. Xếp theo doanh thu ảnh hưởng: làm từ trên xuống để khớp nhanh nhất.";
const LOGO_PATH = path.join(__dirname, '..', '..', 'web', 'public', 'logo-dnpharma.png');
const FONT_REGULAR_CANDIDATES = [
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
];
const FONT_BOLD_CANDIDATES = [
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
];
const ACCOUNTING_INTEGER = '#,##0;(#,##0);-';
const ACCOUNTING_DECIMAL = '#,##0.00;(#,##0.00);-';

const safeText = (value, max = 500) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const numberOrNull = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const pad2 = (value) => String(value).padStart(2, '0');

function bangkokNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return { isoDate: `${part('year')}-${part('month')}-${part('day')}`, display: `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}` };
}

function formatPeriod(from, to = from) {
  const label = (value) => { const match = /^(\d{4})-(\d{2})$/.exec(String(value || '')); return match ? `${match[2]}/${match[1]}` : safeText(value); };
  return from === to ? `Tháng ${label(from)}` : `Kỳ ${label(from)}–${label(to)}`;
}

function formatNumberVi(value, { minimumFractionDigits = 0, maximumFractionDigits = 0 } = {}) {
  const number = numberOrNull(value);
  if (number == null) return '—';
  const rendered = Math.abs(number).toLocaleString('vi-VN', { minimumFractionDigits, maximumFractionDigits });
  return number < 0 ? `(${rendered})` : rendered;
}

function formatMoneyVi(value, decimals = 0) {
  const rendered = formatNumberVi(value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return rendered === '—' ? rendered : `${rendered} đ`;
}

function formatPercentVi(value) {
  return formatNumberVi(value, { minimumFractionDigits: 1, maximumFractionDigits: 4 });
}

function formatDateVi(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : safeText(value) || '—';
}

function excelDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function readTriplet(value, full = false) {
  const hundred = Math.floor(value / 100);
  const ten = Math.floor(value / 10) % 10;
  const unit = value % 10;
  const words = [];
  if (hundred || full) words.push(`${DIGITS[hundred]} trăm`);
  if (ten > 1) {
    words.push(`${DIGITS[ten]} mươi`);
    if (unit === 1) words.push('mốt');
    else if (unit === 5) words.push('lăm');
    else if (unit) words.push(DIGITS[unit]);
  } else if (ten === 1) {
    words.push('mười');
    if (unit === 5) words.push('lăm');
    else if (unit) words.push(DIGITS[unit]);
  } else if (unit) {
    if (hundred || full) words.push('lẻ');
    words.push(DIGITS[unit]);
  }
  return words.join(' ');
}

function numberToVietnameseWords(value) {
  let number = Math.round(Math.abs(Number(value) || 0));
  if (!number) return 'Không đồng';
  const scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const groups = [];
  while (number > 0) { groups.push(number % 1000); number = Math.floor(number / 1000); }
  const words = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (!groups[index]) continue;
    words.push(readTriplet(groups[index], words.length > 0 && groups[index] < 100));
    if (scales[index]) words.push(scales[index]);
  }
  const text = words.join(' ').replace(/\s+/g, ' ').trim();
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} đồng`;
}

function pickUnicodeFonts() {
  const regular = FONT_REGULAR_CANDIDATES.find(fs.existsSync);
  const bold = FONT_BOLD_CANDIDATES.find(fs.existsSync);
  if (!regular || !bold) throw Object.assign(new Error('Máy chủ thiếu font Unicode để xuất PDF tiếng Việt an toàn.'), { status: 500, code: 'EMPLOYEE_COST_PDF_FONT_MISSING' });
  return { regular, bold };
}

function employeeLabel(report = {}) {
  return `${safeText(report.empCode || report.employeeCode, 40) || '—'} · ${safeText(report.employeeName || report.empCode || report.employeeCode, 180) || '—'}`;
}

function gapEmployeeLabel(payload = {}) {
  const code = safeText(payload.scope?.employeeCode, 40).toUpperCase();
  if (payload.scope?.admin && !code) return 'Toàn roster';
  const employee = (payload.coverageByEmployee || []).find((entry) => String(entry.employeeCode || '').toUpperCase() === code);
  return code ? `${code} · ${safeText(employee?.employeeName || code, 180)}` : '—';
}

function excelHeader(sheet, { title, period, employee, exportedAt, columnCount, note = '' }) {
  if (fs.existsSync(LOGO_PATH)) {
    const imageId = sheet.workbook.addImage({ filename: LOGO_PATH, extension: 'png' });
    sheet.addImage(imageId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 70, height: 40 } });
  }
  sheet.mergeCells(1, 2, 1, columnCount);
  sheet.getCell(1, 2).value = COMPANY_NAME;
  sheet.getCell(1, 2).font = { bold: true, size: 12, color: { argb: 'FF1F4E78' } };
  sheet.getCell(1, 2).alignment = { horizontal: 'center' };
  sheet.mergeCells(2, 2, 2, columnCount);
  sheet.getCell(2, 2).value = title;
  sheet.getCell(2, 2).font = { bold: true, size: 16, color: { argb: 'FF075D9B' } };
  sheet.getCell(2, 2).alignment = { horizontal: 'center' };
  sheet.mergeCells(3, 1, 3, columnCount);
  sheet.getCell(3, 1).value = `${period} · Nhân viên: ${employee} · Ngày xuất: ${exportedAt}`;
  sheet.getCell(3, 1).alignment = { horizontal: 'center' };
  sheet.getCell(3, 1).font = { size: 9, color: { argb: 'FF526574' } };
  if (note) {
    sheet.mergeCells(5, 1, 5, columnCount);
    sheet.getCell(5, 1).value = note;
    sheet.getCell(5, 1).font = { italic: true, size: 9, color: { argb: 'FF5B6470' } };
    sheet.getCell(5, 1).alignment = { wrapText: true };
  }
}

function configurePrint(sheet, repeatRows) {
  sheet.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.15, footer: 0.2 },
    printTitlesRow: `${repeatRows}:${repeatRows}`,
  };
  sheet.headerFooter = {
    oddHeader: `&C${COMPANY_NAME}`,
    oddFooter: `&L${SOURCE_FOOTER}&RTrang &P/&N`,
  };
  sheet.views = [{ state: 'frozen', ySplit: repeatRows }];
}

function styleTableHeader(row) {
  row.height = 32;
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF075D9B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin', color: { argb: 'FFFFFFFF' } }, left: { style: 'thin', color: { argb: 'FFFFFFFF' } }, bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } }, right: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });
}

function costColumns(period, report = {}) {
  const base = [
    ['stt', 'STT', 'number', 7],
    ...(report.allEmployees ? [['employee', 'Nhân viên', 'text', 24]] : []),
    ['date', 'Ngày', 'date', 11], ['orderCode', 'Mã đơn', 'text', 15], ['route', 'Tuyến', 'text', 9], ['c7', 'Đơn vị', 'text', 26],
    ['contractorName', 'Nhà thầu', 'text', 22], ['c5', 'Mã QLNB', 'text', 22], ['c16', 'Tên hàng', 'text', 25], ['strength', 'Hàm lượng', 'text', 18],
    ['c25', 'ĐVT', 'text', 8], ['bidPrice', 'Giá trúng thầu', 'money', 15], ['quantity', 'SL', 'number', 10], ['revenueBeforeVat', 'Thành tiền trước VAT', 'decimal', 18],
  ].map(([key, label, kind, width]) => ({
    key, label, kind, width,
    value: key === 'employee' ? (row) => `${safeText(row.employeeCode, 40)} · ${safeText(row.employeeName, 180)}` : (row) => row[key],
  }));
  const dynamic = [];
  for (const column of Array.isArray(period.columns) ? period.columns : []) {
    const key = safeText(column.key, 16).toLowerCase();
    if (!/^c(?:3[3-9]|4[0-6])$/.test(key) || key === 'c32' || key === 'c47') continue;
    dynamic.push({ key, label: safeText(column.label || key, 100), fullLabel: safeText(column.label || key, 100), kind: 'percent', width: 8, annual: !!column.annual, value: (row) => row[key] });
    dynamic.push({ key: `${key}_amount`, label: `Thành tiền ${key.toUpperCase()}`, kind: 'money', width: 16, annual: !!column.annual, value: (row) => row.amounts?.[key] });
  }
  return [...base, ...dynamic, { key: 'rowMonthlyTotal', label: 'Tổng chi phí tháng', kind: 'money', width: 17, value: (row) => row.rowMonthlyTotal }, { key: 'note', label: 'Ghi chú', kind: 'text', width: 24, value: (row) => row.note }];
}

function safeSheetName(value, fallback, used) {
  const base = safeText(value, 60).replace(/[\\/*?:[\]]/g, '-').slice(0, 31) || fallback;
  let name = base; let index = 2;
  while (used.has(name)) { const suffix = `-${index++}`; name = `${base.slice(0, 31 - suffix.length)}${suffix}`; }
  used.add(name); return name;
}

function createCostWorkbook(reports = [], options = {}) {
  const list = Array.isArray(reports) ? reports : [reports];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'App Report';
  workbook.created = options.now || new Date();
  const exportedAt = bangkokNow(options.now).display;
  const usedNames = new Set();
  for (const report of list) {
    for (const period of Array.isArray(report.periods) ? report.periods : []) {
      const columns = costColumns(period, report);
      const sheetName = safeSheetName(`${report.empCode}-${period.period}`, 'Chi phí', usedNames);
      const sheet = workbook.addWorksheet(sheetName);
      const tableRow = 7;
      excelHeader(sheet, { title: COST_TITLE, period: formatPeriod(period.period), employee: employeeLabel(report), exportedAt, columnCount: columns.length });
      sheet.getRow(tableRow).values = columns.map((column) => column.label);
      styleTableHeader(sheet.getRow(tableRow));
      columns.forEach((column, index) => {
        if (column.fullLabel) sheet.getRow(tableRow).getCell(index + 1).note = column.fullLabel;
      });
      const firstDataRow = tableRow + 1;
      const dataRows = (Array.isArray(period.rows) ? period.rows : []).map((row, index) => ({ ...row, stt: numberOrNull(row.stt) || index + 1 }));
      for (const source of dataRows) {
        const values = columns.map((column) => {
          const value = column.value(source);
          if (column.kind === 'date') return excelDate(value);
          if (['money', 'decimal', 'number', 'percent'].includes(column.kind)) return numberOrNull(value);
          return safeText(value, 1000);
        });
        const row = sheet.addRow(values);
        row.height = 23;
        row.eachCell((cell, columnIndex) => {
          const column = columns[columnIndex - 1];
          cell.alignment = { vertical: 'top', horizontal: ['money', 'decimal', 'number', 'percent'].includes(column.kind) ? 'right' : 'left', wrapText: column.kind === 'text' };
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFD6E0E7' } } };
          if (column.kind === 'date') cell.numFmt = 'dd/mm/yyyy';
          else if (column.kind === 'money') cell.numFmt = ACCOUNTING_INTEGER;
          else if (column.kind === 'decimal') cell.numFmt = ACCOUNTING_DECIMAL;
          else if (column.kind === 'number') cell.numFmt = '#,##0.####;(#,##0.####);-';
          else if (column.kind === 'percent') cell.numFmt = '0.0###';
        });
      }
      const lastDataRow = firstDataRow + dataRows.length - 1;
      if (report.allEmployees) {
        for (const subtotal of period.employeeSubtotals || []) {
          const subtotalRow = sheet.addRow(columns.map((column, index) => {
            if (index === 0) return '';
            if (index === 1) return `TỔNG PHỤ ${subtotal.employeeCode} · ${subtotal.employeeName} (${subtotal.rowCount} dòng)`;
            if (column.key === 'rowMonthlyTotal') return numberOrNull(subtotal.monthlyTotal);
            if (column.key.endsWith('_amount')) return numberOrNull(subtotal.columnTotals?.[column.key.replace(/_amount$/, '')]);
            return '';
          }));
          subtotalRow.font = { bold: true, color: { argb: 'FF245C49' } };
          subtotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FAF6' } };
          subtotalRow.eachCell((cell, index) => { if (columns[index - 1]?.kind === 'money') cell.numFmt = ACCOUNTING_INTEGER; });
        }
      }
      const totalRow = sheet.addRow(columns.map((column, index) => {
        if (index === 0) return 'TỔNG CỘNG';
        if (column.kind !== 'money' && column.kind !== 'decimal') return '';
        const letter = sheet.getColumn(index + 1).letter;
        const backendValue = column.key === 'rowMonthlyTotal'
          ? numberOrNull(period.summary?.monthlyTotal)
          : column.key.endsWith('_amount') ? numberOrNull(period.summary?.columnTotals?.[column.key.replace(/_amount$/, '')]) : null;
        if (backendValue == null) return '';
        return dataRows.length ? { formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`, result: backendValue } : backendValue;
      }));
      totalRow.font = { bold: true, color: { argb: 'FF075D9B' } };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF4FB' } };
      totalRow.eachCell((cell, index) => { if (['money', 'decimal'].includes(columns[index - 1]?.kind)) cell.numFmt = columns[index - 1].kind === 'decimal' ? ACCOUNTING_DECIMAL : ACCOUNTING_INTEGER; });
      const monthlyTotal = numberOrNull(period.summary?.monthlyTotal);
      const annualTotal = numberOrNull(period.summary?.annualTotal);
      const hasAnnual = (period.columns || []).some((column) => column.annual);
      if (hasAnnual) {
        const annualRow = sheet.addRow(['KHOẢN CUỐI NĂM (C44 · chi trả T12)', annualTotal]);
        annualRow.font = { bold: true, italic: true, color: { argb: 'FF9A5B00' } };
        annualRow.getCell(2).numFmt = ACCOUNTING_INTEGER;
      }
      const wordsRow = sheet.addRow([monthlyTotal == null ? 'Bằng chữ: —' : `Bằng chữ: ${numberToVietnameseWords(monthlyTotal)}`]);
      sheet.mergeCells(wordsRow.number, 1, wordsRow.number, columns.length);
      wordsRow.font = { bold: true, italic: true };
      const noteRow = sheet.addRow([hasAnnual ? 'Ghi chú: C44 = khoản cuối năm (tạm tính, chi trả T12), không tính vào tổng tháng; dòng “—” = chưa có %.' : 'Ghi chú: Dòng “—” = chưa có %.']);
      sheet.mergeCells(noteRow.number, 1, noteRow.number, columns.length);
      noteRow.font = { italic: true, color: { argb: 'FF5B6470' } };
      columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
      sheet.autoFilter = { from: { row: tableRow, column: 1 }, to: { row: tableRow, column: columns.length } };
      configurePrint(sheet, tableRow);
    }
  }
  if (!workbook.worksheets.length) workbook.addWorksheet('Chi phí').addRow(['Chưa có dữ liệu']);
  return workbook;
}

async function costWorkbookBuffer(reports, options = {}) {
  return Buffer.from(await createCostWorkbook(reports, options).xlsx.writeBuffer());
}

function createGapWorkbook(payload = {}, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'App Report'; workbook.created = options.now || new Date();
  const exportedAt = bangkokNow(options.now).display;
  const employee = gapEmployeeLabel(payload);
  const columns = ['Mã QLNB', 'Tên hàng', 'Đơn vị ảnh hưởng', '# NV', 'Mã NV', 'Doanh thu ảnh hưởng', 'Lý do', 'Mã catalog gợi ý', '% cần điền'];
  const main = workbook.addWorksheet('Theo mã QLNB');
  excelHeader(main, { title: GAP_TITLE, period: formatPeriod(payload.from, payload.to), employee, exportedAt, columnCount: columns.length, note: GAP_NOTE });
  const tableRow = 7;
  main.getRow(tableRow).values = columns; styleTableHeader(main.getRow(tableRow));
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    const row = main.addRow([item.productCode, item.productName, (item.unitLabels || []).join('; '), item.employeeCount, (item.employeeCodes || []).join('; '), numberOrNull(item.revenueAffected), item.reason === 'qd_mismatch' ? 'Lệch mã QĐ/QLNB' : 'Thiếu hẳn', (item.suggestedCatalogCodes || []).join('; '), '']);
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(6).numFmt = ACCOUNTING_INTEGER; row.getCell(6).alignment = { horizontal: 'right' };
  }
  const firstData = tableRow + 1; const lastData = firstData + items.length - 1;
  const revenueTotal = items.reduce((sum, item) => sum + Number(item.revenueAffected || 0), 0);
  const total = main.addRow(['TỔNG CỘNG', '', '', '', '', items.length ? { formula: `SUM(F${firstData}:F${lastData})`, result: revenueTotal } : revenueTotal]);
  total.font = { bold: true, color: { argb: 'FF075D9B' } }; total.getCell(6).numFmt = ACCOUNTING_INTEGER;
  main.columns = [22, 30, 48, 9, 18, 20, 18, 30, 16].map((width) => ({ width }));
  main.autoFilter = { from: `A${tableRow}`, to: `I${tableRow}` }; configurePrint(main, tableRow);

  const mapping = workbook.addWorksheet('Ánh xạ lệch mã');
  excelHeader(mapping, { title: 'ÁNH XẠ LỆCH MÃ QĐ/QLNB', period: formatPeriod(payload.from, payload.to), employee, exportedAt, columnCount: 3, note: GAP_NOTE });
  mapping.getRow(tableRow).values = ['Mã doanh thu', 'Mã catalog gợi ý', 'Xác nhận']; styleTableHeader(mapping.getRow(tableRow));
  for (const item of payload.items || []) if (item.reason === 'qd_mismatch') for (const suggestion of item.suggestedCatalogCodes || []) mapping.addRow([item.productCode, suggestion, '']);
  mapping.columns = [{ width: 32 }, { width: 32 }, { width: 22 }];
  mapping.autoFilter = { from: `A${tableRow}`, to: `C${tableRow}` }; configurePrint(mapping, tableRow);
  return workbook;
}

async function gapWorkbookBuffer(payload, options = {}) {
  return Buffer.from(await createGapWorkbook(payload, options).xlsx.writeBuffer());
}

function createPdfDocument(title) {
  const fonts = pickUnicodeFonts();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 30, bottom: 35, left: 24, right: 24 }, bufferPages: true, info: { Title: title, Author: 'App Report' } });
  doc.registerFont('VN', fonts.regular); doc.registerFont('VN-Bold', fonts.bold);
  return doc;
}

function pdfHeader(doc, { title, period, employee, exportedAt }) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  if (fs.existsSync(LOGO_PATH)) { try { doc.image(LOGO_PATH, doc.page.margins.left, 18, { fit: [52, 30], align: 'left' }); } catch { /* company heading remains */ } }
  doc.font('VN-Bold').fontSize(9).fillColor('#1F4E78').text(COMPANY_NAME, doc.page.margins.left + 55, 18, { width: width - 110, align: 'center' });
  doc.font('VN-Bold').fontSize(13).fillColor('#075D9B').text(title, doc.page.margins.left, 32, { width, align: 'center' });
  doc.font('VN').fontSize(6.5).fillColor('#526574').text(`${period} · Nhân viên: ${employee} · Ngày xuất: ${exportedAt}`, doc.page.margins.left, 49, { width, align: 'center' });
  doc.y = 67;
}

function pdfFooter(doc) {
  const range = doc.bufferedPageRange();
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // Keep the baseline inside PDFKit's printable bottom boundary. Writing even
    // one point below it makes PDFKit silently append blank pages for footers.
    const footerY = doc.page.height - doc.page.margins.bottom - 8;
    doc.font('VN').fontSize(5.8).fillColor('#758692').text(SOURCE_FOOTER, doc.page.margins.left, footerY, { width: width * 0.75, lineBreak: false });
    doc.text(`Trang ${index + 1}/${range.count}`, doc.page.margins.left + width * 0.75, footerY, { width: width * 0.25, align: 'right', lineBreak: false });
  }
}

function pdfTable(doc, columns, rows, { titleContext, noteAfter } = {}) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
  const widths = columns.map((column) => column.weight / totalWeight * width);
  const headerHeight = 29;
  const drawHeader = () => {
    let x = left; const y = doc.y;
    doc.rect(left, y, width, headerHeight).fill('#075D9B');
    columns.forEach((column, index) => { doc.font('VN-Bold').fontSize(4.2).fillColor('white').text(column.label, x + 2, y + 4, { width: widths[index] - 4, height: headerHeight - 7, align: column.align || 'center' }); x += widths[index]; });
    doc.y = y + headerHeight;
  };
  drawHeader();
  rows.forEach((source, rowIndex) => {
    const texts = columns.map((column) => safeText(column.value(source), 500));
    const rowHeight = Math.max(17, Math.min(70, ...texts.map((text, index) => {
      doc.font(columns[index].bold ? 'VN-Bold' : 'VN').fontSize(3.9);
      return doc.heightOfString(text, { width: widths[index] - 4, lineGap: 0 }) + 7;
    })));
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 18) {
      doc.addPage(); pdfHeader(doc, titleContext); drawHeader();
    }
    const y = doc.y; if (rowIndex % 2) doc.rect(left, y, width, rowHeight).fill('#F3F7FA');
    let x = left;
    columns.forEach((column, index) => { doc.font(column.bold ? 'VN-Bold' : 'VN').fontSize(3.9).fillColor('#263645').text(texts[index], x + 2, y + 4, { width: widths[index] - 4, height: rowHeight - 6, align: column.align || 'left', lineGap: 0 }); x += widths[index]; });
    doc.y = y + rowHeight;
  });
  if (noteAfter) {
    if (doc.y + 36 > doc.page.height - doc.page.margins.bottom - 18) { doc.addPage(); pdfHeader(doc, titleContext); }
    doc.moveDown(0.5);
    doc.font('VN').fontSize(6).fillColor('#5B6470').text(noteAfter, left, doc.y, { width, align: 'left' });
  }
}

function buildPdfBuffer(render) {
  return new Promise((resolve, reject) => {
    let doc;
    try { doc = render(); } catch (error) { reject(error); return; }
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfFooter(doc); doc.end();
  });
}

function costPdfBuffer(reports = [], options = {}) {
  const list = Array.isArray(reports) ? reports : [reports];
  const exportedAt = bangkokNow(options.now).display;
  return buildPdfBuffer(() => {
    const doc = createPdfDocument(COST_TITLE);
    let section = 0;
    for (const report of list) for (const period of Array.isArray(report.periods) ? report.periods : []) {
      if (section++) doc.addPage();
      const titleContext = { title: COST_TITLE, period: formatPeriod(period.period), employee: employeeLabel(report), exportedAt };
      pdfHeader(doc, titleContext);
      const columns = costColumns(period, report).map((column) => ({
        label: ['money', 'decimal'].includes(column.kind) ? `${column.label} (đ)` : column.label,
        weight: Math.max(4, Math.min(column.width, column.kind === 'text' ? 14 : 11)),
        align: ['money', 'decimal', 'number', 'percent'].includes(column.kind) ? 'right' : 'left',
        value: (row) => {
          const value = column.value(row);
          if (column.kind === 'date') return formatDateVi(value);
          if (column.kind === 'money') return formatNumberVi(value);
          if (column.kind === 'decimal') return formatNumberVi(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (column.kind === 'number') return formatNumberVi(value, { maximumFractionDigits: 4 });
          if (column.kind === 'percent') return formatPercentVi(value);
          return value == null || value === '' ? '—' : value;
        },
      }));
      const hasAnnual = (period.columns || []).some((column) => column.annual);
      const subtotalNote = report.allEmployees && period.employeeSubtotals?.length
        ? `\nTổng phụ: ${period.employeeSubtotals.map((item) => `${item.employeeCode} ${formatMoneyVi(item.monthlyTotal)} (${item.rowCount} dòng)`).join(' · ')}`
        : '';
      const titleNote = `Tổng chi phí tháng: ${formatMoneyVi(period.summary?.monthlyTotal)} · Bằng chữ: ${numberToVietnameseWords(period.summary?.monthlyTotal || 0)}${subtotalNote}${hasAnnual ? `\nKhoản cuối năm (C44 · chi trả T12): ${formatMoneyVi(period.summary?.annualTotal)}\nGhi chú: C44 không tính vào tổng tháng; dòng “—” = chưa có %.` : '\nGhi chú: Dòng “—” = chưa có %.'}`;
      const pdfRows = (period.rows || []).map((row, index) => ({ ...row, stt: numberOrNull(row.stt) || index + 1 }));
      pdfTable(doc, columns, pdfRows, { titleContext, noteAfter: titleNote });
    }
    if (!section) { pdfHeader(doc, { title: COST_TITLE, period: formatPeriod('', ''), employee: '—', exportedAt }); doc.font('VN').fontSize(10).text('Chưa có dữ liệu.'); }
    return doc;
  });
}

function gapPdfBuffer(payload = {}, options = {}) {
  const exportedAt = bangkokNow(options.now).display;
  const employee = gapEmployeeLabel(payload);
  return buildPdfBuffer(() => {
    const doc = createPdfDocument(GAP_TITLE);
    const titleContext = { title: GAP_TITLE, period: formatPeriod(payload.from, payload.to), employee, exportedAt };
    pdfHeader(doc, titleContext);
    const columns = [
      { label: 'Mã QLNB', weight: 18, value: (x) => x.productCode }, { label: 'Tên hàng', weight: 16, value: (x) => x.productName },
      { label: 'Đơn vị ảnh hưởng', weight: 24, value: (x) => (x.unitLabels || []).join('; ') }, { label: '#NV', weight: 5, align: 'right', value: (x) => x.employeeCount },
      { label: 'Mã NV', weight: 10, value: (x) => (x.employeeCodes || []).join('; ') }, { label: 'Doanh thu ảnh hưởng', weight: 12, align: 'right', value: (x) => formatMoneyVi(x.revenueAffected) },
      { label: 'Lý do', weight: 10, value: (x) => x.reason === 'qd_mismatch' ? 'Lệch mã QĐ/QLNB' : 'Thiếu hẳn' },
      { label: 'Mã catalog gợi ý', weight: 16, value: (x) => (x.suggestedCatalogCodes || []).join('; ') || '—' }, { label: '% cần điền', weight: 8, value: () => '' },
    ];
    pdfTable(doc, columns, payload.items || [], { titleContext, noteAfter: GAP_NOTE });
    const mismatches = (payload.items || []).filter((item) => item.reason === 'qd_mismatch');
    if (mismatches.length) {
      doc.addPage();
      const mappingContext = { ...titleContext, title: 'ÁNH XẠ LỆCH MÃ QĐ/QLNB' };
      pdfHeader(doc, mappingContext);
      pdfTable(doc, [
        { label: 'Mã doanh thu', weight: 40, value: (x) => x.productCode },
        { label: 'Mã catalog gợi ý', weight: 40, value: (x) => (x.suggestedCatalogCodes || []).join('; ') },
        { label: 'Xác nhận', weight: 20, value: () => '' },
      ], mismatches, { titleContext: mappingContext, noteAfter: GAP_NOTE });
    }
    return doc;
  });
}

module.exports = {
  COMPANY_NAME,
  SOURCE_FOOTER,
  COST_TITLE,
  GAP_TITLE,
  GAP_NOTE,
  ACCOUNTING_INTEGER,
  ACCOUNTING_DECIMAL,
  bangkokNow,
  formatPeriod,
  formatNumberVi,
  formatMoneyVi,
  formatPercentVi,
  formatDateVi,
  numberToVietnameseWords,
  pickUnicodeFonts,
  costColumns,
  createCostWorkbook,
  costWorkbookBuffer,
  createGapWorkbook,
  gapWorkbookBuffer,
  costPdfBuffer,
  gapPdfBuffer,
};
