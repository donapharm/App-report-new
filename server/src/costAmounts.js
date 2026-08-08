'use strict';
/**
 * MENU RIÊNG "THÀNH TIỀN C32/C47" (Đợt 3 — SPEC_COST_RATES_LOCAL_SYNC · CEO chốt 08/08/2026)
 *
 * CEO: *"RIÊNG CỘT C32 VÀ CỘT C47 SẼ XÂY MỘT MENU RIÊNG BIỆT... GIẢM RỦI RO LỘ LỌT,
 * LỠ LỖ HỔNG BẢO MẬT/CODE ĐẾN TÀI KHOẢN NV."* Vì thế:
 *
 *  1. Tiền tổng KHÔNG nằm chung màn nào có sẵn — endpoint riêng, tab riêng, công tắc
 *     riêng (`cost_amounts_visibility`, mặc định TẮT ⇒ chỉ CEO thấy).
 *  2. KHÔNG kéo C32/C47 từ DataHub — luật `CATALOG_PERMANENT_FIELD_BLOCKED` giữ
 *     nguyên. Tiền TỰ TÍNH từ hai nguồn App Report đã có:
 *       C32 = doanh thu slot của cặp (có VAT = số gốc; chưa VAT = ÷ VAT_DIVISOR).
 *       C47 = Σ(% kho cục bộ × doanh thu) theo ĐÚNG luật màn "Chi phí của tôi":
 *             cột thường tính trên doanh thu, cột phái sinh (c44) tính trên TIỀN cột
 *             gốc (c43), làm tròn từng cột bằng `employeeCost.calculateAmount` —
 *             đối chiếu tay với màn Chi phí phải khớp từng đồng.
 *  3. Fail-closed: thiếu % cột nào ⇒ C47 = null ('—') + nói thiếu gì; % xung đột
 *     giữa hai dòng cùng cặp ⇒ XUNG_DOT. Không suy 0, không lấy bừa một nửa.
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

/**
 * C47 của một cặp trên một nền doanh thu (chưa/có VAT). Trả `amount: null` kèm lý do
 * khi không đủ %: nửa tổng là một loại số sai mới, thà '—' còn hơn.
 */
function c47Of(rate, template, baseRevenue) {
  if (!rate) return { amount: null, reason: 'THIEU_PHAN_TRAM', missing: [...template.costColumns] };
  if (rate.conflict) return { amount: null, reason: 'XUNG_DOT', missing: [] };
  const amounts = {};
  const missing = [];
  let total = 0;
  for (const key of template.costColumns) {
    const percent = rate.percents[key];
    const base = template.derivedBases[key] ? amounts[template.derivedBases[key]] : baseRevenue;
    const amount = percent == null || base == null ? null : employeeCost.calculateAmount(base, percent);
    amounts[key] = amount;
    if (amount == null) missing.push(key);
    else total += amount;
  }
  if (missing.length) return { amount: null, reason: 'THIEU_PHAN_TRAM', missing };
  return { amount: total, reason: null, missing: [] };
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
    const template = employeeCostTemplates.resolveTemplate(empCode);
    const rates = pairRates(entry.employees[empCode], template.costColumns);
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

    const totals = { c32NoVat: 0, c32WithVat: 0, c47NoVat: 0, c47WithVat: 0, pairCount: 0, missingPairs: 0 };
    for (const key of [...revenueByPair.keys()].sort((a, b) => a.localeCompare(b, 'vi'))) {
      const agg = revenueByPair.get(key);
      const [unitCode, productCode] = key.split('\u001f');
      const rate = rates.get(key);
      const noVat = c47Of(rate, template, agg.noVat);
      const withVat = c47Of(rate, template, agg.withVat);
      const row = {
        empCode,
        unitCode,
        productCode,
        productName: rate?.productName || agg.productName || productCode,
        c32NoVat: Math.round(agg.noVat),
        c32WithVat: Math.round(agg.withVat),
        c47NoVat: noVat.amount,
        c47WithVat: withVat.amount,
        c47Reason: noVat.reason,
        c47Missing: noVat.missing,
      };
      rows.push(row);
      totals.pairCount += 1;
      totals.c32NoVat += row.c32NoVat;
      totals.c32WithVat += row.c32WithVat;
      if (row.c47NoVat == null) totals.missingPairs += 1;
      else { totals.c47NoVat += row.c47NoVat; totals.c47WithVat += row.c47WithVat; }
    }
    // Tổng C47 chỉ chốt khi ĐỦ mọi cặp — hụt cặp nào là tổng thành null + nói rõ hụt
    // bao nhiêu, không đưa "tổng thiếu" ra như tổng thật.
    employees.push({
      empCode,
      pairCount: totals.pairCount,
      missingPairs: totals.missingPairs,
      c32NoVat: totals.c32NoVat,
      c32WithVat: totals.c32WithVat,
      c47NoVat: totals.missingPairs ? null : totals.c47NoVat,
      c47WithVat: totals.missingPairs ? null : totals.c47WithVat,
    });
  }

  // Tổng cộng (chỉ có nghĩa với CEO — NV chỉ có chính mình nên trùng dòng NV).
  const grand = employees.reduce((sum, item) => ({
    pairCount: sum.pairCount + item.pairCount,
    missingPairs: sum.missingPairs + item.missingPairs,
    c32NoVat: sum.c32NoVat + item.c32NoVat,
    c32WithVat: sum.c32WithVat + item.c32WithVat,
    c47NoVat: sum.c47NoVat == null || item.c47NoVat == null ? null : sum.c47NoVat + item.c47NoVat,
    c47WithVat: sum.c47WithVat == null || item.c47WithVat == null ? null : sum.c47WithVat + item.c47WithVat,
  }), { pairCount: 0, missingPairs: 0, c32NoVat: 0, c32WithVat: 0, c47NoVat: 0, c47WithVat: 0 });

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
  pairRates,
  c47Of,
  buildAmounts,
  decisionFor,
  visibilityPanel,
  visibilitySave,
};
