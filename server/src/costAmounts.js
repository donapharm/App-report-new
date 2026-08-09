'use strict';
/**
 * MENU RIÊNG "THÀNH TIỀN C32/C47" (Đợt 3 — SPEC_COST_RATES_LOCAL_SYNC · CEO chốt 08/08/2026)
 *
 * CEO: *"RIÊNG CỘT C32 VÀ CỘT C47 SẼ XÂY MỘT MENU RIÊNG BIỆT... GIẢM RỦI RO LỘ LỌT,
 * LỠ LỖ HỔNG BẢO MẬT/CODE ĐẾN TÀI KHOẢN NV."* Vì thế:
 *
 *  1. Tiền tổng KHÔNG nằm chung màn nào có sẵn — endpoint riêng, tab riêng, công tắc
 *     riêng (`cost_amounts_visibility`, mặc định TẮT ⇒ chỉ CEO thấy).
 *  2. KHÔNG kéo THÀNH TIỀN C32/C47 từ DataHub — luật `CATALOG_PERMANENT_FIELD_BLOCKED`
 *     giữ nguyên. App Report tự nhân % × doanh thu, tiền tổng không đi qua đường truyền.
 *  3. Fail-closed: thiếu % cột nào ⇒ '—' + nói thiếu cột nào; % xung đột giữa hai
 *     dòng cùng cặp ⇒ XUNG_DOT. Không suy 0, không lấy bừa một nửa.
 *
 * ‼ ĐỊNH NGHĨA (CEO đính chính 09/08/2026 — bản đầu Claude làm SAI, xem khối dưới):
 *     C32 = TỔNG % chi phí gốc được cấp cho cặp ("CP Total"), KHÔNG phải doanh thu.
 *     C47 = PHẦN CÒN LẠI sau khi 13 cột chi phí lấy đi, KHÔNG phải tổng cộng lại.
 *   Thành tiền = % × doanh thu kỳ (có VAT = số gốc; chưa VAT = ÷ VAT_DIVISOR).
 */

const persist = require('./persist');
const employeeCost = require('./employeeCost');
const employeeCostTemplates = require('./employeeCostTemplates');
const employeeCostVisibility = require('./employeeCostVisibility');
const costRatesSync = require('./costRatesSync');

const VISIBILITY_FILE = 'cost_amounts_visibility';
// Đúng 4 cột CEO chốt — không thêm cột nào khác vào menu này.
const COLUMNS = Object.freeze([
  { key: 'c32NoVat', label: 'Thành tiền C32 chưa VAT' },
  { key: 'c32WithVat', label: 'Thành tiền C32 có VAT' },
  { key: 'c47NoVat', label: 'Thành tiền C47 chưa VAT' },
  { key: 'c47WithVat', label: 'Thành tiền C47 có VAT' },
]);

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();

// Công tắc riêng, dùng lại nguyên bộ máy employeeCostVisibility (cá nhân > nhóm >
// toàn phòng, backend quyết, audit) trên FILE KHO RIÊNG — không trộn với công tắc
// của "Chi phí của tôi".
const visibilityService = employeeCostVisibility.createService({ storeFile: VISIBILITY_FILE });
const decisionFor = (empCode, roster) => visibilityService.decision(empCode, roster);
const visibilityPanel = (roster) => visibilityService.panel(roster);
const visibilitySave = (patch, opts) => visibilityService.save(patch, opts);

