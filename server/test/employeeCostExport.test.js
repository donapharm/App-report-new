const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ExcelJS = require('exceljs');
const exportService = require('../src/employeeCostExport');

function costReport() {
  return {
    empCode: 'DN001', employeeName: 'Đặng Xuân Trung', from: '2026-07', to: '2026-07',
    periods: [{
      period: '2026-07',
      columns: [
        { key: 'c36', label: 'CP cộng tác viên (%)', annual: false },
        { key: 'c44', label: 'Lương cuối năm (%)', annual: true },
        { key: 'c32', label: 'Cấm', annual: false },
        { key: 'c47', label: 'Cấm', annual: false },
      ],
      rows: [{
        date: '2026-07-02', orderCode: 'DH001', route: 'ETC', c7: '001.BVĐK Đồng Nai', contractorName: 'Nhà thầu Ánh Dương',
        c5: 'G1.GE.QĐ139.1', c16: 'Thuốc tiếng Việt', strength: '500 mg', c25: 'Viên', bidPrice: 1234567.89,
        quantity: 10, revenueBeforeVat: 2278049356.19, c36: 5, c44: 5,
        amounts: { c36: 41144556, c44: 1210470 }, rowMonthlyTotal: 41144556, note: 'Đủ dấu tiếng Việt',
      }],
      summary: { monthlyTotal: 41144556, annualTotal: 1210470, columnTotals: { c36: 41144556, c44: 1210470 } },
    }],
  };
}

function gapPayload() {
  return {
    from: '2026-07', to: '2026-07', scope: { admin: false, employeeCode: 'DN001' },
    items: [{
      productCode: 'G1.GE.QĐ139.2963.N4.549', productName: 'Valesto', unitLabels: ['001.BVĐK Đồng Nai'],
      employeeCount: 1, employeeCodes: ['DN001'], revenueAffected: 1234567,
      reason: 'qd_mismatch', suggestedCatalogCodes: ['G1.GE.QĐ48.549.N4.549'],
    }],
  };
}

test('Vietnamese accounting formatting and amount in words are deterministic', () => {
  assert.equal(exportService.formatNumberVi(1234567.89, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), '1.234.567,89');
  assert.equal(exportService.formatMoneyVi(-1234), '(1.234) đ');
  assert.equal(exportService.formatPercentVi(5), '5,0');
  assert.equal(exportService.formatDateVi('2026-07-22'), '22/07/2026');
  assert.equal(exportService.numberToVietnameseWords(41144556), 'Bốn mươi mốt triệu một trăm bốn mươi bốn nghìn năm trăm năm mươi sáu đồng');
});

test('cost Excel is A4 landscape, numeric/formula capable, Vietnamese, and blocks C32/C47', async () => {
  const buffer = await exportService.costWorkbookBuffer([costReport()], { now: new Date('2026-07-22T10:00:00Z') });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.pageSetup.paperSize, 9);
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.printTitlesRow, '7:7');
  const headers = sheet.getRow(7).values.slice(1);
  assert.equal(headers[0], 'STT');
  assert.equal(sheet.getRow(8).getCell(1).value, 1);
  assert.ok(headers.includes('CP cộng tác viên (%)'));
  assert.ok(headers.includes('Thành tiền C36'));
  assert.ok(headers.includes('Thành tiền C44'));
  assert.equal(headers.some((header) => /C32|C47/.test(String(header))), false);
  const bidPriceColumn = headers.indexOf('Giá trúng thầu') + 1;
  const monthlyColumn = headers.indexOf('Tổng chi phí tháng') + 1;
  assert.equal(typeof sheet.getRow(8).getCell(bidPriceColumn).value, 'number');
  assert.equal(sheet.getRow(8).getCell(bidPriceColumn).numFmt, exportService.ACCOUNTING_INTEGER);
  const totalCell = sheet.getRow(9).getCell(monthlyColumn);
  assert.equal(totalCell.value.formula, `${sheet.getColumn(monthlyColumn).letter}8:${sheet.getColumn(monthlyColumn).letter}8`.replace(/^/, 'SUM(').concat(')'));
  assert.equal(totalCell.value.result, 41144556);
  assert.match(sheet.getRow(11).getCell(1).value, /Bằng chữ: Bốn mươi mốt triệu/);
  assert.match(sheet.headerFooter.oddFooter, /Trang &P\/&N/);
});

