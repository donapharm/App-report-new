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
// ‼ Dùng LẠI bản phân loại gốc, không viết bản thứ hai. Bản chép tay hôm 05/08 đã dán
// nhãn sai ("Bucket ngoài official/pending") cho 18 dòng bucket = 'pending'.
const syncExceptionClassifier = require('./syncExceptionClassifier');

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
 * Lý do dòng đang ở trạng thái này.
 *
 * ‼ SỬA 05/08 11:20 — bản đầu tự viết luật riêng và **NÓI SAI**: bản in thật trên PROD
 * dán nhãn *"Bucket ngoài official/pending"* cho 18 dòng có `revenue_bucket = 'pending'`
 * — tức là **đang nằm TRONG** official/pending. Nhãn sai thì kế toán quyết sai.
 *
 * Nguyên nhân: viết lại một luật đã có sẵn ở `syncExceptionClassifier.classifyMisa`
 * (đúng cái tội "bốn định nghĩa cho một luật" vừa phê bình chỗ khác sáng nay). Nay
 * gọi thẳng bản gốc, không giữ bản chép.
 *
 * `classifyMisa` trả chuỗi RỖNG nghĩa là **không phải ngoại lệ** — dòng vẫn được tính
 * vào doanh thu kỳ, chỉ là MISA chưa ghi chính thức. Trường hợp này KHÔNG bịa mã mới
 * nhét vào danh mục 14 mã; nói thẳng bằng tiếng Việt.
 */
function reasonOf(line = {}, period = '') {
  const code = syncExceptionClassifier.classifyMisa(line, period);
  if (!code) {
    return {
      code: '', excluded: false,
      meaning: 'Không phải ngoại lệ — bucket "pending" VẪN được tính vào doanh thu kỳ, đang chờ MISA ghi chính thức',
      owner: 'Kế toán MISA', action: 'Ghi chính thức, hoặc xác nhận huỷ',
    };
  }
  const meta = syncExceptionCatalog.describe(code);
  return { code, excluded: syncExceptionCatalog.isExcluded(code), meaning: meta.meaning, owner: meta.owner, action: meta.action };
}

/** Một dòng của bảng kế toán sẽ đọc. */
function detailRowOf(line = {}, period = '') {
  const reason = reasonOf(line, period);
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

function buildDetail(lines = [], period = '') {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => detailRowOf(line, period))
    .sort((a, b) => a.date.localeCompare(b.date) || a.orderCode.localeCompare(b.orderCode) || a.productCode.localeCompare(b.productCode));
}

/**
 * ‼ TÁCH DÒNG CÓ TIỀN KHỎI DÒNG 0đ — sửa 05/08 11:20 sau bản in thật trên PROD.
 *
 * Bảng thật ra **18 dòng · 11 đơn**, nhưng **17 dòng là 0đ**; toàn bộ 3.995.000đ nằm
 * ở **đúng MỘT đơn** (`DH479816093`). Đưa nguyên cả 18 dòng cho kế toán là bắt họ
 * quyết 11 lần cho một câu hỏi duy nhất — kiểu bảng đó người ta đọc lướt rồi trả lời
 * bừa, hoặc bỏ đấy tới khi hết hạn.
 *
 * Dòng 0đ KHÔNG biến mất (nguyên tắc "không dòng nào biến mất lặng lẽ") — chúng
 * xuống khối riêng, vì chúng là **việc khác của người khác**: `MISA_TIEN_BANG_0` là
 * lỗi dữ liệu, không phải câu hỏi ghi/huỷ.
 */
function splitByMoney(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return { decide: list.filter((row) => Math.round(num(row.amount)) !== 0), zero: list.filter((row) => Math.round(num(row.amount)) === 0) };
}

/**
 * Kỳ này đã KHOÁ SỔ chưa? Nếu rồi thì "HUỶ" không phải câu trả lời miễn phí — nó làm
 * đổi tổng doanh thu của kỳ đã dùng để tính thưởng/phạt đã trả cho nhân viên.
 * Số ghim lấy từ `revenueMaterializeGuard`, không chép tay.
 */
