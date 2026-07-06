/**
 * smart.js — LÕI "THÔNG MINH" của App Report New.
 *   - buildAlerts:  cảnh báo chủ động (việc CEO cần chú ý).
 *   - forecastTargets: dự báo target kỳ tới theo xu hướng thật.
 *   - answerQuestion: AI hỏi nhanh CODE-FIRST (số do code tính, không bịa).
 */
const store = require('./store');
const A = require('./analytics');
const llm = require('./llm');

/* ---------------- 1) CẢNH BÁO CHỦ ĐỘNG ---------------- */
function buildAlerts({ scope, ky, kys }) {
  const list = Array.isArray(kys) && kys.length ? kys : [ky || store.latestKy()];
  const lastKy = list[list.length - 1];
  const cmp = store.comparePeriods(list); // cặp kỳ SO SÁNH công bằng (tự lùi tháng đủ nếu kỳ dở)
  const fmtKy = (k) => { const [m, y] = String(k || '').split('.'); return m && y ? `T${m}/${y}` : String(k || ''); };
  const cmpNote = cmp.prevKy
    ? (cmp.adjusted
      ? `⚠ Tháng đang xem chưa đủ ngày — đang so 2 tháng đã hoàn tất: ${fmtKy(cmp.curKy)} với ${fmtKy(cmp.prevKy)}.`
      : `So sánh ${fmtKy(cmp.curKy)} với ${fmtKy(cmp.prevKy)}.`)
    : 'Chưa đủ dữ liệu kỳ trước để so sánh.';
  const top = (arr, n = 8) => arr.slice(0, n);

  // a) NV đang bán nhưng tụt target (đạt < 80% target trước VAT).
  // Duyệt NV có doanh thu trong kỳ, không duyệt toàn bộ target/danh bạ để tránh NV nghỉ.
  const targets = store.getTargetsRange({ kys: list, scope });
  const targetByEmp = {};
  for (const t of targets) targetByEmp[t.emp_code] = (targetByEmp[t.emp_code] || 0) + Number(t.target || 0);
  const targetItems = [];
  for (const u of store.targetRoster({ scope })) {
    const empCode = u.emp_code;
    const user = store.findUserByCode(empCode);
    if (!user?.name) continue; // không resolve được tên => loại khỏi cảnh báo
    const target = A.targetCompareValue(targetByEmp[empCode] || 0, lastKy);
    if (target <= 0) continue; // chưa có target thật => không tính %
    const rev = A.sum(store.getRowsRange({ kys: list, scope: { empCode } }), (r) => r.revenue);
    const revBeforeVat = rev / A.VAT_DIVISOR;
    const pct = (revBeforeVat / target) * 100;
    if (pct < 80) {
      targetItems.push({
        emp_code: empCode,
        name: user.name,
        pct: +pct.toFixed(1),
        revenue_before_vat: Math.round(revBeforeVat),
        target,
        severity: pct < 50 ? 'high' : 'medium',
      });
    }
  }
  targetItems.sort((a, b) => a.pct - b.pct);

  // b) Đơn vị biến động doanh thu so kỳ trước: giảm mạnh (MoM ≤ -15%) & tăng mạnh (MoM ≥ +15%)
  const unitItems = [];    // giảm mạnh
  const unitUpItems = [];  // tăng trưởng mạnh
  if (cmp.prevKys.length && cmp.prevKys.length === cmp.curKys.length) {
    const cur = A.revenueBreakdown({ kys: cmp.curKys, scope, dimension: 'unit' });
    const prev = A.revenueBreakdown({ kys: cmp.prevKys, scope, dimension: 'unit' });
    const prevMap = Object.fromEntries(prev.map((u) => [u.key, u.revenue]));
    for (const u of cur) {
      const before = prevMap[u.key] || 0;
      if (before > 0) {
        const mom = ((u.revenue - before) / before) * 100;
        const rec = { unit_code: u.key, unit_name: u.label, prev: before, cur: u.revenue, mom: +mom.toFixed(1) };
        if (mom <= -15) unitItems.push({ ...rec, severity: mom <= -30 ? 'high' : 'medium' });
        else if (mom >= 15) unitUpItems.push({ ...rec, severity: mom >= 30 ? 'high' : 'medium' });
      }
    }
  }
  unitItems.sort((a, b) => a.mom - b.mom);
  unitUpItems.sort((a, b) => b.mom - a.mom);

  // c) Cơ số thầu bất thường: sắp cạn (<10%) hoặc tồn nhiều (>85%)
  const cst = store.getCst({ scope });
  const cstLow = [];
  const cstHigh = [];
  for (const c of cst) {
    if (c.remain_pct < 10) {
      cstLow.push({
        product_name: c.product_name,
        unit_name: c.unit_name,
        remain_qty: c.remain_qty,
        bid_qty_initial: c.bid_qty_initial,
        remain_pct: c.remain_pct,
        bid_package: c.bid_package,
        severity: 'high',
      });
    } else if (c.remain_pct > 85) {
      cstHigh.push({
        product_name: c.product_name,
        unit_name: c.unit_name,
        remain_qty: c.remain_qty,
        bid_qty_initial: c.bid_qty_initial,
        remain_pct: c.remain_pct,
        bid_package: c.bid_package,
        severity: 'low',
      });
    }
  }
  cstLow.sort((a, b) => a.remain_pct - b.remain_pct);
  cstHigh.sort((a, b) => b.remain_pct - a.remain_pct);

  const groups = [
    { key: 'target', icon: '🎯', tone: 'danger', title: 'NV chưa đạt target', total: targetItems.length, items: top(targetItems) },
    { key: 'unit_up', icon: '📈', tone: 'ok', title: 'Đơn vị tăng trưởng mạnh (so kỳ trước)', total: unitUpItems.length, items: top(unitUpItems), note: cmpNote },
    { key: 'unit_down', icon: '📉', tone: 'warning', title: 'Đơn vị giảm mạnh (so kỳ trước)', total: unitItems.length, items: top(unitItems), note: cmpNote },
    { key: 'cst_low', icon: '📦', tone: 'danger', title: 'Cơ số thầu sắp cạn (<10%)', total: cstLow.length, items: top(cstLow) },
    { key: 'cst_high', icon: '🟡', tone: 'neutral', title: 'Cơ số thầu tồn nhiều (>85%)', total: cstHigh.length, items: top(cstHigh) },
  ];
  const summary = {
    emp_below_target: targetItems.length,
    units_up: unitUpItems.length,
    units_down: unitItems.length,
    cst_low: cstLow.length,
    cst_high: cstHigh.length,
  };
  // "Cần chú ý" = các mục CẢNH BÁO (không tính đơn vị tăng trưởng — đó là tin vui).
  const count = groups.filter((g) => g.key !== 'unit_up').reduce((s, g) => s + g.total, 0);
  return { ky: lastKy, kys: list, cstLabel: 'Cơ số thầu hiện tại', summary, groups, count };
}

