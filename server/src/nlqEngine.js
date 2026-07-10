'use strict';
/**
 * nlqEngine.js — NLQ Mức 3: PLANNER → EXECUTOR → NARRATOR.
 * LLM chỉ lập kế hoạch JSON; mọi số liệu do Executor chạy trên dòng doanh thu đã scope quyền.
 */
const store = require('./store');
const A = require('./analytics');
const llm = require('./llm');
const auth = require('./auth');
const { noAccent } = require('./nlqIntent');

const GROUP = {
  unit: ['unit_code', 'unit_name'], product: ['iit_code', 'product_name'], emp: ['emp_code', 'emp_name'],
  contractor: ['contractor_code', 'contractor_name'], bid_package: ['bid_package', 'bid_package'],
  province: ['province', 'province'], route: ['route', 'route'], source: ['source', 'source'], day: ['date', 'date'], order: ['source_order', 'source_order'],
};
const DIM_LABEL = { unit: 'đơn vị', product: 'sản phẩm', emp: 'nhân viên', contractor: 'nhà thầu', bid_package: 'gói thầu', province: 'tỉnh', route: 'tuyến', source: 'nguồn', day: 'ngày', order: 'đơn hàng' };
const SOURCE_ALIASES = { misa: 'CRM_MISA', crm: 'CRM_MISA', web: 'APP_WEB_PARTNER', app: 'APP_WEB_PARTNER', partner: 'APP_WEB_PARTNER' };