/** % theo cặp của MỘT NV từ kho cục bộ. Cùng cặp mà hai dòng khác % ⇒ conflict. */
function pairRates(kept, costColumns) {
  const rates = new Map();
  for (const row of kept?.rows || []) {
    const unit = upper(row.unit_code ?? row.c7);
    const product = upper(row.c5 ?? row.product_code);
    if (!unit || !product) continue;
    const percents = {};
    for (const key of costColumns) {
      const raw = row?.[key];
      percents[key] = raw == null || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
    }
    const signature = costColumns.map((key) => (percents[key] == null ? '—' : String(percents[key]))).join('\u001f');
    const key = `${unit}\u001f${product}`;
    const current = rates.get(key);
    if (!current) {
      rates.set(key, { signature, percents, conflict: false, productName: text(row.c16 ?? row.product_name) });
    } else if (current.signature !== signature) current.conflict = true;
  }
  return rates;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   ‼ C47 LÀ PHẦN CÒN LẠI, KHÔNG PHẢI TỔNG CỘNG LẠI (CEO đính chính 09/08/2026)

   CEO: *"ý anh là tính xem sau khi các cột từ C33–C46 lấy đi số % rồi thì C47 còn
   bao nhiêu tiền thu được, cũng giống như đầu vào của C32 vậy."*

   Bản đầu Claude làm SAI hoàn toàn: lấy `template.costColumns` (C36+C41+C43+C44+C45
   — các cột NV ĐƯỢC NHẬN) rồi CỘNG lại và gọi đó là C47. Sai ba tầng:
     · Sai HƯỚNG: C47 là phần CÒN LẠI sau khi trừ, không phải tổng đã chia.
     · Sai TẬP CỘT: thiếu C33 C34 C35 C37 C39 C40 C46 — chỉ lấy các cột NV nhận.
     · Sai C44: công thức chuẩn LOẠI C44 ("CP bs/td Giữ lại 5%"), bản cũ lại cộng vào.
   Và C32 bị hiểu nhầm thành DOANH THU, trong khi C32 là "CP Total" — TỔNG % chi phí
   gốc được cấp cho cặp đó.

   Nguồn sự thật: file `TEMPLATE_..._CP_TOTAL_FINAL_V29.9.xlsx`, cột AU:
     C47 (cp_in) = C32 −C33 −C34 −C35 −C36 −C37 −C38 −C39 −C40 −C41 −C42 −C43 −C45 −C46
     Excel: =AF-AG-AH-AI-AJ-AK-AL-AM-AN-AO-AP-AQ-AS-AT   (KHÔNG có AR = C44)

   C47 âm = đã chia vượt quá số được cấp. File gốc có sẵn dấu audit `CẢNH_BÁO_C47_ÂM`
   nên đây là chuyện CÓ THẬT, phải nêu ra chứ không được lặng lẽ hiển thị số âm.

   ‼ C47 là thuộc tính của DÒNG DỮ LIỆU (cặp đơn vị × mặt hàng), KHÔNG theo nhóm
   full-time/part-time. `template.costColumns` chỉ dùng cho tiền NV NHẬN ở màn "Chi
   phí của tôi" — dùng nó ở đây chính là lỗi đã mắc.
   ═══════════════════════════════════════════════════════════════════════════════ */

// Đúng 13 cột bị trừ trong công thức chuẩn. Thứ tự giữ như file gốc để đối chiếu tay.
const C47_SUBTRACTED = Object.freeze([
  'c33', 'c34', 'c35', 'c36', 'c37', 'c38', 'c39', 'c40', 'c41', 'c42', 'c43', 'c45', 'c46',
]);
// C44 ("CP bs/td Giữ lại 5%") CỐ TÌNH nằm ngoài công thức C47 — khai tường minh để
// người sau không "thấy thiếu" rồi thêm vào.
const C47_EXCLUDED = Object.freeze(['c44']);
const C47_BUDGET = 'c32';
// Mọi cột % cần có để tính được C47 — dùng cho cả việc đồng bộ lẫn việc báo thiếu.
const C47_REQUIRED = Object.freeze([C47_BUDGET, ...C47_SUBTRACTED]);

// % chi phí thực tế chỉ có 1–2 chữ số thập phân; 6 chữ số là thừa sức an toàn mà đủ
// cắt nhiễu dấu phẩy động. KHÔNG làm tròn mạnh hơn — đó sẽ là sửa số liệu.
const roundPercent = (value) => Math.round(value * 1e6) / 1e6;

/**
 * C47 của một cặp trên một nền doanh thu (chưa/có VAT).
 *
 * Làm việc trên % rồi mới quy ra tiền MỘT LẦN, đúng như file gốc: cộng trừ % trước,
 * nhân doanh thu sau. Quy tiền từng cột rồi mới trừ sẽ lệch do làm tròn 13 lần.
 *
 * Fail-closed: thiếu BẤT KỲ cột nào trong 14 cột ⇒ `amount: null` + kể tên cột thiếu.
 * Một tổng thiếu vài cột là một loại số sai mới, thà để '—'.
 */
function c47Of(rate, baseRevenue) {
  if (!rate) return { amount: null, percent: null, reason: 'THIEU_PHAN_TRAM', missing: [...C47_REQUIRED], negative: false };
  if (rate.conflict) return { amount: null, percent: null, reason: 'XUNG_DOT', missing: [], negative: false };
  const missing = C47_REQUIRED.filter((key) => rate.percents[key] == null);
  if (missing.length) return { amount: null, percent: null, reason: 'THIEU_PHAN_TRAM', missing, negative: false };
  // ‼ Làm tròn 6 chữ số sau khi trừ 13 lần. Máy tính cộng trừ số lẻ nhị phân nên
  // 10 − (0,3+0,3+0,4+1+0,5+0,5+1+0,5+1+0,5+1,5+0,5+0) ra 1,9999999999999982 thay vì
  // 2. Tiền thì không lệch (đã làm tròn khi nhân), nhưng % đó hiện thẳng lên màn cho
  // CEO đọc — để nguyên là mất tin tưởng vào cả bảng.
  const percent = roundPercent(C47_SUBTRACTED.reduce((left, key) => left - rate.percents[key], rate.percents[C47_BUDGET]));
  if (baseRevenue == null) return { amount: null, percent, reason: 'THIEU_DOANH_THU', missing: [], negative: percent < 0 };
  return { amount: employeeCost.calculateAmount(baseRevenue, percent), percent, reason: null, missing: [], negative: percent < 0 };
}

/** Thành tiền C32 = % ngân sách chi phí × doanh thu. C32 KHÔNG phải doanh thu. */
function c32Of(rate, baseRevenue) {
  if (!rate) return { amount: null, percent: null, reason: 'THIEU_PHAN_TRAM', missing: [C47_BUDGET] };
  if (rate.conflict) return { amount: null, percent: null, reason: 'XUNG_DOT', missing: [] };
  const percent = rate.percents[C47_BUDGET];
  if (percent == null) return { amount: null, percent: null, reason: 'THIEU_PHAN_TRAM', missing: [C47_BUDGET] };
  if (baseRevenue == null) return { amount: null, percent, reason: 'THIEU_DOANH_THU', missing: [] };
  return { amount: employeeCost.calculateAmount(baseRevenue, percent), percent, reason: null, missing: [] };
}

/**
 * Dựng bảng thành tiền theo cặp cho một kỳ. LỌC QUYỀN tại đây:
 * CEO thấy mọi NV có trong kho; NV (route đã kiểm công tắc) chỉ thấy chính mình.
 * Không nhận danh sách emp từ ngoài — không có đường hỏi tiền người khác.
 */
function buildAmounts({ period, session, store = persist, revenueRowsOf } = {}) {
  const entry = store.load(costRatesSync.FILE, {})[text(period)];
  if (!entry) {
    return { period, available: false, reason: 'CHUA_DONG_BO', columns: [...COLUMNS], rows: [], employees: [], fetchedAt: null };
  }
  const isCeo = !!session?.isCeo;
  const scopeCodes = isCeo
    ? Object.keys(entry.employees || {}).sort()
    : [upper(session?.emp_code)].filter((code) => entry.employees?.[code]);
  if (!scopeCodes.length) {
    return { period, available: false, reason: 'KHONG_CO_TRONG_KHO', columns: [...COLUMNS], rows: [], employees: [], fetchedAt: entry.fetchedAt || null };
  }

  const rows = [];
  const employees = [];
  for (const empCode of scopeCodes) {
    // ‼ Đọc % theo TẬP CỘT CỦA CÔNG THỨC C47, không theo cột NV được nhận. Hai tập
    // này khác nhau và lẫn chúng chính là lỗi đã mắc ở bản đầu.
    const rates = pairRates(entry.employees[empCode], C47_REQUIRED);
    const lines = employeeCost.buildRevenueLines(revenueRowsOf(empCode), empCode, period);

    // Gộp doanh thu theo cặp; giữ tên hàng đầu tiên gặp làm nhãn dự phòng.
    const revenueByPair = new Map();
    for (const line of lines) {
      const key = `${line.unit}\u001f${line.product}`;
      const agg = revenueByPair.get(key) || { withVat: 0, noVat: 0, productName: '' };
      agg.withVat += line.revenue;
      agg.noVat += line.revenueBeforeVat;
      if (!agg.productName) agg.productName = text(line.source?.product_name ?? line.source?.c16);
      revenueByPair.set(key, agg);
    }

    const totals = { revenueNoVat: 0, revenueWithVat: 0, c32NoVat: 0, c32WithVat: 0, c47NoVat: 0, c47WithVat: 0,
      pairCount: 0, missingPairs: 0, missingC32Pairs: 0, negativePairs: 0 };
    for (const key of [...revenueByPair.keys()].sort((a, b) => a.localeCompare(b, 'vi'))) {
      const agg = revenueByPair.get(key);
      const [unitCode, productCode] = key.split('\u001f');
      const rate = rates.get(key);
      const c32NoVat = c32Of(rate, agg.noVat);
      const c32WithVat = c32Of(rate, agg.withVat);
      const noVat = c47Of(rate, agg.noVat);
      const withVat = c47Of(rate, agg.withVat);
      const row = {
        empCode,
        unitCode,
        productCode,
        productName: rate?.productName || agg.productName || productCode,
        // Doanh thu giữ lại làm CƠ SỞ ĐỐI CHIẾU — nhưng KHÔNG phải là C32.
        revenueNoVat: Math.round(agg.noVat),
        revenueWithVat: Math.round(agg.withVat),
        c32NoVat: c32NoVat.amount,
        c32WithVat: c32WithVat.amount,
        c32Percent: c32NoVat.percent,
        c32Reason: c32NoVat.reason,
        c47NoVat: noVat.amount,
        c47WithVat: withVat.amount,
        c47Percent: noVat.percent,
        c47Reason: noVat.reason,
        c47Missing: noVat.missing,
        // C47 âm = đã chia vượt quá ngân sách C32. Nêu ra, không hiển thị lặng lẽ.
        c47Negative: noVat.negative,
      };
      rows.push(row);
      totals.pairCount += 1;
      totals.revenueNoVat += row.revenueNoVat;
      totals.revenueWithVat += row.revenueWithVat;
      if (row.c32NoVat == null) totals.missingC32Pairs += 1;
      else { totals.c32NoVat += row.c32NoVat; totals.c32WithVat += row.c32WithVat; }
      if (row.c47Negative) totals.negativePairs += 1;
      if (row.c47NoVat == null) totals.missingPairs += 1;
      else { totals.c47NoVat += row.c47NoVat; totals.c47WithVat += row.c47WithVat; }
    }
    // Tổng C47 chỉ chốt khi ĐỦ mọi cặp — hụt cặp nào là tổng thành null + nói rõ hụt
    // bao nhiêu, không đưa "tổng thiếu" ra như tổng thật.
    employees.push({
      empCode,
      pairCount: totals.pairCount,
      missingPairs: totals.missingPairs,
      missingC32Pairs: totals.missingC32Pairs,
      negativePairs: totals.negativePairs,
      revenueNoVat: totals.revenueNoVat,
      revenueWithVat: totals.revenueWithVat,
      c32NoVat: totals.missingC32Pairs ? null : totals.c32NoVat,
      c32WithVat: totals.missingC32Pairs ? null : totals.c32WithVat,
      c47NoVat: totals.missingPairs ? null : totals.c47NoVat,
      c47WithVat: totals.missingPairs ? null : totals.c47WithVat,
    });
  }

  // Tổng cộng (chỉ có nghĩa với CEO — NV chỉ có chính mình nên trùng dòng NV).
  const grand = employees.reduce((sum, item) => ({
    pairCount: sum.pairCount + item.pairCount,
    missingPairs: sum.missingPairs + item.missingPairs,
    missingC32Pairs: sum.missingC32Pairs + item.missingC32Pairs,
    negativePairs: sum.negativePairs + item.negativePairs,
    revenueNoVat: sum.revenueNoVat + item.revenueNoVat,
    revenueWithVat: sum.revenueWithVat + item.revenueWithVat,
    c32NoVat: sum.c32NoVat == null || item.c32NoVat == null ? null : sum.c32NoVat + item.c32NoVat,
    c32WithVat: sum.c32WithVat == null || item.c32WithVat == null ? null : sum.c32WithVat + item.c32WithVat,
    c47NoVat: sum.c47NoVat == null || item.c47NoVat == null ? null : sum.c47NoVat + item.c47NoVat,
    c47WithVat: sum.c47WithVat == null || item.c47WithVat == null ? null : sum.c47WithVat + item.c47WithVat,
  }), { pairCount: 0, missingPairs: 0, missingC32Pairs: 0, negativePairs: 0,
    revenueNoVat: 0, revenueWithVat: 0, c32NoVat: 0, c32WithVat: 0, c47NoVat: 0, c47WithVat: 0 });

  return {
    period,
    available: true,
    columns: [...COLUMNS],
    // C47 = tổng thành tiền TẤT CẢ cột chi phí của NV đó (full-time: C36+C41+C43+C44+C45).
    rows,
    employees,
    grand,
    fetchedAt: entry.fetchedAt || null,
    fetchedBy: entry.fetchedBy || null,
  };
}

module.exports = {
  VISIBILITY_FILE,
  COLUMNS,
  C47_SUBTRACTED,
  C47_EXCLUDED,
  C47_BUDGET,
  C47_REQUIRED,
  pairRates,
  c32Of,
  c47Of,
  buildAmounts,
  decisionFor,
  visibilityPanel,
  visibilitySave,
};