/* ---------------- 2) DỰ BÁO TARGET THEO XU HƯỚNG ---------------- */
// Hệ số mùa vụ (kế thừa từ app cũ, tinh chỉnh được).
const SEASON = { '01': 0.9, '02': 0.88, '03': 1.05, '04': 1.02, '05': 1.05, '06': 1.08,
  '07': 1.0, '08': 1.02, '09': 1.0, '10': 1.05, '11': 1.03, '12': 1.1 };

/**
 * Dự báo target kỳ tới cho từng NV = kết hợp:
 *   - xu hướng doanh thu thật (hồi quy tuyến tính đơn giản qua các kỳ),
 *   - mức đạt target gần nhất,
 *   - hệ số mùa vụ tháng kế tiếp.
 * Trả về giải thích để CEO hiểu vì sao (không phải hộp đen).
 */
function forecastTargets({ scope }) {
  const periods = store.listPeriods().map((p) => p.ky);
  const lastKy = store.lastCompleteKy();
  const nextKy = store.nextKy(lastKy);
  const usablePeriods = periods.filter((ky) => store.periodKys().includes(ky) && ky <= lastKy);
  const nextMonth = nextKy.slice(0, 2);
  const season = SEASON[nextMonth] || 1;

  // Roster target CEO chốt (0-BIS): allowlist/has_target, không suy luận role/status.
  const emps = store.targetRoster({ scope }).map((u) => ({ emp_code: u.emp_code, name: u.name || u.emp_code }));
  const out = emps.map((emp) => {
    const s = { empCode: emp.emp_code };
    const revByKy = usablePeriods.map((ky) => A.sum(store.getRows({ ky, scope: s }), (r) => r.revenue) / A.VAT_DIVISOR);
    const trendRev = linearNext(revByKy); // dự báo doanh thu kỳ tới theo trend
    const lastTarget = (store.getTargets({ ky: lastKy, scope: s })[0] || {}).target || 0;
    const lastRev = revByKy[revByKy.length - 1] || 0;
    const attain = lastTarget > 0 ? lastRev / lastTarget : 1;

    // target đề xuất: neo theo doanh thu-trend, có mùa vụ, kèm đệm theo mức đạt
    let base = Math.max(trendRev, lastRev);
    if (attain >= 1.2) base *= 1.05;
    else if (attain >= 1.0) base *= 1.02;
    else if (attain >= 0.85) base *= 1.0;
    else base *= 0.97;
    const suggested = round100m(base * season);

    return {
      emp_code: emp.emp_code,
      emp_name: emp.name,
      last_ky: lastKy,
      last_target: lastTarget,
      last_revenue_before_vat: Math.round(lastRev),
      attain_pct: lastTarget > 0 ? +(attain * 100).toFixed(1) : null,
      trend_revenue: Math.round(trendRev),
      season_factor: season,
      suggested_target: suggested,
      reason: buildReason(attain, trendRev, lastRev, season),
    };
  });
  return { next_ky: nextKy, season_factor: season, items: out };
}

