/**
 * import_employees.js — Nạp DANH BẠ NHÂN VIÊN thật (SĐT/email/mã NV/vai trò) vào app mới,
 * để đăng nhập OTP map được SĐT -> nhân viên -> phạm vi quyền.
 *
 * Chạy trên server:
 *   node server/scripts/import_employees.js <file-nhan-vien.json>
 * File là MẢNG các nhân viên; map linh hoạt tên cột. Ghi đè server/data/users.json
 * (tự backup users.backup.json). IN tóm tắt để kiểm tra.
 *
 * TODO(LIVE): nếu tên cột khác, gửi 1 bản ghi mẫu để dev bổ sung alias.
 */
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
const noAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();

const ALIAS = {
  emp_code: ['emp_code', 'emp_number', 'ma_nv', 'manv', 'ma_nhan_vien', 'code', 'msnv'],
  name: ['name', 'ten', 'ho_ten', 'hoten', 'ten_nv', 'full_name', 'fullname', 'ten_nhan_vien'],
  phone: ['phone', 'sdt', 'so_dien_thoai', 'dien_thoai', 'mobile', 'phone_number', 'dienthoai', 'so_dt'],
  email: ['email', 'mail', 'e_mail', 'thu_dien_tu'],
  role: ['role', 'vai_tro', 'chuc_danh', 'chucdanh', 'chuc_vu', 'quyen', 'position'],
  route: ['route', 'tuyen'],
};
const LOOKUP = {};
for (const [f, list] of Object.entries(ALIAS)) for (const a of list) LOOKUP[a] = f;

// Chuẩn hoá SĐT VN: bỏ ký tự thừa, +84/84 -> 0
function normPhone(v) {
  let s = String(v || '').replace(/[^\d]/g, '');
  if (s.startsWith('84')) s = '0' + s.slice(2);
  if (s && !s.startsWith('0')) s = '0' + s;
  return s;
}
// Suy vai trò từ text (mặc định sale)
function toRole(v) {
  const r = noAccent(v);
  if (/(ceo|giam doc|tong giam|chu tich|bod)/.test(r)) return 'ceo';
  if (/(admin|quan tri|it)/.test(r)) return 'admin';
  if (['ceo', 'admin', 'sale'].includes(r)) return r;
  return 'sale';
}

function mapEmp(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const f = LOOKUP[noAccent(k).replace(/\s+/g, '_')];
    if (f && out[f] == null) out[f] = v;
  }
  return {
    emp_code: String(out.emp_code || '').trim().toUpperCase(),
    name: String(out.name || '').trim(),
    phone: normPhone(out.phone),
    email: String(out.email || '').trim().toLowerCase(),
    role: toRole(out.role),
    route: out.route ? String(out.route).trim() : undefined,
  };
}

const file = process.argv[2];
if (!file) { console.error('Thiếu đường dẫn file nhân viên .json'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('Không thấy file:', file); process.exit(1); }
const raw = readJson(file, null);
const arr = Array.isArray(raw) ? raw : (raw && (raw.rows || raw.data || raw.items || raw.users)) || [];
if (!Array.isArray(arr) || !arr.length) { console.error('File không phải mảng nhân viên hoặc rỗng.'); process.exit(1); }

const emps = arr.map(mapEmp).filter((e) => e.emp_code);
// Backup danh bạ cũ rồi ghi mới
const usersPath = path.join(DATA, 'users.json');
if (fs.existsSync(usersPath)) fs.copyFileSync(usersPath, path.join(DATA, 'users.backup.json'));
writeJson(usersPath, emps);

const noPhone = emps.filter((e) => !e.phone).length;
const byRole = emps.reduce((m, e) => ((m[e.role] = (m[e.role] || 0) + 1), m), {});
console.log('✔ Nạp danh bạ nhân viên xong (KIỂM TRA):');
console.log(`  Tổng: ${emps.length} NV · vai trò: ${JSON.stringify(byRole)}`);
console.log(`  Thiếu SĐT: ${noPhone} (những NV này sẽ KHÔNG đăng nhập OTP được)`);
console.log('  Mẫu 2 NV:', JSON.stringify(emps.slice(0, 2).map((e) => ({ ...e, email: e.email ? '(có)' : '' }))));
if (noPhone) console.log('\n⚠ Có NV thiếu SĐT hoặc cột SĐT tên khác — gửi 1 bản ghi mẫu để dev bổ sung alias.');
