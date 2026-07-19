'use strict';

/**
 * Chính sách cảnh báo Điểm/Xu dùng cho "AI canh cửa" App Report.
 *
 * Nguồn số vẫn do diemXu.scoreForEmp tính. Module này chỉ:
 * - tạo đúng phạm vi tuần thực (thứ Hai -> ngày dữ liệu), tháng, quý;
 * - đổi số Xu thiếu sang tiền điều chỉnh theo chính sách CEO đã chốt;
 * - tách số tạm tính tháng và quyết toán quý để không cộng hai lần.
 *
 * KHÔNG ghi chi phí/kế toán. Mọi số tiền ở đây là cảnh báo/tạm tính cho tới khi
 * Finance/Expense cung cấp số đã hạch toán để đối trừ ở quyết toán quý.
 */

const PENALTY_PER_MISSING_XU = 300000; // 2 Xu thiếu = 600.000đ

function parseYmd(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Ngày phải có dạng YYYY-MM-DD');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || ymd(d) !== value) throw new Error('Ngày không hợp lệ');
  return d;
}
function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(value, days) { const d = parseYmd(value); d.setUTCDate(d.getUTCDate() + Number(days || 0)); return ymd(d); }
function startOfWeek(value) {
  const d = parseYmd(value);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return ymd(d);
}
function startOfMonth(value) { return `${String(value).slice(0, 8)}01`; }
function endOfMonth(value) {
  const d = parseYmd(value);
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
function startOfQuarter(value) {
  const d = parseYmd(value);
  const month = Math.floor(d.getUTCMonth() / 3) * 3;
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), month, 1)));
}
function endOfQuarter(value) {
  const d = parseYmd(value);
  const month = Math.floor(d.getUTCMonth() / 3) * 3 + 3;
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), month, 0)));
}
function rangesFor(asOf) {
  parseYmd(asOf);
  const monthEnd = endOfMonth(asOf);
  const quarterEnd = endOfQuarter(asOf);
  return {
    as_of: asOf,
    week: { from: startOfWeek(asOf), to: asOf },
    month: { from: startOfMonth(asOf), to: asOf, end: monthEnd, closing: asOf === monthEnd },
    quarter: { from: startOfQuarter(asOf), to: asOf, end: quarterEnd, closing: asOf === quarterEnd },
  };
}
function moneyForMissing(missingXu) {
  return Math.round(Math.max(0, Number(missingXu || 0)) * PENALTY_PER_MISSING_XU);
}
function round4(value) { return +Number(value || 0).toFixed(4); }
function buildCheckpoint({ empCode, asOf, scoreFn, priorBookedAdjustment = null }) {
  if (typeof scoreFn !== 'function') throw new Error('Thiếu hàm tính Điểm/Xu');
  const ranges = rangesFor(asOf);
  const score = scoreFn({ empCode, weekRange: ranges.week, monthRange: ranges.month, quarterRange: ranges.quarter });
  const monthMissing = Math.max(0, Number(score.diem_thang || 0) - Number(score.xu_thang || 0));
  const quarterMissing = Math.max(0, Number(score.diem_quy || 0) - Number(score.xu_quy || 0));
  const monthEstimated = moneyForMissing(monthMissing);
  const quarterTotal = moneyForMissing(quarterMissing);
  const bookedKnown = priorBookedAdjustment !== null && priorBookedAdjustment !== undefined && Number.isFinite(Number(priorBookedAdjustment));
  const booked = bookedKnown ? Math.max(0, Math.round(Number(priorBookedAdjustment))) : null;
  const quarterAdditional = bookedKnown ? Math.max(0, quarterTotal - booked) : null;
  return {
    emp_code: String(empCode || '').trim().toUpperCase(),
    ranges,
    score: {
      ...score,
      xu_tuan_thuc: round4(score.xu_tuan),
      thieu_xu_thang: round4(monthMissing),
      thieu_xu_quy: round4(quarterMissing),
    },
    adjustment: {
      policy: '2 Xu thiếu = 600.000đ',
      per_missing_xu: PENALTY_PER_MISSING_XU,
      month_estimated: monthEstimated,
      quarter_total_estimated: quarterTotal,
      prior_booked: booked,
      quarter_additional_estimated: quarterAdditional,
      needs_finance_reconciliation: !bookedKnown && quarterTotal > 0,
      final: ranges.quarter.closing && bookedKnown,
    },
    warning: {
      monthly: monthMissing > 0,
      quarterly: quarterMissing > 0,
      closing_month: ranges.month.closing && monthMissing > 0,
      closing_quarter: ranges.quarter.closing && quarterMissing > 0,
      wording: 'Chủ động hoàn tất chi tiêu và chứng từ hợp lệ, đúng mục đích, đúng thời hạn để tích lũy Xu; không chi tiêu không cần thiết chỉ để lấy Xu.',
    },
  };
}

module.exports = {
  PENALTY_PER_MISSING_XU,
  parseYmd,
  addDays,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  rangesFor,
  moneyForMissing,
  buildCheckpoint,
};
