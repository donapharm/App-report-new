const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const A = require('./analytics');

const VAT_DIVISOR = 1.05;
const MONEY_FMT = '#,##0;[Red](#,##0)';
const BLUE = '1F4E78';
const GREEN = '1F6F54';
const LIGHT_BLUE = 'DCE6F1';
const LIGHT_GREEN = 'E2F0D9';
const AMBER = 'FCE4D6';

const n = (v) => Number(v || 0);
const vi = (v) => Math.round(n(v)).toLocaleString('vi-VN');
const moneyText = (v) => `${vi(v)} đ`;
const pctText = (v) => v == null ? '—' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
const dateOnlyText = (v) => {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(-2)}` : String(v);
};
const dateText = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return dateOnlyText(v);
  const parts = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
};
const safe = (v) => String(v == null ? '' : v);

function groupRows(rows, keyField, labelField, keyFn = null) {
  const map = new Map();
  for (const r of rows) {
    const key = safe((keyFn ? keyFn(r) : null) || r[keyField] || r[labelField] || '—');
    const cur = map.get(key) || { key, label: safe(r[labelField] || key), revenue: 0, quantity: 0, rows: 0, units: new Set(), products: new Set(), emps: new Set() };
    cur.revenue += n(r.revenue);
    cur.quantity += n(r.quantity);
    cur.rows += 1;
    if (r.unit_code || r.unit_name) cur.units.add(r.unit_code || r.unit_name);
    if (r.iit_code || r.product_name) cur.products.add(r.iit_code || r.product_name);
    if (r.emp_code) cur.emps.add(r.emp_code);
    map.set(key, cur);
  }
  return [...map.values()].map((x) => ({ ...x, unitCount: x.units.size, productCount: x.products.size, empCount: x.emps.size })).sort((a, b) => b.revenue - a.revenue);
}

function buildReport({ ky, kys, rows, targetRows = [], pacing = null, filters = {} }) {
  const totalRevenue = rows.reduce((s, r) => s + n(r.revenue), 0);
  const totalQuantity = rows.reduce((s, r) => s + n(r.quantity), 0);
  const updatedAt = rows.map((r) => r.data_as_of).filter(Boolean).sort().at(-1) || null;
  const emp = groupRows(rows, 'emp_code', 'emp_name');
  const unit = groupRows(rows, 'unit_code', 'unit_name', (r) => A.baseUnitKey(r.unit_code || r.unit_name));
  const product = groupRows(rows, 'iit_code', 'product_name');
  const route = groupRows(rows, 'route', 'route');
  const source = groupRows(rows, 'source', 'source');
  const targetTotal = targetRows.reduce((s, r) => s + n(r.target), 0);
  const revenueBeforeVat = totalRevenue / VAT_DIVISOR;
  const kpis = {
    totalRevenue: Math.round(totalRevenue),
    revenueBeforeVat: Math.round(revenueBeforeVat),
    totalQuantity: Math.round(totalQuantity),
    rowCount: rows.length,
    empCount: new Set(rows.map((r) => r.emp_code).filter(Boolean)).size,
    unitCount: unit.length,
    productCount: new Set(rows.map((r) => r.iit_code || r.product_name).filter(Boolean)).size,
    targetTotal: Math.round(targetTotal),
    targetPct: targetTotal > 0 ? +(revenueBeforeVat / targetTotal * 100).toFixed(1) : null,
  };
  return { ky, kys, rows, targetRows, pacing, filters, updatedAt, kpis, groups: { emp, unit, product, route, source } };
}

function setHeader(row, color = GREEN) {
  row.height = 26;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
}

function setupPrint(ws, titleRows = '1:1') {
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, printTitlesRow: titleRows, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 } };
  ws.headerFooter = { oddFooter: '&LApp Report&RTrang &P/&N' };
}

function addKpiBox(ws, col, label, value, fill) {
  const c1 = ws.getCell(3, col); const c2 = ws.getCell(4, col);
  c1.value = label; c2.value = value;
  [c1, c2].forEach((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${fill}` } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = { top: { style: 'thin', color: { argb: 'FFB8C6D1' } }, left: { style: 'thin', color: { argb: 'FFB8C6D1' } }, right: { style: 'thin', color: { argb: 'FFB8C6D1' } }, bottom: { style: 'thin', color: { argb: 'FFB8C6D1' } } }; });
  c1.font = { bold: true, size: 10, color: { argb: 'FF52606D' } };
  c2.font = { bold: true, size: 15, color: { argb: `FF${BLUE}` } };
}

