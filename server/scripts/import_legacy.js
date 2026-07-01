/**
 * import_legacy.js — Chuyển dữ liệu doanh thu từ APP CŨ (report_upload_data_*.json)
 * thành SLOT của App Report New (data/upload_slots.json + data/uploads/<id>.json + audit).
 *
 * Chạy trên server (nơi có file cũ):
 *   node server/scripts/import_legacy.js <đường-dẫn-file-cũ.json> [ky] [dateFrom] [dateTo]
 * Ví dụ:
 *   node server/scripts/import_legacy.js /home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/report_upload_data_2026-06-01_2026-06-30.json
 *   node server/scripts/import_legacy.js ./old.json 06.2026 2026-06-01 2026-06-30
 *
 * - Nếu không truyền ky/date, script TỰ SUY từ tên file dạng *_YYYY-MM-DD_YYYY-MM-DD.json
 * - Map linh hoạt tên cột cũ -> ReportRow của app mới.
 * - Slot import được đánh dấu active=true (thành nguồn dữ liệu của kỳ đó).
 * - IN RA bản tóm tắt để KIỂM TRA trước khi tin; không xoá gì của app cũ.
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const UP_DIR = path.join(DATA, 'uploads');
fs.mkdirSync(UP_DIR, { recursive: true });
const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
const noAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();

// Bản đồ tên cột cũ -> field mới (thêm alias nếu app cũ dùng tên khác)
const ALIAS = {
  emp_code: ['emp_code', 'emp_number', 'ma_nv', 'manv', 'ma_nhan_vien', 'nhanvien'],
  unit_code: ['unit_code', 'donvi', 'ma_dv', 'madv', 'ma_don_vi'],
  unit_name: ['unit_name', 'ten_dv', 'ten_vt', 'ten_don_vi', 'tendv'],
  route: ['route', 'tuyen'],
  iit_code: ['iit_code', 'qlnb', 'ma_qlnb', 'ma_sp', 'masp'],
  product_name: ['product_name', 'ten_thuoc', 'ten_sp', 'ten_san_pham', 'tensp',
    'item_name', 'iit_name', 'name', 'ten_item', 'ten'],
  quantity: ['quantity', 'so_luong', 'sl', 'soluong'],
  revenue: ['revenue', 'tong_tien', 'doanh_thu', 'thanh_tien', 'tongtien', 'thanhtien'],
  bid_package: ['bid_package', 'goi_thau', 'goithau', 'qd'],
  contractor_code: ['contractor_code', 'ncc', 'nha_cung_cap', 'nhacungcap',
    'nha_thau', 'nhathau', 'ven_name', 'venname', 'ten_nha_thau'],
};
// Tạo map nhanh: alias(chuẩn hoá) -> field
const LOOKUP = {};
for (const [field, list] of Object.entries(ALIAS)) for (const a of list) LOOKUP[a] = field;

// Đọc số chịu được định dạng VN: "22.500.000" (chấm ngăn nghìn), "1.234,5" (phẩy thập phân)
function toNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');     // VN: bỏ chấm nghìn, phẩy -> thập phân
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // chỉ chấm ngăn nghìn -> bỏ
  return Number(s) || 0;
}

function mapRow(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    const field = LOOKUP[noAccent(k).replace(/\s+/g, '_')];
    if (field && out[field] == null) out[field] = v;
  }
  out.emp_code = String(out.emp_code || '').trim().toUpperCase();
  out.revenue = toNum(out.revenue);
  out.quantity = toNum(out.quantity);
  // Fallback: app cũ gộp mã+tên trong DONVI, và tên SP có thể rỗng
  if (!out.unit_name) out.unit_name = out.unit_code;
  if (!out.product_name) out.product_name = out.iit_code;
  // Trích gói thầu (QĐ139/QĐ141…) từ mã IIT nếu chưa có cột gói thầu
  if (!out.bid_package && out.iit_code) {
    const m = String(out.iit_code).match(/Q[ĐD]\s?\d+/i);
    if (m) out.bid_package = m[0].replace(/\s/g, '');
  }
  return out;
}

// ---- Đọc tham số + file ----
const [, , file, kyArg, fromArg, toArg] = process.argv;
if (!file) { console.error('Thiếu đường dẫn file cũ. Xem hướng dẫn ở đầu script.'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('Không thấy file:', file); process.exit(1); }

const raw = readJson(file, null);
const arr = Array.isArray(raw) ? raw : (raw && (raw.rows || raw.data || raw.items)) || [];
if (!Array.isArray(arr) || !arr.length) { console.error('File không phải mảng dòng hoặc rỗng.'); process.exit(1); }

// ---- Suy kỳ/ngày: ưu tiên tham số > tên file (YYYY-MM-DD HOẶC YYYYMMDD) > nội dung dòng (KY/FROM_DATE) ----
let ky = kyArg, dateFrom = fromArg, dateTo = toArg;
const fm = path.basename(file).match(/(\d{4})-?(\d{2})-?(\d{2})[_-](\d{4})-?(\d{2})-?(\d{2})/);
if (fm) {
  dateFrom = dateFrom || `${fm[1]}-${fm[2]}-${fm[3]}`;
  dateTo = dateTo || `${fm[4]}-${fm[5]}-${fm[6]}`;
}
const first = arr[0] || {};
ky = ky || first.KY || first.ky;
dateFrom = dateFrom || first.FROM_DATE || first.from_date || first.DATE || first.date;
dateTo = dateTo || first.TO_DATE || first.to_date;
if (!ky && dateFrom) { const dm = String(dateFrom).match(/(\d{4})-?(\d{2})/); if (dm) ky = `${dm[2]}.${dm[1]}`; }
if (!ky) { console.error('Không suy được kỳ (ky). Truyền tay: node ... <file> MM.YYYY YYYY-MM-DD YYYY-MM-DD'); process.exit(1); }

const rows = arr.map(mapRow).filter((r) => r.emp_code);
const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
const empCount = new Set(rows.map((r) => r.emp_code)).size;

// ---- Ghi slot ----
const id = 'legacy_' + ky.replace('.', '') + '_' + Date.now().toString(36);
writeJson(path.join(UP_DIR, id + '.json'), rows);
const slots = readJson(path.join(DATA, 'upload_slots.json'), []).map((s) => (s.ky === ky ? { ...s, active: false } : s));
slots.push({
  id, ky, dateFrom: dateFrom || ky, dateTo: dateTo || ky,
  totalRows: rows.length, totalRevenue, empCount,
  filename: path.basename(file), uploadedBy: 'IMPORT', uploadedByName: 'Import app cũ',
  uploadedAt: new Date().toISOString(), active: true,
});
writeJson(path.join(DATA, 'upload_slots.json'), slots);
const audit = readJson(path.join(DATA, 'audit.json'), []);
audit.push({ at: new Date().toISOString(), by: 'IMPORT', action: 'import_legacy', ky, slotId: id, rows: rows.length, revenue: totalRevenue, source: path.basename(file) });
writeJson(path.join(DATA, 'audit.json'), audit);

// ---- Tóm tắt để kiểm tra ----
console.log('✔ Import xong (KIỂM TRA giúp trước khi tin):');
console.log(`  Kỳ: ${ky} (${dateFrom} → ${dateTo})`);
console.log(`  Dòng hợp lệ: ${rows.length} / ${arr.length} · NV: ${empCount}`);
console.log(`  Tổng doanh thu: ${totalRevenue.toLocaleString('vi-VN')} đ`);
console.log(`  Slot: ${id} (active)`);
console.log('  Mẫu 2 dòng đầu:', JSON.stringify(rows.slice(0, 2)));
console.log('\n⚠ Nếu doanh thu = 0 hoặc thiếu cột: app cũ dùng tên cột khác — gửi 1 dòng mẫu để dev bổ sung ALIAS.');