function norm(s) { return noAccent(String(s || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').replace(/\bpkdk\b/g, 'phong kham da khoa').trim(); }
function fmt(n) { return `${Math.round(Number(n || 0)).toLocaleString('vi-VN')}đ`; }
function fmtNum(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function pct(n) { return `${Number(n || 0) >= 0 ? '+' : ''}${Number(n || 0).toFixed(1).replace('.', ',')}%`; }
function kyLabel(ky) { const [m, y] = String(ky || '').split('.'); return m && y ? `T${m}/${y}` : String(ky || ''); }
function ymd(d) { return d.toISOString().slice(0, 10); }
function parseYmd(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
function addDays(s, delta) { const d = parseYmd(s); if (!d) return ''; d.setUTCDate(d.getUTCDate() + delta); return ymd(d); }
function kyToRange(ky) { const [mm, yyyy] = String(ky || '').split('.').map(Number); const last = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate(); return { from: `${yyyy}-${String(mm).padStart(2, '0')}-01`, to: `${yyyy}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}`, days: last }; }
function latestDataDate(ky = store.latestKy(), scope = {}) {
  let latest = '';
  for (const r of store.getRows({ ky, scope })) {
    const d = String(r.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > latest) latest = d;
  }
  const p = store.listPeriods().find((x) => x.ky === ky);
  if (!latest && p) {
    const from = String(p.dateFrom || '').slice(0, 10);
    let d = String(p.data_as_of || p.dataAsOf || p.uploadedAt || '').slice(0, 10);
    const to = String(p.dateTo || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || (from && d < from) || (to && d > to)) d = from;
    latest = d;
  }
  return latest || ymd(new Date());
}
function monthMention(q, currentKy) {
  const nq = norm(q);
  const names = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
  const m = nq.match(/\b(?:thang|t|month)\s*0?([1-9]|1[0-2])\b(?:[ ./-]*(20\d{2}|\d{2}))?/i);
  const dm = nq.match(/\b\d{1,2}\s*[/-]\s*([1-9]|1[0-2])\b(?:\s*[/-]\s*(20\d{2}|\d{2}))?/);
  let mm = m?.[1] ? String(m[1]).padStart(2, '0') : (dm?.[1] ? String(dm[1]).padStart(2, '0') : null);
  for (const [k, v] of Object.entries(names)) if (new RegExp(`\\b${k}\\b`).test(nq)) mm = v;
  if (!mm) return null;
  let y = m?.[2] || dm?.[2] || String(currentKy || store.latestKy()).slice(3);
  if (String(y).length === 2) y = `20${y}`;
  return `${mm}.${y}`;
}
function explicitLimit(q) {
  const m = q.match(/top\s*(\d{1,2})|\b(?:lay|xem|liet ke|hien)\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:don hang|dong|muc|san pham|mat hang|ma hang|don vi|benh vien|nv|nhan vien)\b/);
  const n = Number(m?.[1] || m?.[2] || m?.[3] || 0);
  return n > 0 ? Math.min(50, Math.max(1, n)) : null;
}
function wantsFullList(q) {
  return /chi tiet|tat ca|toan bo|day du|liet ke day du|danh sach|lay het|het cac|cac mat hang|cac san pham|cac ma hang/.test(q);
}
function explicitRanking(q) {
  return /\btop\b|cao nhat|lon nhat|nhieu nhat|ban chay|dan dau|dung dau|xep hang|ranking/.test(q);
}
function fallbackPlan(question, ctx = {}) {
  const q = norm(question);
  const period = monthMention(q, ctx.currentPeriod) || (/(thang nay|month this|this month)/.test(q) ? 'current' : null);
  const topN = explicitLimit(q);
  const source = /\bmisa\b|crm/.test(q) ? 'CRM_MISA' : (/\bweb\b|partner|app web/.test(q) ? 'APP_WEB_PARTNER' : null);
  let groupBy = null;
  if (/don hang|order/.test(q)) groupBy = 'order';
  else if (/san pham|thuoc|mat hang|ma hang|ma thuoc|qlnb|product|vixcar/.test(q)) groupBy = /ai ban|nhan vien nao|who/.test(q) ? 'emp' : 'product';
  else if (/nhan vien|\bnv\b|sale/.test(q)) groupBy = 'emp';
  else if (/tuyen|route/.test(q)) groupBy = 'route';
  else if (/nha thau|contractor/.test(q)) groupBy = 'contractor';
  else if (/tinh|province/.test(q)) groupBy = 'province';
  else if (/nguon|source|misa|web/.test(q)) groupBy = source ? null : 'source';
  else if (/don vi|benh vien|bv|hospital|khach hang/.test(q)) groupBy = 'unit';
  let answerType = groupBy ? (topN || explicitRanking(q) ? 'ranking' : 'breakdown') : 'aggregate';
  if (/on khong|nen|uu tien|tu van|phan tich|ổn không/.test(question)) answerType = 'advisory';
  if (/so voi|so sanh|thang truoc|hom qua|giam manh|giam nhieu|tang giam/.test(q)) answerType = 'comparison';
  const day = /\btu\b|tu ngay|den hom nay|toi hom nay/.test(q) ? null : (/hom nay|today/.test(q) ? 'today' : (/hom qua|yesterday/.test(q) ? 'yesterday' : null));
  const filters = { unitHint: null, productHint: null, empHint: null, contractorHint: null, route: null, provinceHint: null, source };
  const mUnitHint = q.match(/\b(?:o|tai|cua|trong|ben)\s+(.+?)(?:\s+(?:tu ngay|tu\s+ngay|tu|den|toi|thang|hom nay|ky|co doanh thu|dat)\b|$)/);
  const uh = mUnitHint?.[1]?.trim();
  if (uh && !/^(toi|minh|em|anh|chi|nhung|cac|top|ngay|dau|nhan vien|nv|san pham|mat hang|ma hang)\b/.test(uh)) filters.unitHint = uh;
  const mUnitCode = q.match(/\b\d{3}\b/); if (!filters.unitHint && mUnitCode) filters.unitHint = mUnitCode[0];
  if (/dong nai|bvdk/.test(q) && /o|tai|hospital|benh vien|bvdk/.test(q)) filters.unitHint ||= question.match(/BVĐK Đồng Nai|bvdk dong nai|Dong Nai hospital|benh vien dong nai/i)?.[0] || 'dong nai';
  if (/benh vien dong nai/.test(q) && !/thong nhat/.test(q)) filters.unitHint = 'benh vien da khoa dong nai';
  if (filters.unitHint) filters.unitHint = String(filters.unitHint)
    .replace(/^don vi\s+/, '')
    .replace(/\bpkdk\b/g, 'phong kham da khoa')
    .replace(/\bbvdk\b/g, 'benh vien da khoa')
    .replace(/\bbv\b/g, 'benh vien')
    .trim();
  if (/vixcar/.test(q)) filters.productHint = 'Vixcar';
  if (/\bcl\b/.test(q)) filters.route = 'CL'; else if (/\bncl\b/.test(q)) filters.route = 'NCL'; else if (/\bnt\b/.test(q)) filters.route = 'NT';
  return { answerType, metric: 'revenue', groupBy, filters, period: period || 'current', day, topN, splitBySource: /5\s*misa\s*5\s*web|misa.*web|web.*misa/.test(q), sort: 'desc', selfScoped: /cua toi|toi\s+(ban|da|co|can|muon|xem|hoi)|my\b|me\b/.test(q), compare: answerType === 'comparison' ? 'prev' : 'none', needClarify: null };
}
function normalizePlan(p, question, ctx) {
  const base = fallbackPlan(question, ctx);
  const out = { ...base, ...(p && typeof p === 'object' ? p : {}) };
  const qn = norm(question);
  out.filters = { ...base.filters, ...(out.filters || {}) };
  if (!['aggregate', 'breakdown', 'ranking', 'orders', 'comparison', 'advisory'].includes(out.answerType)) out.answerType = base.answerType;
  if (!['revenue', 'quantity', 'count', 'points', 'xu'].includes(out.metric)) out.metric = 'revenue';
  if (!GROUP[out.groupBy]) out.groupBy = null;
  if (out.answerType === 'orders') out.groupBy = 'order';
  if (out.groupBy === 'order') out.answerType = 'orders';
  const qLimit = explicitLimit(qn);
  const qWantsFull = wantsFullList(qn);
  const qExplicitRanking = explicitRanking(qn);
  if (qWantsFull && !qLimit && !qExplicitRanking) {
    out.answerType = out.groupBy ? 'breakdown' : out.answerType;
    out.topN = null;
  } else if (out.topN == null) {
    out.topN = out.answerType === 'ranking' && out.groupBy ? 10 : null;
  } else {
    out.topN = Math.min(50, Math.max(1, Number(out.topN) || 10));
  }
  if (out.answerType === 'breakdown' && !qLimit && !qExplicitRanking) out.topN = null;
  out.sort = out.sort === 'asc' ? 'asc' : 'desc';
  out.compare = out.compare === 'prev' ? 'prev' : 'none';
  out.splitBySource = !!out.splitBySource || /misa.*web|web.*misa|5\s*misa\s*5\s*web/.test(qn);
  if (out.splitBySource && /5\s*misa\s*5\s*web/.test(qn)) out.topN = 5;
  out.selfScoped = !!out.selfScoped;
  if (out.answerType === 'advisory') out.needClarify = null;
  for (const k of ['unitHint', 'productHint', 'empHint', 'contractorHint', 'provinceHint']) if (out.filters[k] === 'null' || out.filters[k] === '') out.filters[k] = null;
  if (out.filters.source) out.filters.source = SOURCE_ALIASES[norm(out.filters.source)] || out.filters.source;
  return out;
}
async function plan(question, ctx) {
  let p = null;
  if (llm.isEnabled() && llm.planQuery) p = await llm.planQuery(question, ctx);
  return normalizePlan(p, question, ctx);
}
function periodFor(planObj) {
  const ky = !planObj.period || planObj.period === 'current' ? store.latestKy() : planObj.period;
  return store.periodKys().includes(ky) ? ky : null;
}
function metricValue(rows, metric) {
  if (metric === 'quantity') return rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
  if (metric === 'count') return rows.length;
  return rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
}
function metricLabel(metric) { return metric === 'quantity' ? 'SL' : (metric === 'count' ? 'Số dòng' : 'Doanh thu'); }
function formatMetric(v, metric) { return metric === 'revenue' ? fmt(v) : fmtNum(v); }
function uniqueHints(rows, fields, hint) {
  const nq = norm(hint);
  const map = new Map();
  for (const r of rows) {
    const key = String(r[fields[0]] || '').trim(); if (!key) continue;
    const label = String(r[fields[1]] || key).trim();
    const hay = norm(`${key} ${label}`);
    if (hay.includes(nq) || nq.includes(norm(key)) || norm(key).includes(nq)) {
      const cur = map.get(key) || { key, label, revenue: 0, rows: 0 };
      cur.revenue += Number(r.revenue || 0); cur.rows += 1; map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
}
function applyHint(rows, hint, fields, label) {
  if (!hint) return { rows };
  const hits = uniqueHints(rows, fields, hint);
  if (!hits.length) return { rows: [], note: `Không tìm thấy ${label} khớp “${hint}”.` };
  const nq = norm(hint);
  // Khớp CỤ THỂ nhất trước khi hỏi lại: (1) trùng khít mã / mã+tên; (2) câu CHỨA nguyên mã
  // đơn vị -> chọn mã DÀI (cụ thể) nhất. Bắt buộc vì mã cha "034.PKĐK Y ĐỨC" là TIỀN TỐ của
  // mọi mã con "034.PKĐK Y ĐỨC <chi nhánh>": nếu không ưu tiên mã dài sẽ hỏi lại vô tận (cha
  // luôn khớp chuỗi con). Chỉ auto-chọn khi mã dài nhất DÀI HƠN hẳn mã kế (không hoà -> mới hỏi).
  let pick = hits.find((h) => norm(h.key) === nq) || hits.find((h) => norm(`${h.key} ${h.label}`) === nq);
  if (!pick) {
    const contained = hits.filter((h) => nq.includes(norm(h.key))).sort((a, b) => norm(b.key).length - norm(a.key).length);
    if (contained.length && (contained.length === 1 || norm(contained[0].key).length !== norm(contained[1].key).length)) pick = contained[0];
  }
  if (pick) return { rows: rows.filter((r) => String(r[fields[0]] || '') === pick.key), chosen: pick };
  // MÃ TRẦN (vd "034"/"034*") là "HỌ MÃ" dùng chung cho nhiều chi nhánh (034.PKĐK Y ĐỨC + …TRẢNG
  // BOM/…TRỊ AN…). Hỏi rộng "tất cả đơn vị mã 034" phải trả CẢ HỌ để liệt kê — KHÔNG thu về 1 đơn vị,
  // KHÔNG hỏi lại. (Khác với hint có tên -> đã resolve cụ thể ở khối `pick` phía trên.)
  const bareCode = /^0*\d{3}\s*\*?$/.test(String(hint).trim());
  if (hits.length > 1 && bareCode && new Set(hits.map((h) => norm(h.label))).size > 1) {
    const keys = new Set(hits.map((h) => h.key));
    return { rows: rows.filter((r) => keys.has(String(r[fields[0]] || ''))), chosen: { key: [...keys].join(','), label: `mã ${String(hint).trim().replace(/[^\d]/g, '')}` } };
  }
  if (hits.length > 1 && !/^\d{3}\*?$/.test(String(hint).trim())) {
    const sameLabel = new Set(hits.map((h) => norm(h.label))).size === 1;
    if (sameLabel) {
      const keys = new Set(hits.map((h) => h.key));
      return { rows: rows.filter((r) => keys.has(String(r[fields[0]] || ''))), chosen: { ...hits[0], key: [...keys].join(',') } };
    }
    return { clarify: `Em thấy nhiều ${label} khớp “${hint}”. Anh/Chị muốn hỏi mã nào?`, options: hits.map((h) => `${h.key}: ${h.label}`) };
  }
  const key = hits[0].key;
  return { rows: rows.filter((r) => String(r[fields[0]] || '') === key), chosen: hits[0] };
}
function applyFilters(rows, planObj) {
  const f = planObj.filters || {};
  let out = rows;
  if (f.source) out = out.filter((r) => r.source === f.source);
  if (f.route) out = out.filter((r) => String(r.route || '').toUpperCase() === String(f.route).toUpperCase());
  let x = applyHint(out, f.unitHint, ['unit_code', 'unit_name'], 'đơn vị'); if (x.clarify || x.note) return x; out = x.rows;
  x = applyHint(out, f.productHint, ['iit_code', 'product_name'], 'sản phẩm'); if (x.clarify || x.note) return x; out = x.rows;
  x = applyHint(out, f.empHint, ['emp_code', 'emp_name'], 'nhân viên'); if (x.clarify || x.note) return x; out = x.rows;
  x = applyHint(out, f.contractorHint, ['contractor_code', 'contractor_name'], 'nhà thầu'); if (x.clarify || x.note) return x; out = x.rows;
  x = applyHint(out, f.provinceHint, ['province', 'province'], 'tỉnh'); if (x.clarify || x.note) return x; out = x.rows;
  return { rows: out };
}
function dayRange(planObj, ky, scope) {
  const latest = latestDataDate(ky, scope);
  if (planObj.day === 'today') return { from: latest, to: latest, label: 'hôm nay' };
  if (planObj.day === 'yesterday') { const d = addDays(latest, -1); return { from: d, to: d, label: 'hôm qua' }; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(planObj.day || ''))) return { from: planObj.day, to: planObj.day, label: planObj.day };
  return null;
}
function groupRows(rows, groupBy, metric, sort = 'desc') {
  if (!groupBy) return [];
  const [kf, lf] = GROUP[groupBy];
  const map = new Map();
  for (const r of rows) {
    const key = String(r[kf] || '—');
    const cur = map.get(key) || { key, label: r[lf] || key, revenue: 0, quantity: 0, count: 0, source: r.source || '' };
    cur.revenue += Number(r.revenue || 0); cur.quantity += Number(r.quantity || 0); cur.count += 1; map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => (sort === 'asc' ? 1 : -1) * (metricValue([a], metric) - metricValue([b], metric)));
}
function compareGroups({ rows, ky, scope, metric, groupBy, dateRange, sort = 'desc' }) {
  const prevs = store.previousKys([ky]);
  const prevKy = prevs[0];
  if (!prevKy || !groupBy) return [];
  let prevRows = store.getRows({ ky: prevKy, scope });
  let label = `so ${kyLabel(prevKy)}`;
  if (dateRange) {
    const day = Number(dateRange.to.slice(8, 10));
    const prevRange = kyToRange(prevKy);
    const factor = Math.min(1, day / prevRange.days);
    label = `so nhịp ${kyLabel(prevKy)} (${day}/${prevRange.days} ngày)`;
    // Với period-level kỳ cũ không thể lọc ngày; dùng pacing trên từng nhóm.
    const cur = groupRows(rows, groupBy, metric, 'desc');
    const prev = groupRows(prevRows, groupBy, metric, 'desc');
    const pm = new Map(prev.map((x) => [x.key, metricValue([x], metric)]));
    return cur.map((x) => { const base = Math.round((pm.get(x.key) || 0) * factor); const val = metricValue([x], metric); return { ...x, cur: val, prevPaced: base, delta: val - base, pct: base ? ((val - base) / base) * 100 : null, compareLabel: label }; })
      .sort((a, b) => sort === 'asc' ? a.delta - b.delta : b.delta - a.delta);
  }
  const fresh = store.periodFreshness(ky);
  let factor = 1;
  if (!fresh.complete && fresh.dayCovered) { const prevRange = kyToRange(prevKy); factor = Math.min(1, fresh.dayCovered / prevRange.days); label = `so nhịp ${kyLabel(prevKy)} (${fresh.dayCovered}/${prevRange.days} ngày)`; }
  const cur = groupRows(rows, groupBy, metric, 'desc');
  const prev = groupRows(prevRows, groupBy, metric, 'desc');
  const pm = new Map(prev.map((x) => [x.key, metricValue([x], metric)]));
  return cur.map((x) => { const base = Math.round((pm.get(x.key) || 0) * factor); const val = metricValue([x], metric); return { ...x, cur: val, prevPaced: base, delta: val - base, pct: base ? ((val - base) / base) * 100 : null, compareLabel: label }; })
    .sort((a, b) => sort === 'asc' ? a.delta - b.delta : b.delta - a.delta);
}
function comparePrev({ rows, ky, scope, metric, dateRange, compareDayPrev = false }) {
  const prevs = store.previousKys([ky]);
  const prevKy = prevs[0];
  if (!prevKy) return null;
  const curVal = metricValue(rows, metric);
  if (compareDayPrev && dateRange) {
    const prevDay = addDays(dateRange.to, -1);
    const prevRowsDay = A.applyFilters(store.getRows({ ky, scope }), { dateFrom: prevDay, dateTo: prevDay });
    const baseDay = metricValue(prevRowsDay, metric);
    return { prevKy: ky, curVal, prevPaced: baseDay, delta: curVal - baseDay, pct: baseDay ? ((curVal - baseDay) / baseDay) * 100 : null, label: `so hôm qua (${prevDay.slice(8, 10)}/${prevDay.slice(5, 7)})` };
  }
  let prevRows = store.getRows({ ky: prevKy, scope });
  const filtered = applyFilters(prevRows, { filters: {} }); prevRows = filtered.rows || prevRows;
  let label = `so ${kyLabel(prevKy)}`;
  let base = metricValue(prevRows, metric);
  if (dateRange) {
    const day = Number(dateRange.to.slice(8, 10));
    const prevRange = kyToRange(prevKy);
    const factor = Math.min(1, day / prevRange.days);
    base = Math.round(base * factor);
    label = `so nhịp ${kyLabel(prevKy)} (${day}/${prevRange.days} ngày)`;
  } else {
    const fresh = store.periodFreshness(ky);
    if (!fresh.complete && fresh.dayCovered) {
      const prevRange = kyToRange(prevKy);
      const factor = Math.min(1, fresh.dayCovered / prevRange.days);
      base = Math.round(base * factor);
      label = `so nhịp ${kyLabel(prevKy)} (${fresh.dayCovered}/${prevRange.days} ngày)`;
    }
  }
  return { prevKy, curVal, prevPaced: base, delta: curVal - base, pct: base ? ((curVal - base) / base) * 100 : null, label };
}
async function execute(question, planObj, { scope = {}, session = {} } = {}) {
  if (planObj.needClarify) return { clarify: planObj.needClarify, plan: planObj };
  const isAdmin = auth.isAdmin(session?.role);
  const isEmployee = !isAdmin && (!!scope.empCode || session?.role === 'sale');
  const scoped = { ...(scope || {}) };
  if (isAdmin) delete scoped.empCode;
  if (isEmployee) scoped.empCode = scoped.empCode || session.emp_code;
  const qn = norm(question);
  const mentionedEmp = (qn.match(/\b(dn\d{3}|vp\d{3})\b/) || [])[1]?.toUpperCase();
  if (isEmployee && mentionedEmp && mentionedEmp !== String(scoped.empCode || '').toUpperCase()) {
    return { blocked: 'Anh/Chị chỉ được hỏi dữ liệu của chính mình; không được xem doanh thu nhân viên khác.' };
  }
  if (isEmployee && planObj.groupBy === 'emp' && (planObj.answerType === 'ranking' || planObj.answerType === 'breakdown')) {
    return { blocked: 'Anh/Chị chỉ được xem dữ liệu trong phạm vi của mình; xếp hạng/doanh thu theo nhân viên thuộc quyền CEO/admin.' };
  }
  // Chặn phạm vi: CHỈ khi thật sự hỏi TỔNG công ty / TẤT CẢ nhân viên.
  // KHÔNG bắt nhầm chữ "công ty" nằm trong TÊN pháp nhân của đơn vị (rất nhiều đơn vị
  // tên "CÔNG TY TNHH …/CỔ PHẦN …") — NV vẫn được xem PHẦN CỦA MÌNH ở đơn vị bất kỳ.
  const empScopeAsk = /\btat ca (nhan vien|nv)\b|\bnv khac\b|\bnhan vien khac\b|\bmoi nguoi\b|\btoan doi\b|\bca (team|doi)\b/.test(qn);
  const companyScopeAsk = /\b(toan|ca|toan bo) cong ty\b/.test(qn) || /\bdoanh thu cong ty\b/.test(qn) || /\bcong ty (minh|ban|em|toi|chung ta)\b/.test(qn);
  if (isEmployee && !planObj.selfScoped && (empScopeAsk || companyScopeAsk)) {
    return { blocked: 'Anh/Chị chỉ được hỏi dữ liệu trong phạm vi của chính mình trên App Report.' };
  }
  const ky = periodFor(planObj);
  if (!ky) return { text: `Kỳ ${planObj.period} chưa có dữ liệu trong App Report.` };
  let rows = store.getRows({ ky, scope: scoped });
  const dr = dayRange(planObj, ky, scoped);
  if (dr) rows = A.applyFilters(rows, { dateFrom: dr.from, dateTo: dr.to });
  const filtered = applyFilters(rows, planObj);
  if (filtered.clarify) return { clarify: filtered.clarify, options: filtered.options, plan: planObj };
  if (filtered.note) return { text: filtered.note, plan: planObj };
  rows = filtered.rows;
  const total = metricValue(rows, planObj.metric);
  let items = [];
  let advisoryFacts = null;
  if (planObj.groupBy) items = groupRows(rows, planObj.groupBy, planObj.metric, planObj.sort);
  if (planObj.splitBySource) {
    const sources = ['CRM_MISA', 'APP_WEB_PARTNER'];
    items = sources.flatMap((src) => groupRows(rows.filter((r) => r.source === src), planObj.groupBy || 'order', planObj.metric, planObj.sort).slice(0, planObj.topN || 5).map((x) => ({ ...x, source: src })));
  } else if (planObj.topN && items.length) items = items.slice(0, planObj.topN);
  const compareDayPrev = planObj.day === 'today' && /hom qua|yesterday/.test(qn);
  const cmp = planObj.answerType === 'comparison' || planObj.compare === 'prev' || planObj.answerType === 'advisory' ? comparePrev({ rows, ky, scope: scoped, metric: planObj.metric, dateRange: dr, compareDayPrev }) : null;
  const compareItems = (planObj.answerType === 'comparison' || planObj.compare === 'prev') && planObj.groupBy ? compareGroups({ rows, ky, scope: scoped, metric: planObj.metric, groupBy: planObj.groupBy, dateRange: dr, sort: /giam|sut|tut|decrease|down/.test(qn) ? 'asc' : 'desc' }).slice(0, planObj.topN || 10) : [];
  if (planObj.answerType === 'advisory') {
    advisoryFacts = {
      topProducts: groupRows(rows, 'product', 'revenue', 'desc').slice(0, 8),
      topUnits: groupRows(rows, 'unit', 'revenue', 'desc').slice(0, 8),
      bySource: groupRows(rows, 'source', 'revenue', 'desc'),
      weakUnits: compareGroups({ rows, ky, scope: scoped, metric: 'revenue', groupBy: 'unit', dateRange: dr, sort: 'asc' }).slice(0, 8),
      growthUnits: compareGroups({ rows, ky, scope: scoped, metric: 'revenue', groupBy: 'unit', dateRange: dr, sort: 'desc' }).slice(0, 8),
    };
  }
  const freshness = store.periodFreshness(ky);
  return { question, plan: planObj, ky, scope: scoped, isEmployee, rowsCount: rows.length, total, metric: planObj.metric, groupBy: planObj.groupBy, items, compare: cmp, compareItems, advisoryFacts, dayRange: dr, freshness };
}
function freshnessLine(f) { return (!f?.complete && f.throughDate) ? `📅 Dữ liệu tới ${f.throughDate.slice(8, 10)}/${f.throughDate.slice(5, 7)} (${f.dayCovered}/${f.daysInMonth} ngày) — kỳ đang cập nhật.` : ''; }
function itemLine(x, metric, groupBy, i) {
  const val = formatMetric(metricValue([x], metric), metric);
  const prefix = x.source ? `[${x.source === 'CRM_MISA' ? 'MISA' : 'WEB'}] ` : '';
  return `${i + 1}. ${prefix}${x.key}${x.label && x.label !== x.key ? ` — ${x.label}` : ''}: ${val}${groupBy === 'order' ? ` · ${fmtNum(x.quantity)} SL` : ''}`;
}
async function narrate(result) {
  if (result.blocked) return { text: result.blocked, source: 'nlq-engine' };
  if (result.text) return { text: result.text, source: 'nlq-engine' };
  if (result.clarify) return { text: [result.clarify, ...(result.options || []).map((o) => `• ${o}`)].join('\n'), source: 'nlq-engine' };
  const p = result.plan;
  if (p.answerType === 'advisory' && llm.isEnabled()) {
    const facts = { ky: result.ky, total: result.total, metric: result.metric, top: result.items.slice(0, 8), compare: result.compare, freshness: result.freshness, advisory: result.advisoryFacts };
    const ans = await llm.callLlm({ question: result.question, facts });
    if (ans?.text) return { text: ans.text, source: 'nlq-engine-llm-narrator', facts };
  }
  const period = `${kyLabel(result.ky)}${result.dayRange ? ` — ${result.dayRange.label}` : ''}`;
  const lines = [];
  if (result.compareItems?.length) {
    lines.push(`${DIM_LABEL[result.groupBy]} biến động ${period}:`);
    result.compareItems.forEach((x, i) => lines.push(`${i + 1}. ${x.key}${x.label && x.label !== x.key ? ` — ${x.label}` : ''}: ${formatMetric(x.cur, result.metric)}; ${x.compareLabel}: ${formatMetric(x.prevPaced, result.metric)}; chênh ${formatMetric(x.delta, result.metric)}${x.pct == null ? '' : ` (${pct(x.pct)})`}`));
  } else if (result.compare) {
    const c = result.compare;
    lines.push(`${metricLabel(result.metric)} ${period}: ${formatMetric(c.curVal, result.metric)}; ${c.label}: ${formatMetric(c.prevPaced, result.metric)}; chênh ${formatMetric(c.delta, result.metric)}${c.pct == null ? '' : ` (${pct(c.pct)})`}.`);
  } else if (result.groupBy && result.items.length) {
    const top = result.plan.topN ? `Top ${result.plan.topN}${result.plan.splitBySource ? ' mỗi nguồn ' : ' '}` : '';
    const count = result.items.length;
    const metric = metricLabel(result.metric).toLowerCase();
    const scopeLabel = result.isEmployee ? ' của Anh/Chị' : '';
    const title = top
      ? `${top}${DIM_LABEL[result.groupBy]} có ${metric} ${period}${scopeLabel}`
      : `${metricLabel(result.metric)} theo ${DIM_LABEL[result.groupBy]} ${period}${scopeLabel} — tổng cộng ${count} ${DIM_LABEL[result.groupBy]}`;
    lines.push(`${title}:`);
    result.items.forEach((x, i) => lines.push(itemLine(x, result.metric, result.groupBy, i)));
  } else {
    lines.push(`${metricLabel(result.metric)} ${period}${result.isEmployee ? ' của Anh/Chị' : ' toàn công ty'}: ${formatMetric(result.total, result.metric)}.`);
  }
  const fl = freshnessLine(result.freshness); if (fl) lines.push(fl);
  return { text: lines.join('\n'), source: 'nlq-engine', facts: { plan: p, total: result.total, items: result.items.slice(0, 20), compare: result.compare } };
}
async function answerQuestion(args = {}) {
  const currentPeriod = store.latestKy();
  const ctx = { currentPeriod, latestDataDate: latestDataDate(currentPeriod, args.scope || {}) };
  const planObj = await plan(args.text || '', ctx);
  const res = await execute(args.text || '', planObj, args);
  return narrate(res);
}
module.exports = { plan, execute, narrate, answerQuestion, fallbackPlan, latestDataDate, normalizePlan };
