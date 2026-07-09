/**
 * targetNotify.js — "bộ não" thông báo target chủ động.
 * Tính % đạt từng NV theo kỳ + nhịp thời gian, phát hiện các sự kiện cần báo:
 *   - Vượt mốc 50% / 90% / 100% (mỗi mốc gửi 1 lần/kỳ).
 *   - "Đang chậm nhịp": %đạt thấp hơn %thời gian đã trôi quá BEHIND_MARGIN (tối đa 1 lần/tuần).
 * Chống spam bằng file trạng thái data/notif_state.json (gitignored).
 * Kênh gửi (Telegram/email) do worker/bot đẩy — module này chỉ tính + soạn nội dung.
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');
const A = require('./analytics');
const targetAdmin = require('./targetAdmin');

const STATE_FILE = path.join(__dirname, '..', 'data', 'notif_state.json');
const OPTOUT_FILE = path.join(__dirname, '..', 'config', 'notify_optout.json');
const MILESTONES = [50, 90, 100];       // % đạt cần chúc/nhắc
const BEHIND_MARGIN = 15;               // %đạt thấp hơn %thời-gian quá mức này = chậm nhịp

// Danh sách mã NV TUYỆT ĐỐI không nhận thông báo (CEO chốt) — đọc từ config, cache theo mtime.
let _muteSet = null, _muteMtime = -1;
function muteSet() {
  try {
    const st = fs.statSync(OPTOUT_FILE);
    if (!_muteSet || st.mtimeMs !== _muteMtime) {
      const j = JSON.parse(fs.readFileSync(OPTOUT_FILE, 'utf8')) || {};
      _muteSet = new Set((j.codes || []).map((c) => String(c).trim().toUpperCase()));
      _muteMtime = st.mtimeMs;
    }
  } catch { if (!_muteSet) _muteSet = new Set(); }
  return _muteSet;
}
// Chặn nếu: nằm trong danh sách config HOẶC user có cờ no_auto_notify.
function isMuted(emp) {
  const code = String(emp || '').trim().toUpperCase();
  if (muteSet().has(code)) return true;
  try { return !!store.findUserByCode(code)?.no_auto_notify; } catch { return false; }
}

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch { return {}; } };
const writeState = (o) => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(o, null, 2), 'utf8'); } catch { /* ignore */ } };
const moneyShort = (n) => `${Math.round(Number(n || 0)).toLocaleString('vi-VN')}đ`;
const pctText = (v) => (v == null ? '—' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`);

// Trạng thái từng NV roster ở 1 kỳ: target, đạt (before VAT), %đạt, %thời gian, chậm nhịp.
function evaluate({ ky } = {}) {
  const k = ky || store.lastCompleteKy() || store.latestKy();
  const pacing = A.targetPacingMeta(k);
  const timePct = +(pacing.factor * 100).toFixed(1);
  const weekOfMonth = Math.max(1, Math.ceil((pacing.daysElapsed || 1) / 7));
  const daysLeft = Math.max(0, (pacing.daysInMonth || 0) - (pacing.daysElapsed || 0));
  const roster = store.targetRoster({ scope: {} });
  const targets = new Map(targetAdmin.resolveTargets({ ky: k, empCodes: roster.map((u) => u.emp_code) }).map((e) => [e.emp_code, Number(e.target || 0)]));
  const revByEmp = {};
  for (const r of store.getRows({ ky: k, scope: {} })) if (r.emp_code) revByEmp[r.emp_code] = (revByEmp[r.emp_code] || 0) + Number(r.revenue || 0);
  const rows = [];
  for (const u of roster) {
    const emp = u.emp_code; const target = targets.get(emp) || 0;
    if (target <= 0) continue; // chưa giao target -> không nhắc
    const achieved = Math.round((revByEmp[emp] || 0) / A.VAT_DIVISOR);
    const pct = +(achieved / target * 100).toFixed(1);
    const behind = pacing.isCurrent && pct < 100 && pct < (timePct - BEHIND_MARGIN);
    rows.push({ emp_code: emp, name: u.name || emp, target, achieved, pct, gap: Math.max(0, target - achieved), behind, daysLeft });
  }
  return { ky: k, timePct, weekOfMonth, isCurrent: pacing.isCurrent, daysLeft, rows };
}

// So với trạng thái đã gửi -> danh sách SỰ KIỆN mới cần báo (chưa gửi).
function pendingEvents({ ky } = {}) {
  const ev = evaluate({ ky });
  const st = readState();
  const events = [];
  for (const r of ev.rows) {
    if (isMuted(r.emp_code)) continue; // NV trong danh sách chặn -> không tạo sự kiện gửi
    const done = st[`${ev.ky}|${r.emp_code}`] || {};
    for (const m of MILESTONES) if (r.pct >= m && !done[`m${m}`]) events.push({ ...r, ky: ev.ky, timePct: ev.timePct, type: 'milestone', milestone: m });
    // Chậm nhịp: tối đa 1 lần/tuần/kỳ, và chỉ khi chưa đạt mốc 50 (tránh nhắc kép).
    if (r.behind && r.pct < 50 && !done[`behind_w${ev.weekOfMonth}`]) events.push({ ...r, ky: ev.ky, timePct: ev.timePct, type: 'behind', week: ev.weekOfMonth });
  }
  return { ky: ev.ky, timePct: ev.timePct, weekOfMonth: ev.weekOfMonth, events };
}

// Đánh dấu đã gửi (chỉ gọi cho sự kiện ĐÃ đẩy thành công).
function markSent(events) {
  if (!events || !events.length) return;
  const st = readState();
  for (const e of events) {
    const key = `${e.ky}|${e.emp_code}`;
    st[key] = st[key] || {};
    if (e.type === 'milestone') st[key][`m${e.milestone}`] = new Date().toISOString();
    if (e.type === 'behind') st[key][`behind_w${e.week}`] = new Date().toISOString();
  }
  writeState(st);
}

// ---------- EMAIL HTML (đẹp, an toàn client email: table + inline style) ----------
// Màu theo brand DONAPHARM: xanh dương chủ đạo + cam nhấn. Logo & QR nhúng kiểu CID
// (notifyChannels đính kèm) — Gmail chặn ảnh data-URI nên phải dùng cid:.
const BRAND = '#1560ac';
const CID_LOGO = 'dnpharma-logo';
const CID_ZALO = 'dnpharma-zalo';
const APP_URL = process.env.APP_PUBLIC_URL || 'https://reportnew.donapharm.asia';
function badge(text, bg, fg = '#ffffff') {
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:14px;font-weight:bold;padding:7px 16px;border-radius:999px;line-height:1;">${text}</span>`;
}
function ctaButton(url, label, color = BRAND) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;border-collapse:collapse;"><tr>`
    + `<td style="border-radius:8px;background:${color};"><a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:8px;">${label}</a></td>`
    + `</tr></table>`;
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function progressBar(pct, color) {
  const w = Math.max(2, Math.min(100, Number(pct) || 0));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
    + `<tr><td style="background:#e8edf2;border-radius:999px;padding:0;">`
    + `<table role="presentation" width="${w}%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:10px;">`
    + `<tr><td style="background:${color};height:12px;line-height:12px;font-size:0;border-radius:999px;">&nbsp;</td></tr></table>`
    + `</td></tr></table>`;
}
function statTable(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0 4px;">`
    + rows.map(([l, v, c]) => `<tr>`
      + `<td style="padding:9px 0;color:#6b7785;font-size:14px;border-bottom:1px solid #eef2f6;">${esc(l)}</td>`
      + `<td align="right" style="padding:9px 0;color:${c || '#1f2a37'};font-size:15px;font-weight:bold;border-bottom:1px solid #eef2f6;">${v}</td>`
      + `</tr>`).join('')
    + `</table>`;
}
// srcLogo/srcZalo: mặc định dùng cid: (email thật). Bản PREVIEW truyền data-URI để xem trên trình duyệt.
function emailShell({ accent = BRAND, preheader = '', bodyHtml = '', srcLogo = `cid:${CID_LOGO}`, srcZalo = `cid:${CID_ZALO}` }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:#eef2f6;">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;padding:24px 10px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">`
    + `<tr><td align="center">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border-collapse:collapse;box-shadow:0 1px 4px rgba(16,24,40,.10);">`
    + `<tr><td style="height:5px;line-height:5px;font-size:0;background:${accent};">&nbsp;</td></tr>`
    + `<tr><td align="center" style="padding:24px 28px 10px;background:#ffffff;">`
    + `<img src="${srcLogo}" alt="DNPHARMA" width="200" style="display:block;width:200px;max-width:62%;height:auto;border:0;">`
    + `</td></tr>`
    + `<tr><td style="padding:14px 28px 24px;">${bodyHtml}</td></tr>`
    + `<tr><td style="background:#f7f9fb;border-top:1px solid #edf1f5;padding:20px 28px 14px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>`
    + `<td width="92" valign="middle" style="width:92px;"><img src="${srcZalo}" alt="Zalo OA DNPHARMA" width="86" style="display:block;width:86px;height:auto;border:0;border-radius:8px;"></td>`
    + `<td valign="middle" style="padding-left:16px;color:#55606c;font-size:13px;line-height:1.55;">`
    + `<b style="color:${BRAND};font-size:14px;">Kết nối Zalo OA DNPHARMA</b><br>Quét mã QR để nhận thông báo &amp; tra cứu nhanh.`
    + `</td></tr></table></td></tr>`
    + `<tr><td style="background:#f7f9fb;padding:0 28px 16px;color:#93a0ad;font-size:11px;line-height:1.5;">`
    + `Email tự động từ <b style="color:#8794a3;">DNPHARMA App Report</b> · vui lòng không trả lời email này.`
    + `</td></tr>`
    + `</table></td></tr></table></body></html>`;
}
// Email HTML cho 1 SỰ KIỆN (milestone/behind). assets = {srcLogo, srcZalo} cho bản preview.
function emailHtmlFor(e, assets = {}) {
  const monthNo = String(e.ky).split('.')[0];
  const perDay = e.daysLeft > 0 && e.gap > 0 ? Math.round(e.gap / e.daysLeft) : 0;
  const isDone = e.type === 'milestone' && e.milestone === 100;
  const isBehind = e.type === 'behind';
  const accent = isBehind ? '#b45309' : BRAND;
  const barColor = isDone ? '#16a34a' : isBehind ? '#f59e0b' : BRAND;
  const heroEmoji = isDone ? '🎉' : isBehind ? '⏱️' : '🎯';
  const heroTitle = isDone ? `Chúc mừng ${esc(e.name)}!`
    : isBehind ? `${esc(e.name)} ơi, đang chậm nhịp` : `${esc(e.name)} đã đạt ${e.milestone}% target`;
  const heroSub = isDone ? `Tháng ${monthNo} bạn đã <b style="color:#16a34a;">ĐẠT 100% target</b>. Giữ nhịp bứt phá nhé!`
    : isBehind ? `Tháng ${monthNo}: mới đạt <b>${pctText(e.pct)}</b> trong khi thời gian đã trôi <b>${pctText(e.timePct)}</b>.`
      : `Tháng ${monthNo}: bạn đã đạt <b>${pctText(e.pct)}</b> target — cố thêm chút nữa nhé!`;
  const stats = [
    ['Doanh thu đạt', moneyShort(e.achieved), '#0e7a5f'],
    ['Target tháng', moneyShort(e.target)],
    ['Tỷ lệ đạt', pctText(e.pct), isDone ? '#16a34a' : isBehind ? '#b45309' : '#0e7a5f'],
  ];
  if (e.gap > 0) stats.push(['Còn thiếu', moneyShort(e.gap), '#b45309']);
  if (e.gap > 0 && e.daysLeft) stats.push([`Còn ${e.daysLeft} ngày · cần ~/ngày`, moneyShort(perDay)]);
  const chip = isDone ? badge('✓ Đã đạt 100% target', '#16a34a')
    : isBehind ? badge('⚡ Cần tăng tốc', '#ef8a1f') : badge(`Đã đạt ${e.milestone}% target`, BRAND);
  const body = `<div style="font-size:36px;line-height:1;margin-bottom:12px;">${heroEmoji}</div>`
    + `<div style="font-size:22px;font-weight:bold;color:#1f2a37;margin-bottom:12px;">${heroTitle}</div>`
    + `<div style="margin-bottom:16px;">${chip}</div>`
    + `<div style="font-size:15px;color:#55606c;line-height:1.55;margin-bottom:22px;">${heroSub}</div>`
    + progressBar(e.pct, barColor)
    + `<div style="text-align:right;font-size:12px;color:#93a0ad;margin-top:6px;">${pctText(e.pct)} / 100%</div>`
    + statTable(stats)
    + ctaButton(APP_URL, 'Xem báo cáo chi tiết →', isBehind ? '#b45309' : BRAND);
  const preheader = isDone ? `Tháng ${monthNo}: đạt 100% target (${moneyShort(e.achieved)})` : `Tháng ${monthNo}: ${pctText(e.pct)} target`;
  return emailShell({ accent, preheader, bodyHtml: body, ...assets });
}
// Email HTML cho tin TRẠNG THÁI 1 NV (gửi đích danh/test).
function emailHtmlForStatus(r, ev, assets = {}) {
  const monthNo = String(ev.ky).split('.')[0];
  const perDay = r.daysLeft > 0 && r.gap > 0 ? Math.round(r.gap / r.daysLeft) : 0;
  const done = r.gap <= 0;
  const behind = ev.isCurrent && r.pct < ev.timePct && !done;
  const accent = behind ? '#b45309' : BRAND;
  const barColor = done ? '#16a34a' : behind ? '#f59e0b' : BRAND;
  const stats = [
    ['Doanh thu đạt', moneyShort(r.achieved), '#0e7a5f'],
    ['Target tháng', moneyShort(r.target)],
    ['Tỷ lệ đạt', pctText(r.pct), done ? '#16a34a' : '#0e7a5f'],
    ['Thời gian đã trôi', pctText(ev.timePct)],
  ];
  if (r.gap > 0) stats.push(['Còn thiếu', moneyShort(r.gap), '#b45309']);
  if (r.gap > 0 && r.daysLeft) stats.push([`Còn ${r.daysLeft} ngày · cần ~/ngày`, moneyShort(perDay)]);
  const title = done ? `${esc(r.name)} đã đạt/vượt target 🎉` : `Tình hình target · ${esc(r.name)}`;
  const sub = done ? `Tháng ${monthNo}: bạn đã hoàn thành target — tuyệt vời!`
    : `Tháng ${monthNo}: ${behind ? 'đang <b style="color:#b45309;">chậm nhịp</b>' : 'đang <b style="color:#0e7a5f;">bám nhịp tốt</b>'} — cùng bứt tốc nhé!`;
  const body = `<div style="font-size:20px;font-weight:bold;color:#1f2a37;margin-bottom:6px;">📊 ${title}</div>`
    + `<div style="font-size:14px;color:#55606c;margin-bottom:20px;">${sub}</div>`
    + progressBar(r.pct, barColor)
    + `<div style="text-align:right;font-size:12px;color:#93a0ad;margin-top:6px;">${pctText(r.pct)} / 100%</div>`
    + statTable(stats)
    + ctaButton(APP_URL, 'Xem báo cáo chi tiết →', behind ? '#b45309' : BRAND);
  return emailShell({ accent, preheader: `${r.name}: ${pctText(r.pct)} target tháng ${monthNo}`, bodyHtml: body, ...assets });
}
// Email HTML tổng hợp cho CEO.
function ceoDigestHtml({ ky, ...assets } = {}) {
  const ev = evaluate({ ky });
  const monthNo = String(ev.ky).split('.')[0];
  if (!ev.rows.length) return emailShell({ preheader: `Chưa có NV target tháng ${monthNo}`, bodyHtml: `<div style="font-size:16px;color:#1f2a37;">Tháng ${monthNo}: chưa có NV nào được giao target.</div>`, ...assets });
  const sorted = [...ev.rows].sort((a, b) => a.pct - b.pct);
  const achieved = ev.rows.filter((r) => r.pct >= 100).length;
  const behind = ev.rows.filter((r) => r.behind).length;
  const totalTarget = ev.rows.reduce((s, r) => s + r.target, 0);
  const totalAchieved = ev.rows.reduce((s, r) => s + r.achieved, 0);
  const totalPct = totalTarget > 0 ? +(totalAchieved / totalTarget * 100).toFixed(1) : null;
  const rowsHtml = sorted.map((r) => {
    const icon = r.pct >= 100 ? '✅' : r.behind ? '🔴' : '•';
    const c = r.pct >= 100 ? '#16a34a' : r.behind ? '#dc2626' : '#1f2a37';
    return `<tr><td style="padding:9px 0;border-bottom:1px solid #eef2f6;font-size:14px;color:#1f2a37;">${icon}&nbsp; ${esc(r.name)}</td>`
      + `<td align="right" style="padding:9px 0;border-bottom:1px solid #eef2f6;font-size:14px;font-weight:bold;color:${c};">${pctText(r.pct)}</td>`
      + `<td align="right" style="padding:9px 0 9px 12px;border-bottom:1px solid #eef2f6;font-size:12px;color:#8794a3;white-space:nowrap;">${moneyShort(r.achieved)} / ${moneyShort(r.target)}</td></tr>`;
  }).join('');
  const body = `<div style="font-size:20px;font-weight:bold;color:#1f2a37;margin-bottom:4px;">📊 Tổng hợp target · Tháng ${monthNo}</div>`
    + `<div style="font-size:14px;color:#55606c;margin-bottom:16px;">Tổng đạt <b style="color:#0e7a5f;">${pctText(totalPct)}</b> (${moneyShort(totalAchieved)} / ${moneyShort(totalTarget)}) · thời gian đã trôi ${pctText(ev.timePct)}</div>`
    + progressBar(totalPct, '#0e7a5f')
    + `<div style="margin:16px 0 6px;font-size:14px;color:#55606c;"><b style="color:#16a34a;">✅ ${achieved} đạt</b> &nbsp;·&nbsp; <b style="color:#dc2626;">🔴 ${behind} chậm nhịp</b> &nbsp;/&nbsp; ${ev.rows.length} NV</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rowsHtml}</table>`
    + ctaButton(APP_URL, 'Xem toàn bộ báo cáo →', BRAND);
  return emailShell({ preheader: `Tổng đạt ${pctText(totalPct)} tháng ${monthNo}`, bodyHtml: body, ...assets });
}

