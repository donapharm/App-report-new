// Định dạng tiền tệ VN, rút gọn cho mobile.
export function money(n) {
  if (n == null) return '—';
  return Math.round(n).toLocaleString('vi-VN') + ' đ';
}
export function short(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, '') + ' tỷ';
  if (a >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
  if (a >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(Math.round(n));
}
export function pct(n) {
  return n == null ? '—' : n + '%';
}
export const roleLabel = (r) => ({ ceo: 'CEO', admin: 'Quản trị', sale: 'Sale' }[r] || r);
