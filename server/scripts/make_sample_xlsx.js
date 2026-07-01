// Tạo file Excel mẫu để thử tính năng Upload: server/data/sample_upload.xlsx
const path = require('path');
const ExcelJS = require('exceljs');

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DoanhThu');
  ws.addRow(['ma_nv', 'ma_dv', 'ten_dv', 'ma_qlnb', 'ten_thuoc', 'so_luong', 'tong_tien', 'goi_thau']);
  const units = [['BV001', 'Bệnh viện Mẫu 01'], ['PK002', 'Phòng khám Mẫu 02'], ['NT003', 'Nhà thuốc Mẫu 03']];
  const prods = [['QLNB101', 'Sản phẩm A01'], ['QLNB102', 'Sản phẩm B02'], ['QLNB103', 'Sản phẩm C03']];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 1; i <= 40; i++) {
    const emp = 'DN' + String((i % 6) + 1).padStart(3, '0');
    const u = units[i % units.length];
    const p = prods[i % prods.length];
    const qty = Math.floor(50 + rnd() * 300);
    const rev = qty * Math.floor(20000 + rnd() * 200000);
    ws.addRow([emp, u[0], u[1], p[0], p[1], qty, rev, rnd() > 0.5 ? 'QĐ139' : 'QĐ141']);
  }
  // 1 dòng lỗi (thiếu mã NV) + 1 dòng trùng để test cảnh báo
  ws.addRow(['', 'BV001', 'Bệnh viện Mẫu 01', 'QLNB101', 'Sản phẩm A01', 10, 500000, 'QĐ139']);
  const out = path.join(__dirname, '..', 'data', 'sample_upload.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('✔ Tạo file mẫu:', out);
})();