function addSummarySheet(wb, report) {
  const ws = wb.addWorksheet('Tổng quan', { views: [{ state: 'frozen', ySplit: 6 }] });
  ws.columns = Array.from({ length: 8 }, (_, i) => ({ key: `c${i + 1}`, width: 20 }));
  ws.mergeCells('A1:H1'); ws.getCell('A1').value = `BÁO CÁO DOANH THU BÁN HÀNG — ${report.kys.join(', ') || report.ky}`;
  ws.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } }; ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }; ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BLUE}` } }; ws.getRow(1).height = 34;
  ws.mergeCells('A2:H2'); ws.getCell('A2').value = `Cập nhật dữ liệu: ${dateText(report.updatedAt)} · Nguồn: ${report.groups.source.map((x) => x.key).join(', ') || '—'}`; ws.getCell('A2').alignment = { horizontal: 'center' }; ws.getCell('A2').font = { italic: true, color: { argb: 'FF667788' } };
  addKpiBox(ws, 1, 'TỔNG DOANH THU', report.kpis.totalRevenue, LIGHT_BLUE);
  addKpiBox(ws, 2, 'DOANH THU TRƯỚC VAT', report.kpis.revenueBeforeVat, LIGHT_GREEN);
  addKpiBox(ws, 3, 'TỔNG SỐ LƯỢNG', report.kpis.totalQuantity, 'FFF2CC');
  addKpiBox(ws, 4, 'SỐ DÒNG', report.kpis.rowCount, 'EDEDED');
  addKpiBox(ws, 5, 'NHÂN VIÊN', report.kpis.empCount, 'D9EAD3');
  addKpiBox(ws, 6, 'ĐƠN VỊ', report.kpis.unitCount, 'D9EAF7');
  addKpiBox(ws, 7, 'SẢN PHẨM', report.kpis.productCount, 'FCE4D6');
  addKpiBox(ws, 8, '% ĐẠT TARGET', report.kpis.targetPct == null ? 'Chưa target' : report.kpis.targetPct / 100, 'E4DFEC');
  ['A4', 'B4', 'C4'].forEach((c) => (ws.getCell(c).numFmt = MONEY_FMT));
  ws.getCell('H4').numFmt = report.kpis.targetPct == null ? '@' : '0.0%';
  ws.getRow(3).height = 24; ws.getRow(4).height = 32;
  const headers = ['Nhóm', 'Mã/Tên', 'Doanh thu', 'Tỷ trọng', 'Số lượng', 'Số dòng', 'Đơn vị', 'Sản phẩm'];
  ws.addRow([]); const h = ws.addRow(headers); setHeader(h, BLUE);
  const addTop = (label, data) => data.slice(0, 10).forEach((x) => ws.addRow([label, x.label || x.key, x.revenue, report.kpis.totalRevenue ? x.revenue / report.kpis.totalRevenue : 0, x.quantity, x.rows, x.unitCount, x.productCount]));
  addTop('Nhân viên', report.groups.emp); addTop('Đơn vị', report.groups.unit); addTop('Sản phẩm', report.groups.product); addTop('Tuyến', report.groups.route);
  ws.getColumn(3).numFmt = MONEY_FMT; ws.getColumn(4).numFmt = '0.0%'; [5, 6, 7, 8].forEach((i) => (ws.getColumn(i).numFmt = '#,##0'));
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: 8 } };
  setupPrint(ws, '1:6');
}

function addGroupSheet(wb, name, rows, report, kind) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2 }] });
  const headers = kind === 'emp'
    ? ['Hạng', 'Mã NV', 'Tên NV', 'Doanh thu', 'Trước VAT', 'Tỷ trọng', 'Số lượng', 'Số đơn vị', 'Số sản phẩm']
    : ['Hạng', 'Mã', 'Tên', 'Doanh thu', 'Tỷ trọng', 'Số lượng', 'Số dòng', 'Số đơn vị', 'Số NV'];
  ws.mergeCells(1, 1, 1, headers.length); ws.getCell(1, 1).value = `${name.toUpperCase()} — Tổng doanh thu: ${moneyText(report.kpis.totalRevenue)}`; ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BLUE}` } }; ws.getCell(1, 1).alignment = { horizontal: 'center' };
  const h = ws.addRow(headers); setHeader(h);
  rows.forEach((x, i) => ws.addRow(kind === 'emp'
    ? [i + 1, x.key, x.label, x.revenue, x.revenue / VAT_DIVISOR, report.kpis.totalRevenue ? x.revenue / report.kpis.totalRevenue : 0, x.quantity, x.unitCount, x.productCount]
    : [i + 1, x.key, x.label, x.revenue, report.kpis.totalRevenue ? x.revenue / report.kpis.totalRevenue : 0, x.quantity, x.rows, x.unitCount, x.empCount]));
  const widths = kind === 'emp' ? [7, 12, 28, 18, 18, 12, 14, 12, 12] : [7, 24, 38, 18, 12, 14, 10, 12, 10]; widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(4).numFmt = MONEY_FMT; if (kind === 'emp') ws.getColumn(5).numFmt = MONEY_FMT; ws.getColumn(kind === 'emp' ? 6 : 5).numFmt = '0.0%';
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } }; setupPrint(ws, '1:2');
}

