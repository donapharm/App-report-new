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
function buildAlerts({ scope }) {
  const ky = store.latestKy();
  const periods = store.listPeriods().map((p) => p.ky);
  const idx = periods.indexOf(ky);
  const prevKy = idx > 0 ? periods[idx - 1] : null;
  const alerts = [];

  // a) NV tụt target (đạt < 80% target trước VAT)
  const targets = store.getTargets({ ky, scope });
  for (const t of targets) {
    const rev = A.sum(store.getRows({ ky, scope: { empCode: t.emp_code } }), (r) => r.revenue);
    const revBeforeVat = rev / A.VAT_DIVISOR;
    const pct = t.target > 0 ? (revBeforeVat / t.target) * 100 : null;
    if (pct != null && pct < 80) {
      alerts.push({
        type: 'target_low',
        severity: pct < 50 ? 'high' : 'medium',
        emp_code: t.emp_code,
        emp_name: store.findUserByCode(t.emp_code)?.name,
        title: `${store.findUserByCode(t.emp_code)?.name || t.emp_code} mới đạt ${pct.toFixed(0)}% target`,
        detail: `Doanh thu trước VAT ${fmt(revBeforeVat)} / target ${fmt(t.target)}.`,
        metric: +pct.toFixed(1),
      });
    }
  }

  // b) Đơn vị giảm doanh thu so kỳ trước (MoM < -15%)
  if (prevKy) {
    const cur = A.revenueBreakdown({ ky, scope, dimension: 'unit' });
    const prev = A.revenueBreakdown({ ky: prevKy, scope, dimension: 'unit' });
    const prevMap = Object.fromEntries(prev.map((u) => [u.key, u.revenue]));
    for (const u of cur) {
      const before = prevMap[u.key] || 0;
      if (before > 0) {
        const mom = ((u.revenue - before) / before) * 100;
        if (mom <= -15) {
          alerts.push({
            type: 'unit_drop',
            severity: mom <= -30 ? 'high' : 'medium',
            title: `${u.label} giảm ${Math.abs(mom).toFixed(0)}% so kỳ trước`,
            detail: `Kỳ trước ${fmt(before)} → kỳ này ${fmt(u.revenue)}.`,
            metric: +mom.toFixed(1),
          });
        }
      }
    }
  }

  // c) Cơ số thầu bất thường: sắp cạn (<10%) hoặc tồn nhiều (>85%)
  const cst = store.getCst({ scope });
  for (const c of cst) {
    if (c.remain_pct < 10) {
      alerts.push({
        type: 'cst_low',
        severity: 'high',
        title: `${c.product_name} tại ${c.unit_name} sắp cạn cơ số (${c.remain_pct}%)`,
        detail: `Còn ${c.remain_qty.toLocaleString('vi-VN')} / ${c.bid_qty_initial.toLocaleString('vi-VN')} (${c.bid_package}).`,
        metric: c.remain_pct,
      });
    } else if (c.remain_pct > 85) {
      alerts.push({
        type: 'cst_high',
        severity: 'low',
        title: `${c.product_name} tại ${c.unit_name} tồn nhiều cơ số (${c.remain_pct}%)`,
        detail: `Mới bán ${(100 - c.remain_pct).toFixed(0)}% cơ số ${c.bid_package}. Cân nhắc đẩy bán/điều chuyển.`,
        metric: c.remain_pct,
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { ky, count: alerts.length, alerts };
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
  const lastKy = periods[periods.length - 1];
  const nextMonth = String((parseInt(lastKy.slice(0, 2), 10) % 12) + 1).padStart(2, '0');
  const nextYear = nextMonth === '01' ? +lastKy.slice(3) + 1 : +lastKy.slice(3);
  const nextKy = `${nextMonth}.${nextYear}`;
  const season = SEASON[nextMonth] || 1;

  const emps = store.listUsers().filter((u) => u.role === 'sale' && (!scope.empCode || u.emp_code === scope.empCode));
  const out = emps.map((emp) => {
    const s = { empCode: emp.emp_code };
    const revByKy = periods.map((ky) => A.sum(store.getRows({ ky, scope: s }), (r) => r.revenue) / A.VAT_DIVISOR);
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
  const ky = store.latestKy();
  const mine = !!scope.empCode;

  if (/(top|cao nhat|ban chay).*(san pham|thuoc)|(san pham|thuoc).*(top|cao|ban chay)/.test(q)) {
    const top = A.revenueBreakdown({ ky, scope, dimension: 'product' }).slice(0, 5);
    return say(`Top sản phẩm kỳ ${ky}:`, top.map((t, i) => `${i + 1}. ${t.label}: ${fmt(t.revenue)}`));
  }
  if (/(top|cao nhat).*(don vi|benh vien|phong kham|khach)|(don vi|benh vien|khach).*(top|cao)/.test(q)) {
    const top = A.revenueBreakdown({ ky, scope, dimension: 'unit' }).slice(0, 5);
    return say(`Top đơn vị kỳ ${ky}:`, top.map((t, i) => `${i + 1}. ${t.label}: ${fmt(t.revenue)}`));
  }
  if (!mine && /(xep hang|ranking|top).*(nhan vien|nv|sale)|(nhan vien|sale).*(top|cao|xep hang)/.test(q)) {
    const top = A.revenueBreakdown({ ky, scope, dimension: 'emp' }).slice(0, 5);
    return say(`Top nhân viên kỳ ${ky}:`, top.map((t, i) => `${i + 1}. ${t.label}: ${fmt(t.revenue)}`));
  }
  if (/co so|con lai|sap can|ton kho|con nhieu/.test(q)) {
    const low = A.cstTable({ scope, remainPctMax: 10 });
    if (!low.length) return say('Không có cơ số thầu nào dưới 10% trong phạm vi của bạn.');
    return say(`Có ${low.length} dòng cơ số thầu sắp cạn (<10%):`,
      low.slice(0, 5).map((c) => `• ${c.product_name} @ ${c.unit_name}: còn ${c.remain_pct}%`));
  }
  if (/target|chi tieu|% ?dat|dat bao nhieu|hoan thanh/.test(q)) {
    const k = A.overviewKpis({ ky, scope });
    if (k.pctTarget == null) return say('Chưa có target cho kỳ ' + ky + '.');
    return say(`Kỳ ${ky}: doanh thu trước VAT ${fmt(k.revenueBeforeVat)} / target ${fmt(k.targetTotal)} → đạt ${k.pctTarget}%.`);
  }
  if (/doanh thu|doanh so|tong tien|bao nhieu tien/.test(q)) {
    const k = A.overviewKpis({ ky, scope });
    const who = mine ? 'của bạn' : 'toàn công ty';
    const mom = k.momPct == null ? '' : ` (${k.momPct >= 0 ? '+' : ''}${k.momPct}% so kỳ trước)`;
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
    top_don_vi: A.revenueBreakdown({ ky, scope, dimension: 'unit' }).slice(0, 5).map((x) => ({ ten: x.label, doanh_thu: x.revenue })),
    ...(mine ? {} : { top_nhan_vien: A.revenueBreakdown({ ky, scope, dimension: 'emp' }).slice(0, 5).map((x) => ({ ten: x.label, doanh_thu: x.revenue })) }),
    co_so_thau_sap_can: A.cstTable({ scope, remainPctMax: 10 }).slice(0, 8).map((c) => ({ sp: c.product_name, dv: c.unit_name, con_lai_pct: c.remain_pct })),
  };
}

/* ---------------- helpers ---------------- */
function noAccent(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
function fmt(n) { return Math.round(n).toLocaleString('vi-VN') + ' đ'; }
function say(text, lines) { return { text, lines: lines || [], source: 'code' }; }

module.exports = { buildAlerts, forecastTargets, answerQuestion, SEASON };
