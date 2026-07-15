// Chuẩn hiển thị kế toán Việt Nam: dấu chấm hàng nghìn, tiền nguyên đồng + đ.
export function num(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Math.round(Number(n)).toLocaleString('vi-VN');
}
export function money(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return num(n) + 'đ';
}
// Rút gọn chỉ dùng cho trục chart/không gian rất hẹp; thập phân dùng dấu phẩy VN.
export function short(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const a = Math.abs(v);
  const fmt = (x, d = 1) => x.toLocaleString('vi-VN', { maximumFractionDigits: d });
  if (a >= 1e9) return fmt(v / 1e9, 2) + ' tỷ';
  if (a >= 1e6) return fmt(v / 1e6, 0) + ' tr';
  if (a >= 1e3) return fmt(v / 1e3, 0) + ' nghìn';
  return num(v);
}
export function pct(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('vi-VN', { maximumFractionDigits: digits }) + '%';
}

// Chuẩn ngày toàn App Report New: giao diện dd/mm/yy, dữ liệu/API vẫn ISO yyyy-mm-dd.
const pad2 = (v) => String(v).padStart(2, '0');
export function parseDisplayDate(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const vi = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  let y, m, d;
  if (iso) [, y, m, d] = iso;
  else if (vi) { d = vi[1]; m = vi[2]; y = vi[3].length === 2 ? `20${vi[3]}` : vi[3]; }
  else return null;
  y = Number(y); m = Number(m); d = Number(d);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
export function formatDate(value, fallback = '') {
  if (value == null || value === '') return fallback;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1].slice(-2)}`;
  const parsed = parseDisplayDate(s);
  if (parsed) return formatDate(parsed, fallback);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback || s;
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
}
export function formatDateTime(value, fallback = '') {
  if (value == null || value === '') return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return formatDate(value, fallback);
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}
function looksLikeContractorName(v) {
  return /\b(c[oô]ng\s*ty|tnhh|tr[aá]ch\s*nhi[eệ]m|d[uư][oợ]c|pharma)\b/i.test(String(v || ''));
}
export function labelPair(code, name) {
  const c = String(code || '').trim();
  const nm = String(name || '').trim();
  if (!c && !nm) return { code: '—', name: '' };
  if (!c) return { code: nm, name: '' };
  if (nm && looksLikeContractorName(c)) return { code: nm, name: '' };
  if (!nm || c === nm || c.includes(nm)) return { code: c, name: '' };
  if (nm.includes(c)) return { code: c, name: nm.replace(c, '').trim().replace(/^[-–—·\s]+/, '') };
  return { code: c, name: nm };
}
export function pairText(code, name) {
  const p = labelPair(code, name);
  return p.name ? `${p.code} - ${p.name}` : p.code;
}
export function unitParts(code, name) {
  const c = String(code || '').trim();
  const nm = String(name || '').trim();
  if (!c && !nm) return { code: '—', name: '' };
  if (!c) return { code: nm, name: '' };
  if (!nm || nm === c || c.includes(nm)) return { code: c, name: '' };
  if (nm.includes(c)) {
    const rest = nm.replace(c, '').trim().replace(/^[./|\-–—·\s]+/, '');
    return { code: c, name: rest };
  }
  return { code: c, name: nm };
}
export function unitText(code, name) {
  const p = unitParts(code, name);
  return p.name ? `${p.code} / ${p.name}` : p.code;
}
export const roleLabel = (r) => ({ ceo: 'CEO', admin: 'Quản trị', sale: 'Sale' }[r] || r);