function frozenPeriodPin(period = '', transitions = null) {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text(period));
  if (!month) return null;
  const ky = `${month[2]}.${month[1]}`;
  const source = transitions || require('./revenueMaterializeGuard').APPROVED_RULE_TRANSITIONS;
  for (const transition of Object.values(source || {})) {
    const pin = (transition?.frozenPeriods || {})[ky];
    if (pin) return { ky, ...pin };
  }
  return null;
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

/**
 * ‼ CẤM CẮT CỤT. Sửa 05/08 11:50.
 *
 * Bản đầu dùng `.slice(0, width)`, cột mã hàng rộng 22 ⇒ mã thật
 * `G1.GE.QĐ139.1487.N3.691` (23 ký tự) in ra thành `G1.GE.QĐ139.1487.N3.69`.
 * Mã đơn vị cũng bị cụt: `186.BVĐK AN PHÚ CNIII-PKĐK AN PHÚ` → `186.BVĐK AN PHÚ CNIII-PK`.
 *
 * Kế toán cầm mã cụt đi tra MISA thì **không ra đơn nào** — đúng cái kiểu sai mà cả bộ
 * này sinh ra để chặn. Thà bảng rộng còn hơn bảng sai. Nay chỉ đệm, không bao giờ cắt,
 * và bề rộng cột **tự tính theo dữ liệu thật**.
 */
const pad = (value, width) => String(value ?? '').padEnd(width);
const widthOf = (rows, get, header, min = 0) => Math.max(
  String(header).length, min, ...(Array.isArray(rows) ? rows : []).map((row) => String(get(row) ?? '').length),
);

/** Bảng phân nhóm — dùng khi KHÔNG tìm ra nhóm nào khớp số. */
function formatGroups(groups = [], targetAmount) {
  const out = [`Không nhóm trạng thái nào cộng đúng ${money(targetAmount)}. Toàn bộ nhóm hiện có:`, ''];
  // Tên trạng thái cũng KHÔNG được cắt — cắt là chỉ nhầm nhóm ở lần chạy sau.
  const keyWidth = widthOf(groups, (group) => group.key, 'bucket | status | mapping');
  out.push(`   ${pad('bucket | status | mapping', keyWidth)} ${pad('dòng', 6)} ${pad('đơn', 6)} tiền`);
  for (const group of groups) {
    out.push(`   ${pad(group.key, keyWidth)} ${pad(group.lines, 6)} ${pad(group.orders, 6)} ${money(group.amount)}`);
  }
  out.push('');
  out.push('⛔ CHƯA gửi bảng nào cho kế toán. Chỉ đúng tên trạng thái rồi chạy lại với --status="…".');
  return out.join('\n');
}

