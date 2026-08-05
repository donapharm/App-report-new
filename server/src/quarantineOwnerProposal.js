'use strict';
/**
 * V1 — ĐỀ XUẤT CHỦ CHO DÒNG BỊ CÁCH LY (LENH_05082026.md §V1)
 *
 * Bối cảnh: đơn `DH479816174` (MISA 341964 · Pizar-3 · 1.795.600đ · đơn vị
 * `120.HTNT-PHARMACITY`) đang gán cho **VP018 — telesaler**, nên
 * `employeeRevenuePolicy.quarantineRevenueRow` đẩy nó về `UNALLOCATED`. Tiền vẫn nằm
 * trong doanh thu công ty, nhưng không vào doanh số NV Sale nào ⇒ App Report và App
 * Sale lệch đúng khoản này.
 *
 * ‼ CEO ra lệnh rõ: **"Báo lại 1 cái tên đề xuất kèm căn cứ… Hai nguồn mâu thuẫn
 * nhau, hoặc không tra ra ai → nói thẳng 'không xác định được' kèm số liệu đã tra.
 * CẤM ĐOÁN."**
 *
 * File này là phần **QUYẾT ĐỊNH** — hàm thuần, không truy vấn, không ghi. Phần **lấy
 * dữ liệu** nằm ở `scripts/propose_quarantine_owner.js` (cần DB thật). Tách ra vì:
 *   · luật gán chủ là chỗ dễ sai và phải cãi nhau với CEO ⇒ phải test được offline;
 *   · Claude không có đường vào PROD, nhưng vẫn phải chốt được LUẬT trước.
 *
 * Hai nguồn căn cứ, đúng thứ tự CEO yêu cầu:
 *   ① **Danh mục phân công** (`unit_product_employees`) — bảng phân công chính thức.
 *   ② **Lịch sử doanh thu** của chính đơn vị đó trong các kỳ gần nhất.
 * Hai nguồn khớp nhau ⇒ chắc. Chỉ một nguồn có ⇒ vẫn đề xuất, nhưng ghi rõ độ chắc.
 * Hai nguồn chỏi nhau ⇒ **KHÔNG đề xuất**, trả về CONFLICT kèm cả hai bảng số.
 */

const employeeRevenuePolicy = require('./employeeRevenuePolicy');

/** Chiếm ưu thế bao nhiêu thì mới dám đề xuất khi đơn vị có nhiều NV cùng bán. */
const DOMINANT_LINE_SHARE = 0.8;

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Mã này có được nhận doanh thu NV Sale không?
 * Loại: rỗng · UNALLOCATED · mã bị chính sách chặn (VP018 telesaler).
 * ‼ KHÔNG tự suy "VP* đều là văn phòng" — VP004 chưa từng được CEO xác nhận là
 * non-sale. Mã VP còn lại vẫn vào bảng nhưng bị gắn cờ `needsRoleCheck` để người
 * đọc thấy mà hỏi lại, thay vì bị xoá lặng lẽ.
 */
function attributableEmp(empCode) {
  const emp = upper(empCode);
  if (!emp || emp === 'UNALLOCATED' || emp === 'NULL') return '';
  if (employeeRevenuePolicy.isRevenueAttributionBlocked(emp)) return '';
  return emp;
}

const needsRoleCheck = (empCode) => /^VP\d+$/.test(upper(empCode));

/**
 * ② Đếm doanh thu của đơn vị theo từng NV.
 * @param {Array} lines  dòng doanh thu MISA/App Sale của ĐÚNG đơn vị đang xét
 * @returns {Array} [{ emp, empName, lines, orders, amount, share, needsRoleCheck }] giảm dần
 */
function tallyRevenueByEmployee(lines = []) {
  const byEmp = new Map();
  let totalLines = 0;
  for (const line of Array.isArray(lines) ? lines : []) {
    const emp = attributableEmp(line?.employee_code ?? line?.emp_code);
    if (!emp) continue;                                  // dòng cách ly không tự bầu cho ai
    totalLines += 1;
    const hit = byEmp.get(emp) || {
      emp, empName: text(line?.employee_name ?? line?.emp_name),
      lines: 0, orders: new Set(), amount: 0, needsRoleCheck: needsRoleCheck(emp),
    };
    hit.lines += 1;
    const order = text(line?.sale_order_no ?? line?.order_code ?? line?.source_order);
    if (order) hit.orders.add(order);
    hit.amount += num(line?.invoice_export_amount ?? line?.revenue ?? line?.amount);
    if (!hit.empName) hit.empName = text(line?.employee_name ?? line?.emp_name);
    byEmp.set(emp, hit);
  }
  return [...byEmp.values()]
    .map((hit) => ({
      ...hit,
      orders: hit.orders.size,
      amount: Math.round(hit.amount),
      share: totalLines ? hit.lines / totalLines : 0,
    }))
    .sort((a, b) => b.lines - a.lines || b.amount - a.amount || a.emp.localeCompare(b.emp));
}

