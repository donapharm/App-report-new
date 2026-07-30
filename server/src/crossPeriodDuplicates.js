'use strict';
/**
 * CHẶN ĐẾM TRÙNG ĐƠN GIỮA HAI KỲ (CEO chốt 2026-07-30, việc 3)
 *
 * CEO: "phải có cơ chế chặn trùng đơn, tránh một đơn tính cho cả 2 tháng (như tính
 * T06 rồi T07 tính nữa / tính T07 rồi T08 tính lại nữa)."
 *
 * ‼ Vì sao cần thêm, dù `reconcile.js` đã có `duplicateLines`: lớp đó chỉ soát trùng
 * TRONG CÙNG MỘT KỲ (`seenLineId` dựng lại cho mỗi `reconcileKy`). Một dòng nằm ở
 * T06 rồi lại nằm ở T07 thì **cả hai kỳ đều thấy sạch** — đúng loại lỗi CEO lo, và
 * đúng loại lỗi không ai phát hiện được bằng mắt vì mỗi kỳ nhìn riêng đều đủ.
 *
 * Rủi ro thật: quy kỳ theo NGÀY THỰC GIAO (SPEC_REVENUE_DELIVERY_PERIOD) nên khi
 * VP018/DN007 sửa ngày, một dòng có thể chuyển kỳ. Sửa mà kỳ cũ chưa bỏ dòng đó ra
 * thì thành cộng hai lần — NV được thưởng trên doanh thu đếm đôi.
 *
 * Nguyên tắc:
 *  1. CHỈ ĐỌC, không sửa dữ liệu. Việc này là người canh cửa, không phải người dọn.
 *  2. FAIL-CLOSED VÀ NÓI RA: dòng không có khoá nhận dạng nào thì KHÔNG kết luận là
 *     sạch — đếm riêng vào `unidentifiable` và báo, vì với dòng đó ta không thể
 *     chứng minh là không trùng.
 *  3. Không tự đoán "dòng nào mới đúng". Chọn kỳ nào giữ là quyết định nghiệp vụ của
 *     CEO/VP018, module chỉ chỉ ra chỗ trùng và số tiền đang đếm đôi.
 */

