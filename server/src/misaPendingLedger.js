'use strict';
/**
 * V2 — BẢNG KÊ KHOẢN MISA "ĐỀ NGHỊ GHI" (LENH_05082026.md §V2)
 *
 * CEO: *"Bot server chuẩn bị TRƯỚC khi hỏi kế toán: in ra mã đơn · ngày · đơn vị ·
 * mặt hàng · NV đang gán · lý do đang ở trạng thái 'Đề nghị ghi'. Kế toán chỉ trả lời
 * GHI hay HUỶ — không phải đi tra lại từ đầu."* Hạn **08/08**, quá là kỳ khoá sổ.
 *
 * ‼ HAI CHỖ DỄ SAI, ĐÃ CHẶN SẴN:
 *
 * 1. **Không đoán tên trạng thái.** Không ai trong repo này biết chắc "Đề nghị ghi"
 *    nằm ở cột `revenue_bucket`, `revenue_status` hay `mapping_status`, và giá trị
 *    thật viết hoa hay thường. Nên hàm dưới đây **không lọc theo tên** — nó gom TOÀN
 *    BỘ dòng theo bộ ba trạng thái, rồi **tìm nhóm nào cộng đúng ra số cần tìm**
 *    (3.995.000đ). Tìm ra thì in bảng của đúng nhóm đó; không tìm ra thì in cả bảng
 *    phân nhóm để người đọc tự chỉ, **không tự chọn bừa một nhóm gần giống**.
 *
 * 2. **Không dòng nào biến mất lặng lẽ** (SPEC_REVENUE_SYNC_EXCEPTIONS). Tổng bảng
 *    chi tiết in ra phải bằng đúng tổng nhóm đã chọn; lệch một đồng là DỪNG.
 *
 * Hàm THUẦN — không truy vấn, không ghi. Phần lấy dữ liệu ở
 * `scripts/misa_pending_detail.js`.
 */

const syncExceptionCatalog = require('./syncExceptionCatalog');

const text = (value) => String(value ?? '').trim();
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value) => `${Math.round(num(value)).toLocaleString('vi-VN')}đ`;

/** Khoá nhóm = bộ ba trạng thái, giữ nguyên chữ gốc để dán lại cho kế toán đọc. */
function statusKeyOf(line = {}) {
  return [text(line.revenue_bucket), text(line.revenue_status), text(line.mapping_status)].join(' | ');
}

/**
 * Gom toàn bộ dòng theo bộ ba trạng thái.
 * @returns {Array} [{ key, bucket, status, mapping, lines, orders, amount }] — tiền giảm dần
 */
