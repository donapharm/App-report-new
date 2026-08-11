import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeCostViewModel } from '../src/employeeCostModel.js';

/**
 * CHẶN Ở TẦNG DỮ LIỆU — CA KIỂM CHẠY TRÊN SỐ THẬT, KHÔNG ĐỌC CHUỖI MÃ NGUỒN.
 *
 * Bot audit đợt 17 vòng 5 phá được máy quét chuỗi của tôi bằng bốn đường: biến trung
 * gian, destructuring, truy cập ngoặc vuông, và nhãn miễn trừ không kèm giải thích.
 * Họ đúng ở chỗ căn bản: **một cái tên trường có vô số cách viết ra**, đọc chữ không
 * bao giờ chặn hết được. Đây là lần thứ NĂM trong đợt tôi vá cái danh sách thay vì bỏ
 * mô hình danh sách đi.
 *
 * Nay số tổng đội **không tồn tại** trong model khi thiếu người. Ca kiểm này dựng model
 * thật rồi đọc bằng đúng bốn đường bot đã phá — không đường nào lấy ra được số, vì
 * không có gì ở đó để mà lấy.
 */

const NV = (empCode) => ({
  empCode, employeeName: empCode, sourceOutcome: 'ok',
  rowCount: 1, monthlyTotal: 1_000_000,
});

function payloadDoi({ thieu = [] } = {}) {
  return {
    empCode: 'ALL', allEmployees: true, from: '2026-07', to: '2026-07',
    match: {
      matchedRows: 100, totalRows: 100, rate: 100, threshold: 90,
      unavailableEmployeeCount: thieu.length,
      unavailableEmployees: thieu,
    },
    summary: {
      reliable: true, monthlyTotal: 30_982_248_913, periodTotal: 30_982_248_913,
      provisionalMonthlyTotal: 1_444_932_127, annualTotal: 500_000_000, annualLabels: ['C44'],
    },
    penalty: {
      aggregate: true, employeeCount: 21, contributors: 21 - thieu.length,
      total: 458_482, provisionalTotal: 458_482, baseTotal: 30_982_248_913,
      afterPenaltyTotal: 30_981_790_431, xuAmount: 1_800_000,
    },
    // `bonus`/`target` có hai tầng `month`/`quarter` — tiền nằm ở tầng TRONG.
    bonus: { configured: true, month: { amount: 31_812_041 }, quarter: { amount: 3_373_262 } },
    target: { available: true, month: { target: 11_527_638_470, pct: 110.9 } },
    periods: [{
      period: '2026-07', columns: [], rows: [],
      summary: { monthlyTotal: 30_982_248_913, annualTotal: 500_000_000, annualLabels: ['C44'] },
      match: {
        matchedRows: 100, totalRows: 100, rate: 100, threshold: 90,
        unavailableEmployeeCount: thieu.length, unavailableEmployees: thieu,
      },
      employeeSubtotals: [NV('DN001'), NV('DN002')],
      daily: { reliable: true, dates: ['2026-07-01'], totals: [{ date: '2026-07-01', monthlyTotal: 9_000_000 }] },
    }],
  };
}

test('đủ người thì mọi số tổng đội còn nguyên — chặn không được bắt nhầm', () => {
  const model = employeeCostViewModel(payloadDoi());
  assert.equal(model.thieuNguoi, false);
  assert.equal(model.summary.periodTotal, 30_982_248_913);
  assert.equal(model.penalty.baseTotal, 30_982_248_913);
  assert.equal(model.bonus.month.amount, 31_812_041);
  assert.equal(model.target.month.target, 11_527_638_470);
  assert.equal(model.periods[0].summary.monthlyTotal, 30_982_248_913);
  assert.equal(model.periods[0].daily.totals.length, 1);
});

/* ‼ ĐÚNG BỐN ĐƯỜNG BOT PHÁ ĐƯỢC MÁY QUÉT CHUỖI. Ở tầng dữ liệu thì cả bốn đều vô hiệu,
 * vì không ai đọc ra được một giá trị đã không có ở đó. */