function num(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function text(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Khoá nhận dạng một dòng doanh thu, theo thứ tự tin cậy giảm dần:
 *  1. `source_line_id` — khoá thật của nguồn, tin cậy nhất.
 *  2. `order_item_id` — khoá dòng đơn hàng của App Sale.
 *  3. Bộ ghép mã đơn + mã hàng + đơn vị — dùng khi nguồn không cấp khoá dòng.
 * Không đủ để dựng khoá nào ⇒ trả null (rơi vào `unidentifiable`, KHÔNG coi là sạch).
 */
function identityOf(row = {}) {
  const lineId = text(row.source_line_id ?? row.sourceLineId);
  if (lineId) return { key: `line:${lineId}`, basis: 'source_line_id' };
  const itemId = text(row.order_item_id ?? row.orderItemId);
  if (itemId) return { key: `item:${itemId}`, basis: 'order_item_id' };
  const order = text(row.order_code ?? row.orderCode ?? row.ma_don_hang);
  const product = text(row.product_code ?? row.productCode ?? row.qlnb_code ?? row.c5);
  const unit = text(row.unit_code ?? row.unitCode ?? row.c7);
  if (order && product) return { key: `combo:${order}|${product}|${unit}`, basis: 'order+product+unit' };
  return null;
}

/**
 * rowsByKy: { '06.2026': [row, ...], '07.2026': [...] }
 * Trả danh sách dòng xuất hiện ở TỪ HAI KỲ TRỞ LÊN, kèm số tiền đang bị đếm đôi.
 */
function scan(rowsByKy = {}) {
  const byKey = new Map();
  const unidentifiable = [];
  const perKy = {};

  for (const [ky, rows] of Object.entries(rowsByKy)) {
    const list = Array.isArray(rows) ? rows : [];
    perKy[ky] = { rows: list.length, revenue: 0, unidentifiable: 0 };
    for (const row of list) {
      const revenue = num(row.revenue ?? row.amount ?? row.revenue_before_vat);
      perKy[ky].revenue += revenue;
      const identity = identityOf(row);
      if (!identity) {
        perKy[ky].unidentifiable += 1;
        unidentifiable.push({
          ky,
          empCode: text(row.emp_code ?? row.empCode),
          unitCode: text(row.unit_code ?? row.unitCode),
          revenue,
          reason: 'không có source_line_id / order_item_id / (mã đơn + mã hàng) nên KHÔNG chứng minh được là không trùng',
        });
        continue;
      }
      const entry = byKey.get(identity.key) || { key: identity.key, basis: identity.basis, hits: [] };
      entry.hits.push({
        ky,
        empCode: text(row.emp_code ?? row.empCode),
        unitCode: text(row.unit_code ?? row.unitCode),
        orderCode: text(row.order_code ?? row.orderCode ?? row.ma_don_hang),
        date: String(row.revenue_date ?? row.effective_date ?? row.date ?? '').slice(0, 10),
        revenue,
      });
      byKey.set(identity.key, entry);
    }
  }

  const duplicates = [...byKey.values()]
    .map((entry) => {
      const kys = [...new Set(entry.hits.map((hit) => hit.ky))].sort();
      return { ...entry, kys, crossPeriod: kys.length > 1 };
    })
    .filter((entry) => entry.crossPeriod)
    .map((entry) => {
      // Tiền đếm đôi = tổng các lần LẶP LẠI (giữ 1 lần là đúng, các lần sau là thừa).
      const amounts = entry.hits.map((hit) => hit.revenue).sort((left, right) => right - left);
      return { ...entry, doubleCountedRevenue: amounts.slice(1).reduce((sum, value) => sum + value, 0) };
    })
    .sort((left, right) => right.doubleCountedRevenue - left.doubleCountedRevenue);

  const doubleCountedRevenue = duplicates.reduce((sum, entry) => sum + entry.doubleCountedRevenue, 0);
  // ‼ Kỳ KHÔNG CÓ DÒNG NÀO thì tuyệt đối không được tuyên "sạch": không có dữ liệu
  // để soát khác hoàn toàn với đã soát và không thấy trùng. Bản nháp đầu in "✅ không
  // có đơn nào bị tính hai kỳ" khi cả hai kỳ đều 0 dòng — đúng loại báo cáo sai mà
  // người đọc tin ngay.
  const emptyKys = Object.entries(perKy).filter(([, info]) => info.rows === 0).map(([ky]) => ky);
  return {
    emptyKys,
    kys: Object.keys(rowsByKy).sort(),
    perKy,
    duplicates,
    duplicateCount: duplicates.length,
    doubleCountedRevenue,
    unidentifiable,
    unidentifiableCount: unidentifiable.length,
    // clean = KHÔNG có dòng trùng VÀ mọi dòng đều nhận dạng được. Còn dòng không
    // nhận dạng được thì KHÔNG được tuyên "sạch" — chỉ là "chưa thấy trùng".
    clean: duplicates.length === 0 && unidentifiable.length === 0 && emptyKys.length === 0,
    status: duplicates.length ? 'duplicates_found'
      : (unidentifiable.length || emptyKys.length) ? 'unverifiable' : 'clean',
  };
}

// Câu chữ cho người đọc: nói rõ đang đếm đôi bao nhiêu tiền và ai phải quyết.
function summaryText(result = {}) {
  if (result.status === 'clean') {
    return `✅ Không có đơn nào bị tính cho hai kỳ (${(result.kys || []).join(' · ')}). Mọi dòng đều nhận dạng được.`;
  }
  const lines = [];
  if ((result.emptyKys || []).length) {
    lines.push(`⚠ Không có dòng nào để soát ở kỳ: ${result.emptyKys.join(' · ')} — CHƯA soát được, không phải "sạch".`);
    lines.push('→ Kiểm lại slot active của kỳ đó trước khi kết luận.');
  }
  if (result.duplicateCount) {
    lines.push(`🛑 ${result.duplicateCount} dòng bị tính ở NHIỀU KỲ — đang đếm đôi ${Math.round(result.doubleCountedRevenue).toLocaleString('vi-VN')}đ.`);
    for (const entry of (result.duplicates || []).slice(0, 10)) {
      const where = entry.hits.map((hit) => `${hit.ky}${hit.date ? ` (${hit.date})` : ''}`).join(' + ');
      lines.push(`• ${entry.hits[0].orderCode || entry.key} · ${Math.round(entry.hits[0].revenue).toLocaleString('vi-VN')}đ · ${entry.hits[0].empCode || '—'} · nằm ở ${where}`);
    }
    if (result.duplicateCount > 10) lines.push(`… và ${result.duplicateCount - 10} dòng nữa.`);
    lines.push('→ VP018/DN007 chốt dòng này thuộc kỳ NÀO, rồi bỏ khỏi kỳ còn lại. App Report KHÔNG tự chọn giúp.');
  }
  if (result.unidentifiableCount) {
    lines.push(`⚠ ${result.unidentifiableCount} dòng KHÔNG có khoá nhận dạng nên chưa chứng minh được là không trùng.`);
    lines.push('→ DataHub/App Sale cấp source_line_id hoặc order_item_id cho các dòng này.');
  }
  return lines.join('\n');
}

module.exports = { identityOf, scan, summaryText };
