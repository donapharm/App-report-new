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
const costFilters = require('./costFilters');

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

/* ═══════════════════════════════════════════════════════════════════════════════
   CHI TIẾT TỪNG DÒNG ĐƠN HÀNG (CEO chốt 09/08/2026: *"tôi muốn lấy thêm các cột
   khác về để làm báo cáo luôn — là các cột bên tab Chi phí của tôi"*, và khi hỏi
   xem-trên-màn hay chỉ-xuất-Excel thì CEO trả lời *"tôi muốn cả hai"*).

   ‼ NHÃN CỘT CHÉP ĐÚNG tab "Chi phí của tôi" (`employeeCostExport.costColumns`) —
   cùng một thứ mà hai màn gọi hai tên là người đọc phải tự dịch, rồi tự nghi ngờ
   có phải hai số khác nhau không.

   Mức chi tiết là ADDITIVE: `rows`/`employees`/`grand` (mức cặp) GIỮ NGUYÊN, chi
   tiết nằm ở `orderRows` riêng. Nhờ vậy bật/tắt chi tiết KHÔNG bao giờ làm đổi
   con số tổng — thứ CEO đọc để ra quyết định.
   ═══════════════════════════════════════════════════════════════════════════════ */
const DETAIL_COLUMNS = Object.freeze([
  { key: 'date', label: 'Ngày' },
  { key: 'orderCode', label: 'Mã đơn' },
  { key: 'route', label: 'Tuyến' },
  { key: 'unitCode', label: 'Đơn vị' },
  { key: 'contractorName', label: 'Nhà thầu' },
  { key: 'productCode', label: 'Mã QLNB' },
  { key: 'productName', label: 'Tên hàng' },
  { key: 'strength', label: 'Hàm lượng' },
  { key: 'uom', label: 'ĐVT' },
  { key: 'bidPrice', label: 'Giá trúng thầu', money: true },
  { key: 'quantity', label: 'SL', number: true },
  { key: 'revenueNoVat', label: 'Thành tiền trước VAT', money: true },
]);
// Trần dòng chi tiết. Một kỳ × 21 NV có thể ra hàng chục nghìn dòng đơn — trả hết
// là treo trình duyệt. Cắt thì PHẢI NÓI RA (`orderRowsTruncated` + tổng thật), vì
// bảng bị cắt lặng lẽ đọc y như bảng đầy đủ.
const ORDER_ROW_LIMIT = Math.max(200, Number(process.env.COST_AMOUNTS_ORDER_LIMIT || 5000) || 5000);

const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Một dòng đơn hàng. Tiền C32/C47 tính trên doanh thu CỦA CHÍNH DÒNG ĐÓ bằng đúng
 * % của cặp — cộng lại đúng bằng số ở mức cặp, không phải một cách tính thứ hai.
 * Thiếu thuộc tính nào để RỖNG; danh mục là SSOT, dòng doanh thu chỉ đỡ khi danh
 * mục tra không ra cặp.
 */
function orderLineOf(line, meta, attr, rate) {
  const source = line.source || {};
  const pick = (...keys) => { for (const key of keys) { const v = text(source[key]); if (v) return v; } return ''; };
  const noVat = line.revenueBeforeVat;
  const withVat = line.revenue;
  const c32 = c32Of(rate, noVat);
  const c47 = c47Of(rate, noVat);
  return {
    ...meta,
    // Ngày chỉ hiện khi nguồn thực sự theo ngày (`dateReliable`) — slot kỳ cũ gán
    // ngày kỹ thuật, in ra là bịa ngày giao dịch.
    date: line.dateReliable ? line.date : '',
    orderCode: line.orderCode || '',
    productName: rate?.productName || pick('product_name', 'c16') || meta.productCode,
    strength: text(attr.strength) || pick('strength', 'ham_luong', 'c17'),
    uom: text(attr.uom) || pick('uom', 'c25'),
    bidPrice: attr.bidPrice ?? numberOrNull(source.bid_price ?? source.c31),
    quantity: numberOrNull(line.quantity),
    revenueNoVat: noVat == null ? null : Math.round(noVat),
    revenueWithVat: Math.round(withVat),
    c32NoVat: c32.amount, c32Percent: c32.percent, c32Reason: c32.reason,
    c47NoVat: c47.amount, c47Percent: c47.percent, c47Reason: c47.reason,
    c47Missing: c47.missing, c47Negative: c47.negative,
  };
}

