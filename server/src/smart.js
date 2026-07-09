/**
 * smart.js — LÕI "THÔNG MINH" của App Report New.
 *   - buildAlerts:  cảnh báo chủ động (việc CEO cần chú ý).
 *   - forecastTargets: dự báo target kỳ tới theo xu hướng thật.
 *   - answerQuestion: AI hỏi nhanh CODE-FIRST (số do code tính, không bịa).
 */
const store = require('./store');
const A = require('./analytics');
const llm = require('./llm');
const NLQ = require('./nlqIntent');
const nlqEngine = require('./nlqEngine');

/* ---------------- 1) CẢNH BÁO CHỦ ĐỘNG ---------------- */
function buildAlerts({ scope, ky, kys, compareMode }) {
  const list = Array.isArray(kys) && kys.length ? kys : [ky || store.latestKy()];
  const lastKy = list[list.length - 1];
  const mode = compareMode === 'yoy' ? 'yoy' : 'prev';
  const cmp = store.comparePeriods(list, mode); // cặp kỳ SO SÁNH (tháng liền trước / cùng kỳ năm ngoái)
  const fmtKy = (k) => { const [m, y] = String(k || '').split('.'); return m && y ? `T${m}/${y}` : String(k || ''); };
  const cmpNote = cmp.yoyMissing
    ? `Chưa có dữ liệu cùng kỳ năm ngoái (${fmtKy(cmp.prevKy)}) để so — cần nạp số ${String(cmp.prevKy || '').split('.')[1] || 'năm trước'}.`
    : (!cmp.hasPrev
      ? 'Chưa đủ dữ liệu kỳ trước để so sánh.'
      : (cmp.mode === 'yoy'
        ? `So cùng kỳ năm ngoái: ${fmtKy(cmp.curKy)} với ${fmtKy(cmp.prevKy)}.`
        : (cmp.adjusted
          ? `⚠ Tháng đang xem chưa đủ ngày — đang so 2 tháng đã hoàn tất: ${fmtKy(cmp.curKy)} với ${fmtKy(cmp.prevKy)}.`
          : `So tháng liền trước: ${fmtKy(cmp.curKy)} với ${fmtKy(cmp.prevKy)}.`)));
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
  if (cmp.hasPrev) {
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
  return { ky: lastKy, kys: list, cstLabel: 'Cơ số thầu hiện tại', summary, groups, count, compareMode: cmp.mode, compareNote: cmpNote };
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
  const askedKy = resolveKyFromQuestion(q);
  const askedMonth = monthMention(q);
  // Hỏi RÕ 1 tháng nhưng kỳ đó CHƯA có dữ liệu -> báo thẳng, KHÔNG lặng lẽ lấy kỳ mới nhất.
  if (!askedKy && askedMonth) {
    const have = store.periodKys();
    const label = askedMonth.y ? `${askedMonth.m}.${askedMonth.y}` : `tháng ${Number(askedMonth.m)}`;
    return say(`Kỳ ${label} chưa có dữ liệu trong App Report.`, [
      have.length ? `Các kỳ đang có số: ${have.join(', ')}.` : 'Hiện chưa có kỳ nào có dữ liệu.',
      'Anh/Chị thử hỏi một trong các kỳ trên nhé.',
    ]);
  }
  const ky = askedKy || store.latestKy();
  const mine = !!scope.empCode;

  // Nhãn "độ tươi": kỳ đang chạy (chưa đủ ngày) -> thêm dòng "dữ liệu tới DD/MM".
  const _fresh = store.periodFreshness(ky);
  const freshNote = (!_fresh.complete && _fresh.throughDate)
    ? `📅 Dữ liệu tới ${_fresh.throughDate.slice(8, 10)}/${_fresh.throughDate.slice(5, 7)} (${_fresh.dayCovered}/${_fresh.daysInMonth} ngày) — kỳ đang cập nhật.`
    : '';
  const withFresh = (lines) => (freshNote ? [...lines, freshNote] : lines);

  const rowsFor = () => store.getRows({ ky, scope });
  const topList = (title, arr, fmtItem) => say(title, withFresh(arr.map((t, i) => `${i + 1}. ${fmtItem(t)}`)));
  const intent = NLQ.classify(text || '');
  const limitFromQuestion = (def = 5, max = 20) => Math.min(max, Math.max(1, Number((q.match(/top\s*(\d{1,2})|^(?:.*?)(\d{1,2})\s*(?:dong|muc|don vi|san pham|nv|nhan vien)/) || [])[1] || (q.match(/top\s*(\d{1,2})|^(?:.*?)(\d{1,2})\s*(?:dong|muc|don vi|san pham|nv|nhan vien)/) || [])[2] || def)));
  // Khóa cứng T07 ĐÃ GỠ: T07 đã đúng (gom nhóm chuẩn + fix lọc ngày slot) và đã có nhãn
  // "dữ liệu tới ngày DD/MM" báo kỳ đang cập nhật. Giữ biến=false để mọi guard bên dưới thành no-op.
  const employeeRevenueLocked = false;
  const lockedMsg = `Dữ liệu doanh thu kỳ ${ky} đang được đối chiếu lại nguồn gán nhân viên nên em tạm khóa trả số để tránh sai.`;
  let _ph = null; // memo tra cứu đích danh SẢN PHẨM (tránh tính 2 lần)
  const prodHits = () => { if (_ph === null) _ph = lookupProducts({ q, ky, scope }); return _ph; };
  let _uh = null; // memo tra cứu đích danh ĐƠN VỊ
  const unitHits = () => { if (_uh === null) _uh = lookupUnits({ q, ky, scope }); return _uh; };
  const revenueLocked = () => employeeRevenueLocked ? say(lockedMsg) : null;
  const dimRows = (dimension, limit) => {
    if (dimension === 'contractor') return A.groupSum(rowsFor(), 'contractor_code', 'contractor_name').filter((t) => Number(t.revenue || 0) > 0).slice(0, limit);
    if (dimension === 'bid_package') return A.groupSum(rowsFor().filter((r) => r.bid_package), 'bid_package', 'bid_package').filter((t) => Number(t.revenue || 0) > 0).slice(0, limit);
    if (dimension === 'province') return A.groupSum(rowsFor().filter((r) => r.province), 'province', 'province').filter((t) => Number(t.revenue || 0) > 0).slice(0, limit);
    return A.revenueBreakdown({ ky, scope, dimension }).filter((t) => Number(t.revenue || 0) > 0).slice(0, limit);
  };
  const dimLabel = (dimension) => ({ emp: 'nhân viên', unit: 'đơn vị', product: 'sản phẩm', contractor: 'nhà thầu', bid_package: 'gói thầu', province: 'tỉnh' }[dimension] || dimension);
  const fmtDimItem = (dimension, t) => `${dimension === 'unit' ? unitText(t.key, t.label) : t.label}: ${fmt(t.revenue)}`;

  // NLQ Mức 3: Planner → Executor → Narrator cho truy vấn doanh thu tổng quát.
  // Bỏ qua các nhóm ngoài doanh thu/đã có handler nghiệp vụ riêng để fallback cũ vẫn an toàn.
  if (!['sensitive', 'help', 'greeting', 'identity_check', 'target_gap', 'target_pct', 'cst_empty', 'cst_low'].includes(intent.intent)) {
    const engineAns = await nlqEngine.answerQuestion({ text, scope, session });
    if (engineAns?.text) return engineAns;
  }

  if (shouldInterpretQuery(intent, q)) {
    const interpreted = await answerFromInterpretedIntent({ text, q, baseKy: ky, scope, mine });
    if (interpreted) return interpreted;
  }

  if (isLlmAnalysisQuestion(q)) {
    const ans = await answerWithLlm({ text, ky, scope, mine });
    if (ans) return ans;
  }

  const drilldown = drilldownAnswer({ q, ky, mine, unitHits, productHits: prodHits });
  if (drilldown) return drilldown;

  // Router NLQ có cấu trúc: intent rõ ràng xử lý trước fuzzy lookup.
  if (intent.intent === 'sensitive') {
    return say('Đây là nội dung nhạy cảm về chi phí/lợi nhuận/CP Total. Anh/Chị vui lòng liên hệ CEO trước khi hỏi tiếp nội dung này.');
  }
  if (intent.intent === 'revenue_employee') {
    const emp = String(intent.empCode || '').toUpperCase();
    if (mine && emp !== String(scope.empCode || '').toUpperCase()) return say('Anh/Chị chỉ được xem doanh thu trong phạm vi của mình; không được xem doanh thu nhân viên khác.');
    if (employeeRevenueLocked && mine) return revenueLocked();
    const u = store.findUserByCode(emp);
    if (!u) return say(`Chưa tìm thấy mã nhân viên ${emp}.`);
    const k = A.overviewKpis({ ky, scope: { empCode: emp } });
    const mom = k.momPct == null ? '' : ` (${k.momPct >= 0 ? '+' : ''}${fmtPct(k.momPct)} so kỳ trước)`;
    return say(`Doanh thu ${u.name || emp} (${emp}) kỳ ${ky}: ${fmt(k.revenue)}${mom}.`, withFresh([]));
  }
  if (intent.intent === 'unit_movement') {
    if (employeeRevenueLocked) return revenueLocked();
    const al = buildAlerts({ ky, scope });
    const down = al.groups.find((g) => g.key === 'unit_down');
    const up = al.groups.find((g) => g.key === 'unit_up');
    const wantsUp = /tang|tang truong/.test(q);
    const wantsDown = /giam|sut|tut/.test(q);
    const groups = wantsUp && !wantsDown ? [up] : wantsDown && !wantsUp ? [down] : [down, up];
    const lines = [];
    for (const g of groups) {
      if (!g?.items?.length) continue;
      lines.push(`${g.key === 'unit_up' ? '📈 Tăng mạnh' : '📉 Giảm mạnh'} (${g.total}):`);
      g.items.slice(0, 6).forEach((u) => lines.push(`• ${unitText(u.unit_code, u.unit_name)}: ${g.key === 'unit_up' ? '+' : ''}${fmtPct(u.mom)}`));
    }
    return lines.length ? say(`Biến động đơn vị kỳ ${ky} (so kỳ trước):`, lines) : say(`Kỳ ${ky}: chưa thấy đơn vị tăng/giảm bất thường hoặc thiếu dữ liệu kỳ trước để so.`);
  }
  if (intent.intent === 'ranking') {
    if (intent.dimension === 'emp' && mine) return say('Anh/Chị chỉ được xem dữ liệu trong phạm vi của mình; xếp hạng nhân viên thuộc quyền CEO/admin.');
    if (employeeRevenueLocked) return revenueLocked();
    const rows = dimRows(intent.dimension, intent.limit || 5);
    if (!rows.length) return say(`Chưa có dữ liệu ${dimLabel(intent.dimension)} có doanh thu kỳ ${ky}.`);
    return topList(`Top ${intent.limit || rows.length} ${dimLabel(intent.dimension)} có doanh thu kỳ ${ky}:`, rows, (t) => fmtDimItem(intent.dimension, t));
  }
  if (intent.intent === 'breakdown') {
    if (intent.dimension === 'emp' && mine) return say('Anh/Chị chỉ được xem dữ liệu trong phạm vi của mình; doanh thu theo nhân viên thuộc quyền CEO/admin.');
    if (employeeRevenueLocked) return revenueLocked();
    const rows = dimRows(intent.dimension, intent.limit || 10);
    if (!rows.length) return say(`Chưa có dữ liệu ${dimLabel(intent.dimension)} kỳ ${ky}.`);
    return topList(`Doanh thu theo ${dimLabel(intent.dimension)} kỳ ${ky} (${rows.length} mục đầu):`, rows, (t) => fmtDimItem(intent.dimension, t));
  }
  if (intent.intent === 'overview') {
    if (employeeRevenueLocked) return revenueLocked();
    const k = A.overviewKpis({ ky, scope });
    return say(`📊 Tổng hợp kỳ ${ky} (${mine ? 'của bạn' : 'toàn công ty'}):`, withFresh([
      `• Doanh thu: ${fmt(k.revenue)}${k.momPct != null ? ` (${k.momPct >= 0 ? '+' : ''}${fmtPct(k.momPct)} so kỳ trước)` : ''}`,
      k.pctTarget != null ? `• Đạt target: ${fmtPct(k.pctTarget)} (${fmt(k.revenueBeforeVat)}/${fmt(k.targetCompareTotal || k.targetTotal)})` : '• Chưa giao target',
      `• Số NV/đơn vị/sản phẩm có doanh thu: ${k.empCount}/${k.unitCount}/${k.productCount}`,
    ]));
  }
  if (intent.intent === 'target_gap') {
    if (employeeRevenueLocked) return revenueLocked();
    const k = A.overviewKpis({ ky, scope });
    if (k.pctTarget == null) return say(`Kỳ ${ky} chưa giao target nên chưa tính được phần còn thiếu.`);
    const target = k.targetCompareTotal || k.targetTotal || 0;
    const gap = Math.max(0, Math.round(target - k.revenueBeforeVat));
    if (gap <= 0) return say(`Kỳ ${ky}: đã ĐẠT/VƯỢT target (đạt ${fmtPct(k.pctTarget)}). 🎉`);
    const pac = A.targetPacingMeta(ky);
    const daysLeft = Math.max(0, pac.daysInMonth - pac.daysElapsed);
    const perDay = pac.isCurrent && daysLeft > 0 ? Math.round(gap / daysLeft) : 0;
    return say(`Kỳ ${ky}: còn thiếu ${fmt(gap)} để đủ target (đang đạt ${fmtPct(k.pctTarget)}).`, perDay ? [`Còn ${daysLeft} ngày → cần bán ~${fmt(perDay)}/ngày.`] : []);
  }
  if (intent.intent === 'target_pct') {
    if (employeeRevenueLocked) return revenueLocked();
    const k = A.overviewKpis({ ky, scope });
    if (k.pctTarget == null) return say('Chưa có target cho kỳ ' + ky + '.');
    return say(`Kỳ ${ky}: doanh thu trước VAT ${fmt(k.revenueBeforeVat)} / target ${fmt(k.targetCompareTotal || k.targetTotal)} → đạt ${fmtPct(k.pctTarget)}.`);
  }
  if (intent.intent === 'comparison') {
    if (employeeRevenueLocked) return revenueLocked();
    const k = A.overviewKpis({ ky, scope });
    if (k.momPct == null) return say('Chưa đủ dữ liệu kỳ trước để so sánh.');
    return say(`Kỳ ${ky}: doanh thu ${fmt(k.revenue)}, ${k.momPct >= 0 ? 'TĂNG 📈' : 'GIẢM 📉'} ${fmtPct(Math.abs(k.momPct))} so kỳ trước.`, withFresh([]));
  }
  if (intent.intent === 'revenue_total') {
    if (employeeRevenueLocked) return revenueLocked();
    const k = A.overviewKpis({ ky, scope });
    const who = mine ? 'của bạn' : 'toàn công ty';
    const mom = k.momPct == null ? '' : ` (${k.momPct >= 0 ? '+' : ''}${fmtPct(k.momPct)} so kỳ trước)`;
    return say(`Doanh thu ${who} kỳ ${ky}: ${fmt(k.revenue)}${mom}.`, withFresh([]));
  }
  // entity_lookup/help/greeting/unknown tiếp tục xuống các block hiện hữu.

  // Trợ giúp / bot làm được gì
  if (/\b(help|menu|giup)\b|huong dan|lam duoc gi|hoi gi|ban lam gi|chuc nang|tro giup/.test(q)) {
    return say('Mình trả lời được các nhóm câu hỏi sau (gõ có/không dấu đều được):', [
      '💰 Doanh thu: "Doanh thu kỳ này?", "So với tháng trước?"',
      `🏆 Xếp hạng: "Top sản phẩm / đơn vị${mine ? '' : ' / nhân viên'} / nhà thầu / gói thầu / tỉnh"`,
      '🎯 Target: "Tôi đạt bao nhiêu % target?", "Còn thiếu bao nhiêu để đạt target?"',
      '📦 Cơ số thầu: "Cơ số nào sắp cạn?", "Đơn vị nào chưa bán?"',
      '🔎 Tra cứu thuốc: "Giá thầu Paracetamol?", "Doanh thu thuốc X?", "Cơ số còn lại mã QLNB?"',
      '🏥 Tra cứu đơn vị: "Đơn vị BV007 bán bao nhiêu, ai bán?", "011 Cao Su ĐN doanh thu?"',
      `📈 Biến động: "Đơn vị nào giảm mạnh / tăng mạnh?"${mine ? '' : ', "NV nào chưa đạt?"'}`,
      '🗓️ Có thể ghi rõ tháng: "Doanh thu tháng 6?"',
    ]);
  }
  // Chào hỏi
  if (/^(chao|hi|hello|alo|xin chao|hey)\b/.test(q)) {
    return say('Chào Anh/Chị 👋 Mình là trợ lý App Report. Hỏi mình về doanh thu, target, cơ số thầu, top sản phẩm/đơn vị/tỉnh… Gõ "giúp" để xem menu.');
  }

  // Câu tự giới thiệu/kiểm tra liên kết kiểu "Tôi là NV DN001, bạn trả lời tôi nào".
  // Trả bằng code cố định để tránh LLM tự diễn giải sai đơn vị tiền (triệu/tỷ).
  if (/(toi|minh|em)\s+la\b.*\b(nv|nhan vien|dn\d{3}|vp\d{3})\b|\bban tra loi\b|\btra loi toi\b/.test(q)) {
    if (employeeRevenueLocked) {
      const emp = scope.empCode ? store.findUserByCode(scope.empCode) : null;
      return say(`Chào ${emp?.name || scope.empCode} — tài khoản đang liên kết ${scope.empCode}.`, [
        lockedMsg,
        'Sau khi quản trị xác nhận nguồn, Anh/Chị hỏi lại em sẽ trả lời ngay.',
      ]);
    }
    const k = A.overviewKpis({ ky, scope });
    const emp = scope.empCode ? store.findUserByCode(scope.empCode) : null;
    const target = k.targetCompareTotal || k.targetTotal || 0;
    const gap = k.pctTarget != null && target > 0 ? Math.max(0, Math.round(target - k.revenueBeforeVat)) : null;
    const pac = A.targetPacingMeta(ky);
    const daysLeft = Math.max(0, (pac.daysInMonth || 0) - (pac.daysElapsed || 0));
    const lines = [
      `• Doanh thu: ${fmt(k.revenue)}`,
      `• Doanh thu trước VAT: ${fmt(k.revenueBeforeVat)}`,
      target > 0 ? `• Target: ${fmt(target)} · đạt ${fmtPct(k.pctTarget)}` : '• Chưa có target kỳ này',
    ];
    if (gap != null) lines.push(gap > 0 ? `• Còn thiếu: ${fmt(gap)}${daysLeft ? ` · cần ~${fmt(Math.round(gap / daysLeft))}/ngày` : ''}` : '• Đã đạt/vượt target 🎉');
    if (k.momPct != null) lines.push(`• So kỳ trước: ${k.momPct >= 0 ? '+' : ''}${fmtPct(k.momPct)}`);
    lines.push('• Chi tiết sản phẩm/đơn vị/số lượng: đang khóa tạm để kiểm tra lại nguồn gán doanh số, tránh trả sai.');
    return say(`Chào ${emp?.name || (scope.empCode ? scope.empCode : 'Anh/Chị')} — tài khoản đang liên kết ${scope.empCode || 'quyền admin'}. Báo cáo kỳ ${ky}:`, lines);
  }

  // Tra cứu ĐÍCH DANH: giá thầu / mã QLNB / hoạt chất / cơ số còn lại của MỘT thuốc cụ thể.
  // ĐẶT TRƯỚC các mẫu "top…" (vì "top …" bắt cả "bao nhiêu"→"nhiều") để câu hỏi đích danh thắng.
  if (/gia thau|don gia|qlnb|ma hang|ma thuoc|hoat chat|tra cuu|tim thuoc|thong tin (san pham|thuoc)/.test(q)) {
    const ans = sayProductLookup(prodHits(), ky);
    if (ans) return ans;
    return say('Chưa tìm thấy thuốc/mã QLNB khớp trong phạm vi dữ liệu của bạn 🤔.', [
      'Thử gõ đúng TÊN thuốc hoặc MÃ QLNB, ví dụ:',
      '• "giá thầu Paracetamol"',
      '• "cơ số còn lại mã 12345"',
      '• "doanh thu thuốc Amlodipin"',
    ]);
  }
  const isTopUnitQuery = /(top|xep hang|cao nhat|nhieu nhat).*(don vi|benh vien|phong kham|khach)|(don vi|benh vien|khach).*(top|xep hang|cao|nhieu)/.test(q);
  // Tra cứu ĐÍCH DANH 1 ĐƠN VỊ: "BV007 bán được bao nhiêu, ai bán?" (KHÔNG lẫn với "top đơn vị").
  if (!isTopUnitQuery && (/\bai ban\b|ai phu trach|nhan vien nao ban|nv nao ban/.test(q)
      || /(don vi|benh vien|phong kham|nha thuoc|khach hang|ma dv)\b.*(ban duoc|bao nhieu|doanh thu|doanh so|ai ban)/.test(q)
      || /(ban duoc|doanh thu|doanh so).*(don vi|benh vien|phong kham|nha thuoc|ma dv)\b/.test(q))) {
    const ans = sayUnitLookup(unitHits(), ky, mine);
    if (ans) return ans;
    if (/\bai ban\b|ai phu trach/.test(q)) {
      return say('Chưa xác định được đơn vị nào trong câu hỏi 🤔.', [
        'Thử gõ kèm MÃ hoặc TÊN đơn vị, ví dụ:',
        '• "đơn vị BV007 bán được bao nhiêu, ai bán?"',
        '• "011 Cao Su Đồng Nai doanh thu bao nhiêu?"',
      ]);
    }
  }

  if (/(top|cao nhat|ban chay|nhieu nhat|xep hang).*(san pham|thuoc|mat hang)|(san pham|thuoc|mat hang).*(top|cao|ban chay|nhieu|xep hang)/.test(q)) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const limit = limitFromQuestion(5, 20);
    const top = A.revenueBreakdown({ ky, scope, dimension: 'product' }).filter((t) => Number(t.revenue || 0) > 0).slice(0, limit);
    return topList(`Top ${limit} sản phẩm có doanh thu kỳ ${ky}:`, top, (t) => `${t.label}: ${fmt(t.revenue)}`);
  }
  if (isTopUnitQuery || /(co doanh thu|phat sinh doanh thu).*(don vi|benh vien|phong kham|khach)|(don vi|benh vien|phong kham|khach).*(co doanh thu|phat sinh doanh thu)/.test(q)) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const limit = limitFromQuestion(/top\s*10|10\s*(don vi|benh vien|phong kham|khach)/.test(q) ? 10 : 10, 20);
    const top = A.revenueBreakdown({ ky, scope, dimension: 'unit' }).filter((t) => Number(t.revenue || 0) > 0).slice(0, limit);
    return topList(`Top ${limit} đơn vị có doanh thu kỳ ${ky}:`, top, (t) => `${unitText(t.key, t.label)}: ${fmt(t.revenue)}`);
  }
  if (/(xep hang|ranking|top|dan dau|dung dau|cao nhat|nhieu nhat).*(nhan vien|nv|sale)|(nhan vien|nv|sale).*(top|cao|xep hang|nhieu|dan dau|dung dau)|\b(ai|nguoi nao)\b.*(dan dau|dung dau|cao nhat|nhieu nhat)/.test(q)) {
    if (mine) return say('Anh/Chị chỉ được xem dữ liệu trong phạm vi của mình; xếp hạng nhân viên thuộc quyền CEO/admin.');
    const limit = limitFromQuestion(5, 20);
    const top = A.revenueBreakdown({ ky, scope, dimension: 'emp' }).filter((t) => Number(t.revenue || 0) > 0).slice(0, limit);
    return topList(`Top ${limit} nhân viên kỳ ${ky}:`, top, (t) => `${t.label}: ${fmt(t.revenue)}`);
  }
  if (!mine && (/(doanh thu|doanh so).*(theo|tung|moi|liet ke|thong ke).*(nhan vien|nv|sale)|(nhan vien|nv|sale).*(co doanh thu|phat sinh doanh thu|doanh thu|doanh so)/.test(q))) {
    const limit = limitFromQuestion(10, 30);
    const rows = A.revenueBreakdown({ ky, scope, dimension: 'emp' }).filter((t) => Number(t.revenue || 0) > 0).slice(0, limit);
    return topList(`Doanh thu theo nhân viên kỳ ${ky} (${rows.length} NV đầu):`, rows, (t) => `${t.label}: ${fmt(t.revenue)}`);
  }
  if (/nha thau/.test(q)) {
    const g = A.groupSum(rowsFor(), 'contractor_code', 'contractor_name').slice(0, 5);
    if (!g.length) return say(`Chưa có dữ liệu nhà thầu trong kỳ ${ky}.`);
    return topList(`Top nhà thầu kỳ ${ky}:`, g, (t) => `${t.label}: ${fmt(t.revenue)}`);
  }
  if (/goi thau/.test(q)) {
    const g = A.groupSum(rowsFor().filter((r) => r.bid_package), 'bid_package', 'bid_package').slice(0, 5);
    if (!g.length) return say(`Chưa có dữ liệu gói thầu trong kỳ ${ky}.`);
    return topList(`Top gói thầu kỳ ${ky}:`, g, (t) => `${t.label}: ${fmt(t.revenue)}`);
  }
  if (/\btinh\b|thanh pho|khu vuc|dong nai|binh phuoc|vung tau/.test(q)) {
    const g = A.groupSum(rowsFor().filter((r) => r.province), 'province', 'province').slice(0, 8);
    if (!g.length) return say(`Chưa gán được tỉnh cho dữ liệu kỳ ${ky}.`);
    return topList(`Doanh thu theo tỉnh kỳ ${ky}:`, g, (t) => `${t.label}: ${fmt(t.revenue)}`);
  }
  // Báo cáo theo TỪNG đơn vị (không chỉ "top") — vd "báo cáo bán hàng theo từng mã đơn vị"
  if (/(bao cao|theo|tung|moi|liet ke|thong ke|chi tiet).*(don vi|benh vien|phong kham|khach hang|ma dv)/.test(q)) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const rows = A.revenueBreakdown({ ky, scope, dimension: 'unit' }).slice(0, 15);
    if (!rows.length) return say(`Chưa có doanh thu theo đơn vị kỳ ${ky}.`);
    return topList(`Doanh thu theo đơn vị kỳ ${ky} (${rows.length} đơn vị đầu):`, rows, (t) => `${unitText(t.key, t.label)}: ${fmt(t.revenue)}`);
  }
  // Báo cáo theo TỪNG sản phẩm
  if (/(bao cao|theo|tung|moi|liet ke|thong ke|chi tiet).*(san pham|thuoc|ma hang|ma qlnb)/.test(q)) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const rows = A.revenueBreakdown({ ky, scope, dimension: 'product' }).slice(0, 15);
    if (!rows.length) return say(`Chưa có doanh thu theo sản phẩm kỳ ${ky}.`);
    return topList(`Doanh thu theo sản phẩm kỳ ${ky} (${rows.length} SP đầu):`, rows, (t) => `${t.label}: ${fmt(t.revenue)}`);
  }
  // Báo cáo tổng hợp / tổng quan
  if (/bao cao tong hop|tong hop|tong quan|bao cao chung|tinh hinh chung|so lieu chung/.test(q)) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const k = A.overviewKpis({ ky, scope });
    return say(`📊 Tổng hợp kỳ ${ky} (${mine ? 'của bạn' : 'toàn công ty'}):`, [
      `• Doanh thu: ${fmt(k.revenue)}${k.momPct != null ? ` (${k.momPct >= 0 ? '+' : ''}${fmtPct(k.momPct)} so kỳ trước)` : ''}`,
      k.pctTarget != null ? `• Đạt target: ${fmtPct(k.pctTarget)} (${fmt(k.revenueBeforeVat)}/${fmt(k.targetCompareTotal || k.targetTotal)})` : '• Chưa giao target',
      '• Gõ "top đơn vị", "top sản phẩm", "đơn vị giảm mạnh"… để xem chi tiết.',
    ]);
  }
  // Biến động đơn vị (giảm/tăng mạnh)
  if (/giam manh|sut giam|tut manh|giam nhieu|tang manh|tang truong/.test(q)) {
    const al = buildAlerts({ ky, scope });
    const down = al.groups.find((g) => g.key === 'unit_down');
    const up = al.groups.find((g) => g.key === 'unit_up');
    const lines = [];
    if (down?.items?.length) { lines.push(`📉 Giảm mạnh (${down.total}):`); down.items.slice(0, 5).forEach((u) => lines.push(`• ${unitText(u.unit_code, u.unit_name)}: ${fmtPct(u.mom)}`)); }
    if (up?.items?.length) { lines.push(`📈 Tăng mạnh (${up.total}):`); up.items.slice(0, 5).forEach((u) => lines.push(`• ${unitText(u.unit_code, u.unit_name)}: +${fmtPct(u.mom)}`)); }
    if (!lines.length) return say(`Kỳ ${ky}: chưa thấy đơn vị tăng/giảm bất thường (hoặc thiếu dữ liệu kỳ trước để so).`);
    return say(`Biến động đơn vị kỳ ${ky} (so kỳ trước):`, lines);
  }
  // NV chưa đạt (chỉ admin)
  if (!mine && /(nv|nhan vien|ai)\b.*(chua dat|chua hoan thanh|kem|thap|cham nhip|yeu)|chua dat target/.test(q)) {
    const g = buildAlerts({ ky, scope }).groups.find((x) => x.key === 'target');
    if (!g?.items?.length) return say(`Kỳ ${ky}: không có NV nào dưới 80% target (hoặc chưa giao target).`);
    return say(`NV chưa đạt target kỳ ${ky} (${g.total}):`, g.items.slice(0, 8).map((t) => `• ${t.name || t.emp_code}: ${fmtPct(t.pct)}`));
  }
  // Đơn vị chưa bán (cơ số còn nhưng chưa khai thác)
  if (/chua ban|chua khai thac|can cham|chua co don|chua ban gi/.test(q)) {
    const empty = A.cstTable({ scope, filters: { status: 'empty' } });
    if (!empty.length) return say('Không có cơ số thầu nào "chưa bán" trong phạm vi của bạn. 👍');
    return say(`Có ${empty.length} dòng cơ số thầu CHƯA bán (cần tiếp cận):`,
      empty.slice(0, 6).map((c) => `• ${c.product_name} @ ${unitText(c.unit_code, c.unit_name)}`));
  }
  if (/co so|con lai|sap can|ton kho|con nhieu/.test(q)) {
    const low = A.cstTable({ scope, remainPctMax: 10 });
    if (!low.length) return say('Không có cơ số thầu nào dưới 10% trong phạm vi của bạn.');
    return say(`Có ${low.length} dòng cơ số thầu sắp cạn (<10%):`,
      low.slice(0, 5).map((c) => `• ${c.product_name} @ ${unitText(c.unit_code, c.unit_name)}: còn ${fmtPct(c.remain_pct)}`));
  }
  // Còn thiếu / cần bán bao nhiêu để đạt target
  if (/con thieu|con bao nhieu|can ban bao nhieu|can them|bao nhieu nua|de dat target|cach target|cham target|con cach/.test(q)) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const k = A.overviewKpis({ ky, scope });
    if (k.pctTarget == null) return say(`Kỳ ${ky} chưa giao target nên chưa tính được phần còn thiếu.`);
    const target = k.targetCompareTotal || k.targetTotal || 0;
    const gap = Math.max(0, Math.round(target - k.revenueBeforeVat));
    if (gap <= 0) return say(`Kỳ ${ky}: đã ĐẠT/VƯỢT target (đạt ${fmtPct(k.pctTarget)}). 🎉`);
    const pac = A.targetPacingMeta(ky);
    const daysLeft = Math.max(0, pac.daysInMonth - pac.daysElapsed);
    const perDay = pac.isCurrent && daysLeft > 0 ? Math.round(gap / daysLeft) : 0;
    return say(`Kỳ ${ky}: còn thiếu ${fmt(gap)} để đủ target (đang đạt ${fmtPct(k.pctTarget)}).`, perDay ? [`Còn ${daysLeft} ngày → cần bán ~${fmt(perDay)}/ngày.`] : []);
  }
  if (/target|chi tieu|% ?dat|dat bao nhieu|hoan thanh/.test(q)) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const k = A.overviewKpis({ ky, scope });
    if (k.pctTarget == null) return say('Chưa có target cho kỳ ' + ky + '.');
    return say(`Kỳ ${ky}: doanh thu trước VAT ${fmt(k.revenueBeforeVat)} / target ${fmt(k.targetCompareTotal || k.targetTotal)} → đạt ${fmtPct(k.pctTarget)}.`);
  }
  // So với kỳ trước / tăng hay giảm
  if (/so voi|so ky truoc|so thang truoc|tang hay giam|tang giam|bien dong|so sanh/.test(q)) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const k = A.overviewKpis({ ky, scope });
    if (k.momPct == null) return say('Chưa đủ dữ liệu kỳ trước để so sánh.');
    return say(`Kỳ ${ky}: doanh thu ${fmt(k.revenue)}, ${k.momPct >= 0 ? 'TĂNG 📈' : 'GIẢM 📉'} ${fmtPct(Math.abs(k.momPct))} so kỳ trước.`);
  }
  // Doanh thu/doanh số chung: ưu tiên trước fuzzy lookup để không bắt nhầm "tôi/tổng" thành đơn vị/thuốc.
  // Nếu câu hỏi nêu rõ thuốc/sản phẩm/mã QLNB hoặc đơn vị thì mới cho tra cứu đích danh.
  const asksRevenue = /doanh thu|doanh so|tong tien|bao nhieu tien|ban duoc/.test(q);
  const hasProductCue = /thuoc|san pham|ma hang|ma thuoc|qlnb|hoat chat|gia thau/.test(q);
  const hasUnitCue = /don vi|benh vien|phong kham|nha thuoc|khach hang|ma dv|ai ban|ai phu trach/.test(q);
  if (asksRevenue && !hasProductCue && !hasUnitCue) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const k = A.overviewKpis({ ky, scope });
    const who = mine ? 'của bạn' : 'toàn công ty';
    const mom = k.momPct == null ? '' : ` (${k.momPct >= 0 ? '+' : ''}${fmtPct(k.momPct)} so kỳ trước)`;
    return say(`Doanh thu ${who} kỳ ${ky}: ${fmt(k.revenue)}${mom}.`);
  }

  // Câu hỏi NHẮC ĐÍCH DANH một thuốc (kể cả không có từ khoá "giá thầu/qlnb") -> trả lời theo sản phẩm.
  {
    const hits = prodHits();
    if (hits.length) { const ans = sayProductLookup(hits, ky); if (ans) return ans; }
  }
  // ... rồi tới ĐƠN VỊ đích danh (nếu câu hỏi có nhắc mã/tên đơn vị).
  {
    const hits = unitHits();
    if (hits.length) { const ans = sayUnitLookup(hits, ky, mine); if (ans) return ans; }
  }
  if (asksRevenue) {
    if (employeeRevenueLocked) return say(lockedMsg);
    const k = A.overviewKpis({ ky, scope });
    const who = mine ? 'của bạn' : 'toàn công ty';
    const mom = k.momPct == null ? '' : ` (${k.momPct >= 0 ? '+' : ''}${fmtPct(k.momPct)} so kỳ trước)`;
    return say(`Doanh thu ${who} kỳ ${ky}: ${fmt(k.revenue)}${mom}.`);
  }

  // Không khớp mẫu code → nếu có LLM (grounded) thì nhờ diễn giải trên FACTS đã tính.
  if (llm.isEnabled()) {
    const facts = buildFacts({ ky, scope, mine });
    const ph = prodHits();
    if (ph.length) facts.tra_cuu_san_pham = ph; // thuốc/mã QLNB/giá thầu câu hỏi nhắc tới
    const uh = unitHits();
    if (uh.length) facts.tra_cuu_don_vi = uh; // đơn vị + ai bán + top SP tại đơn vị
    const ans = await llm.callLlm({ question: text, facts });
    if (ans) return { text: ans.text, lines: [], source: 'llm' };
  }

  return say('Mình chưa rõ ý câu hỏi 🤔. Bạn thử hỏi một trong các nhóm sau:', [
    '💰 "Doanh thu kỳ này?" · "So với tháng trước?"',
    `🏆 "Top sản phẩm / đơn vị${mine ? '' : ' / nhân viên'} / nhà thầu / gói thầu / tỉnh"`,
    '🎯 "Tôi đạt bao nhiêu % target?" · "Còn thiếu bao nhiêu để đạt target?"',
    `📦 "Cơ số nào sắp cạn?" · "Đơn vị nào chưa bán?"${mine ? '' : ' · "NV nào chưa đạt?"'}`,
    '🔎 "Giá thầu / doanh thu / cơ số còn lại của thuốc (tên hoặc mã QLNB)"',
    '🏥 "Đơn vị (mã/tên) bán được bao nhiêu, ai bán?"',
    '📈 "Đơn vị nào giảm mạnh / tăng mạnh?"',
    '— Gõ "giúp" để xem đầy đủ menu.',
  ]);
}