// Soạn nội dung tin cho 1 sự kiện (dùng chung Telegram/email).
function messageFor(e) {
  const monthNo = String(e.ky).split('.')[0];
  const perDay = e.daysLeft > 0 && e.gap > 0 ? Math.round(e.gap / e.daysLeft) : 0;
  const needLine = e.gap > 0 ? `\nCòn thiếu ${moneyShort(e.gap)}${e.daysLeft ? ` · còn ${e.daysLeft} ngày → cần ~${moneyShort(perDay)}/ngày` : ''}.` : '';
  if (e.type === 'milestone' && e.milestone === 100) return `🎉 Chúc mừng ${e.name}! Tháng ${monthNo} bạn đã ĐẠT 100% target (${moneyShort(e.achieved)}/${moneyShort(e.target)}). Giữ nhịp bứt phá nhé!`;
  if (e.type === 'milestone') return `🎯 [Tháng ${monthNo}] ${e.name}: bạn đã đạt ${e.milestone}% target (${moneyShort(e.achieved)} / ${moneyShort(e.target)} · ${pctText(e.pct)}).${needLine}`;
  return `⏱️ [Tháng ${monthNo}] ${e.name}: đang CHẬM NHỊP — mới đạt ${pctText(e.pct)} target trong khi thời gian đã trôi ${pctText(e.timePct)}.${needLine}`;
}