/**
 * Dựng bảng thành tiền theo cặp cho MỘT hoặc NHIỀU kỳ.
 *
 * LỌC QUYỀN tại đây: CEO thấy mọi NV có trong kho; NV (route đã kiểm công tắc) chỉ
 * thấy chính mình. Không nhận danh sách emp từ ngoài — không có đường hỏi tiền người
 * khác. Bộ lọc của người dùng chạy SAU hàng rào quyền, nên lọc rộng cỡ nào cũng
 * không mở thêm được một dòng nào ngoài phạm vi.
 *
 * ‼ NHIỀU KỲ = NHIỀU DÒNG, KHÔNG CỘNG DỒN (CEO xin "xuất từ kỳ đến kỳ" 09/08/2026).
 * Mỗi kỳ có bản % riêng, cộng doanh thu hai kỳ rồi nhân MỘT bản % là bịa số cho kỳ
 * kia. Vì thế mỗi cặp × mỗi kỳ là một dòng, có cột "Kỳ"; phần tổng theo NV mới cộng
 * lại. Kỳ nào chưa đồng bộ % ⇒ nằm trong `missingPeriods` và KHÔNG lặng lẽ biến mất.
 *
 * `catalogAttrsOf(period)` → Map `UNIT@QLNB` → { contractor, contractorName, route,
 * priority } (danh mục là SSOT); tra không ra thì lấy dự phòng từ chính dòng doanh
 * thu, vẫn không ra thì để RỖNG chứ không đoán.
 */