// Gom SỐ đã tính (trong phạm vi quyền) để đưa LLM — không có dữ liệu thô/PII.
function buildFacts({ ky, scope, mine }) {
  const k = A.overviewKpis({ ky, scope });
  const rows = store.getRows({ ky, scope });
  const pac = A.targetPacingMeta(ky);
  const target = k.targetCompareTotal || k.targetTotal || 0;
  const truocVat = k.revenueBeforeVat || 0;
  const conThieu = k.pctTarget != null && target > 0 ? Math.max(0, Math.round(target - truocVat)) : null;
  const daysLeft = Math.max(0, (pac.daysInMonth || 0) - (pac.daysElapsed || 0));
  const topRev = (dim, n = 8) => A.revenueBreakdown({ ky, scope, dimension: dim }).slice(0, n);
  const groupTop = (field, labelField, filter) => A.groupSum(filter ? rows.filter(filter) : rows, field, labelField).slice(0, 8);
  // Xu hướng doanh thu 6 kỳ gần nhất (dữ liệu đã cache nên nhẹ).
  const xuHuong = store.periodKys().slice(-6).map((kk) => ({ ky: kk, doanh_thu: Math.round(store.getRows({ ky: kk, scope }).reduce((s, r) => s + Number(r.revenue || 0), 0)) }));
  // Biến động đơn vị + NV chưa đạt (từ buildAlerts).
  let tangManh = [], giamManh = [], nvChuaDat = [];
  try {
    const al = buildAlerts({ ky, scope });
    giamManh = (al.groups.find((g) => g.key === 'unit_down')?.items || []).slice(0, 6).map((u) => ({ ten: unitText(u.unit_code, u.unit_name), giam_pct: u.mom }));
    tangManh = (al.groups.find((g) => g.key === 'unit_up')?.items || []).slice(0, 6).map((u) => ({ ten: unitText(u.unit_code, u.unit_name), tang_pct: u.mom }));
    if (!mine) nvChuaDat = (al.groups.find((g) => g.key === 'target')?.items || []).slice(0, 10).map((t) => ({ ten: t.name || t.emp_code, dat_pct: t.pct }));
  } catch { /* thiếu dữ liệu kỳ trước -> bỏ qua */ }
  // Danh sách TỪNG NV (CHỈ admin — NV thường không thấy người khác).
  let danhSachNV;
  if (!mine) {
    const empRev = Object.fromEntries(A.revenueBreakdown({ ky, scope, dimension: 'emp' }).map((e) => [e.key, e.revenue]));
    const tByEmp = {};
    for (const t of store.getTargetsRange({ kys: [ky], scope })) tByEmp[t.emp_code] = (tByEmp[t.emp_code] || 0) + Number(t.target || 0);
    danhSachNV = store.targetRoster({ scope }).map((u) => {
      const bvat = Math.round((empRev[u.emp_code] || 0) / A.VAT_DIVISOR);
      const tg = tByEmp[u.emp_code] || 0;
      return { ma: u.emp_code, ten: u.name || u.emp_code, doanh_thu_truoc_vat: bvat, target: tg, dat_pct: tg > 0 ? +(bvat / tg * 100).toFixed(1) : null };
    }).sort((a, b) => b.doanh_thu_truoc_vat - a.doanh_thu_truoc_vat);
  }
  return {
    ky,
    phamvi: mine ? 'chỉ nhân viên đang đăng nhập' : 'toàn công ty',
    doanh_thu: k.revenue,
    doanh_thu_truoc_vat: truocVat,
    target_tong: target,
    phan_tram_dat: k.pctTarget,
    con_thieu_target: conThieu,
    con_thieu_target_hien_thi: conThieu == null ? null : fmtHumanMoney(conThieu),
    can_ban_moi_ngay_hien_thi: conThieu && daysLeft > 0 ? `${fmtHumanMoney(Math.round(conThieu / daysLeft))}/ngày` : null,
    tien_do_thoi_gian_pct: +((pac.factor || 0) * 100).toFixed(1),
    so_ngay_con_lai: daysLeft,
    can_ban_moi_ngay: conThieu && daysLeft > 0 ? Math.round(conThieu / daysLeft) : null,
    tang_giam_so_ky_truoc_pct: k.momPct,
    xu_huong_doanh_thu_cac_ky: xuHuong,
    top_san_pham: topRev('product').map((x) => ({ ten: x.label, doanh_thu: x.revenue })),
    top_don_vi: topRev('unit').map((x) => ({ ten: unitText(x.key, x.label), doanh_thu: x.revenue })),
    top_nha_thau: groupTop('contractor_code', 'contractor_name').map((x) => ({ ten: x.label, doanh_thu: x.revenue })),
    top_goi_thau: groupTop('bid_package', 'bid_package', (r) => r.bid_package).map((x) => ({ ten: x.label, doanh_thu: x.revenue })),
    top_tinh: groupTop('province', 'province', (r) => r.province).map((x) => ({ ten: x.label, doanh_thu: x.revenue })),
    don_vi_tang_manh: tangManh,
    don_vi_giam_manh: giamManh,
    ...(mine ? {} : {
      top_nhan_vien: topRev('emp', 5).map((x) => ({ ten: x.label, doanh_thu: x.revenue })),
      danh_sach_nhan_vien: danhSachNV,
      nv_chua_dat_target: nvChuaDat,
    }),
    co_so_thau_sap_can: A.cstTable({ scope, remainPctMax: 10 }).slice(0, 8).map((c) => ({ sp: c.product_name, dv: unitText(c.unit_code, c.unit_name), con_lai_pct: c.remain_pct })),
    so_don_vi_chua_ban: A.cstTable({ scope, filters: { status: 'empty' } }).length,
  };
}