test('thiếu MỘT người ⇒ không đường nào moi được số tổng đội', () => {
  const model = employeeCostViewModel(payloadDoi({ thieu: ['DN007'] }));
  assert.equal(model.thieuNguoi, true);
  assert.deepEqual(model.thieuNguoiCodes, ['DN007']);

  // ① đọc thẳng
  assert.equal(model.summary.periodTotal, null);
  // ② biến trung gian
  const tam = model.summary.provisionalPeriodTotal;
  assert.equal(tam, null);
  // ③ destructuring
  const { periodTotal, annualTotal } = model.summary;
  assert.equal(periodTotal, null);
  assert.equal(annualTotal, null);
  // ④ truy cập ngoặc vuông
  assert.equal(model.summary['periodTotal'], null);
  assert.equal(model.penalty['baseTotal'], null);
});

test('thiếu người ⇒ thưởng, phạt, target tổng đội đều rỗng', () => {
  const model = employeeCostViewModel(payloadDoi({ thieu: ['DN007'] }));
  for (const [ten, giaTri] of [
    ['penalty.total', model.penalty.total],
    ['penalty.baseTotal', model.penalty.baseTotal],
    ['penalty.afterPenaltyTotal', model.penalty.afterPenaltyTotal],
    ['penalty.xuAmount', model.penalty.xuAmount],
    ['bonus.month.amount', model.bonus.month.amount],
    ['bonus.quarter.amount', model.bonus.quarter.amount],
  ]) assert.equal(giaTri, null, `${ten} phải rỗng khi thiếu người`);
});

/* Target tổng đội — bot bắt riêng: giảm số người góp số 21 → 20 làm giá trị ĐỔI, mà ô
 * vẫn hiện số thay vì "Chưa đủ dữ liệu". Số nào đổi theo số người góp thì nó là tổng
 * toàn đội, dù nhãn không có chữ "tổng". */
test('Target tổng đội đổi theo số người góp ⇒ cũng là tổng đội, cũng phải rỗng', () => {
  const du = employeeCostViewModel(payloadDoi());
  const thieu = employeeCostViewModel(payloadDoi({ thieu: ['DN007'] }));
  assert.equal(du.target.month.target, 11_527_638_470, 'đủ người thì có số');
  assert.equal(thieu.target.month.target, null, 'thiếu người thì không được hiện số target đội');
  assert.equal(thieu.target.month.pct, null, 'tỷ lệ đạt cũng tính trên số người góp');
});

test('thiếu người ⇒ tổng theo NGÀY cũng rỗng (Σ ngày gộp cả đội)', () => {
  const model = employeeCostViewModel(payloadDoi({ thieu: ['DN007'] }));
  assert.deepEqual(model.periods[0].daily.totals, [],
    'Σ ngày gộp cả đội theo từng ngày — thiếu người thì nó sai y như tổng tháng');
  assert.equal(model.periods[0].summary.monthlyTotal, null);
  assert.equal(model.periods[0].summary.annualTotal, null);
});

/* ‼ RANH GIỚI. Xoá quá tay cũng là một kiểu sai: tổng phụ của TỪNG NV là số thật của
 * người đó, thiếu người khác không làm nó sai. Giấu đi là giấu dữ liệu đang có. */
test('tổng phụ của TỪNG NV phải GIỮ NGUYÊN — không được xoá quá tay', () => {
  const model = employeeCostViewModel(payloadDoi({ thieu: ['DN007'] }));
  const phu = model.periods[0].employeeSubtotals;
  assert.equal(phu.length, 2, 'vẫn phải liệt kê những người ĐÃ có số');
  assert.equal(phu[0].monthlyTotal, 1_000_000, 'số của chính người đó, giữ nguyên');
});

test('xem MỘT NV thì không bị chặn — cờ chỉ bật ở chế độ toàn đội', () => {
  const payload = payloadDoi({ thieu: ['DN007'] });
  payload.allEmployees = false;
  payload.empCode = 'DN001';
  const model = employeeCostViewModel(payload);
  assert.equal(model.thieuNguoi, false);
  assert.equal(model.summary.periodTotal, 30_982_248_913,
    'người đang xem có số của mình thì phải thấy, không liên quan ai vắng');
});
