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

// App Salary ĐÃ TRẢ LỜI và câu trả lời là "không có ứng lần 1" — khác hẳn gọi không
// được. Chỉ ba trường hợp này mới được coi là 0 thật; mọi lỗi mạng vẫn fail-closed.
const NONE_REASONS = new Set(['not_eligible', 'employee_not_found', 'period_not_found']);
function noneReasonOf(advance) {
  if (!advance || advance.available !== true) return null;
  if (Number.isSafeInteger(advance.amount)) return null;
  const reason = String(advance.reason || '');
  return NONE_REASONS.has(reason) ? reason : null;
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
      // App Salary TRẢ LỜI RÕ là NV này không ứng ⇒ dựng sổ đủ, không loại khỏi bảng đội.
      firstAdvanceNone: noneReasonOf(advance) != null,
      firstAdvanceNoneReason: noneReasonOf(advance) || '',
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
    const next = book.installments.find((item) => !['paid', 'none'].includes(item.status)) || null;
    const amountOf = (key) => {
      const item = book.installments.find((entry) => entry.key === key);
      return item && Number.isSafeInteger(item.amount) ? item.amount : 0;
    };
    const firstItem = book.installments.find((item) => item.key === 'advance');
    rows.push({
      empCode,
      employeeName,
      total: book.total,
      received: book.received,
      outstanding: book.outstanding,
      // CEO chốt 04/08: bảng tổng hợp phải tách được đã ứng L1 / còn L2 / tất toán L3 / C44.
      firstAdvance: amountOf('advance'),
      firstAdvanceNone: firstItem?.status === 'none',
      second: amountOf('second'),
      final: amountOf('final'),
      c44: Number.isSafeInteger(book.c44?.amount) ? book.c44.amount : 0,
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
      // Bốn ô CEO yêu cầu 04/08 — tổng hợp chung của cả đội.
      firstAdvance: sum('firstAdvance'),
      second: sum('second'),
      final: sum('final'),
      c44: sum('c44'),
      employeesWithoutFirstAdvance: rows.filter((row) => row.firstAdvanceNone).length,
      overdueEmployees: rows.filter((row) => row.overdueCount > 0).length,
      overdueAmount: sum('overdueAmount'),
    },
    // Bất biến toàn đội: đã nhận + còn nợ == tổng. Gãy ⇒ màn phải báo, không hiện số chỏi.
    invariantOk: rows.every((row) => row.invariantOk) && sum('received') + sum('outstanding') === sum('total'),
  };
}

module.exports = { buildPaymentTeamSummary, afterPenaltyOf, noneReasonOf };