function buildAmounts({ period, periods, session, store = persist, revenueRowsOf, catalogAttrsOf = () => new Map(), filters: rawFilters = {}, level = 'pair' } = {}) {
  // ‼ CHI TIẾT ĐƠN HÀNG CHỈ DÀNH CHO CEO (bot chặn Gate 1 đúng, 09/08/2026).
  // CEO xin bảng chi tiết để TỰ làm báo cáo ("để tao biết"), không hề nói mở cho NV.
  // Menu Thành tiền vốn sinh ra để "giảm rủi ro lộ lọt", nên mở thêm một mức chi tiết
  // cho NV phải là quyết định RIÊNG của CEO, không phải hệ quả phụ của một tính năng.
  // Chốt ngay tại đây — nơi duy nhất dựng bảng — để không route nào lách được.
  const wantOrders = String(level) === 'order' && !!session?.isCeo;
  const filters = costFilters.normalizeFilters(rawFilters);
  const periodList = [...new Set((Array.isArray(periods) && periods.length ? periods : [period]).map(text).filter(Boolean))].sort();
  const warehouse = store.load(costRatesSync.FILE, {});
  const availablePeriods = periodList.filter((item) => warehouse[item]);
  const missingPeriods = periodList.filter((item) => !warehouse[item]);
  const seen = costFilters.collector();
  const emptyResult = (reason) => ({
    period: periodList[0] || '', periods: periodList, missingPeriods,
    available: false, reason, columns: [...COLUMNS], rows: [], employees: [],
    filters, filterOptions: seen.result(), partnerGroups: costFilters.PARTNER_GROUPS.map((item) => ({ ...item })),
    groupQueryNote: costFilters.groupQueryNote(filters.groupQuery), sources: [], fetchedAt: null,
    level: wantOrders ? 'order' : 'pair', detailColumns: [...DETAIL_COLUMNS],
    joinHealth: { revenuePairs: 0, matchedPairs: 0, ratePairs: 0, sampleRevenueKeys: [], sampleRateKeys: [], keyFormatMismatch: false },
    orderRows: [], orderRowsTotal: 0, orderRowsTruncated: false, orderRowLimit: ORDER_ROW_LIMIT,
  });
  if (!availablePeriods.length) return emptyResult('CHUA_DONG_BO');

  const isCeo = !!session?.isCeo;
  const ownCode = upper(session?.emp_code);
  const scopeCodes = [...new Set(availablePeriods.flatMap((item) => Object.keys(warehouse[item].employees || {})))]
    .map(upper)
    .filter((code) => isCeo || code === ownCode)
    .sort();
  if (!scopeCodes.length) return emptyResult('KHONG_CO_TRONG_KHO');

  const rows = [];
  const orderRows = [];
  let orderRowsTotal = 0;
  /* ‼ SỨC KHOẺ PHÉP KHỚP CẶP — phân biệt "DataHub thiếu %" với "hai bên ghi mã
     đơn vị khác định dạng" (Claude tự thêm sau khi mất cả tối 09/08 vì đổ tội nhầm).
     Hai cảnh này hiện ra màn Y HỆT NHAU: mọi ô là "—" kèm chữ "thiếu %". Nhưng cách
     xử lý ngược nhau hoàn toàn — một bên đi đòi DataHub bổ sung số, một bên là lỗi
     ghép khoá của chính App Report và đòi DataHub cũng vô ích.
     Dấu hiệu KHÔNG THỂ NHẦM: cả hai bên ĐỀU CÓ dữ liệu mà giao nhau BẰNG KHÔNG. */
  const joinHealth = { revenuePairs: 0, matchedPairs: 0, ratePairs: 0, sampleRevenueKeys: [], sampleRateKeys: [] };
  const filtersActive = costFilters.isActive(filters);
  // Tổng theo NV cộng qua MỌI kỳ đang xem — khoá theo mã NV, không theo kỳ.
  const byEmployee = new Map();
  const totalsOf = (empCode) => {
    if (!byEmployee.has(empCode)) {
      byEmployee.set(empCode, { empCode, periods: new Set(), pairCount: 0, missingPairs: 0, missingC32Pairs: 0,
        negativePairs: 0, revenueNoVat: 0, revenueWithVat: 0, c32NoVat: 0, c32WithVat: 0, c47NoVat: 0, c47WithVat: 0 });
    }
    return byEmployee.get(empCode);
  };

  for (const item of availablePeriods) {
    const entry = warehouse[item];
    const attrs = catalogAttrsOf(item) || new Map();
    for (const empCode of scopeCodes) {
      const kept = entry.employees?.[empCode];
      if (!kept) continue;
      // KHÔNG lọc ⇒ NV nào có % trong kho đều phải xuất hiện ở bảng tổng, kể cả khi
      // kỳ đó không có doanh thu nào (pairCount 0). "Có % mà không có doanh thu" là
      // tin cần thấy; để dòng đó biến mất là giấu chuyện. Đang lọc thì mới được giấu
      // NV không còn dòng nào — nếu không, lọc một đơn vị vẫn hiện đủ mấy chục NV rỗng.
      if (!filtersActive) totalsOf(empCode).periods.add(item);
      // ‼ Đọc % theo TẬP CỘT CỦA CÔNG THỨC C47, không theo cột NV được nhận. Hai tập
      // này khác nhau và lẫn chúng chính là lỗi đã mắc ở bản đầu.
      const rates = pairRates(kept, C47_REQUIRED);
      joinHealth.ratePairs += rates.size;
      for (const key of rates.keys()) {
        if (joinHealth.sampleRateKeys.length >= 3) break;
        joinHealth.sampleRateKeys.push(key.replace('\u001f', ' × '));
      }
      const lines = employeeCost.buildRevenueLines(revenueRowsOf(empCode, item), empCode, item);

      // Gộp doanh thu theo cặp; giữ tên hàng đầu tiên gặp làm nhãn dự phòng.
      const revenueByPair = new Map();
      for (const line of lines) {
        const key = `${line.unit}\u001f${line.product}`;
        const agg = revenueByPair.get(key) || { withVat: 0, noVat: 0, productName: '', dims: null, lines: [] };
        agg.withVat += line.revenue;
        agg.noVat += line.revenueBeforeVat;
        if (!agg.productName) agg.productName = text(line.source?.product_name ?? line.source?.c16);
        if (!agg.dims) agg.dims = costFilters.dimsOfRevenueRow(line.source);
        // Giữ dòng gốc CHỈ khi có người hỏi chi tiết — mặc định không ôm thêm bộ nhớ.
        if (wantOrders) agg.lines.push(line);
        revenueByPair.set(key, agg);
      }

      for (const key of [...revenueByPair.keys()].sort((a, b) => a.localeCompare(b, 'vi'))) {
        const agg = revenueByPair.get(key);
        const [unitCode, productCode] = key.split('\u001f');
        const attr = attrs.get(key) || {};
        const dims = agg.dims || {};
        const meta = {
          empCode,
          unitCode,
          productCode,
          group: costFilters.groupOf(unitCode),
          contractorCode: upper(attr.contractor || dims.contractorCode),
          contractorName: text(attr.contractorName || dims.contractorName),
          route: upper(attr.route || dims.route),
          priority: upper(attr.priority || dims.priority),
        };
        // Thu lựa chọn TRƯỚC khi lọc — bỏ lọc phải còn đường quay lại.
        seen.add({ ...meta, productName: agg.productName });
        if (!costFilters.passes({ ...meta, productName: agg.productName }, filters)) continue;

        const rate = rates.get(key);
        joinHealth.revenuePairs += 1;
        if (rate) joinHealth.matchedPairs += 1;
        else if (joinHealth.sampleRevenueKeys.length < 3) joinHealth.sampleRevenueKeys.push(key.replace('\u001f', ' × '));
        const c32NoVat = c32Of(rate, agg.noVat);
        const c32WithVat = c32Of(rate, agg.withVat);
        const noVat = c47Of(rate, agg.noVat);
        const withVat = c47Of(rate, agg.withVat);
        const row = {
          period: item,
          ...meta,
          productName: rate?.productName || agg.productName || productCode,
          partnerGroup: costFilters.partnerGroupOf(meta.contractorCode),
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
        if (wantOrders) {
          orderRowsTotal += agg.lines.length;
          for (const line of agg.lines) {
            // Đếm TỔNG trước, cắt sau — con số tổng phải là số thật, không phải
            // số còn lại sau khi cắt.
            if (orderRows.length >= ORDER_ROW_LIMIT) continue;
            orderRows.push({ period: item, ...orderLineOf(line, meta, attr, rate) });
          }
        }

        const totals = totalsOf(empCode);
        totals.periods.add(item);
        totals.pairCount += 1;
        totals.revenueNoVat += row.revenueNoVat;
        totals.revenueWithVat += row.revenueWithVat;
        if (row.c32NoVat == null) totals.missingC32Pairs += 1;
        else { totals.c32NoVat += row.c32NoVat; totals.c32WithVat += row.c32WithVat; }
        if (row.c47Negative) totals.negativePairs += 1;
        if (row.c47NoVat == null) totals.missingPairs += 1;
        else { totals.c47NoVat += row.c47NoVat; totals.c47WithVat += row.c47WithVat; }
      }
    }
  }

  // Tổng C47 chỉ chốt khi ĐỦ mọi cặp — hụt cặp nào là tổng thành null + nói rõ hụt
  // bao nhiêu, không đưa "tổng thiếu" ra như tổng thật.
  const employees = [...byEmployee.values()]
    .sort((a, b) => a.empCode.localeCompare(b.empCode, 'vi'))
    .map((item) => ({
      empCode: item.empCode,
      periodCount: item.periods.size,
      pairCount: item.pairCount,
      missingPairs: item.missingPairs,
      missingC32Pairs: item.missingC32Pairs,
      negativePairs: item.negativePairs,
      revenueNoVat: item.revenueNoVat,
      revenueWithVat: item.revenueWithVat,
      c32NoVat: item.missingC32Pairs ? null : item.c32NoVat,
      c32WithVat: item.missingC32Pairs ? null : item.c32WithVat,
      c47NoVat: item.missingPairs ? null : item.c47NoVat,
      c47WithVat: item.missingPairs ? null : item.c47WithVat,
    }));

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

  // Căn cước bản số của TỪNG kỳ — nhiều kỳ thì mỗi kỳ một lần đồng bộ khác nhau,
  // gộp thành một mốc là nói dối về nguồn.
  const sources = availablePeriods.map((item) => ({
    period: item, fetchedAt: warehouse[item].fetchedAt || null, fetchedBy: warehouse[item].fetchedBy || null,
  }));
  const last = sources.at(-1) || {};

  return {
    period: periodList[0] || '',
    periods: periodList,
    availablePeriods,
    missingPeriods,
    available: true,
    columns: [...COLUMNS],
    rows,
    employees,
    grand,
    filters,
    filterOptions: seen.result(),
    partnerGroups: costFilters.PARTNER_GROUPS.map((item) => ({ ...item })),
    groupQueryNote: costFilters.groupQueryNote(filters.groupQuery),
    level: wantOrders ? 'order' : 'pair',
    detailColumns: [...DETAIL_COLUMNS],
    joinHealth: {
      ...joinHealth,
      // Cả hai bên có số mà không khớp được CẶP NÀO ⇒ chắc chắn là lệch khoá,
      // không phải thiếu %. Chỉ kết luận khi bằng chứng không thể hiểu cách khác.
      keyFormatMismatch: joinHealth.matchedPairs === 0 && joinHealth.revenuePairs > 0 && joinHealth.ratePairs > 0,
    },
    orderRows,
    orderRowsTotal,
    orderRowsTruncated: orderRowsTotal > orderRows.length,
    orderRowLimit: ORDER_ROW_LIMIT,
    sources,
    fetchedAt: last.fetchedAt || null,
    fetchedBy: last.fetchedBy || null,
  };
}

module.exports = {
  VISIBILITY_FILE,
  COLUMNS,
  DETAIL_COLUMNS,
  ORDER_ROW_LIMIT,
  orderLineOf,
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