// Tin TRẠNG THÁI cho 1 NV bất kỳ (không cần vừa vượt mốc) — dùng để gửi đích danh/test.
function statusMessage(r, ev) {
  const monthNo = String(ev.ky).split('.')[0];
  const perDay = r.daysLeft > 0 && r.gap > 0 ? Math.round(r.gap / r.daysLeft) : 0;
  const need = r.gap > 0 ? `\nCòn thiếu ${moneyShort(r.gap)}${r.daysLeft ? ` · còn ${r.daysLeft} ngày → cần ~${moneyShort(perDay)}/ngày` : ''}.` : '\n✅ Bạn đã đạt/vượt target.';
  const pace = !ev.isCurrent ? '' : (r.pct >= ev.timePct ? ' — đang ĐÚNG/VƯỢT nhịp 👍' : ' — đang CHẬM nhịp ⏱️');
  return `📊 [Tháng ${monthNo}] ${r.name}: đạt ${pctText(r.pct)} target (${moneyShort(r.achieved)}/${moneyShort(r.target)}) · thời gian đã trôi ${pctText(ev.timePct)}${pace}.${need}`;
}
function statusFor(emp, ky) {
  const ev = evaluate({ ky });
  const r = ev.rows.find((x) => x.emp_code === String(emp || '').trim().toUpperCase());
  if (!r) return null; // NV chưa giao target / không thuộc roster
  return { emp_code: r.emp_code, ky: ev.ky, pct: r.pct, message: statusMessage(r, ev), html: emailHtmlForStatus(r, ev) };
}

