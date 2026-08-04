'use strict';
/**
 * SỔ "THANH TOÁN CP CỦA TÔI" — GĐ1 (SPEC_THANH_TOAN_CP_SELFVIEW.md, CEO chốt 31/07)
 *
 * Đây là lõi TÍNH TIỀN của sổ. Chỉ tính và kiểm bất biến; không gọi mạng, không
 * ghi gì, không tự đánh dấu "đã trả" — GĐ1 mọi lần chưa ghi nhận đều là KẾ HOẠCH.
 *
 * Nguồn số (mục 3 spec):
 *   - Tổng chi phí kỳ sau phạt : DataHub (SSOT) — App Report không sửa.
 *   - Lần 1 (ứng)              : App Salary (SSOT) — chỉ đọc.
 *   - Lần 2 / Lần 3            : SỐ TẠI APP REPORT — tính minh bạch từ (Tổng − Lần 1).
 *   - C44                      : sổ RIÊNG, cộng dồn tới T12, KHÔNG nằm trong Tổng.
 *
 * ‼ Bất biến (mục 2) — lệch một đồng là DỪNG, không hiển thị số chỏi:
 *   Σ(các lần) == Tổng kỳ        và        Đã nhận + Còn nợ == Tổng kỳ
 */

// Ngưỡng chia 2 lần / 3 lần — CEO chỉnh được, KHÔNG ghi cứng trong code (mục 3b).
const DEFAULT_SPLIT_THRESHOLD_VND = 60_000_000;
// Tỷ lệ mặc định của Lần 2 trên phần còn lại. Sửa được từng NV (mục 1).
const DEFAULT_SECOND_RATIO = 0.6;
// Mốc ngày tính TỪ ngày Lần 1 (mục 5). Hiển thị bắt buộc để NV khỏi tự nhẩm.
const DAYS_TO_SECOND = 45;
const DAYS_TO_FINAL = 60;

function moneyOrNull(value) {
  // `Number(null)`/`Number('')` đều ra 0 — phải loại thẳng, nếu không "chưa có số"
  // bị hiểu thành "bằng 0" và sổ sẽ chốt sai.
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeMonth(value) {
  const text = String(value || '').trim();
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const vn = /^(0[1-9]|1[0-2])\.(\d{4})$/.exec(text);
  return vn ? `${vn[2]}-${vn[1]}` : '';
}

// Ngày cuối tháng của kỳ — mốc Lần 1 (mục 5). Dùng Date.UTC nên không dính múi giờ máy.
function periodEndDate(period) {
  const month = normalizeMonth(period);
  if (!month) return '';
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
}

function addDays(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return '';
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) return null;
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000);
}

function unavailable(period, reason) {
  return Object.freeze({
    available: false, period: normalizeMonth(period), reason,
    total: null, installments: [], received: null, outstanding: null,
    c44: null, invariantOk: null, warnings: [],
  });
}

/**
 * Dựng sổ cho MỘT nhân viên, MỘT kỳ.
 * Thiếu Tổng kỳ hoặc thiếu Lần 1 ⇒ trả `available:false` kèm lý do; KHÔNG suy ra 0.
 */