/**
 * ① Đọc bảng phân công của đơn vị.
 * @param {Array} catalogRows [{ unit_code, qlnb_code, emp_code, emp_name, nv_cnt }]
 * @returns {Array} [{ emp, empName, pairs, products, needsRoleCheck }] giảm dần
 */
function tallyCatalogByEmployee(catalogRows = []) {
  const byEmp = new Map();
  for (const row of Array.isArray(catalogRows) ? catalogRows : []) {
    // Cặp đơn vị+mã hàng đang do NHIỀU NV giữ thì bản thân danh mục đã mập mờ —
    // không được lấy làm căn cứ, nhưng phải kể ra ở phần ghi chú.
    if (Number(row?.nv_cnt) > 1) continue;
    const emp = attributableEmp(row?.emp_code);
    if (!emp) continue;
    const hit = byEmp.get(emp) || {
      emp, empName: text(row?.emp_name), pairs: 0, products: new Set(), needsRoleCheck: needsRoleCheck(emp),
    };
    hit.pairs += 1;
    const product = upper(row?.qlnb_code);
    if (product) hit.products.add(product);
    if (!hit.empName) hit.empName = text(row?.emp_name);
    byEmp.set(emp, hit);
  }
  return [...byEmp.values()]
    .map((hit) => ({ ...hit, products: [...hit.products].sort() }))
    .sort((a, b) => b.pairs - a.pairs || a.emp.localeCompare(b.emp));
}

/** Cặp đơn vị+mã hàng đang do nhiều NV giữ — danh mục tự mâu thuẫn, phải nói ra. */
function ambiguousCatalogPairs(catalogRows = []) {
  return (Array.isArray(catalogRows) ? catalogRows : [])
    .filter((row) => Number(row?.nv_cnt) > 1)
    .map((row) => ({ unit: upper(row?.unit_code), product: upper(row?.qlnb_code), count: Number(row.nv_cnt) }));
}

/**
 * ‼ CHẨN ĐOÁN ĐÚNG CẶP CỦA ĐƠN ĐANG HỎI — thêm 06/08/2026 04:45.
 *
 * Vì sao cần: App Sale đã gán tay `DH479816174` → DN001 lúc 16:39 ngày 05/08, nhưng ô
 * KPI "Doanh thu chưa phân bổ" vẫn hiện **1.795.600đ**. Nguyên nhân đã phân tích:
 * `appSaleRevenueMirror.CRM_ROWS_SQL` **ưu tiên bảng phân công** (`unit_product_employees`,
 * khi cặp chỉ có 1 NV) hơn `employee_code` của dòng MISA. Sửa dòng MISA vì thế **không
 * ăn thua** — phải sửa **đúng cặp (đơn vị × mã hàng)** trong bảng phân công.
 *
 * Hàm này chỉ ra **chính xác cặp nào** cần sửa và **sửa kiểu gì**, để bot khỏi phải
 * chạy thêm truy vấn rồi hỏi vòng qua lại — còn 2 ngày tới hạn khoá sổ 08/08.
 *
 * @returns {{found:boolean, productCode:string, lines:number, amount:number,
 *            inCatalog:boolean, nvCount:number, emps:string[], verdict:string, action:string}}
 */
