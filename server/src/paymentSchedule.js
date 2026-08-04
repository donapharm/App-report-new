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
/**
 * BIÊN ĐỘ TRƯỢT — CEO chốt 04/08/2026.
 *
 * CEO: *"số ngày theo lịch, không kể ngày nghỉ chủ nhật, nghỉ lễ… lần 2 sẽ rơi vào
 * trong khoảng ngày 15/09/2026 có dao động biên độ trượt lên 15 ngày, kiểu vậy đó."*
 *
 * Nghĩa là hai điều, phải làm đúng cả hai:
 *  1. Ngày mốc vẫn đếm THẲNG theo lịch — KHÔNG dời tránh Chủ nhật/lễ (CEO đã cân
 *     nhắc và chọn phương án này; không được tự ý cắm `holidays.json` vào đây).
 *  2. Hạn là một KHOẢNG, không phải một ngày cứng. Quá ngày mốc mà còn trong 15 ngày
 *     thì là **TỚI HẠN**, chưa phải **QUÁ HẠN**. Nhờ vậy hạn rơi vào Chủ nhật hay
 *     Tết cũng không bị báo đỏ oan — và tin nhắn nhắc nợ không bắn oan theo.
 */
const GRACE_DAYS = 15;

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
  // ‼ App Salary TRẢ LỜI RÕ là NV này không có ứng lần 1 (not_eligible / không có
  // bản ghi). Khác hẳn "gọi không được" — CEO chốt 04/08: trường hợp này vẫn dựng
  // sổ ĐẦY ĐỦ, ghi rõ "không thực hiện ứng lần 1", Lần 2/Lần 3 chia trên toàn bộ.
  firstAdvanceNone = false,
  firstAdvanceNoneReason = '',
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
  const declared = moneyOrNull(firstAdvanceAmount);
  // Không có số NHƯNG App Salary đã khẳng định là không ứng ⇒ 0 là số THẬT, không phải đoán.
  const first = declared == null && firstAdvanceNone === true ? 0 : declared;
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

  // ‼ CEO chốt 04/08: App Salary DUYỆT ỨNG LẦN 1 VÀO NGÀY CUỐI THÁNG của kỳ. Nên khi
  // đã có số của App Salary thì Lần 1 là VIỆC ĐÃ XONG tại ngày đó — KHÔNG BAO GIỜ
  // được gắn "quá hạn". Trước đây Lần 1 bị so với hôm nay rồi kêu "quá 4 ngày", vô lý:
  // App Salary đã chi từ 31/07 rồi mà màn hình lại đòi nợ chính nó.
  const periodEnded = !today || daysBetween(firstDate, today) >= 0;
  const firstStatus = firstAdvanceNone === true ? 'none'
    : (periodEnded ? 'paid' : 'pending');
  const installments = [
    {
      index: 1, key: 'advance',
      // CEO chốt 04/08 21:10: NV không có ứng lần 1 thì ghi thẳng vào ô đó là bỏ qua
      // bước này, và VẪN hiện đủ ở mọi mục/tổng hợp/báo cáo như các bạn khác.
      label: firstAdvanceNone === true ? 'Lần 1 · Bỏ qua' : 'Lần 1 · Ứng',
      amount: first, dueDate: firstDate, dayOffset: 0,
      gapNote: firstAdvanceNone === true
        ? 'Bạn không được ứng lần 1 · bỏ qua bước này'
        : `chốt ngày cuối tháng ${month.slice(5)}/${month.slice(0, 4)}`,
      noneReason: firstAdvanceNone === true ? String(firstAdvanceNoneReason || '') : null,
      source: 'app_salary', editable: false,
      // `firstAdvancePaid` (locked) chỉ để ghi chú tạm tính/đã duyệt, KHÔNG dùng để
      // quyết định quá hạn — hợp đồng provisional/approved vẫn đang chờ App Salary.
      salaryLocked: firstAdvancePaid === true,
      status: firstStatus,
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
    // Lần 1 do App Salary chi, App Report KHÔNG đòi nợ nó ⇒ miễn nhiễm "quá hạn".
    if (item.key === 'advance') { item.graceDate = ''; item.graceDays = 0; continue; }
    item.graceDays = GRACE_DAYS;
    item.graceDate = addDays(item.dueDate, GRACE_DAYS);
    item.daysFromGrace = today ? daysBetween(today, item.graceDate) : null;
    if (item.status === 'paid') continue;
    // Quá ngày mốc nhưng CÒN trong biên độ ⇒ "tới hạn", chưa phải "quá hạn".
    if (item.daysFromGrace != null && item.daysFromGrace < 0) item.status = 'overdue';
    else if (item.daysFromToday != null && item.daysFromToday < 0) item.status = 'due';
  }

  // "Đã nhận" = số THẬT đã chuyển (nếu có ghi nhận), còn lại lấy số của lần đã chốt.
  const amountReceived = (item) => (Number.isSafeInteger(item.paidAmount) ? item.paidAmount : item.amount);
  const received = installments.filter((item) => item.status === 'paid')
    .reduce((sum, item) => sum + amountReceived(item), 0);
  // ‼ CEO chốt 04/08: TÁCH hai loại tiền — bên lương chi khác với CEO ghi nhận trả.
  // Gộp chung thì lúc đối chiếu hụt tiền không truy được hụt ở khâu nào.
  const receivedFromSalary = installments
    .filter((item) => item.key === 'advance' && item.status === 'paid')
    .reduce((sum, item) => sum + amountReceived(item), 0);
  const receivedRecorded = received - receivedFromSalary;
  const outstanding = total - received;
  const sum = installments.reduce((acc, item) => acc + item.amount, 0);
  const invariantOk = sum === total && received + outstanding === total;
  if (!invariantOk) warnings.push('invariant_broken');

  return Object.freeze({
    available: true, period: month, reason: null,
    total, installments, received, outstanding,
    // Hai nguồn tiền của "Đã nhận" — App Salary chi vs CEO ghi nhận trả.
    receivedFromSalary, receivedRecorded,
    // C44 là SỔ RIÊNG: không cộng vào total, không nằm trong các lần.
    c44: { amount: moneyOrNull(c44Amount), note: 'Khoản riêng · cộng dồn · chi trả T12', includedInTotal: false },
    twoInstalmentsOnly, splitThresholdVnd: Number(splitThresholdVnd),
    invariantOk, warnings,
  });
}

