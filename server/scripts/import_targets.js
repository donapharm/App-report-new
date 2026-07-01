/**
 * import_targets.js — Nạp TARGET THẬT từ app cũ vào app mới (data/targets_real.json).
 * Khi có target thật, tab Target sẽ hiện "target cũ" + % đạt đúng thay vì 0.
 *
 * Chạy trên server:
 *   node server/scripts/import_targets.js <file-target.json> [ky]
 * File là MẢNG bản ghi target. Map linh hoạt: emp_code, ky, target.
 * - Nếu bản ghi không có 'ky', dùng [ky] truyền vào.
 * - Gộp theo (ky+emp_code): bản mới ghi đè bản cũ cùng kỳ.
 *
 * Nguồn target app cũ: thường lấy từ /api/targets (backend) hoặc V_TEM_TARGET_BONUS.
 * Bot có thể dump JSON từ đó rồi chạy script này.
 */
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
const noAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();
function toNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s) || 0;
}
const ALIAS = {
  emp_code: ['emp_code', 'emp_number', 'ma_nv', 'manv', 'code'],
  ky: ['ky', 'period', 'thang', 'ky_bao_cao'],
  target: ['target', 'chi_tieu', 'target_truoc_vat', 'muc_tieu', 'kpi'],
};
const LOOKUP = {};
for (const [f, list] of Object.entries(ALIAS)) for (const a of list) LOOKUP[a] = f;

const [, , file, kyArg] = process.argv;
if (!file) { console.error('Thiếu đường dẫn file target .json'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('Không thấy file:', file); process.exit(1); }
const raw = readJson(file, null);
const arr = Array.isArray(raw) ? raw : (raw && (raw.rows || raw.data || raw.items || raw.targets)) || [];
if (!Array.isArray(arr) || !arr.length) { console.error('File không phải mảng target hoặc rỗng.'); process.exit(1); }

const mapped = arr.map((o) => {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const f = LOOKUP[noAccent(k).replace(/\s+/g, '_')];
    if (f && out[f] == null) out[f] = v;
  }
  return { emp_code: String(out.emp_code || '').trim().toUpperCase(), ky: String(out.ky || kyArg || '').trim(), target: toNum(out.target) };
}).filter((t) => t.emp_code && t.ky);

// Gộp với target_real cũ, ghi đè cùng (ky+emp_code)
const cur = readJson(path.join(DATA, 'targets_real.json'), []);
const key = (t) => t.ky + '|' + t.emp_code;
const map = new Map(cur.map((t) => [key(t), t]));
for (const t of mapped) map.set(key(t), t);
const merged = [...map.values()];
writeJson(path.join(DATA, 'targets_real.json'), merged);

const byKy = mapped.reduce((m, t) => ((m[t.ky] = (m[t.ky] || 0) + 1), m), {});
console.log('✔ Nạp target thật xong (KIỂM TRA):');
console.log(`  Bản ghi nạp: ${mapped.length} · theo kỳ: ${JSON.stringify(byKy)}`);
console.log(`  Tổng target_real.json hiện có: ${merged.length}`);
console.log('  Mẫu 2:', JSON.stringify(mapped.slice(0, 2)));
if (mapped.length < arr.length) console.log(`\n⚠ Bỏ qua ${arr.length - mapped.length} dòng thiếu emp_code/ky — kiểm tên cột nếu cần.`);