function buildPaymentSchedule({
  period,
  totalAfterPenalty,          // DataHub, sau phạt
  firstAdvanceAmount,         // App Salary
  firstAdvancePaid = false,   // App Salary đã chốt chi chưa
  secondOverride = null,      // CEO/admin sửa Lần 2 (mục 8)
  paid = {},                  // GĐ2: đã ghi nhận trả — { second:{amount,paidAt,by}, final:{…} }
  c44Amount = null,           // sổ riêng, chi trả T12
  splitThresholdVnd = DEFAULT_SPLIT_THRESHOLD_VND,
  secondRatio = DEFAULT_SECOND_RATIO,
  today = '',
} = {}) {
  const month = normalizeMonth(period);
  if (!month) return unavailable(period, 'period_invalid');

  const total = moneyOrNull(totalAfterPenalty);
  if (total == null) return unavailable(month, 'total_unavailable');
  const first = moneyOrNull(firstAdvanceAmount);
  if (first == null) return unavailable(month, 'first_advance_unavailable');
  if (first > total) return unavailable(month, 'first_advance_exceeds_total');

  const remainder = total - first;
  // Dưới ngưỡng thì TẤT TOÁN NGAY LẦN 2, bỏ lần 3 (mục 3b).
  const twoInstalmentsOnly = total < Number(splitThresholdVnd);

  const overridden = moneyOrNull(secondOverride);
  const warnings = [];
  let second;
  if (twoInstalmentsOnly) {
    second = remainder;
    if (overridden != null && overridden !== remainder) warnings.push('second_override_ignored_two_instalments');
  } else if (overridden != null) {
    // Sửa quá phần còn lại thì kẹp lại và BÁO, không im lặng đẻ ra lần 3 âm.
    second = Math.min(overridden, remainder);
    if (overridden > remainder) warnings.push('second_override_capped_to_remainder');
  } else {
    second = Math.round(remainder * Number(secondRatio));
  }
  // Lần cuối luôn là PHẦN CÒN LẠI CHÍNH XÁC ⇒ tổng khớp tuyệt đối, không lệch do làm tròn.
  const final = remainder - second;

  const firstDate = periodEndDate(month);
  const secondDate = addDays(firstDate, DAYS_TO_SECOND);
  const finalDate = addDays(firstDate, DAYS_TO_FINAL);

  const installments = [
    {
      index: 1, key: 'advance', label: 'Lần 1 · Ứng',
      amount: first, dueDate: firstDate, dayOffset: 0, gapNote: '',
      source: 'app_salary', editable: false,
      status: firstAdvancePaid ? 'paid' : 'plan',
    },
    {
      index: 2, key: 'second',
      label: twoInstalmentsOnly ? 'Lần 2 · Tất toán' : 'Lần 2 · Ứng',
      amount: second, dueDate: secondDate, dayOffset: DAYS_TO_SECOND,
      gapNote: `cách Lần 1 khoảng ${DAYS_TO_SECOND} ngày (±15)`,
      source: 'app_report', editable: true, status: 'plan',
    },
  ];
  if (!twoInstalmentsOnly) {
    installments.push({
      index: 3, key: 'final', label: 'Lần 3 · Tất toán',
      amount: final, dueDate: finalDate, dayOffset: DAYS_TO_FINAL,
      gapNote: `cách Lần 2 khoảng ${DAYS_TO_FINAL - DAYS_TO_SECOND} ngày · tổng ${DAYS_TO_FINAL} ngày từ Lần 1`,
      // Tất toán = phần còn lại, KHÔNG nhập tay (mục 1).
      source: 'app_report', editable: false, status: 'plan',
    });
  }

  // GĐ2: gắn ghi nhận đã trả. CHỈ nhận khi có người ghi — không tự đánh dấu.
  for (const item of installments) {
    const record = paid && typeof paid === 'object' ? paid[item.key] : null;
    const amount = moneyOrNull(record?.amount);
    if (amount != null) {
      item.status = 'paid';
      item.paidAmount = amount;
      item.paidAt = String(record.paidAt || '');
      item.paidBy = String(record.by || '');
      // Số thật lệch số kế hoạch thì NÓI RA, không im lặng.
      if (amount !== item.amount) item.paidDiff = amount - item.amount;
    }
  }

  for (const item of installments) {
    item.daysFromToday = today ? daysBetween(today, item.dueDate) : null;
    if (item.status !== 'paid' && item.daysFromToday != null && item.daysFromToday < 0) item.status = 'overdue';
  }

  // "Đã nhận" = số THẬT đã chuyển (nếu có ghi nhận), còn lại lấy số của lần đã chốt.
  const received = installments.filter((item) => item.status === 'paid')
    .reduce((sum, item) => sum + (Number.isSafeInteger(item.paidAmount) ? item.paidAmount : item.amount), 0);
  const outstanding = total - received;
  const sum = installments.reduce((acc, item) => acc + item.amount, 0);
  const invariantOk = sum === total && received + outstanding === total;
  if (!invariantOk) warnings.push('invariant_broken');

  return Object.freeze({
    available: true, period: month, reason: null,
    total, installments, received, outstanding,
    // C44 là SỔ RIÊNG: không cộng vào total, không nằm trong các lần.
    c44: { amount: moneyOrNull(c44Amount), note: 'Khoản riêng · cộng dồn · chi trả T12', includedInTotal: false },
    twoInstalmentsOnly, splitThresholdVnd: Number(splitThresholdVnd),
    invariantOk, warnings,
  });
}

module.exports = {
  DEFAULT_SPLIT_THRESHOLD_VND, DEFAULT_SECOND_RATIO, DAYS_TO_SECOND, DAYS_TO_FINAL,
  buildPaymentSchedule, periodEndDate, addDays, daysBetween,
};
