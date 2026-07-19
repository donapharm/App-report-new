'use strict';

const crypto = require('crypto');
function n(v) { return Number(v || 0).toLocaleString('vi-VN'); }
function esc(v) { return String(v || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function line(item) {
  const level = item.attention?.level === 'management' ? '🚨 CEO' : item.attention?.level === 'red' ? '🔴 Đỏ' : '🟡';
  return `${level} ${item.emp_code} · ${item.iit_code} · ${item.unit_name || item.unit_code} · ${n(item.days_idle)} ngày`;
}
function buildDormantDigest(data = {}) {
  const s = data.summary || {};
  const items = (data.items || []).filter((x) => x.attention?.level !== 'normal').slice(0, 10);
  const asOf = data.as_of || 'chưa xác định';
  const subject = `[App Report] QLNB ngủ đông · dữ liệu đến ${asOf}`;
  const telegram = [
    `📌 *QLNB NGỦ ĐÔNG — APP REPORT*`,
    `Dữ liệu đến: ${asOf}`,
    `• Đang ngủ đông: ${n(s.dormant)}`,
    `• Chưa kích hoạt: ${n(s.not_activated)}`,
    `• Quá 7 ngày chưa xử lý: ${n(s.red_7_days)}`,
    `• Đưa quản lý/CEO: ${n(s.management_14_days)}`,
    `• Có đơn dương trở lại: ${n(s.reactivated)}`,
    ...(items.length ? ['', '*Ưu tiên xử lý:*', ...items.map(line)] : ['', '✅ Chưa có mã quá hạn xử lý cần leo thang.']),
    '',
    '_App Report chỉ cảnh báo/audit; không tự sửa Finance/Expense._',
  ].join('\n');
  const rows = items.map((item) => `<tr><td>${esc(item.emp_code)}</td><td>${esc(item.iit_code)}</td><td>${esc(item.unit_name || item.unit_code)}</td><td>${n(item.days_idle)}</td><td>${esc(item.attention?.level === 'management' ? 'Đưa CEO' : 'Đỏ')}</td></tr>`).join('');
  const html = `<h2>QLNB ngủ đông — App Report</h2><p>Dữ liệu đến <b>${esc(asOf)}</b></p><ul><li>Đang ngủ đông: <b>${n(s.dormant)}</b></li><li>Chưa kích hoạt: <b>${n(s.not_activated)}</b></li><li>Quá 7 ngày: <b>${n(s.red_7_days)}</b></li><li>Đưa quản lý/CEO: <b>${n(s.management_14_days)}</b></li><li>Có đơn dương trở lại: <b>${n(s.reactivated)}</b></li></ul>${items.length ? `<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>NV</th><th>QLNB</th><th>Đơn vị</th><th>Ngày ngủ</th><th>Mức</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Chưa có mã quá hạn xử lý cần leo thang.</p>'}<p><i>App Report chỉ cảnh báo/audit; không tự sửa Finance/Expense.</i></p>`;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ asOf, summary: s, keys: items.map((x) => [x.key, x.attention?.level]) })).digest('hex').slice(0, 20);
  return { subject, telegram_text: telegram, email_html: html, fingerprint, send_enabled: false };
}

module.exports = { buildDormantDigest };