test('part-time cost export keeps only C36 and does not invent C44', async () => {
  const report = costReport();
  report.empCode = 'DN021'; report.employeeName = 'CTV';
  report.periods[0].columns = [{ key: 'c36', label: 'CP cộng tác viên (%)', annual: false }];
  report.periods[0].rows[0].amounts = { c36: 41144556 };
  report.periods[0].summary = { monthlyTotal: 41144556, annualTotal: 0, columnTotals: { c36: 41144556 } };
  const workbook = exportService.createCostWorkbook([report]);
  const sheet = workbook.worksheets[0];
  const headers = sheet.getRow(7).values.slice(1).join(' | ');
  assert.match(headers, /C36/);
  assert.doesNotMatch(headers, /C44|C41|C43|C45/);
  assert.doesNotMatch(sheet.getColumn(1).values.join(' | '), /KHOẢN CUỐI NĂM|C44/);
});

test('ALL employee Excel/PDF export keeps STT + employee identity and employee subtotals', async () => {
  const report = costReport();
  report.empCode = 'ALL'; report.employeeName = 'Tất cả nhân viên'; report.allEmployees = true;
  report.periods[0].rows[0].stt = 7;
  report.periods[0].rows[0].employeeCode = 'DN001';
  report.periods[0].rows[0].employeeName = 'Đặng Xuân Trung';
  report.periods[0].employeeSubtotals = [{ employeeCode: 'DN001', employeeName: 'Đặng Xuân Trung', rowCount: 1, monthlyTotal: 41144556, columnTotals: { c36: 41144556, c44: 1210470 } }];
  const workbook = exportService.createCostWorkbook([report]);
  const sheet = workbook.worksheets[0];
  const headers = sheet.getRow(7).values.slice(1);
  assert.deepEqual(headers.slice(0, 2), ['STT', 'Nhân viên']);
  assert.equal(sheet.getRow(8).getCell(1).value, 7);
  assert.match(sheet.getRow(8).getCell(2).value, /DN001 · Đặng Xuân Trung/);
  assert.match(sheet.getColumn(2).values.join(' | '), /TỔNG PHỤ DN001/);
  const pdf = inspectPdf(await exportService.costPdfBuffer([report]), 'cost-all');
  assert.match(pdf.text, /STT/);
  assert.match(pdf.text, /Nhân viên/);
  assert.match(pdf.text, /Tổng phụ: DN001/);
});

test('cost Excel/PDF print the same province, unit-group, route, date and search slice resolved by backend', async () => {
  const report = costReport();
  report.filters = { province: 'ĐỒNG NAI', unitGroup: 'BV', route: 'CL', date: '2026-07-02' };
  report.search = { query: 'Cerecaps', filteredRows: 1, totalRows: 12 };
  report.periods[0].search = { query: 'Cerecaps', filteredRows: 1, totalRows: 12 };
  const workbook = exportService.createCostWorkbook([report]);
  assert.match(workbook.worksheets[0].getCell('A5').value, /Vùng\/Tỉnh: ĐỒNG NAI/);
  assert.match(workbook.worksheets[0].getCell('A5').value, /Nhóm mã ĐV: BV/);
  assert.match(workbook.worksheets[0].getCell('A5').value, /Tuyến: CL/);
  assert.match(workbook.worksheets[0].getCell('A5').value, /Ngày: 02\/07\/2026/);
  assert.match(workbook.worksheets[0].getCell('A5').value, /Hiện 1\/12 dòng/);
  const pdf = inspectPdf(await exportService.costPdfBuffer([report]), 'cost-filtered');
  assert.match(pdf.text, /ĐỒNG NAI/);
  assert.match(pdf.text, /Nhóm mã ĐV: BV/);
  assert.match(pdf.text, /Tuyến: CL/);
  assert.match(pdf.text, /Ngày: 02\/07\/2026/);
  assert.match(pdf.text, /Cerecaps/);
});

