'use strict';
/**
 * BẢNG THANH TOÁN TOÀN ĐỘI — GĐ2 (SPEC_THANH_TOAN_CP_SELFVIEW.md §7)
 *
 * CEO nhìn một bảng biết: ai đã nhận · ai còn nợ · ai QUÁ HẠN.
 *
 * ‼ Không gọi thêm mạng. Dùng lại đúng ba thứ đã có sẵn:
 *   - tổng sau phạt từng NV  : lấy từ subtotals của chính bảng "Tất cả NV" đang dựng
 *   - Lần 1                  : đọc KHO đã chốt (`salaryAdvanceSnapshot`) — 0 lượt gọi
 *   - đã trả lần 2/3         : đọc sổ ghi nhận (`paymentLedgerStore`)
 *
 * NV nào thiếu nguồn thì TÁCH RIÊNG kèm lý do, KHÔNG biến thành 0 và KHÔNG cộng
 * vào tổng đội — số chỏi thà không hiện còn hơn hiện sai.
 */

const paymentSchedule = require('./paymentSchedule');

function moneyOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

// Tổng sau phạt của một NV: ưu tiên số đã trừ phạt, không có thì lấy tổng gốc.
function afterPenaltyOf(subtotal) {
  const applied = moneyOrNull(subtotal?.penalty?.afterPenaltyTotal);
  if (applied != null) return applied;
  return moneyOrNull(subtotal?.monthlyTotal ?? subtotal?.periodTotal ?? subtotal?.total);
}

function buildPaymentTeamSummary({
  period, subtotals = [], readSnapshot, readLedger, today = '', splitThresholdVnd, secondRatio,
} = {}) {
  const rows = [];
  const excluded = [];

  for (const subtotal of Array.isArray(subtotals) ? subtotals : []) {
    const empCode = String(subtotal?.employeeCode || '').trim().toUpperCase();
    const employeeName = String(subtotal?.employeeName || empCode);
    if (!empCode || empCode === '—') continue;

    const total = afterPenaltyOf(subtotal);
    const snapshot = typeof readSnapshot === 'function' ? readSnapshot(empCode, period) : null;
    const advance = snapshot?.projection;
    const ledger = typeof readLedger === 'function' ? readLedger(empCode, period) : null;

    const book = paymentSchedule.buildPaymentSchedule({
      period,
      totalAfterPenalty: total,
      firstAdvanceAmount: advance?.available === true && advance?.applicable === true ? advance.amount : null,
      firstAdvancePaid: advance?.locked === true,
      secondOverride: ledger?.secondOverride ?? null,
      paid: ledger?.paid || {},
      today,
      ...(splitThresholdVnd == null ? {} : { splitThresholdVnd }),
      ...(secondRatio == null ? {} : { secondRatio }),
    });

    if (!book.available) {
      // Thiếu nguồn ⇒ tách riêng kèm lý do, KHÔNG cho vào tổng đội.
      excluded.push({ empCode, employeeName, reason: book.reason });
      continue;
    }

    const overdue = book.installments.filter((item) => item.status === 'overdue');
    const next = book.installments.find((item) => item.status !== 'paid') || null;
    rows.push({
      empCode,
      employeeName,
      total: book.total,
      received: book.received,
      outstanding: book.outstanding,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((sum, item) => sum + item.amount, 0),
      nextLabel: next ? next.label : '',
      nextDueDate: next ? next.dueDate : '',
      nextAmount: next ? next.amount : null,
      nextDaysFromToday: next ? next.daysFromToday : null,
      twoInstalmentsOnly: book.twoInstalmentsOnly,
      invariantOk: book.invariantOk,
    });
  }

  rows.sort((a, b) => b.overdueCount - a.overdueCount
    || b.outstanding - a.outstanding
    || a.empCode.localeCompare(b.empCode, 'vi', { numeric: true }));

  const sum = (key) => rows.reduce((acc, row) => acc + (Number.isSafeInteger(row[key]) ? row[key] : 0), 0);
  return {
    period: String(period || ''),
    rows,
    excluded,
    totals: {
      employees: rows.length,
      total: sum('total'),
      received: sum('received'),
      outstanding: sum('outstanding'),
      overdueEmployees: rows.filter((row) => row.overdueCount > 0).length,
      overdueAmount: sum('overdueAmount'),
    },
    // Bất biến toàn đội: đã nhận + còn nợ == tổng. Gãy ⇒ màn phải báo, không hiện số chỏi.
    invariantOk: rows.every((row) => row.invariantOk) && sum('received') + sum('outstanding') === sum('total'),
  };
}

module.exports = { buildPaymentTeamSummary, afterPenaltyOf };