function diagnoseOrderPair({ orderCode = '', unitCode = '', lines = [], catalogRows = [] } = {}) {
  const wanted = text(orderCode).toUpperCase();
  const own = (Array.isArray(lines) ? lines : []).filter((line) => (
    text(line?.sale_order_no ?? line?.order_code ?? line?.source_order).toUpperCase() === wanted
  ));
  const base = { found: false, productCode: '', lines: 0, amount: 0, inCatalog: false, nvCount: 0, emps: [] };
  if (!own.length) {
    return {
      ...base, unitCode: upper(unitCode), orderCode: wanted,
      verdict: 'KHÔNG TÌM THẤY ĐƠN trong khoảng ngày đang tra',
      action: 'Kiểm lại mã đơn và khoảng --from/--to trước khi kết luận. CẤM suy ra "đơn đã hết cách ly".',
    };
  }
  const productCode = upper(own[0]?.qlnb_code ?? own[0]?.iit_code ?? own[0]?.product_code);
  const amount = Math.round(own.reduce((sum, line) => sum + num(line?.invoice_export_amount ?? line?.revenue ?? line?.amount), 0));
  // Mọi NV mà danh mục đang gán cho ĐÚNG cặp này (kể cả cặp đang gán nhiều người).
  const pairRows = (Array.isArray(catalogRows) ? catalogRows : [])
    .filter((row) => upper(row?.qlnb_code) === productCode);
  const nvCount = pairRows.reduce((max, row) => Math.max(max, Number(row?.nv_cnt) || 0), 0);
  const emps = [...new Set(pairRows.map((row) => upper(row?.emp_code)).filter(Boolean))].sort();
  const hit = { ...base, found: true, unitCode: upper(unitCode), orderCode: wanted, productCode, lines: own.length, amount, inCatalog: !!pairRows.length, nvCount, emps };

  if (!pairRows.length) {
    return { ...hit,
      verdict: 'CẶP THIẾU trong bảng phân công ⇒ App Report phải rơi về mã NV của dòng MISA, nên vẫn cách ly',
      action: `App Sale: THÊM cặp (${upper(unitCode)} × ${productCode}) vào unit_product_employees, gán ĐÚNG MỘT NV.` };
  }
  if (nvCount > 1) {
    return { ...hit,
      verdict: `CẶP ĐANG GÁN ${nvCount} NV (${emps.join(', ')}) ⇒ danh mục mập mờ, App Report không dám lấy`,
      action: `App Sale: GỠ còn ĐÚNG MỘT NV cho cặp (${upper(unitCode)} × ${productCode}).` };
  }
  return { ...hit,
    verdict: `Cặp đã có, gán đúng 1 NV (${emps[0] || '—'}) ⇒ đường phân công KHÔNG còn lỗi`,
    action: 'Vẫn còn cách ly thì lỗi nằm ở đường dựng dữ liệu, KHÔNG phải bảng phân công — dừng và báo Claude.' };
}

const DECISIONS = Object.freeze({
  CATALOG_AND_REVENUE: { code: 'PROPOSE', strength: 'chắc', note: 'danh mục phân công VÀ lịch sử doanh thu cùng chỉ một người' },
  CATALOG_ONLY: { code: 'PROPOSE', strength: 'khá chắc', note: 'danh mục phân công chỉ một người; đơn vị chưa có lịch sử doanh thu để đối chiếu' },
  REVENUE_ONLY: { code: 'PROPOSE', strength: 'khá chắc', note: 'toàn bộ doanh thu của đơn vị này thuộc một người; danh mục chưa khai' },
  DOMINANT: { code: 'PROPOSE', strength: 'yếu — CEO cân nhắc', note: 'đơn vị có nhiều NV, nhưng một người giữ áp đảo' },
  CONFLICT: { code: 'CONFLICT', strength: '—', note: 'hai nguồn chỉ hai người khác nhau — KHÔNG đoán' },
  SPLIT: { code: 'CONFLICT', strength: '—', note: 'nhiều NV cùng bán đơn vị này, không ai áp đảo — KHÔNG đoán' },
  UNKNOWN: { code: 'UNKNOWN', strength: '—', note: 'không nguồn nào tra ra ai' },
});

/**
 * Chốt đề xuất.
 * @returns {{
 *   decision:'PROPOSE'|'CONFLICT'|'UNKNOWN', candidate:string, candidateName:string,
 *   strength:string, reason:string, revenue:Array, catalog:Array, warnings:string[]
 * }}
 */
function proposeOwner({ unitCode = '', orderCode = '', lines = [], catalogRows = [], dominantShare = DOMINANT_LINE_SHARE } = {}) {
  const revenue = tallyRevenueByEmployee(lines);
  const catalog = tallyCatalogByEmployee(catalogRows);
  const warnings = [];
  const ambiguous = ambiguousCatalogPairs(catalogRows);
  if (ambiguous.length) {
    warnings.push(`Danh mục có ${ambiguous.length} cặp đơn vị+mã hàng đang gán nhiều NV — đã bỏ khỏi căn cứ: `
      + ambiguous.slice(0, 5).map((item) => `${item.product}(${item.count} NV)`).join(', '));
  }
  for (const item of [...revenue, ...catalog]) {
    if (item.needsRoleCheck) warnings.push(`${item.emp} là mã văn phòng — phải xác nhận có phải NV Sale không trước khi gán.`);
  }

  const base = { unitCode: upper(unitCode), orderCode: text(orderCode), revenue, catalog, warnings: [...new Set(warnings)] };
  const decide = (kind, emp) => {
    const meta = DECISIONS[kind];
    const from = revenue.find((item) => item.emp === emp) || catalog.find((item) => item.emp === emp) || {};
    return { ...base, decision: meta.code, candidate: emp || '', candidateName: from.empName || '', strength: meta.strength, reason: meta.note };
  };

  const catalogEmps = catalog.map((item) => item.emp);
  const revenueEmps = revenue.map((item) => item.emp);

  if (!catalogEmps.length && !revenueEmps.length) return decide('UNKNOWN', '');

  // Danh mục chỉ đúng một người — đây là bảng phân công chính thức, ưu tiên cao nhất.
  if (catalogEmps.length === 1) {
    const emp = catalogEmps[0];
    if (!revenueEmps.length) return decide('CATALOG_ONLY', emp);
    if (revenueEmps.length === 1 && revenueEmps[0] === emp) return decide('CATALOG_AND_REVENUE', emp);
    // Doanh thu có người khác ⇒ hai nguồn chỏi nhau. Dù người trong danh mục cũng
    // đang bán, vẫn phải để CEO nhìn cả hai bảng rồi quyết — cấm tự chọn.
    return { ...decide('CONFLICT', ''), reason: DECISIONS.CONFLICT.note };
  }
  if (catalogEmps.length > 1) return { ...decide('CONFLICT', ''), reason: 'danh mục phân công đơn vị này cho nhiều NV — KHÔNG đoán' };

  // Danh mục trống ⇒ chỉ còn lịch sử doanh thu.
  if (revenueEmps.length === 1) return decide('REVENUE_ONLY', revenueEmps[0]);
  const top = revenue[0];
  if (top && top.share >= dominantShare) {
    const result = decide('DOMINANT', top.emp);
    result.reason = `${DECISIONS.DOMINANT.note} (${top.lines}/${revenue.reduce((sum, item) => sum + item.lines, 0)} dòng`
      + ` = ${Math.round(top.share * 100)}%)`;
    return result;
  }
  return { ...decide('SPLIT', ''), reason: DECISIONS.SPLIT.note };
}

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;

