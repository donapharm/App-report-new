'use strict';

const crypto = require('crypto');
function n(v) { return Number(v || 0).toLocaleString('vi-VN'); }
function esc(v) { return String(v || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function line(item) {
  const status = item.attention?.status;
  const level = status === 'overdue' ? '🚨 Quá hạn' : status === 'due' ? '🔴 Đến hạn' : '🕒 Sắp review';
  return `${level} · ${item.emp_code} · ${item.iit_code} · ${item.unit_name || item.unit_code} · chu kỳ ${n(item.action?.cycle)}`;
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
    `• Chưa có kế hoạch: ${n(s.unplanned)}`,
    `• Đang triển khai trong 14 ngày: ${n(s.in_progress)}`,
    `• Đến hạn review: ${n(s.due_review)}`,
    `• Quá hạn review: ${n(s.overdue_review)}`,
    `• Có đơn dương trở lại: ${n(s.reactivated)}`,
    ...(items.length ? ['', '*Cần CEO chú ý:*', ...items.map(line)] : ['', '✅ Chưa có kế hoạch đến hạn hoặc quá hạn.']),
    '',
    '_App Report chỉ cảnh báo/audit; không tự sửa Finance/Expense._',
  ].join('\n');
  const rows = items.map((item) => `<tr><td>${esc(item.emp_code)}</td><td>${esc(item.iit_code)}</td><td>${esc(item.unit_name || item.unit_code)}</td><td>${n(item.action?.cycle)}</td><td>${esc(item.attention?.status === 'overdue' ? 'Quá hạn' : item.attention?.status === 'due' ? 'Đến hạn' : 'Sắp review')}</td></tr>`).join('');
  const html = `<h2>QLNB ngủ đông — App Report</h2><p>Dữ liệu đến <b>${esc(asOf)}</b></p><ul><li>Đang ngủ đông: <b>${n(s.dormant)}</b></li><li>Chưa có kế hoạch: <b>${n(s.unplanned)}</b></li><li>Đang triển khai trong 14 ngày: <b>${n(s.in_progress)}</b></li><li>Đến hạn review: <b>${n(s.due_review)}</b></li><li>Quá hạn review: <b>${n(s.overdue_review)}</b></li><li>Có đơn dương trở lại: <b>${n(s.reactivated)}</b></li></ul>${items.length ? `<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>NV</th><th>QLNB</th><th>Đơn vị</th><th>Chu kỳ</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Chưa có kế hoạch đến hạn hoặc quá hạn.</p>'}<p><i>App Report chỉ cảnh báo/audit; không tự sửa Finance/Expense.</i></p>`;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ asOf, summary: s, keys: items.map((x) => [x.key, x.attention?.status, x.action?.cycle]) })).digest('hex').slice(0, 20);
  return { subject, telegram_text: telegram, email_html: html, fingerprint, send_enabled: false };
}

module.exports = { buildDormantDigest };