/**
 * GỘP NHIỀU KỲ — CEO chốt 04/08: "chọn từ tháng này tới tháng này để biết total bao
 * nhiêu / đã ứng bao nhiêu / còn lại bao nhiêu".
 *
 * ‼ Kỳ nào KHÔNG dựng được sổ thì TÁCH RA kèm lý do, KHÔNG cộng 0 vào tổng. Cộng 0
 * làm tổng nhiều tháng nhỏ đi mà nhìn vẫn "sạch" — đúng kiểu mất tiền lặng lẽ.
 */
function buildPaymentRangeSummary(schedules = []) {
  const list = Array.isArray(schedules) ? schedules : [];
  const included = list.filter((book) => book && book.available === true);
  const skipped = list.filter((book) => book && book.available !== true)
    .map((book) => ({ period: book.period || '', reason: book.reason || 'unknown' }));

  const sumBy = (pick) => included.reduce((acc, book) => acc + (Number(pick(book)) || 0), 0);
  const instalment = (key) => included.reduce((acc, book) => {
    const item = book.installments.find((entry) => entry.key === key);
    return acc + (item && Number.isSafeInteger(item.amount) ? item.amount : 0);
  }, 0);

  const total = sumBy((book) => book.total);
  const received = sumBy((book) => book.received);
  const outstanding = sumBy((book) => book.outstanding);
  return {
    periods: included.map((book) => book.period),
    months: included.length,
    skipped,
    total,
    received,
    outstanding,
    firstAdvance: instalment('advance'),
    second: instalment('second'),
    final: instalment('final'),
    // C44 cộng dồn — sổ RIÊNG, vẫn không nằm trong `total`.
    c44: included.reduce((acc, book) => acc + (Number(book.c44?.amount) || 0), 0),
    employeesWithoutFirstAdvance: included
      .filter((book) => book.installments.some((item) => item.key === 'advance' && item.status === 'none')).length,
    invariantOk: included.every((book) => book.invariantOk) && received + outstanding === total,
  };
}

module.exports = {
  DEFAULT_SPLIT_THRESHOLD_VND, DEFAULT_SECOND_RATIO, DAYS_TO_SECOND, DAYS_TO_FINAL, GRACE_DAYS,
  buildPaymentSchedule, buildPaymentRangeSummary, periodEndDate, addDays, daysBetween,
};