/** In ra dạng người đọc được — CEO chỉ cần nhìn một màn là gật hoặc lắc. */
function formatProposal(result) {
  const out = [];
  const icon = result.decision === 'PROPOSE' ? '✅' : result.decision === 'CONFLICT' ? '⛔' : '❓';
  out.push(`ĐỀ XUẤT CHỦ CHO DÒNG CÁCH LY — đơn vị ${result.unitCode || '—'}${result.orderCode ? ` · đơn ${result.orderCode}` : ''}`);
  out.push('');
  if (result.decision === 'PROPOSE') {
    out.push(`${icon} ĐỀ XUẤT: ${result.candidate}${result.candidateName ? ` — ${result.candidateName}` : ''}`);
    out.push(`   Độ chắc: ${result.strength} · căn cứ: ${result.reason}`);
  } else {
    out.push(`${icon} KHÔNG XÁC ĐỊNH ĐƯỢC — ${result.reason}`);
    out.push('   (Theo lệnh CEO: cấm đoán. Dưới đây là toàn bộ số đã tra.)');
  }
  out.push('');
  out.push('① DANH MỤC PHÂN CÔNG (unit_product_employees)');
  if (!result.catalog.length) out.push('   — không có dòng nào cho đơn vị này');
  for (const item of result.catalog) {
    out.push(`   ${item.emp.padEnd(8)} ${String(item.empName || '').padEnd(24)} ${item.pairs} cặp mã hàng`
      + `${item.products.length ? ` (${item.products.slice(0, 6).join(', ')}${item.products.length > 6 ? '…' : ''})` : ''}`);
  }
  out.push('');
  out.push('② LỊCH SỬ DOANH THU CỦA ĐƠN VỊ');
  if (!result.revenue.length) out.push('   — không có dòng nào gán được cho NV Sale');
  for (const item of result.revenue) {
    out.push(`   ${item.emp.padEnd(8)} ${String(item.empName || '').padEnd(24)} ${item.lines} dòng · ${item.orders} đơn · `
      + `${money(item.amount)} · ${Math.round(item.share * 100)}%`);
  }
  if (result.pair) {
    const p = result.pair;
    out.push('');
    out.push(`③ CẶP CỦA ĐƠN ĐANG HỎI — ${p.orderCode}`);
    if (!p.found) out.push(`   ⛔ ${p.verdict}`);
    else {
      out.push(`   Mã hàng: ${p.productCode} · ${p.lines} dòng · ${money(p.amount)}`);
      out.push(`   Trong bảng phân công: ${p.inCatalog ? `CÓ · ${p.nvCount} NV (${p.emps.join(', ') || '—'})` : 'KHÔNG'}`);
      out.push(`   ⇒ ${p.verdict}`);
    }
    out.push(`   ➜ VIỆC CẦN LÀM: ${p.action}`);
  }
  if (result.warnings.length) {
    out.push('');
    out.push('⚠ LƯU Ý');
    for (const warning of result.warnings) out.push(`   · ${warning}`);
  }
  return out.join('\n');
}

module.exports = {
  DOMINANT_LINE_SHARE, DECISIONS,
  attributableEmp, tallyRevenueByEmployee, tallyCatalogByEmployee, ambiguousCatalogPairs, diagnoseOrderPair,
  proposeOwner, formatProposal,
};