/** Bảng chi tiết — kế toán chỉ việc điền GHI hoặc HUỶ vào cột cuối. */
function formatDetail({ rows = [], group = null, audit = null, period = '', frozen = undefined } = {}) {
  const out = [];
  const { decide, zero } = splitByMoney(rows);
  const pin = frozen === undefined ? frozenPeriodPin(period) : frozen;
  out.push(`BẢNG KÊ MISA "ĐỀ NGHỊ GHI" — kỳ ${period || '—'}`);
  if (group) out.push(`Trạng thái nguồn: ${group.key}  ·  ${group.lines} dòng · ${group.orders} đơn · ${money(group.amount)}`);
  out.push('');
  const orders = [...new Set(decide.map((row) => row.orderCode))];
  out.push(`‼ KẾ TOÁN CHỈ CẦN TRẢ LỜI ${orders.length} CÂU: mỗi đơn dưới đây → GHI hay HUỶ.`);
  out.push('   Hạn 08/08 (giờ VN), quá hạn là kỳ khoá sổ, không sửa được nữa.');
  out.push('');
  // Bề rộng tự tính từ dữ liệu THẬT — không có cột nào cắt cụt mã.
  const w = {
    order: widthOf(decide, (row) => row.orderCode, 'MÃ ĐƠN'),
    date: widthOf(decide, (row) => row.date, 'NGÀY'),
    unit: widthOf(decide, (row) => row.unitCode, 'ĐƠN VỊ'),
    product: widthOf(decide, (row) => row.productCode, 'MẶT HÀNG'),
    emp: widthOf(decide, (row) => row.empCode, 'NV'),
    money: widthOf(decide, (row) => money(row.amount), 'TIỀN'),
  };
  const rule = '─'.repeat(w.order + w.date + w.unit + w.product + w.emp + w.money + 6 + 7);
  out.push(`${pad('MÃ ĐƠN', w.order)} ${pad('NGÀY', w.date)} ${pad('ĐƠN VỊ', w.unit)} ${pad('MẶT HÀNG', w.product)} ${pad('NV', w.emp)} ${pad('TIỀN', w.money)} GHI/HUỶ`);
  out.push(rule);
  for (const row of decide) {
    out.push(`${pad(row.orderCode, w.order)} ${pad(row.date, w.date)} ${pad(row.unitCode, w.unit)} ${pad(row.productCode, w.product)} `
      + `${pad(row.empCode, w.emp)} ${pad(money(row.amount), w.money)} ______`);
  }
  out.push(rule);
  if (audit) {
    out.push(`${pad('TỔNG', w.order + w.date + w.unit + w.product + w.emp + 5)} ${pad(money(audit.detailTotal), w.money)}`);
    if (!audit.ok) {
      out.push('');
      out.push(`⛔ LỆCH ${money(audit.diff)} so với số cần đối chiếu (${money(audit.expected)}) — DỪNG, không gửi bảng này đi.`);
    }
  }

  // ‼ Kỳ đã khoá sổ ⇒ "HUỶ" KHÔNG phải câu trả lời miễn phí. Phải nói trước, đừng để
  // kế toán trả lời xong mới phát hiện là đụng vào số đã trả thưởng cho nhân viên.
  if (pin) {
    out.push('');
    out.push(`‼ KỲ ${pin.ky} ĐÃ KHOÁ SỔ — ghim ${money(pin.totalRevenue)} / ${pin.totalRows} dòng.`);
    out.push('   Bucket "pending" ĐANG ĐƯỢC TÍNH vào doanh thu kỳ. Nên:');
    out.push('     · GHI  ⇒ số không đổi, chỉ là MISA ghi chính thức. An toàn.');
    out.push(`     · HUỶ  ⇒ doanh thu kỳ GIẢM ${money(audit ? audit.detailTotal : 0)} so với số đã chốt`);
    out.push('              và đã dùng tính thưởng/phạt đã trả. Trả lời HUỶ thì BÁO CEO TRƯỚC,');
    out.push('              không tự sửa — theo SPEC_REVENUE_DELIVERY_PERIOD: không hồi tố.');
  }

  const reasons = [...new Set(decide.map((row) => `${row.reasonCode || '(không phải ngoại lệ)'} — ${row.reasonMeaning}`))];
  if (reasons.length) {
    out.push('');
    out.push('VÌ SAO CÁC ĐƠN NÀY CẦN QUYẾT');
    for (const reason of reasons) out.push(`   · ${reason}`);
  }

  // Dòng 0đ: KHÔNG bỏ đi, nhưng cũng KHÔNG bắt kế toán quyết. Việc khác, người khác.
  if (zero.length) {
    const zeroReasons = [...new Set(zero.map((row) => `${row.reasonCode || '(không rõ)'} — ${row.reasonMeaning}`))];
    const zeroOrders = [...new Set(zero.map((row) => row.orderCode))];
    out.push('');
    out.push(`── ${zero.length} DÒNG 0đ (${zeroOrders.length} đơn) — KHÔNG hỏi kế toán, đây là lỗi dữ liệu ──`);
    for (const reason of zeroReasons) out.push(`   · ${reason}`);
    out.push(`   Đơn: ${zeroOrders.join(' · ')}`);
    out.push('   Không ảnh hưởng tổng tiền ở trên (đều bằng 0đ). Chuyển App Sale / MISA soát lại.');
  }

  const units = [...new Set(decide.map((row) => `${row.unitCode}${row.unitName ? ` — ${row.unitName}` : ''}`))];
  const products = [...new Set(decide.map((row) => `${row.productCode}${row.productName ? ` — ${row.productName}` : ''}`))];
  out.push('');
  out.push(`ĐƠN VỊ CẦN QUYẾT (${units.length}): ${units.join(' · ')}`);
  out.push(`MẶT HÀNG (${products.length}): ${products.join(' · ')}`);
  return out.join('\n');
}

module.exports = {
  statusKeyOf, groupByStatus, findGroupsMatching, reasonOf,
  detailRowOf, buildDetail, splitByMoney, frozenPeriodPin, auditTotals, formatGroups, formatDetail,
};