function addTargetSheet(wb, report) {
  const ws = wb.addWorksheet('Target đối chiếu', { views: [{ state: 'frozen', ySplit: 2 }] });
  const timePct = report.pacing?.factor != null ? report.pacing.factor : null;
  ws.mergeCells('A1:I1'); ws.getCell('A1').value = `TARGET & ĐỐI CHIẾU — Target ${moneyText(report.kpis.targetTotal)} · Đạt ${pctText(report.kpis.targetPct)} · Tiến độ thời gian ${timePct == null ? '—' : pctText(timePct * 100)}`; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BLUE}` } }; ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.columns = [{ width: 7 }, { width: 12 }, { width: 28 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 12 }, { width: 18 }, { width: 12 }];
  const h = ws.addRow(['Hạng', 'Mã NV', 'Tên NV', 'Doanh thu', 'Trước VAT', 'Target', '% đạt', 'Còn thiếu/Vượt', 'Tiến độ tháng']); setHeader(h);
  report.targetRows.forEach((x, i) => ws.addRow([i + 1, x.emp_code, x.emp_name, x.revenue, x.revenue_before_vat, x.target, x.pct == null ? null : x.pct / 100, x.gap, timePct]));
  [4, 5, 6, 8].forEach((c) => (ws.getColumn(c).numFmt = MONEY_FMT)); [7, 9].forEach((c) => (ws.getColumn(c).numFmt = '0.0%'));
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 9 } }; setupPrint(ws, '1:2');
}

function addDetailSheet(wb, report) {
  const ws = wb.addWorksheet('Chi tiết đơn hàng', { views: [{ state: 'frozen', ySplit: 2 }] });
  const cols = [
    ['STT', 'stt', 7],
    ['Tuyến', 'route', 8],
    ['Mã số NV', 'emp_code', 11],
    ['Mã đơn vị', 'unit_code', 24],
    ['Tên nhà thầu', 'contractor_name', 30],
    ['Thứ tự ưu tiên\n(H.A*/H.A…)', 'priority', 13],
    ['Số QĐ/QLNB trúng thầu\n(G1.GE…)', 'iit_code', 24],
    ['Tên thuốc', 'product_name', 26],
    ['Hoạt chất + hàm lượng', 'ingredient_strength', 34],
    ['Đơn vị tính', 'uom', 10],
    ['Giá trúng thầu', 'bid_price', 15],
    ['Số lượng xuất bán', 'quantity', 15],
    ['Thành tiền chưa VAT', 'revenue_before_vat', 18],
    ['Ghi chú', 'note', 24],
  ];
  ws.mergeCells(1, 1, 1, cols.length); ws.getCell(1, 1).value = `CHI TIẾT ĐƠN HÀNG — ${report.rows.length.toLocaleString('vi-VN')} dòng nguồn · Không gộp dòng · Tổng trước VAT ${moneyText(report.kpis.revenueBeforeVat)}`; ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BLUE}` } }; ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 26;
  ws.columns = cols.map(([, key, width]) => ({ key, width }));
  const h = ws.getRow(2); cols.forEach(([header], i) => { h.getCell(i + 1).value = header; }); setHeader(h);
  h.height = 32;
  report.rows.forEach((r, i) => {
    const row = ws.addRow({
      stt: i + 1,
      route: r.route || '',
      emp_code: r.emp_code || '',
      unit_code: r.unit_code || '',
      contractor_name: r.contractor_name || r.contractor_code || '',
      priority: r.priority || '',
      iit_code: r.iit_code || r.qd || r.bid_package || '',
      product_name: r.product_name || '',
      ingredient_strength: [r.active_ingredient, r.ham_luong].filter(Boolean).join('\n'),
      uom: r.uom || '',
      bid_price: r.bid_price == null ? null : n(r.bid_price),
      quantity: r.quantity == null ? null : n(r.quantity),
      revenue_before_vat: Math.round(n(r.revenue) / VAT_DIVISOR),
      note: r.note || r.source_order || '',
    });
    row.height = 30; // tối đa khoảng 2 dòng hiển thị theo yêu cầu CEO
  });
  ['bid_price', 'revenue_before_vat'].forEach((k) => (ws.getColumn(k).numFmt = MONEY_FMT));
  ws.getColumn('quantity').numFmt = '#,##0';
  ws.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', horizontal: rowNumber === 2 ? 'center' : undefined, wrapText: true, shrinkToFit: false };
      cell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });
    if (rowNumber >= 3 && row.height > 30) row.height = 30;
  });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } }; setupPrint(ws, '1:2');
}