// Bản tổng hợp theo TỪNG NV cho CEO (1 tin gọn).
function ceoDigest({ ky } = {}) {
  const ev = evaluate({ ky });
  const monthNo = String(ev.ky).split('.')[0];
  if (!ev.rows.length) return `📊 [Tháng ${monthNo}] Chưa có NV nào được giao target.`;
  const sorted = [...ev.rows].sort((a, b) => a.pct - b.pct);
  const achieved = ev.rows.filter((r) => r.pct >= 100).length;
  const behind = ev.rows.filter((r) => r.behind).length;
  const totalTarget = ev.rows.reduce((s, r) => s + r.target, 0);
  const totalAchieved = ev.rows.reduce((s, r) => s + r.achieved, 0);
  const totalPct = totalTarget > 0 ? +(totalAchieved / totalTarget * 100).toFixed(1) : null;
  const lines = sorted.map((r) => `${r.pct >= 100 ? '✅' : r.behind ? '🔴' : '•'} ${r.name}: ${pctText(r.pct)} (${moneyShort(r.achieved)}/${moneyShort(r.target)})`);
  return `📊 [Tháng ${monthNo}] Tổng đạt ${pctText(totalPct)} (${moneyShort(totalAchieved)}/${moneyShort(totalTarget)}) · thời gian ${pctText(ev.timePct)}\n`
    + `✅ ${achieved} NV đạt · 🔴 ${behind} NV chậm nhịp / ${ev.rows.length} NV\n`
    + lines.join('\n');
}

module.exports = { evaluate, pendingEvents, markSent, messageFor, emailHtmlFor, emailHtmlForStatus, statusFor, ceoDigest, ceoDigestHtml, isMuted, MILESTONES, BEHIND_MARGIN, STATE_FILE };
