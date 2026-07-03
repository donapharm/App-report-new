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
export function unitText(code, name) {
  const c = String(code || '').trim();
  const nm = String(name || '').trim();
  if (!c && !nm) return '—';
  if (!c) return nm;
  if (!nm || nm === c) return c;
  if (/^\d{3}\./.test(c) && c.includes(nm)) return c;
  if (nm.startsWith(`${c}.`) || nm.startsWith(`${c} `) || nm.includes(c)) return nm;
  return `${c}.${nm}`;
}
export const roleLabel = (r) => ({ ceo: 'CEO', admin: 'Quản trị', sale: 'Sale' }[r] || r);