async function excelBuffer(report) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'App Report'; wb.created = new Date();
  addDetailSheet(wb, report);
  addSummarySheet(wb, report);
  addGroupSheet(wb, 'Tổng hợp NV', report.groups.emp, report, 'emp');
  addGroupSheet(wb, 'Tổng hợp đơn vị', report.groups.unit, report, 'unit');
  addGroupSheet(wb, 'Tổng hợp sản phẩm', report.groups.product, report, 'product');
  addTargetSheet(wb, report);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function csvCell(v) {
  let s = safe(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
function csvBuffer(report) {
  const lines = [
    ['BÁO CÁO DOANH THU BÁN HÀNG', report.kys.join(', ') || report.ky],
    ['Tổng doanh thu', report.kpis.totalRevenue], ['Doanh thu trước VAT', report.kpis.revenueBeforeVat], ['Tổng số lượng', report.kpis.totalQuantity],
    ['Số dòng', report.kpis.rowCount], ['Nhân viên', report.kpis.empCount], ['Đơn vị', report.kpis.unitCount], ['Sản phẩm', report.kpis.productCount], ['% đạt target', report.kpis.targetPct ?? ''],
    ['Cập nhật dữ liệu', dateText(report.updatedAt)], [],
  ].map((r) => r.map(csvCell).join(','));
  const fields = [
    ['STT', null], ['Kỳ', 'ky'], ['Ngày bán', 'date'], ['Nguồn', 'source'], ['Số đơn nguồn', 'source_order'], ['Mã dòng nguồn', 'source_line_id'], ['Mã NV', 'emp_code'], ['Tên NV', 'emp_name'], ['Tỉnh/Thành', 'province'], ['Tuyến', 'route'], ['Mã đơn vị', 'unit_code'], ['Tên đơn vị', 'unit_name'], ['Mã nhà thầu', 'contractor_code'], ['Tên nhà thầu', 'contractor_name'], ['Gói thầu/QĐ', 'bid_package'], ['Mã QLNB', 'iit_code'], ['Tên sản phẩm', 'product_name'], ['Hoạt chất', 'active_ingredient'], ['Hàm lượng', 'ham_luong'], ['ĐVT', 'uom'], ['Ưu tiên', 'priority'], ['Giá trúng thầu', 'bid_price'], ['Đơn giá bán', 'unit_price'], ['Số lượng', 'quantity'], ['Doanh thu sau VAT', 'revenue'], ['Doanh thu trước VAT', null], ['Cơ sở doanh thu', 'revenue_basis'], ['Trạng thái DT', 'revenue_status'], ['Trạng thái mapping', 'mapping_status'], ['Dữ liệu cập nhật', 'data_as_of'], ['Ghi chú', 'note'],
  ];
  lines.push(fields.map(([h]) => csvCell(h)).join(','));
  report.rows.forEach((r, i) => lines.push(fields.map(([, k], idx) => {
    const value = idx === 0 ? i + 1
      : idx === 25 ? Math.round(n(r.revenue) / VAT_DIVISOR)
        : k === 'date' ? dateOnlyText(r.date)
          : k === 'data_as_of' ? dateText(r.data_as_of)
            : r[k];
    return csvCell(value);
  }).join(',')));
  return Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8');
}

function pickFont(bold = false) {
  const paths = bold ? ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'] : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'];
  return paths.find((p) => fs.existsSync(p));
}
function pdfBuffer(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 34, bottom: 34, left: 36, right: 36 }, bufferPages: true, info: { Title: `Báo cáo doanh thu ${report.ky}`, Author: 'App Report' } });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const regular = pickFont(false), bold = pickFont(true); if (regular) doc.registerFont('VN', regular); if (bold) doc.registerFont('VN-Bold', bold); const F = regular ? 'VN' : 'Helvetica'; const FB = bold ? 'VN-Bold' : 'Helvetica-Bold';
    const pageW = doc.page.width - 72;
    const title = (t, sub) => { doc.font(FB).fontSize(18).fillColor('#1f4e78').text(t, 36, 34, { width: pageW, align: 'center' }); doc.font(F).fontSize(9).fillColor('#64748b').text(sub || '', { align: 'center' }); doc.moveDown(1); };
    const kpi = (x, y, w, label, value, fill) => { doc.roundedRect(x, y, w, 55, 7).fill(fill); doc.font(F).fontSize(8).fillColor('#52606d').text(label, x + 8, y + 8, { width: w - 16, align: 'center' }); doc.font(FB).fontSize(13).fillColor('#1f4e78').text(value, x + 6, y + 28, { width: w - 12, align: 'center' }); };
    const table = (heading, rows, columns, yStart = 105) => { doc.font(FB).fontSize(13).fillColor('#1f4e78').text(heading, 36, yStart); let y = yStart + 22; const totalW = pageW; const widths = columns.map((c) => c.w * totalW); const drawHeader = () => { doc.rect(36, y, totalW, 22).fill('#1f6f54'); let x = 36; columns.forEach((c, i) => { doc.font(FB).fontSize(8).fillColor('white').text(c.h, x + 3, y + 6, { width: widths[i] - 6, align: c.a || 'left' }); x += widths[i]; }); y += 22; }; drawHeader(); rows.forEach((r, idx) => { if (y > doc.page.height - 56) { doc.addPage(); y = 40; drawHeader(); } if (idx % 2) doc.rect(36, y, totalW, 20).fill('#f3f7fa'); let x = 36; columns.forEach((c, i) => { doc.font(F).fontSize(8).fillColor('#263645').text(safe(c.v(r, idx)), x + 3, y + 5, { width: widths[i] - 6, align: c.a || 'left', ellipsis: true, height: 12 }); x += widths[i]; }); y += 20; }); };
    title(`BÁO CÁO DOANH THU BÁN HÀNG — ${report.kys.join(', ') || report.ky}`, `Cập nhật ${dateText(report.updatedAt)} · App Report`);
    const gap = 8, w = (pageW - gap * 3) / 4, y = 92;
    kpi(36, y, w, 'TỔNG DOANH THU', moneyText(report.kpis.totalRevenue), '#dce6f1'); kpi(36 + w + gap, y, w, 'TRƯỚC VAT', moneyText(report.kpis.revenueBeforeVat), '#e2f0d9'); kpi(36 + (w + gap) * 2, y, w, 'QUY MÔ', `${report.kpis.empCount} NV · ${report.kpis.unitCount} ĐV · ${report.kpis.productCount} SP`, '#fff2cc'); kpi(36 + (w + gap) * 3, y, w, 'ĐẠT TARGET', pctText(report.kpis.targetPct), '#e4dfec');
    doc.font(F).fontSize(10).fillColor('#40566e').text(`Tổng số lượng: ${vi(report.kpis.totalQuantity)} · ${report.kpis.rowCount.toLocaleString('vi-VN')} dòng dữ liệu`, 36, 160, { align: 'center', width: pageW });
    table('Top 10 nhân viên', report.groups.emp.slice(0, 10), [{ h: '#', w: .05, a: 'center', v: (_, i) => i + 1 }, { h: 'Nhân viên', w: .38, v: (r) => `${r.key} · ${r.label}` }, { h: 'Doanh thu', w: .24, a: 'right', v: (r) => moneyText(r.revenue) }, { h: 'Tỷ trọng', w: .14, a: 'right', v: (r) => pctText(report.kpis.totalRevenue ? r.revenue / report.kpis.totalRevenue * 100 : 0) }, { h: 'ĐV/SP', w: .19, a: 'right', v: (r) => `${r.unitCount}/${r.productCount}` }], 185);
    doc.addPage(); title('CƠ CẤU DOANH THU', 'Top đơn vị và sản phẩm');
    table('Top 12 đơn vị', report.groups.unit.slice(0, 12), [{ h: '#', w: .05, a: 'center', v: (_, i) => i + 1 }, { h: 'Đơn vị', w: .56, v: (r) => `${r.key} · ${r.label}` }, { h: 'Doanh thu', w: .24, a: 'right', v: (r) => moneyText(r.revenue) }, { h: 'Tỷ trọng', w: .15, a: 'right', v: (r) => pctText(report.kpis.totalRevenue ? r.revenue / report.kpis.totalRevenue * 100 : 0) }], 90);
    doc.addPage(); title('TOP SẢN PHẨM', 'Doanh thu và số lượng');
    table('Top 15 sản phẩm', report.groups.product.slice(0, 15), [{ h: '#', w: .05, a: 'center', v: (_, i) => i + 1 }, { h: 'Mã QLNB / sản phẩm', w: .51, v: (r) => `${r.key} · ${r.label}` }, { h: 'Số lượng', w: .16, a: 'right', v: (r) => vi(r.quantity) }, { h: 'Doanh thu', w: .20, a: 'right', v: (r) => moneyText(r.revenue) }, { h: '%', w: .08, a: 'right', v: (r) => pctText(report.kpis.totalRevenue ? r.revenue / report.kpis.totalRevenue * 100 : 0) }], 90);
    doc.addPage(); title('TARGET & NGUỒN DỮ LIỆU', `Tiến độ ngày ${report.pacing?.daysElapsed || '—'}/${report.pacing?.daysInMonth || '—'}`);
    table('Đối chiếu target theo nhân viên', report.targetRows.slice(0, 24), [{ h: 'NV', w: .24, v: (r) => `${r.emp_code} · ${r.emp_name}` }, { h: 'Trước VAT', w: .20, a: 'right', v: (r) => moneyText(r.revenue_before_vat) }, { h: 'Target', w: .20, a: 'right', v: (r) => moneyText(r.target) }, { h: '% đạt', w: .12, a: 'right', v: (r) => pctText(r.pct) }, { h: 'Thiếu/Vượt', w: .24, a: 'right', v: (r) => moneyText(r.gap) }], 90);
    const range = doc.bufferedPageRange(); for (let i = range.start; i < range.start + range.count; i++) { doc.switchToPage(i); doc.font(F).fontSize(8).fillColor('#94a3b8').text(`App Report · Trang ${i + 1}/${range.count}`, 36, doc.page.height - doc.page.margins.bottom - 12, { width: pageW, align: 'right', lineBreak: false }); }
    doc.end();
  });
}