function groupByStatus(lines = []) {
  const groups = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const key = statusKeyOf(line);
    const hit = groups.get(key) || {
      key,
      bucket: text(line.revenue_bucket), status: text(line.revenue_status), mapping: text(line.mapping_status),
      lines: 0, orders: new Set(), amount: 0,
    };
    hit.lines += 1;
    const order = text(line.sale_order_no || line.order_code);
    if (order) hit.orders.add(order);
    hit.amount += num(line.invoice_export_amount ?? line.revenue ?? line.amount);
    groups.set(key, hit);
  }
  return [...groups.values()]
    .map((hit) => ({ ...hit, orders: hit.orders.size, amount: Math.round(hit.amount) }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

/**
 * Nhóm nào cộng đúng ra số đang đi tìm?
 * ‼ So khớp CHÍNH XÁC tới đồng. Gần đúng không tính — "gần đúng" là cách người ta
 * dán nhầm bảng cho kế toán rồi ghi nhầm doanh thu vào kỳ đã khoá sổ.
 */
function findGroupsMatching(groups = [], targetAmount) {
  const target = Math.round(num(targetAmount));
  if (!target) return [];
  return (Array.isArray(groups) ? groups : []).filter((group) => Math.round(num(group.amount)) === target);
}

/**
 * Lý do dòng đang nằm ngoài doanh thu — lấy NGHĨA từ danh mục 14 mã có sẵn, không tự
 * nghĩ chữ mới. Bucket ngoài official/pending chính là `MISA_CHUA_GHI_DOANH_SO`.
 */
function reasonOf(line = {}) {
  const bucket = text(line.revenue_bucket).toLowerCase();
  const code = bucket && !['official', 'pending'].includes(bucket)
    ? 'MISA_CHUA_GHI_DOANH_SO'
    : (!text(line.revenue_date || line.sale_order_date) ? 'MISA_THIEU_NGAY_DOANH_THU' : 'MISA_CHUA_GHI_DOANH_SO');
  const meta = syncExceptionCatalog.describe(code);
  return { code, meaning: meta.meaning, owner: meta.owner, action: meta.action };
}

/** Một dòng của bảng kế toán sẽ đọc. */
function detailRowOf(line = {}) {
  const reason = reasonOf(line);
  return {
    orderCode: text(line.sale_order_no || line.order_code) || '—',
    date: text(line.sale_order_date || line.invoice_date).slice(0, 10) || '—',
    unitCode: text(line.unit_code) || '—',
    unitName: text(line.unit_name) || '',
    productCode: text(line.qlnb_code) || '—',
    productName: text(line.product_name || line.misa_product_name) || '',
    empCode: text(line.employee_code) || 'UNALLOCATED',
    empName: text(line.employee_name) || '',
    amount: Math.round(num(line.invoice_export_amount ?? line.revenue ?? line.amount)),
    statusRaw: statusKeyOf(line),
    reasonCode: reason.code,
    reasonMeaning: reason.meaning,
  };
}

function buildDetail(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map(detailRowOf)
    .sort((a, b) => a.date.localeCompare(b.date) || a.orderCode.localeCompare(b.orderCode) || a.productCode.localeCompare(b.productCode));
}

/**
 * Bất biến: tổng bảng in ra phải bằng tổng nhóm, và bằng số đang đi tìm.
 * @returns {{ ok:boolean, detailTotal:number, expected:number, diff:number, rows:number }}
 */
function auditTotals(detailRows = [], expectedAmount) {
  const detailTotal = (Array.isArray(detailRows) ? detailRows : []).reduce((sum, row) => sum + Math.round(num(row.amount)), 0);
  const expected = Math.round(num(expectedAmount));
  return { ok: detailTotal === expected, detailTotal, expected, diff: detailTotal - expected, rows: detailRows.length };
}

const pad = (value, width) => String(value ?? '').padEnd(width).slice(0, width);

/** Bảng phân nhóm — dùng khi KHÔNG tìm ra nhóm nào khớp số. */
function formatGroups(groups = [], targetAmount) {
  const out = [`Không nhóm trạng thái nào cộng đúng ${money(targetAmount)}. Toàn bộ nhóm hiện có:`, ''];
  out.push(`   ${pad('bucket | status | mapping', 52)} ${pad('dòng', 6)} ${pad('đơn', 6)} tiền`);
  for (const group of groups) {
    out.push(`   ${pad(group.key, 52)} ${pad(group.lines, 6)} ${pad(group.orders, 6)} ${money(group.amount)}`);
  }
  out.push('');
  out.push('⛔ CHƯA gửi bảng nào cho kế toán. Chỉ đúng tên trạng thái rồi chạy lại với --status="…".');
  return out.join('\n');
}

/** Bảng chi tiết — kế toán chỉ việc điền GHI hoặc HUỶ vào cột cuối. */
function formatDetail({ rows = [], group = null, audit = null, period = '' } = {}) {
  const out = [];
  out.push(`BẢNG KÊ MISA "ĐỀ NGHỊ GHI" — kỳ ${period || '—'}`);
  if (group) out.push(`Trạng thái nguồn: ${group.key}  ·  ${group.lines} dòng · ${group.orders} đơn · ${money(group.amount)}`);
  out.push('');
  out.push('‼ KẾ TOÁN CHỈ CẦN TRẢ LỜI: mỗi đơn dưới đây → GHI hay HUỶ. Hạn 08/08 (giờ VN),');
  out.push('   quá hạn là kỳ khoá sổ, không sửa được nữa.');
  out.push('');
  out.push(`${pad('MÃ ĐƠN', 16)} ${pad('NGÀY', 11)} ${pad('ĐƠN VỊ', 24)} ${pad('MẶT HÀNG', 22)} ${pad('NV', 8)} ${pad('TIỀN', 14)} GHI/HUỶ`);
  out.push('─'.repeat(112));
  for (const row of rows) {
    out.push(`${pad(row.orderCode, 16)} ${pad(row.date, 11)} ${pad(row.unitCode, 24)} ${pad(row.productCode, 22)} `
      + `${pad(row.empCode, 8)} ${pad(money(row.amount), 14)} ______`);
  }
  out.push('─'.repeat(112));
  if (audit) {
    out.push(`${pad('TỔNG', 84)} ${pad(money(audit.detailTotal), 14)}`);
    if (!audit.ok) {
      out.push('');
      out.push(`⛔ LỆCH ${money(audit.diff)} so với số cần đối chiếu (${money(audit.expected)}) — DỪNG, không gửi bảng này đi.`);
    }
  }
  const reasons = [...new Set(rows.map((row) => `${row.reasonCode} — ${row.reasonMeaning}`))];
  if (reasons.length) {
    out.push('');
    out.push('VÌ SAO CÁC DÒNG NÀY CHƯA VÀO DOANH THU');
    for (const reason of reasons) out.push(`   · ${reason}`);
  }
  const units = [...new Set(rows.map((row) => `${row.unitCode}${row.unitName ? ` — ${row.unitName}` : ''}`))];
  const products = [...new Set(rows.map((row) => `${row.productCode}${row.productName ? ` — ${row.productName}` : ''}`))];
  out.push('');
  out.push(`ĐƠN VỊ (${units.length}): ${units.join(' · ')}`);
  out.push(`MẶT HÀNG (${products.length}): ${products.join(' · ')}`);
  return out.join('\n');
}

module.exports = {
  statusKeyOf, groupByStatus, findGroupsMatching, reasonOf,
  detailRowOf, buildDetail, auditTotals, formatGroups, formatDetail,
};