/* ---------------- TRA CỨU ĐÍCH DANH (thuốc / mã QLNB / giá thầu / cơ số) ---------------- */
// Từ "chung chung" trong câu hỏi + đơn vị bào chế — KHÔNG dùng để nhận diện tên thuốc.
const PROD_STOP = new Set([
  'thuoc', 'san', 'pham', 'vien', 'nang', 'ong', 'chai', 'tuyp', 'hop', 'goi', 'lo',
  'dung', 'dich', 'tiem', 'uong', 'nho', 'mat', 'bot', 'kem', 'siro', 'sui',
  'gam', 'gram', 'mcg', 'iu', 'ui', 'cua', 'gia', 'thau', 'doanh', 'thu', 'con',
  'bao', 'nhieu', 'cho', 'ban', 'duoc', 'thang', 'nay', 'hoi', 'xem', 'qlnb',
  'hoat', 'chat', 'lai', 'vao', 'hay', 'the', 'nao', 'cao', 'hien', 'tai',
  'tra', 'cuu', 'tim', 'thong', 'tin', 'hang', 'con', 'thieu', 'bang', 'tong',
]);
// Tách "từ đặc trưng" của tên thuốc/hoạt chất để nhận diện thuốc trong câu hỏi:
//   - từ chữ >=4 ký tự (VD "paracetamol", "amlodipin"), HOẶC
//   - mã ngắn có CẢ chữ lẫn số >=3 ký tự (VD "e05", "b02", "n14") — rất đặc trưng.
// Bỏ số thuần, đơn vị đo, và từ chung chung (PROD_STOP).
function prodTokens(s) {
  return noAccent(String(s || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => {
      if (/^\d+$/.test(w) || /^\d+(mg|ml|g|mcg)$/.test(w) || PROD_STOP.has(w)) return false;
      if (w.length >= 4) return true;
      return w.length >= 3 && /[a-z]/.test(w) && /[0-9]/.test(w); // mã ngắn kiểu B02/E05
    });
}
/**
 * lookupProducts — tra cứu ĐÍCH DANH 1..N thuốc mà câu hỏi nhắc tới (theo tên/mã QLNB/hoạt chất),
 * TRẢ VỀ trong phạm vi quyền (NV chỉ thấy phần của mình). Không bịa: số từ getRows/getCst.
 * Kết quả mỗi thuốc: doanh thu, số lượng, GIÁ THẦU, cơ số còn lại, đơn vị đang bán, cơ số theo đơn vị.
 */
function lookupProducts({ q, ky, scope, max = 3 }) {
  const qn = ' ' + noAccent(String(q || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  if (qn.trim().length < 2) return [];
  const rows = store.getRows({ ky, scope });
  const cstAll = store.getCst({ scope });

  const prod = new Map();
  const getP = (code, name) => {
    const c = String(code || '').trim();
    if (!c) return null;
    let p = prod.get(c);
    if (!p) { p = { code: c, name: name || c, revenue: 0, quantity: 0, units: new Map(), emps: new Map(), cst: [] }; prod.set(c, p); }
    if ((!p.name || p.name === c) && name) p.name = name;
    return p;
  };
  for (const r of rows) {
    const p = getP(r.iit_code, r.product_name); if (!p) continue;
    p.revenue += Number(r.revenue || 0); p.quantity += Number(r.quantity || 0);
    const uk = r.unit_code || r.unit_name;
    if (uk) {
      const u = p.units.get(uk) || { code: r.unit_code, name: r.unit_name || r.unit_code, revenue: 0, quantity: 0 };
      u.revenue += Number(r.revenue || 0); u.quantity += Number(r.quantity || 0); p.units.set(uk, u);
    }
    const ek = r.emp_code;
    if (ek) {
      if (!p.emps) p.emps = new Map();
      const e = p.emps.get(ek) || { code: ek, name: r.emp_name || ek, revenue: 0, quantity: 0 };
      e.revenue += Number(r.revenue || 0); e.quantity += Number(r.quantity || 0); p.emps.set(ek, e);
    }
  }
  // Gắn CST (cơ số/giá thầu) cho mọi sản phẩm — kể cả thuốc đã trúng thầu nhưng kỳ này chưa bán.
  for (const c of cstAll) { const p = getP(c.iit_code, c.product_name); if (p) p.cst.push(c); }

  const hits = [];
  for (const p of prod.values()) {
    const codeN = noAccent(String(p.code).toLowerCase());
    let matched = codeN.length >= 3 && qn.includes(codeN);
    if (!matched) {
      const toks = new Set([
        ...prodTokens(p.name),
        ...p.cst.flatMap((c) => prodTokens(c.ham_luong || c.active_ingredient || '')),
      ]);
      for (const t of toks) { if (qn.includes(t)) { matched = true; break; } }
    }
    if (matched) hits.push(p);
  }
  hits.sort((a, b) => b.revenue - a.revenue);
  return hits.slice(0, max).map((p) => {
    const cst = p.cst;
    const bidQty = cst.reduce((s, c) => s + Number(c.bid_qty_initial || 0), 0);
    const soldQty = cst.reduce((s, c) => s + Number(c.sold_qty || 0), 0);
    const remainQty = cst.reduce((s, c) => s + Number(c.remain_qty || 0), 0);
    const remainPct = bidQty > 0 ? +(remainQty / bidQty * 100).toFixed(1) : (cst[0]?.remain_pct ?? null);
    const prices = [...new Set(cst.map((c) => Number(c.bid_price || 0)).filter((v) => v > 0))];
    const units = [...p.units.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
    const emps = [...(p.emps || new Map()).values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
    return {
      ma: p.code,
      ten: p.name,
      ham_luong: cst.find((c) => c.ham_luong)?.ham_luong || '',
      doanh_thu: Math.round(p.revenue),
      so_luong: p.quantity,
      gia_thau: prices.length ? (prices.length === 1 ? prices[0] : prices) : null,
      co_so_ban_dau: bidQty || null,
      da_ban: soldQty || null,
      con_lai: cst.length ? remainQty : null,
      con_lai_pct: remainPct,
      don_vi_dang_ban: units.map((u) => ({ ten: unitText(u.code, u.name), doanh_thu: Math.round(u.revenue), so_luong: u.quantity })),
      ai_ban: emps.map((e) => ({ ma: e.code, ten: e.name, doanh_thu: Math.round(e.revenue), so_luong: e.quantity })),
      co_so_theo_don_vi: cst.slice(0, 6).map((c) => ({
        dv: unitText(c.unit_code, c.unit_name), goi: c.bid_package || '',
        gia_thau: Number(c.bid_price || 0) || null,
        con_lai: Number(c.remain_qty || 0), tong: Number(c.bid_qty_initial || 0), con_lai_pct: c.remain_pct,
      })),
    };
  });
}
// Định dạng câu trả lời tra cứu đích danh (dùng cho intent code-first).
function sayProductLookup(hits, ky) {
  if (!hits.length) return null;
  const nf = (n) => Number(n || 0).toLocaleString('vi-VN');
  const lines = [];
  for (const p of hits) {
    lines.push(`📌 ${p.ten} (${p.ma})${p.ham_luong ? ` · ${p.ham_luong}` : ''}`);
    lines.push(`• Doanh thu: ${fmt(p.doanh_thu)}${p.so_luong ? ` · SL ${nf(p.so_luong)}` : ''}`);
    if (p.gia_thau != null) {
      lines.push(`• Giá thầu: ${Array.isArray(p.gia_thau) ? p.gia_thau.map((v) => fmt(v)).join(' / ') : fmt(p.gia_thau)}`);
    }
    if (p.con_lai != null) {
      lines.push(`• Cơ số còn lại: ${nf(p.con_lai)}${p.co_so_ban_dau ? `/${nf(p.co_so_ban_dau)}` : ''}${p.con_lai_pct != null ? ` (${fmtPct(p.con_lai_pct)})` : ''}`);
    }
    if (p.don_vi_dang_ban.length) {
      lines.push(`• Đơn vị đang bán: ${p.don_vi_dang_ban.map((u) => `${u.ten}: ${fmt(u.doanh_thu)}`).join(' · ')}`);
    } else if (p.co_so_ban_dau) {
      lines.push('• Kỳ này chưa phát sinh doanh thu (còn cơ số để khai thác).');
    }
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  return say(`🔎 Tra cứu kỳ ${ky}:`, lines);
}

// Từ chung chung của TÊN ĐƠN VỊ (bệnh viện/phòng khám…) — bỏ khi nhận diện đơn vị.
const UNIT_STOP = new Set([
  'benh', 'vien', 'phong', 'kham', 'nha', 'thuoc', 'mau', 'trung', 'tam', 'khoa',
  'don', 'vi', 'khach', 'hang', 'cong', 'ty', 'tnhh', 'cty', 'trach', 'nhiem',
  'huu', 'han', 'the', 'ban', 'duoc', 'doanh', 'thu', 'bao', 'nhieu', 'gia', 'thau',
  'tai', 'hien', 'nay', 'thang', 'con', 'lai', 'nao', 'cua', 'quan', 'huyen',
]);
function unitTokens(s) {
  return noAccent(String(s || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => {
      if (/^\d+$/.test(w) || UNIT_STOP.has(w)) return false;
      if (w.length >= 4) return true;
      return w.length >= 3 && /[a-z]/.test(w) && /[0-9]/.test(w);
    });
}
/**
 * lookupUnits — tra cứu ĐÍCH DANH 1..N ĐƠN VỊ (theo mã hoặc tên): bán được bao nhiêu,
 * AI bán (NV nào — CHỈ trong phạm vi quyền: NV thường chỉ thấy chính mình), top sản phẩm
 * tại đơn vị, số dòng cơ số + số sắp cạn. Không bịa: số từ getRows/getCst.
 */
function lookupUnits({ q, ky, scope, max = 3 }) {
  const qn = ' ' + noAccent(String(q || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  if (qn.trim().length < 2) return [];
  const rows = store.getRows({ ky, scope });
  const cstAll = store.getCst({ scope });

  const um = new Map();
  const getU = (code, name) => {
    const key = String(code || name || '').trim();
    if (!key) return null;
    let u = um.get(key);
    if (!u) { u = { code: String(code || '').trim(), name: name || code || key, revenue: 0, quantity: 0, emps: new Map(), prods: new Map(), cst: [] }; um.set(key, u); }
    if ((!u.name || u.name === u.code) && name) u.name = name;
    return u;
  };
  for (const r of rows) {
    const u = getU(r.unit_code, r.unit_name); if (!u) continue;
    u.revenue += Number(r.revenue || 0); u.quantity += Number(r.quantity || 0);
    const ek = r.emp_code;
    if (ek) { const e = u.emps.get(ek) || { code: ek, name: r.emp_name || ek, revenue: 0 }; e.revenue += Number(r.revenue || 0); u.emps.set(ek, e); }
    const pk = r.iit_code;
    if (pk) { const p = u.prods.get(pk) || { code: pk, name: r.product_name || pk, revenue: 0 }; p.revenue += Number(r.revenue || 0); u.prods.set(pk, p); }
  }
  for (const c of cstAll) { const u = getU(c.unit_code, c.unit_name); if (u) u.cst.push(c); }

  const hits = [];
  for (const u of um.values()) {
    const codeN = noAccent(String(u.code).toLowerCase()).replace(/[^a-z0-9]/g, '');
    const digits = (String(u.code).match(/\d{2,}/) || [])[0] || '';
    const digitsNoZero = digits.replace(/^0+/, ''); // "017" -> "17" (người hỏi hay bỏ số 0)
    let matched = false;
    if (codeN.length >= 4 && qn.includes(codeN)) matched = true;       // vd "bv007"
    if (!matched && digits && (qn.includes(` ${digits} `) || (digitsNoZero.length >= 2 && qn.includes(` ${digitsNoZero} `)))) matched = true; // vd "011" / "17"
    if (!matched) { for (const t of unitTokens(u.name)) { if (qn.includes(t)) { matched = true; break; } } }
    if (matched) hits.push(u);
  }
  hits.sort((a, b) => b.revenue - a.revenue);
  return hits.slice(0, max).map((u) => {
    const emps = [...u.emps.values()].sort((a, b) => b.revenue - a.revenue);
    const prods = [...u.prods.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    const cstLow = u.cst.filter((c) => Number(c.remain_pct || 0) < 10).length;
    return {
      ma: u.code,
      ten: unitText(u.code, u.name),
      doanh_thu: Math.round(u.revenue),
      so_luong: u.quantity,
      ai_ban: emps.map((e) => ({ ma: e.code, ten: e.name, doanh_thu: Math.round(e.revenue) })),
      top_san_pham: prods.map((p) => ({ ten: p.name, doanh_thu: Math.round(p.revenue) })),
      so_dong_co_so: u.cst.length,
      co_so_sap_can: cstLow,
      co_so: u.cst.slice(0, 6).map((c) => ({ sp: c.product_name, ma_sp: c.iit_code, con_lai: Number(c.remain_qty || 0), tong: Number(c.bid_qty_initial || 0), con_lai_pct: c.remain_pct, goi: c.bid_package || '' })),
    };
  });
}
function sayUnitLookup(hits, ky, mine) {
  if (!hits.length) return null;
  const nf = (n) => Number(n || 0).toLocaleString('vi-VN');
  const lines = [];
  for (const u of hits) {
    lines.push(`🏥 ${u.ten}`);
    lines.push(`• Doanh thu: ${fmt(u.doanh_thu)}${u.so_luong ? ` · SL ${nf(u.so_luong)}` : ''}`);
    if (u.ai_ban.length) {
      lines.push(`• ${mine ? 'Bạn bán' : 'Ai bán'}: ${u.ai_ban.map((e) => `${e.ten}: ${fmt(e.doanh_thu)}`).join(' · ')}`);
    }
    if (u.top_san_pham.length) {
      lines.push(`• Top sản phẩm: ${u.top_san_pham.map((p) => `${p.ten}: ${fmt(p.doanh_thu)}`).join(' · ')}`);
    }
    if (u.so_dong_co_so) {
      lines.push(`• Cơ số thầu: ${u.so_dong_co_so} dòng${u.co_so_sap_can ? `, ${u.co_so_sap_can} sắp cạn (<10%)` : ''}`);
    }
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  return say(`🔎 Tra cứu đơn vị kỳ ${ky}:`, lines);
}

function isSpecificEntityQuestion(q) {
  return /\b(o|tai|cua|trong|ben)\b/.test(q)
    || /\b(ai ban|nv nao ban|nhan vien nao ban|don vi nao ban|ban o dau)\b/.test(q)
    || /dong\s+nai/.test(q)
    || /\b\d{3}\b/.test(q);
}
function filterExplicitUnitCode(q, hits) {
  const codes = [...String(q || '').matchAll(/\b(\d{3})\b/g)].map((m) => m[1]);
  if (!codes.length) return hits;
  let picked = hits.filter((u) => codes.some((c) => String(u.ma || '').startsWith(`${c}.`) || String(u.ma || '') === c));
  if (!picked.length) return hits;
  const qn = noAccent(String(q || '').toLowerCase());
  // Nếu người dùng chỉ nói mã đơn vị 001, ưu tiên đơn vị chính, tránh biến thể NT/nhà thuốc cùng mã.
  if (!/\bnt\b|nha\s+thuoc/.test(qn) && picked.length > 1) {
    const primary = picked.filter((u) => !/\bNT\b|NHA\s*THUOC|NHÀ\s*THUỐC/i.test(String(u.ma || '') + ' ' + String(u.ten || '')));
    if (primary.length) picked = primary;
  }
  return picked;
}
function filterDongNaiAmbiguity(q, hits) {
  if (!/dong\s+nai/.test(q) || hits.length <= 1) return hits;
  const codeNameHits = hits.filter((u) => noAccent(String(u.ma || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').includes('dong nai'));
  return codeNameHits.length >= 2 ? codeNameHits : hits;
}
function disambiguateEntity(kind, hits, rawName) {
  if (!hits.length) return null;
  if (hits.length === 1) return null;
  if (hits.length <= 5) {
    const label = kind === 'unit' ? 'đơn vị' : 'sản phẩm';
    const choices = hits.map((h) => kind === 'unit' ? `• ${h.ma}: ${h.ten}` : `• ${h.ma}: ${h.ten}`);
    return say(`Em thấy nhiều ${label} khớp${rawName ? ` "${rawName}"` : ''}. Anh/Chị muốn hỏi mã nào?`, [...choices, 'Anh/Chị nhắn kèm mã giúp em nhé.']);
  }
  return say(`Có hơn 5 kết quả khớp. Anh/Chị gõ cụ thể hơn hoặc kèm mã giúp em nhé.`);
}
function drilldownAnswer({ q, ky, mine, unitHits, productHits }) {
  if (!isSpecificEntityQuestion(q)) return null;
  const wantsProductList = /san pham|thuoc|mat hang|ma hang|ma qlnb/.test(q) && /\b(o|tai|trong|ben)\b/.test(q);
  const wantsSeller = /\b(ai ban|nv nao ban|nhan vien nao ban|ai phu trach)\b/.test(q);
  const wantsCst = /co so|con lai|ma thau|thau/.test(q);
  const wantsProductUnits = /don vi nao ban|ban o dau/.test(q);

  let units = unitHits();
  units = filterExplicitUnitCode(q, units);
  units = filterDongNaiAmbiguity(q, units);
  const products = productHits();

  const explicitUnit = units.length && (/\b(o|tai|trong|ben)\b/.test(q) || /benh vien|bvdk|phong kham|nha thuoc|don vi|\b\d{3}\b/.test(q));
  const explicitProduct = products.length && (/vixcar|san pham|thuoc|mat hang|qlnb|ma hang|don vi nao ban|ban o dau|ai ban/.test(q));

  if (explicitUnit) {
    const dis = disambiguateEntity('unit', units, '');
    if (dis) return dis;
    const u = units[0];
    const lines = [`🏥 ${u.ten}`, `• Doanh thu: ${fmt(u.doanh_thu)}${u.so_luong ? ` · SL ${Number(u.so_luong || 0).toLocaleString('vi-VN')}` : ''}`];
    if (wantsProductList) {
      lines.push(u.top_san_pham.length ? '• Sản phẩm tại đơn vị:' : '• Chưa có sản phẩm phát sinh tại đơn vị trong kỳ.');
      u.top_san_pham.slice(0, 8).forEach((p, i) => lines.push(`${i + 1}. ${p.ten}: ${fmt(p.doanh_thu)}`));
      return say(`Sản phẩm tại ${u.ten} kỳ ${ky}:`, lines);
    }
    if (wantsSeller) {
      if (mine) lines.push('• Anh/Chị chỉ xem được phần của mình trong đơn vị này.');
      lines.push(u.ai_ban.length ? `• ${mine ? 'Bạn bán' : 'NV bán tại đơn vị'}:` : '• Chưa có NV phát sinh doanh thu tại đơn vị trong phạm vi này.');
      u.ai_ban.forEach((e, i) => lines.push(`${i + 1}. ${e.ten} (${e.ma}): ${fmt(e.doanh_thu)}`));
      return say(`NV bán tại ${u.ten} kỳ ${ky}:`, lines);
    }
    if (wantsCst) {
      lines.push(u.co_so?.length ? '• Cơ số/mã thầu tại đơn vị:' : '• Chưa có cơ số thầu khớp đơn vị trong phạm vi này.');
      (u.co_so || []).forEach((c, i) => lines.push(`${i + 1}. ${c.sp}${c.ma_sp ? ` (${c.ma_sp})` : ''}: còn ${Number(c.con_lai || 0).toLocaleString('vi-VN')}${c.tong ? `/${Number(c.tong || 0).toLocaleString('vi-VN')}` : ''}${c.con_lai_pct != null ? ` (${fmtPct(c.con_lai_pct)})` : ''}`));
      return say(`Cơ số tại ${u.ten} kỳ ${ky}:`, lines);
    }
    if (u.top_san_pham.length) lines.push(`• Top sản phẩm: ${u.top_san_pham.map((p) => `${p.ten}: ${fmt(p.doanh_thu)}`).join(' · ')}`);
    if (u.ai_ban.length) lines.push(`• ${mine ? 'Bạn bán' : 'Ai bán'}: ${u.ai_ban.map((e) => `${e.ten}: ${fmt(e.doanh_thu)}`).join(' · ')}`);
    if (u.so_dong_co_so) lines.push(`• Cơ số thầu: ${u.so_dong_co_so} dòng${u.co_so_sap_can ? `, ${u.co_so_sap_can} sắp cạn (<10%)` : ''}`);
    return say(`Doanh thu chi tiết tại ${u.ten} kỳ ${ky}:`, lines);
  }

  if (explicitProduct) {
    const dis = disambiguateEntity('product', products, '');
    if (dis) return dis;
    const p = products[0];
    const lines = [`📌 ${p.ten} (${p.ma})`, `• Doanh thu: ${fmt(p.doanh_thu)}${p.so_luong ? ` · SL ${Number(p.so_luong || 0).toLocaleString('vi-VN')}` : ''}`];
    if (wantsSeller) {
      lines.push(p.ai_ban?.length ? `• ${mine ? 'Bạn bán' : 'NV bán sản phẩm'}:` : '• Chưa có NV phát sinh doanh thu sản phẩm này trong phạm vi này.');
      (p.ai_ban || []).forEach((e, i) => lines.push(`${i + 1}. ${e.ten} (${e.ma}): ${fmt(e.doanh_thu)}`));
      return say(`NV bán ${p.ten} kỳ ${ky}:`, lines);
    }
    if (wantsProductUnits || /don vi|benh vien|phong kham|nha thuoc|khach hang/.test(q)) {
      lines.push(p.don_vi_dang_ban.length ? '• Đơn vị bán sản phẩm:' : '• Kỳ này chưa thấy đơn vị phát sinh doanh thu sản phẩm này trong phạm vi này.');
      p.don_vi_dang_ban.forEach((u, i) => lines.push(`${i + 1}. ${u.ten}: ${fmt(u.doanh_thu)}`));
      return say(`Đơn vị bán ${p.ten} kỳ ${ky}:`, lines);
    }
    return sayProductLookup([p], ky);
  }

  if (/dong\s+nai/.test(q)) return disambiguateEntity('unit', units, 'Đồng Nai') || null;
  return null;
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
// Người dùng có nêu RÕ 1 tháng (bất kể có dữ liệu hay không)? -> {m:'08', y:'2026'|''}.
function monthMention(q) {
  const yr = (yy) => (!yy ? '' : (String(yy).length === 2 ? `20${yy}` : String(yy)));
  let m = q.match(/\b(?:t|thang|ky)\s*0?([1-9]|1[0-2])(?:\s*[./-]?\s*(20\d{2}|\d{2}))?\b/);
  if (m) return { m: String(m[1]).padStart(2, '0'), y: yr(m[2]) };
  m = q.match(/\b(0?[1-9]|1[0-2])[./-](20\d{2}|\d{2})\b/);
  if (m) return { m: String(m[1]).padStart(2, '0'), y: yr(m[2]) };
  return null;
}
function noAccent(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
function fmt(n) { return Math.round(n).toLocaleString('vi-VN') + 'đ'; }
function fmtPct(n) { return n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%'; }
function fmtHumanMoney(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ đồng`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} triệu đồng`;
  return fmt(v);
}
function unitText(code, name) {
  const c = String(code || '').trim();
  const nm = String(name || '').trim();
  if (!c && !nm) return '—';
  if (!c) return nm;
  if (!nm || nm === c) return c;
  // unit_code đã chứa cả tên (vd "034.PKĐK Y ĐỨC") + unit_name chỉ là tên -> tránh ghép lặp đôi.
  if (/^\d{3}\./.test(c) && c.includes(nm)) return c;
  if (nm.startsWith(`${c}.`) || nm.startsWith(`${c} `) || nm.includes(c)) return nm;
  return `${c}.${nm}`;
}

function intentPeriodKy(period, fallbackKy) {
  if (!period || period === 'current') return fallbackKy;
  return store.periodKys().includes(period) ? period : fallbackKy;
}
function hintForLookup(hint, originalQ, kind) {
  let h = String(hint || '').trim();
  const qn = noAccent(String(originalQ || '').toLowerCase());
  const hn = noAccent(h.toLowerCase());
  // Ca tiếng Anh: "Dong Nai hospital" thường người dùng chỉ BVĐK Đồng Nai mã 001.
  // Ca tiếng Việt "benh vien dong nai" vẫn để mơ hồ 001/025 theo directive.
  if (kind === 'unit' && /dong\s+nai\s+hospital|hospital\s+.*dong\s+nai/.test(hn || qn) && /\bhow\b|\bsell\b|\bjuly\b|\bhospital\b/.test(qn)) {
    h = `001 ${h}`;
  }
  return h || originalQ;
}
function shortEntityName(s) {
  return String(s || '').replace(/^[0-9]{3}\./, '').split(/[.·]/)[0].trim() || String(s || '').trim();
}
function disambiguateShort(kind, hits, rawName) {
  if (!hits.length) return null;
  if (hits.length === 1) return null;
  if (hits.length <= 5) {
    const label = kind === 'unit' ? 'đơn vị' : 'sản phẩm';
    const choices = hits.map((h) => `• ${h.ma} — ${shortEntityName(h.ten)}`);
    return say(`Em thấy nhiều ${label} khớp${rawName ? ` "${rawName}"` : ''}. Anh/Chị muốn hỏi mã nào?`, [...choices, 'Anh/Chị nhắn kèm mã giúp em nhé.']);
  }
  return say('Có hơn 5 kết quả khớp. Anh/Chị gõ cụ thể hơn hoặc kèm mã giúp em nhé.');
}
function productListAtUnitAnswer(u, ky) {
  const lines = [`🏥 ${u.ten}`, `• Doanh thu: ${fmt(u.doanh_thu)}${u.so_luong ? ` · SL ${Number(u.so_luong || 0).toLocaleString('vi-VN')}` : ''}`];
  lines.push(u.top_san_pham.length ? '• Sản phẩm tại đơn vị:' : '• Chưa có sản phẩm phát sinh tại đơn vị trong kỳ.');
  u.top_san_pham.slice(0, 8).forEach((p, i) => lines.push(`${i + 1}. ${p.ten}: ${fmt(p.doanh_thu)}`));
  return say(`Sản phẩm tại ${u.ten} kỳ ${ky}:`, lines);
}
function unitRevenueAnswer(u, ky, mine) {
  const lines = [`🏥 ${u.ten}`, `• Doanh thu: ${fmt(u.doanh_thu)}${u.so_luong ? ` · SL ${Number(u.so_luong || 0).toLocaleString('vi-VN')}` : ''}`];
  if (mine) lines.push('• Đã lọc theo phạm vi của chính Anh/Chị.');
  if (u.top_san_pham.length) lines.push(`• Top sản phẩm: ${u.top_san_pham.map((p) => `${p.ten}: ${fmt(p.doanh_thu)}`).join(' · ')}`);
  if (u.ai_ban.length) lines.push(`• ${mine ? 'Bạn bán' : 'Ai bán'}: ${u.ai_ban.map((e) => `${e.ten}: ${fmt(e.doanh_thu)}`).join(' · ')}`);
  return say(`Doanh thu${mine ? ' của Anh/Chị' : ''} tại ${u.ten} kỳ ${ky}:`, lines);
}
function shouldInterpretQuery(intent, q) {
  if (!llm.isEnabled()) return false;
  const clearCodeFirst = new Set(['sensitive', 'help', 'greeting', 'identity_check', 'revenue_employee', 'ranking', 'breakdown', 'overview', 'unit_movement', 'target_gap', 'target_pct', 'comparison', 'revenue_total', 'cst_empty', 'cst_low']);
  if (clearCodeFirst.has(intent?.intent)) return false;
  // entity_drilldown/entity_lookup/unknown are the cases where regex may know the broad topic but not the exact natural-language entity/self scope.
  if (['entity_drilldown', 'entity_lookup', 'unknown'].includes(intent?.intent)) return true;
  // Natural bilingual questions that regex often misses.
  return /\b(how much|did i sell|my sales|at .*hospital|who sells|product.*hospital)\b/.test(q);
}
async function answerFromInterpretedIntent({ text, q, baseKy, scope, mine }) {
  if (!llm.isEnabled()) return null;
  const it = await llm.interpretQuery(text, { currentPeriod: baseKy });
  if (!it || it.metric === 'unknown' || it.needClarify || it.listAll) return null;
  const ky2 = intentPeriodKy(it.period, baseKy);
  const unitHint = it.unitHint || '';
  const productHint = it.productHint || '';

  if (unitHint) {
    let units = lookupUnits({ q: hintForLookup(unitHint, text, 'unit'), ky: ky2, scope });
    units = filterExplicitUnitCode(hintForLookup(unitHint, text, 'unit'), units);
    units = filterDongNaiAmbiguity(noAccent(String(unitHint || text).toLowerCase()), units);
    const dis = disambiguateShort('unit', units, unitHint);
    if (dis) return dis;
    if (!units.length) return say(`Chưa tìm thấy đơn vị "${unitHint}" có doanh thu kỳ ${ky2} trong phạm vi hiện tại.`);
    const u = units[0];
    if (it.dimension === 'product' || /san pham|product|thuoc|mat hang/.test(q)) return productListAtUnitAnswer(u, ky2);
    return unitRevenueAnswer(u, ky2, mine || it.selfScoped);
  }

  if (productHint) {
    const products = lookupProducts({ q: hintForLookup(productHint, text, 'product'), ky: ky2, scope });
    const dis = disambiguateShort('product', products, productHint);
    if (dis) return dis;
    if (!products.length) return say(`Chưa tìm thấy sản phẩm "${productHint}" có doanh thu kỳ ${ky2} trong phạm vi hiện tại.`);
    const p = products[0];
    if (it.dimension === 'emp' || /ai ban|who sells|seller|nhan vien|nv/.test(q)) {
      const lines = [`📌 ${p.ten} (${p.ma})`, `• Doanh thu: ${fmt(p.doanh_thu)}${p.so_luong ? ` · SL ${Number(p.so_luong || 0).toLocaleString('vi-VN')}` : ''}`];
      if (mine) lines.push('• Anh/Chị chỉ xem được phần của mình.');
      lines.push(p.ai_ban?.length ? `• ${mine ? 'Bạn bán' : 'NV bán sản phẩm'}:` : '• Chưa có NV phát sinh doanh thu sản phẩm này trong phạm vi này.');
      (p.ai_ban || []).forEach((e, i) => lines.push(`${i + 1}. ${e.ten} (${e.ma}): ${fmt(e.doanh_thu)}`));
      return say(`NV bán ${p.ten} kỳ ${ky2}:`, lines);
    }
    return sayProductLookup([p], ky2);
  }
  return null;
}
function isLlmAnalysisQuestion(q) {
  if (!llm.isEnabled()) return false;
  // Câu phân tích/tư vấn ngôn ngữ tự nhiên: để LLM diễn giải trên FACTS tổng hợp.
  // Không bắt các câu số liệu rõ ràng/top/drilldown để giữ code-first chính xác.
  if (/\b(top|xep hang|theo san pham|theo don vi|theo nhan vien|doanh thu o|tai\s+\d{3}|\d{3}|gia thau|ma hang|ma thuoc|qlnb)\b/.test(q)) return false;
  return /(on khong|co on|uu tien|giai thich|de hieu|tinh hinh|dang chu y|nen chu y|tu van|quan tri|cham soc|tom tat|hom nay nen lam gi|rui ro|nhan xet|danh gia|khuyen nghi|can lam gi)/.test(q);
}
async function answerWithLlm({ text, ky, scope, mine }) {
  const ans = await llm.callLlm({ question: text, facts: buildFacts({ ky, scope, mine }) });
  if (!ans) return null;
  return { text: ans.text, lines: [], source: 'llm' };
}
function say(text, lines) { return { text, lines: lines || [], source: 'code' }; }

module.exports = { buildAlerts, forecastTargets, answerQuestion, lookupProducts, lookupUnits, SEASON };