function addPptTitle(slide, title, sub = '') {
  slide.background = { color: 'F7FAFC' };
  slide.addText(title, { x: .45, y: .25, w: 12.4, h: .45, fontFace: 'Arial', fontSize: 22, bold: true, color: BLUE, margin: 0 });
  if (sub) slide.addText(sub, { x: .45, y: .75, w: 12.4, h: .25, fontFace: 'Arial', fontSize: 9, color: '64748B', margin: 0 });
  slide.addShape('line', { x: .45, y: 1.08, w: 12.4, h: 0, line: { color: 'D7E2EA', width: 1 } });
}
function pptKpi(slide, x, y, w, label, value, fill) {
  slide.addShape('roundRect', { x, y, w, h: 1.0, rectRadius: .08, fill: { color: fill }, line: { color: 'CAD5DF', width: 1 } });
  slide.addText(label, { x: x + .08, y: y + .12, w: w - .16, h: .22, fontSize: 10, color: '52606D', bold: true, align: 'center', margin: 0 });
  slide.addText(value, { x: x + .06, y: y + .47, w: w - .12, h: .32, fontSize: 17, color: BLUE, bold: true, align: 'center', margin: 0, fit: 'shrink' });
}
function pptTopTable(slide, rows, report, opts = {}) {
  const startY = opts.y || 1.35; const max = opts.max || 10; const data = rows.slice(0, max); const rowH = (5.65 / Math.max(10, data.length));
  data.forEach((r, i) => { const y = startY + i * rowH; const share = report.kpis.totalRevenue ? r.revenue / report.kpis.totalRevenue : 0; slide.addText(`${i + 1}`, { x: .5, y, w: .35, h: .25, fontSize: 10, bold: true, color: BLUE, align: 'center', margin: 0 }); slide.addText(`${r.key} · ${r.label}`, { x: .95, y, w: 5.25, h: .25, fontSize: 10, color: '263645', margin: 0, fit: 'shrink' }); slide.addShape('rect', { x: 6.35, y: y + .03, w: Math.max(.02, 3.2 * share / Math.max(...data.map((x) => x.revenue / report.kpis.totalRevenue), .01)), h: .16, fill: { color: i === 0 ? 'F5A11E' : '2F80ED' }, line: { color: 'FFFFFF', transparency: 100 } }); slide.addText(moneyText(r.revenue), { x: 9.65, y, w: 2.0, h: .25, fontSize: 10, bold: true, color: BLUE, align: 'right', margin: 0 }); slide.addText(pctText(share * 100), { x: 11.8, y, w: .8, h: .25, fontSize: 9, color: '64748B', align: 'right', margin: 0 }); });
}
async function pptxBuffer(report) {
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'App Report'; pptx.subject = `Báo cáo doanh thu ${report.ky}`; pptx.title = `Báo cáo doanh thu ${report.ky}`; pptx.company = 'DONAPHARM'; pptx.lang = 'vi-VN'; pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'vi-VN' };
  let s = pptx.addSlide(); s.background = { color: BLUE }; s.addText('DONAPHARM', { x: .7, y: .65, w: 12, h: .4, fontSize: 18, bold: true, color: 'FFFFFF', charSpacing: 2, margin: 0 }); s.addText('BÁO CÁO DOANH THU BÁN HÀNG', { x: .7, y: 2.0, w: 12, h: .7, fontSize: 30, bold: true, color: 'FFFFFF', margin: 0, align: 'center' }); s.addText(report.kys.join(', ') || report.ky, { x: .7, y: 2.85, w: 12, h: .5, fontSize: 22, color: 'DCE6F1', margin: 0, align: 'center' }); s.addText(`Cập nhật ${dateText(report.updatedAt)}`, { x: .7, y: 5.95, w: 12, h: .3, fontSize: 10, color: 'DCE6F1', margin: 0, align: 'center' });
  s = pptx.addSlide(); addPptTitle(s, '1. Tổng quan doanh thu', 'Các tổng số được đặt ngay đầu báo cáo'); pptKpi(s, .55, 1.45, 2.9, 'TỔNG DOANH THU', moneyText(report.kpis.totalRevenue), LIGHT_BLUE); pptKpi(s, 3.7, 1.45, 2.9, 'TRƯỚC VAT', moneyText(report.kpis.revenueBeforeVat), LIGHT_GREEN); pptKpi(s, 6.85, 1.45, 2.9, 'ĐẠT TARGET', pctText(report.kpis.targetPct), 'E4DFEC'); pptKpi(s, 10.0, 1.45, 2.75, 'TỔNG SỐ LƯỢNG', vi(report.kpis.totalQuantity), 'FFF2CC'); pptKpi(s, .55, 3.0, 2.9, 'NHÂN VIÊN', vi(report.kpis.empCount), 'D9EAD3'); pptKpi(s, 3.7, 3.0, 2.9, 'ĐƠN VỊ', vi(report.kpis.unitCount), 'D9EAF7'); pptKpi(s, 6.85, 3.0, 2.9, 'SẢN PHẨM', vi(report.kpis.productCount), 'FCE4D6'); pptKpi(s, 10.0, 3.0, 2.75, 'SỐ DÒNG', vi(report.kpis.rowCount), 'EDEDED');
  s = pptx.addSlide(); addPptTitle(s, '2. Doanh thu theo nhân viên', 'So sánh doanh thu và tỷ trọng tổng doanh thu'); pptTopTable(s, report.groups.emp, report, { max: 12 });
  s = pptx.addSlide(); addPptTitle(s, '3. Top đơn vị', 'Các đơn vị đóng góp doanh thu lớn nhất'); pptTopTable(s, report.groups.unit, report, { max: 12 });
  s = pptx.addSlide(); addPptTitle(s, '4. Top sản phẩm', 'Các sản phẩm đóng góp doanh thu lớn nhất'); pptTopTable(s, report.groups.product, report, { max: 12 });
  s = pptx.addSlide(); addPptTitle(s, '5. Cơ cấu tuyến và nguồn dữ liệu'); const summary = [...report.groups.route.map((r) => ({ ...r, type: 'Tuyến' })), ...report.groups.source.map((r) => ({ ...r, type: 'Nguồn' }))]; pptTopTable(s, summary, report, { max: 10 });
  s = pptx.addSlide(); addPptTitle(s, '6. Tiến độ target theo nhân viên', `Ngày ${report.pacing?.daysElapsed || '—'}/${report.pacing?.daysInMonth || '—'} · Target tính theo doanh thu trước VAT`); const tr = report.targetRows.slice(0, 18); const rows = [['NV', 'Trước VAT', 'Target', '% đạt', 'Thiếu/Vượt'], ...tr.map((r) => [`${r.emp_code} · ${r.emp_name}`, moneyText(r.revenue_before_vat), moneyText(r.target), pctText(r.pct), moneyText(r.gap)])]; s.addTable(rows, { x: .55, y: 1.35, w: 12.2, h: 5.6, border: { type: 'solid', color: 'CBD5E1', pt: .5 }, fill: 'FFFFFF', color: '263645', fontFace: 'Arial', fontSize: 9, margin: .05, rowH: .28, autoFit: false, colW: [3.9, 2.1, 2.1, 1.2, 2.2], bold: false });
  s = pptx.addSlide(); addPptTitle(s, '7. Kết luận nhanh', 'Báo cáo tự động từ App Report'); const topEmp = report.groups.emp[0], topUnit = report.groups.unit[0], topProduct = report.groups.product[0]; const bullets = [`Tổng doanh thu ${moneyText(report.kpis.totalRevenue)}; trước VAT ${moneyText(report.kpis.revenueBeforeVat)}.`, `Tiến độ target toàn phạm vi: ${pctText(report.kpis.targetPct)}.`, topEmp ? `Nhân viên dẫn đầu: ${topEmp.key} · ${topEmp.label} — ${moneyText(topEmp.revenue)}.` : '', topUnit ? `Đơn vị dẫn đầu: ${topUnit.label} — ${moneyText(topUnit.revenue)}.` : '', topProduct ? `Sản phẩm dẫn đầu: ${topProduct.label} — ${moneyText(topProduct.revenue)}.` : '', `Quy mô: ${report.kpis.empCount} NV · ${report.kpis.unitCount} đơn vị · ${report.kpis.productCount} sản phẩm.`].filter(Boolean); s.addText(bullets.map((text) => ({ text, options: { bullet: { indent: 18 }, hanging: 4, breakLine: true } })), { x: 1.0, y: 1.55, w: 11.2, h: 4.5, fontSize: 18, color: '263645', breakLine: true, margin: .12, paraSpaceAfterPt: 16 });
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}

module.exports = { buildReport, excelBuffer, csvBuffer, pdfBuffer, pptxBuffer };
