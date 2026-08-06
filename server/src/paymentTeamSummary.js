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
// C44 (lương cuối năm) của một NV — cùng trường mà sổ cá nhân dùng (`annualTotal`),
// để hai màn không bao giờ lệch. Không khớp đủ % thì trường này là `null`, KHÔNG
// được thay bằng 0: 0 nghĩa là "không có khoản nào", null nghĩa là "chưa tính ra".
function annualOf(subtotal) {
  return moneyOrNull(subtotal?.annualTotal);
}

function afterPenaltyOf(subtotal) {
  const applied = moneyOrNull(subtotal?.penalty?.afterPenaltyTotal);
  if (applied != null) return applied;
  return moneyOrNull(subtotal?.monthlyTotal ?? subtotal?.periodTotal ?? subtotal?.total);
}

// App Salary ĐÃ TRẢ LỜI và câu trả lời là "không có ứng lần 1" — khác hẳn gọi không
// được. Chỉ ba trường hợp này mới được coi là 0 thật; mọi lỗi mạng vẫn fail-closed.
// Hợp đồng App Salary có HAI kiểu "tôi không có bản ghi ứng lần 1", trả về khác nhau:
//   1. `available:true  · applicable:false · reason:'not_eligible'`      — không thuộc diện ứng
//   2. `available:false · applicable:null  · reason:'employee_not_found'|'period_not_found'`
// Bản trước chỉ bắt kiểu 1 ⇒ NV rơi vào kiểu 2 bị hiểu nhầm thành "gọi không được"
// và bị loại khỏi bảng đội (CEO thấy 4 NV: DN001·DN021·DN022·DN023, 04/08 21:04).
//
// ‼ `duplicate_employee` KHÔNG nằm ở đây: nó nghĩa là dữ liệu mâu thuẫn, không phải
// "không có ứng" — vẫn fail-closed. Mọi lý do vận chuyển (timeout, unauthorized,
// not_configured, contract_mismatch) cũng vậy.
const NONE_REASONS_ANSWERED = new Set(['not_eligible']);
const NONE_REASONS_NO_RECORD = new Set(['employee_not_found', 'period_not_found']);
function noneReasonOf(advance) {
  if (!advance || Number.isSafeInteger(advance.amount)) return null;
  const reason = String(advance.reason || '');
  if (advance.available === true) return NONE_REASONS_ANSWERED.has(reason) ? reason : null;
  if (advance.available === false) return NONE_REASONS_NO_RECORD.has(reason) ? reason : null;
  return null;
}

function buildPaymentTeamSummary({
  period, subtotals = [], readSnapshot, readLedger, today = '', splitThresholdVnd, secondRatio,
  includeSchedules = false,
} = {}) {
  const rows = [];
  const excluded = [];
  const schedules = [];

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
      flow: ledger?.flow || {},
      // ‼ Thiếu dòng này ⇒ ô "Σ C44 · cuối năm" của toàn đội luôn ra 0đ trong khi
      // sổ từng người vẫn hiện đúng (CEO thấy 04/08 22:43).
      c44Amount: annualOf(subtotal),
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
    if (includeSchedules) schedules.push({ empCode, employeeName, schedule: book });

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
      c44: moneyOrNull(book.c44?.amount),
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
    ...(includeSchedules ? { schedules } : {}),
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
      // Bao nhiêu NV CHƯA tính ra được C44 — để ô KPI nói "luỹ kế của N/M người",
      // không im lặng cộng thiếu rồi trông như đã đủ.
      c44Unknown: rows.filter((row) => row.c44 == null).length,
      employeesWithoutFirstAdvance: rows.filter((row) => row.firstAdvanceNone).length,
      overdueEmployees: rows.filter((row) => row.overdueCount > 0).length,
      overdueAmount: sum('overdueAmount'),
    },
    // Bất biến toàn đội: đã nhận + còn nợ == tổng. Gãy ⇒ màn phải báo, không hiện số chỏi.
    invariantOk: rows.every((row) => row.invariantOk) && sum('received') + sum('outstanding') === sum('total'),
  };
}

module.exports = { buildPaymentTeamSummary, afterPenaltyOf, annualOf, noneReasonOf };