test('gap Excel has two A4 landscape sheets and blank fill/confirmation columns', async () => {
  const buffer = await exportService.gapWorkbookBuffer(gapPayload(), { now: new Date('2026-07-22T10:00:00Z') });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Theo mã QLNB', 'Ánh xạ lệch mã']);
  const main = workbook.getWorksheet('Theo mã QLNB');
  assert.equal(main.getCell('I7').value, '% cần điền');
  assert.equal(main.getCell('I8').value, '');
  assert.equal(main.getCell('F8').value, 1234567);
  assert.equal(main.pageSetup.orientation, 'landscape');
  assert.equal(main.pageSetup.fitToWidth, 1);
  const mapping = workbook.getWorksheet('Ánh xạ lệch mã');
  assert.equal(mapping.getCell('A8').value, 'G1.GE.QĐ139.2963.N4.549');
  assert.equal(mapping.getCell('B8').value, 'G1.GE.QĐ48.549.N4.549');
  assert.equal(mapping.getCell('C8').value, '');
});

function inspectPdf(buffer, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-cost-pdf-'));
  const file = path.join(dir, `${name}.pdf`); fs.writeFileSync(file, buffer);
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  const fonts = execFileSync('pdffonts', [file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { info, text, fonts };
}

test('cost PDF is A4 landscape with embedded Unicode font, Vietnamese text, totals, and page footer', async () => {
  const result = inspectPdf(await exportService.costPdfBuffer([costReport()], { now: new Date('2026-07-22T10:00:00Z') }), 'cost');
  assert.match(result.info, /Page size:\s+841\.89 x 595\.28 pts \(A4\)/);
  assert.match(result.info, /Pages:\s+1\b/);
  assert.match(result.fonts, /NotoSans|DejaVuSans|LiberationSans/);
  assert.match(result.fonts, /yes\s+yes/);
  assert.match(result.text, /BÁO CÁO CHI PHÍ CỦA TÔI/);
  assert.match(result.text, /Công ty TNHH Dược phẩm Donapharm/);
  assert.match(result.text, /2\.278\.049\.356,19/);
  assert.match(result.text, /41\.144\.556 đ/);
  assert.match(result.text, /Bằng chữ: Bốn mươi mốt triệu/);
  assert.match(result.text, /C44 không tính vào tổng tháng/);
  assert.match(result.text, /Trang 1\/1/);
  assert.doesNotMatch(result.text, /C32|C47/);
});

test('gap PDF is A4 landscape, Unicode, and includes blank-worklist labels and mapping', async () => {
  const result = inspectPdf(await exportService.gapPdfBuffer(gapPayload(), { now: new Date('2026-07-22T10:00:00Z') }), 'gaps');
  assert.match(result.info, /Page size:\s+841\.89 x 595\.28 pts \(A4\)/);
  assert.match(result.info, /Pages:\s+2\b/);
  assert.match(result.fonts, /NotoSans|DejaVuSans|LiberationSans/);
  assert.match(result.text, /DANH SÁCH MẶT HÀNG CHƯA CÓ % CHI PHÍ/);
  assert.match(result.text, /% cần điền/);
  assert.match(result.text, /G1\.GE\.QĐ139\.2963\.N4\.549/);
  assert.match(result.text, /G1\.GE\.QĐ48\.549\.N4\.549/);
  assert.match(result.text, /ÁNH XẠ LỆCH MÃ QĐ\/QLNB/);
  assert.match(result.text, /Trang 1\/2/);
  assert.match(result.text, /Trang 2\/2/);
});

test('export routes are authenticated, self-scope through employeeCostPayload, and expose both formats', () => {
  const routes = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  for (const path of ['/employee-cost/export.xlsx', '/employee-cost/export.pdf', '/employee-cost/gaps/export.xlsx', '/employee-cost/gaps/export.pdf']) {
    assert.match(routes, new RegExp(`router\\.get\\('${path.replace('.', '\\.')}.*auth\\.requireAuth`));
  }
  assert.match(routes, /employeeCost\.resolveScopedEmployee/);
  assert.match(routes, /auditEvent: `export_\$\{format\}`/);
  assert.match(routes, /province: req\.query\.province/);
  assert.match(routes, /unitGroup: req\.query\.unitGroup/);
  assert.match(routes, /route: req\.query\.route/);
});