function linearNext(ys) {
  const n = ys.length;
  if (n === 0) return 0;
  if (n === 1) return ys[0];
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  return Math.max(0, my + slope * (n - mx)); // giá trị tại x = n (kỳ kế tiếp)
}
function round100m(n) { return Math.round(n / 100e6) * 100e6; }
function buildReason(attain, trend, last, season) {
  const parts = [];
  if (attain >= 1.2) parts.push('kỳ trước vượt target mạnh (+5%)');
  else if (attain >= 1.0) parts.push('kỳ trước đạt target (+2%)');
  else if (attain >= 0.85) parts.push('kỳ trước gần đạt (giữ mức)');
  else parts.push('kỳ trước chưa đạt (giảm nhẹ -3%)');
  parts.push(trend >= last ? 'doanh thu đang tăng theo xu hướng' : 'doanh thu đang chững/giảm');
  parts.push(`hệ số mùa vụ ${season}`);
  return parts.join('; ');
}

/* ---------------- 3) AI HỎI NHANH (CODE-FIRST) ---------------- */
/**
 * answerQuestion — TRẢ LỜI BẰNG SỐ DO CODE TÍNH.
 * Nhận diện ý định theo từ khóa; luôn giới hạn trong phạm vi quyền (scope).
 * Nếu không chắc, trả gợi ý thay vì bịa số. (Điểm cắm LLM để diễn giải: TODO(LIVE).)
 */
async function answerQuestion({ text, scope, session }) {
  const q = noAccent((text || '').toLowerCase()); // chấp nhận cả gõ KHÔNG DẤU
  const ky = resolveKyFromQuestion(q) || store.latestKy();
  const mine = !!scope.empCode;

  if (/(top|cao nhat|ban chay).*(san pham|thuoc)|(san pham|thuoc).*(top|cao|ban chay)/.test(q)) {
    const top = A.revenueBreakdown({ ky, scope, dimension: 'product' }).slice(0, 5);
    return say(`Top sản phẩm kỳ ${ky}:`, top.map((t, i) => `${i + 1}. ${t.label}: ${fmt(t.revenue)}`));
  }
  if (/(top|cao nhat).*(don vi|benh vien|phong kham|khach)|(don vi|benh vien|khach).*(top|cao)/.test(q)) {
    const top = A.revenueBreakdown({ ky, scope, dimension: 'unit' }).slice(0, 5);
    return say(`Top đơn vị kỳ ${ky}:`, top.map((t, i) => `${i + 1}. ${unitText(t.key, t.label)}: ${fmt(t.revenue)}`));
  }
  if (!mine && /(xep hang|ranking|top).*(nhan vien|nv|sale)|(nhan vien|sale).*(top|cao|xep hang)/.test(q)) {
    const top = A.revenueBreakdown({ ky, scope, dimension: 'emp' }).slice(0, 5);
    return say(`Top nhân viên kỳ ${ky}:`, top.map((t, i) => `${i + 1}. ${t.label}: ${fmt(t.revenue)}`));
  }
  if (/co so|con lai|sap can|ton kho|con nhieu/.test(q)) {
    const low = A.cstTable({ scope, remainPctMax: 10 });
    if (!low.length) return say('Không có cơ số thầu nào dưới 10% trong phạm vi của bạn.');
    return say(`Có ${low.length} dòng cơ số thầu sắp cạn (<10%):`,
      low.slice(0, 5).map((c) => `• ${c.product_name} @ ${unitText(c.unit_code, c.unit_name)}: còn ${fmtPct(c.remain_pct)}`));
  }
  if (/target|chi tieu|% ?dat|dat bao nhieu|hoan thanh/.test(q)) {
    const k = A.overviewKpis({ ky, scope });
    if (k.pctTarget == null) return say('Chưa có target cho kỳ ' + ky + '.');
    return say(`Kỳ ${ky}: doanh thu trước VAT ${fmt(k.revenueBeforeVat)} / target ${fmt(k.targetCompareTotal || k.targetTotal)} → đạt ${fmtPct(k.pctTarget)}.`);
  }
  if (/doanh thu|doanh so|tong tien|bao nhieu tien/.test(q)) {
    const k = A.overviewKpis({ ky, scope });
    const who = mine ? 'của bạn' : 'toàn công ty';
    const mom = k.momPct == null ? '' : ` (${k.momPct >= 0 ? '+' : ''}${fmtPct(k.momPct)} so kỳ trước)`;
    return say(`Doanh thu ${who} kỳ ${ky}: ${fmt(k.revenue)}${mom}.`);
  }

  // Không khớp mẫu code → nếu có LLM (grounded) thì nhờ diễn giải trên FACTS đã tính.
  if (llm.isEnabled()) {
    const facts = buildFacts({ ky, scope, mine });
    const ans = await llm.callLlm({ question: text, facts });
    if (ans) return { text: ans.text, lines: [], source: 'llm' };
  }

  return say('Mình chưa chắc ý câu hỏi. Bạn thử hỏi theo mẫu:', [
    'Doanh thu kỳ này bao nhiêu?',
    'Top sản phẩm / Top đơn vị',
    mine ? 'Cơ số thầu của tôi sắp cạn?' : 'Top nhân viên',
    'Tôi đạt bao nhiêu % target?',
  ]);
}

