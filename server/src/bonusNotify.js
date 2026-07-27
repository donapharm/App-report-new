'use strict';
/**
 * bonusNotify — mốc thưởng + tổng thưởng cuối tháng (CEO chốt 2026-07-27).
 *
 * ‼ NGƯỠNG ĐỌC TỪ CẤU HÌNH THẬT, KHÔNG HARDCODE.
 *   CEO ban đầu nói "100% = P1, 110% = P2". Đối chiếu employee_bonus_tiers.json thì
 *   NGƯỢC: P1 bắt đầu ở 90% (bậc đầu có bonusPct > 0), P2 bắt đầu ở
 *   priorityThresholdPct (đang là 101). CEO đã chốt: nhắn đủ 4 mốc, gọi ĐÚNG tên.
 *   Vì vậy mốc được SUY RA từ config — đổi config là mốc tự đổi, không phải sửa code.
 *
 * Module này CHỈ ĐỊNH DẠNG CHỮ. Mọi con số tiền do employeeBonus tính và được
 * truyền vào. Không tự nhân chia ra tiền ở đây.
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'notif_bonus_state.json');

const moneyShort = (n) => `${Math.round(Number(n || 0)).toLocaleString('vi-VN')}đ`;
const pctText = (v) => (v == null ? '—' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`);
// ‼ Chặn null/'' trước: Number(null) === 0, nếu không thì số thưởng chưa tính được
//   sẽ bị hiểu thành 0đ và nhắn cho NV như một lời hứa sai.
const finite = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch { return {}; } };
const writeState = (o) => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(o, null, 2), 'utf8'); } catch { /* ignore */ } };

/**
 * Suy ra danh sách mốc cần nhắn từ cấu hình thưởng.
 *  - P1: mọi bậc baseTiers có bonusPct > 0 → mốc `fromPct`. Bậc đầu tiên = "P1 bắt đầu",
 *    các bậc sau = "P1 lên bậc".
 *  - P2: priorityThresholdPct → "P2 bắt đầu".
 * Trả [] nếu cấu hình không hợp lệ (fail-closed: thà không nhắn còn hơn nhắn sai).
 */
function milestonesFromConfig(config = {}) {
  const tiers = Array.isArray(config.baseTiers) ? config.baseTiers : [];
  const paid = tiers
    .filter((t) => finite(t?.fromPct) != null && finite(t?.bonusPct) > 0)
    .sort((a, b) => Number(a.fromPct) - Number(b.fromPct));

  const out = [];
  paid.forEach((tier, index) => {
    out.push({
      pct: Number(tier.fromPct),
      key: `p1_${Number(tier.fromPct)}`,
      kind: 'p1',
      first: index === 0,
      ratePct: Number(tier.bonusPct),
    });
  });

  const p2At = finite(config.priorityThresholdPct);
  if (p2At != null && p2At > 0) out.push({ pct: p2At, key: `p2_${p2At}`, kind: 'p2', first: true, ratePct: null });

  // Cùng một %: ưu tiên hiện P2 trước (tin đáng chú ý hơn), rồi tới P1.
  return out.sort((a, b) => a.pct - b.pct || (a.kind === b.kind ? 0 : a.kind === 'p2' ? -1 : 1));
}

/**
 * Mốc mới cần gửi cho 1 NV. `rows` là danh sách đã tính sẵn:
 *   { emp_code, name, pct, target, achieved, sourceAvailable }
 * NV chưa lấy được nguồn chi phí -> KHÔNG tạo sự kiện (không hứa tiền trên dữ liệu thiếu).
 */
function pendingEvents({ ky, rows = [], config = {}, isMuted = () => false } = {}) {
  const milestones = milestonesFromConfig(config);
  if (!milestones.length) return { ky, events: [], reason: 'bonus_config_unusable' };
  const state = readState();
  const events = [];
  for (const row of rows) {
    const emp = String(row?.emp_code || '').trim().toUpperCase();
    if (!emp || isMuted(emp)) continue;
    if (row.sourceAvailable === false) continue;
    const pct = finite(row.pct);
    if (pct == null) continue;
    const done = state[`${ky}|${emp}`] || {};
    for (const m of milestones) {
      if (pct >= m.pct && !done[m.key]) events.push({ ...row, emp_code: emp, ky, milestone: m });
    }
  }
  return { ky, events };
}

function markSent(events = []) {
  if (!events.length) return;
  const state = readState();
  for (const e of events) {
    const key = `${e.ky}|${e.emp_code}`;
    state[key] = state[key] || {};
    state[key][e.milestone.key] = new Date().toISOString();
  }
  writeState(state);
}

function messageFor(e) {
  const monthNo = String(e.ky).split('.')[0];
  const who = e.name || e.emp_code;
  const stand = `Đang ở ${pctText(e.pct)} target (${moneyShort(e.achieved)}/${moneyShort(e.target)}).`;
  if (e.milestone.kind === 'p2') {
    return `🟣 [Tháng ${monthNo}] ${who}: từ mốc ${pctText(e.milestone.pct)} bạn BẮT ĐẦU có thêm thưởng ưu tiên P2 `
      + `(tính trên phần vượt target, chia theo tỷ trọng các nhóm C10 bạn thực sự bán). ${stand}`;
  }
  if (e.milestone.first) {
    return `🔵 [Tháng ${monthNo}] ${who}: bạn đã BẮT ĐẦU có thưởng P1 (mức ${pctText(e.milestone.ratePct)} doanh thu). ${stand}`;
  }
  return `🔵 [Tháng ${monthNo}] ${who}: qua mốc ${pctText(e.milestone.pct)}, thưởng P1 lên mức ${pctText(e.milestone.ratePct)}. ${stand}`;
}

/**
 * Tin tổng thưởng cuối tháng. `bonus` lấy thẳng từ employeeBonus.buildBonusSummary.
 * Không có số P1/P2 hợp lệ -> trả null để nơi gọi bỏ qua, KHÔNG bịa 0đ.
 */
function monthEndMessage(row = {}, bonus = {}) {
  const p1 = finite(bonus.baseAmount);
  const p2 = finite(bonus.priorityAmount);
  if (p1 == null && p2 == null) return null;
  const monthNo = String(row.ky).split('.')[0];
  const total = (p1 || 0) + (p2 || 0);
  return [
    `🏆 [Tháng ${monthNo}] ${row.name || row.emp_code} — thưởng dự kiến tháng`,
    `Đạt ${pctText(row.pct)} target (${moneyShort(row.achieved)}/${moneyShort(row.target)})`,
    `P1 (coach): ${p1 == null ? '—' : moneyShort(p1)}`,
    `P2 (ưu tiên C10): ${p2 == null ? '—' : moneyShort(p2)}`,
    `Tổng dự kiến: ${moneyShort(total)}`,
    'ℹ Số DỰ KIẾN theo chính sách hiện hành, không phải bảng lương.',
  ].join('\n');
}

module.exports = { STATE_FILE, milestonesFromConfig, pendingEvents, markSent, messageFor, monthEndMessage };
