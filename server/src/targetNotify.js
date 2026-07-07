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
const MILESTONES = [50, 90, 100];       // % đạt cần chúc/nhắc
const BEHIND_MARGIN = 15;               // %đạt thấp hơn %thời-gian quá mức này = chậm nhịp

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

// Soạn nội dung tin cho 1 sự kiện (dùng chung Telegram/email).
function messageFor(e) {
  const monthNo = String(e.ky).split('.')[0];
  const perDay = e.daysLeft > 0 && e.gap > 0 ? Math.round(e.gap / e.daysLeft) : 0;
  const needLine = e.gap > 0 ? `\nCòn thiếu ${moneyShort(e.gap)}${e.daysLeft ? ` · còn ${e.daysLeft} ngày → cần ~${moneyShort(perDay)}/ngày` : ''}.` : '';
  if (e.type === 'milestone' && e.milestone === 100) return `🎉 Chúc mừng ${e.name}! Tháng ${monthNo} bạn đã ĐẠT 100% target (${moneyShort(e.achieved)}/${moneyShort(e.target)}). Giữ nhịp bứt phá nhé!`;
  if (e.type === 'milestone') return `🎯 [Tháng ${monthNo}] ${e.name}: bạn đã đạt ${e.milestone}% target (${moneyShort(e.achieved)} / ${moneyShort(e.target)} · ${pctText(e.pct)}).${needLine}`;
  return `⏱️ [Tháng ${monthNo}] ${e.name}: đang CHẬM NHỊP — mới đạt ${pctText(e.pct)} target trong khi thời gian đã trôi ${pctText(e.timePct)}.${needLine}`;
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

module.exports = { evaluate, pendingEvents, markSent, messageFor, ceoDigest, MILESTONES, BEHIND_MARGIN, STATE_FILE };