// Gom SỐ đã tính (trong phạm vi quyền) để đưa LLM — không có dữ liệu thô/PII.
function buildFacts({ ky, scope, mine }) {
  const k = A.overviewKpis({ ky, scope });
  return {
    ky,
    phamvi: mine ? 'chỉ nhân viên đang đăng nhập' : 'toàn công ty',
    doanh_thu: k.revenue,
    doanh_thu_truoc_vat: k.revenueBeforeVat,
    target_tong: k.targetTotal,
    phan_tram_dat: k.pctTarget,
    tang_giam_so_ky_truoc_pct: k.momPct,
    top_san_pham: A.revenueBreakdown({ ky, scope, dimension: 'product' }).slice(0, 5).map((x) => ({ ten: x.label, doanh_thu: x.revenue })),
    top_don_vi: A.revenueBreakdown({ ky, scope, dimension: 'unit' }).slice(0, 5).map((x) => ({ ten: unitText(x.key, x.label), doanh_thu: x.revenue })),
    ...(mine ? {} : { top_nhan_vien: A.revenueBreakdown({ ky, scope, dimension: 'emp' }).slice(0, 5).map((x) => ({ ten: x.label, doanh_thu: x.revenue })) }),
    co_so_thau_sap_can: A.cstTable({ scope, remainPctMax: 10 }).slice(0, 8).map((c) => ({ sp: c.product_name, dv: unitText(c.unit_code, c.unit_name), con_lai_pct: c.remain_pct })),
  };
}

/* ---------------- helpers ---------------- */
function resolveKyFromQuestion(q) {
  const periods = store.listPeriods().map((p) => p.ky).filter(Boolean);
  if (!periods.length) return null;
  const latest = periods[periods.length - 1];
  const pickByMonthYear = (mm, yy) => {
    const m = String(mm).padStart(2, '0');
    let y = yy ? String(yy) : '';
    if (y.length === 2) y = `20${y}`;
    if (y) return periods.includes(`${m}.${y}`) ? `${m}.${y}` : null;
    const latestYear = latest.slice(3);
    if (periods.includes(`${m}.${latestYear}`)) return `${m}.${latestYear}`;
    return periods.filter((p) => p.startsWith(`${m}.`)).slice(-1)[0] || null;
  };
  let m = q.match(/\b(?:t|thang|ky)\s*0?(\d{1,2})(?:\s*[./-]?\s*(20\d{2}|\d{2}))?\b/);
  if (m) return pickByMonthYear(m[1], m[2]);
  m = q.match(/\b(0?[1-9]|1[0-2])[./-](20\d{2}|\d{2})\b/);
  if (m) return pickByMonthYear(m[1], m[2]);
  return null;
}
function noAccent(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
function fmt(n) { return Math.round(n).toLocaleString('vi-VN') + 'đ'; }
function fmtPct(n) { return n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%'; }
function unitText(code, name) {
  const c = String(code || '').trim();
  const nm = String(name || '').trim();
  if (!c && !nm) return '—';
  if (!c) return nm;
  if (!nm || nm === c) return c;
  if (nm.startsWith(`${c}.`) || nm.startsWith(`${c} `) || nm.includes(c)) return nm;
  return `${c}.${nm}`;
}
function say(text, lines) { return { text, lines: lines || [], source: 'code' }; }

module.exports = { buildAlerts, forecastTargets, answerQuestion, SEASON };
