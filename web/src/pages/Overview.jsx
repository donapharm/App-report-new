import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { formatDateTime, money, pct } from '../util.js';
import { Spinner, Kpi, DailySalesKpi, MoneyBig, ZaloCard, UnitLabel } from '../components.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams, periodLabel } from './PeriodFilter.jsx';
import { DonutChart, RevenueTrendChart, TargetGauge, TopBarChart } from '../charts.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';

function CstOwnerLine({ item }) {
  const codes = [...new Set((item.employees || []).map((emp) => String(emp?.code || emp || '').trim().toUpperCase()).filter(Boolean))];
  return (
    <span className="alert-owner-line">👤 NV phụ trách: <b>{codes.length ? codes.join(', ') : 'Chưa có thông tin phụ trách'}</b></span>
  );
}

function AlertLine({ group, item }) {
  if (group.key === 'cst_queued') {
    return <div className="alert-line"><b>{item.product_name || '—'}</b><span>{item.unit_name || item.unit_code || '—'} · hiện hành {item.cst_sequence?.current?.code || 'cần xác nhận'} còn {pct(item.cst_sequence?.current?.remainPct)} · kế tiếp {item.iit_code}</span><CstOwnerLine item={item} /></div>;
  }
  if (group.key === 'cst_untouched') {
    return (
      <div className="alert-line">
        <b>{item.label || item.product_name || '—'}</b>
        <span>{item.unit_name || item.unit_code || '—'} · còn {Number(item.remain_qty || 0).toLocaleString('vi-VN')} {item.uom || ''}</span>
        <CstOwnerLine item={item} />
      </div>
    );
  }
  if (group.key === 'target_near') {
    const remaining = Math.max(0, Number(item.target_full || item.target || 0) - Number(item.revenue_before_vat || 0));
    return (
      <div className="alert-line">
        <b>{item.emp_name || item.emp_code || '—'}</b>
        <span><span className="chg-chip up">{pct(item.pct)}</span>Còn {money(remaining)} để đạt target</span>
      </div>
    );
  }
  if (group.key === 'product_growth') {
    return (
      <div className="alert-line">
        <b>{item.label || item.product_name || item.key || '—'}</b>
        <span><span className="chg-chip up">▲ {pct(item.deltaPct, 0)}</span>{money(item.revenue)} · tăng {money(item.delta)}</span>
      </div>
    );
  }
  if (group.key === 'target') {
    const targetPct = Number(item.pct || 0);
    const severity = targetPct < 50 ? 'critical' : 'warning';
    return (
      <div className={`alert-line slow-target-line ${severity}`}>
        <div className="slow-target-person">
          <b>{item.name}</b>
          <span className={`slow-target-status ${severity}`}>{severity === 'critical' ? '🚨 Rất chậm' : '⚠ Chậm tiến độ'}</span>
        </div>
        <span><strong className={`slow-target-pct ${severity}`}>{pct(item.pct)}</strong> target · {money(item.revenue_before_vat)} / {money(item.target)}</span>
      </div>
    );
  }
  if (group.key === 'unit_up') {
    return (
      <div className="alert-line">
        <UnitLabel code={item.unit_code} name={item.unit_name} />
        <span><span className="chg-chip up">▲ Tăng {pct(Math.abs(item.mom), 0)}</span>{money(item.prev)} → {money(item.cur)}</span>
      </div>
    );
  }
  if (group.key === 'unit_down') {
    return (
      <div className="alert-line">
        <UnitLabel code={item.unit_code} name={item.unit_name} />
        <span><span className="chg-chip down">▼ Giảm {pct(Math.abs(item.mom), 0)}</span>{money(item.prev)} → {money(item.cur)}</span>
      </div>
    );
  }
  return (
    <div className="alert-line">
      <b>{item.product_name || '—'}</b>
      <span><UnitLabel code={item.unit_code} name={item.unit_name} /> · còn {pct(item.remain_pct)} ({Number(item.remain_qty || 0).toLocaleString('vi-VN')} / {Number(item.bid_qty_initial || 0).toLocaleString('vi-VN')})</span>
      {(group.key === 'cst_high' || group.key === 'cst_low') && <CstOwnerLine item={item} />}
    </div>
  );
}

export default function Overview({ me, onNavigate }) {
  const [periods, setPeriods] = useState([]);
  const [periodSel, setPeriodSel] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [trend, setTrend] = useState(null);
  const [topDim, setTopDim] = useState('unit');
  const topLimit = 20;
  const [topRows, setTopRows] = useState(null);
  const [unitRevenueRows, setUnitRevenueRows] = useState(null);
  const [richInsights, setRichInsights] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cmpMode, setCmpModeState] = useState(() => { try { return localStorage.getItem('rpt_cmp_mode') || 'prev'; } catch { return 'prev'; } });
  const setCmpMode = (m) => { setCmpModeState(m); try { localStorage.setItem('rpt_cmp_mode', m); } catch { /* ignore */ } };
  const { reloadTick, reload } = useReloadTick();
  const lastAutoRefresh = useRef(Date.now());

  // Tổng quan có KPI doanh số ngày nên cũng tự nhận bản materialize mới giống Phân tích.
  useEffect(() => {
    const run = (minGap = 0) => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastAutoRefresh.current < minGap) return;
      lastAutoRefresh.current = now;
      reload();
    };
    const id = setInterval(() => run(4 * 60 * 1000), 5 * 60 * 1000);
    const onReturn = () => run(60 * 1000);
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab Nhân viên: ghép % đạt target vào từng NV để tô màu bar theo target.
  function loadTopRows(p) {
    setTopRows(null);
    if (topDim === 'emp' && me.isAdmin) {
      Promise.all([api.revenue('emp', null, p), api.targets(p)]).then(([d, t]) => {
        const pctByEmp = Object.fromEntries((t.items || []).map((x) => [x.emp_code, x.pct]));
        setTopRows((d.rows || []).slice(0, topLimit).map((r) => ({ ...r, pctTarget: pctByEmp[r.key] ?? null })));
      });
    } else {
      api.revenue(topDim, null, p).then((d) => setTopRows((d.rows || []).slice(0, topLimit)));
    }
  }

  useEffect(() => {
    api.periods().then((p) => { setPeriods(p.periods); setPeriodSel(defaultPeriodSelection(p.periods, p.latest)); });
  }, []);

  useEffect(() => {
    if (!periodSel) return;
    setKpi(null);
    api.overview(periodParams(periodSel)).then(setKpi);
    setTrend(null);
    api.trend().then(setTrend);
    setAlerts(null);
    api.alerts({ ...periodParams(periodSel), compareMode: cmpMode }).then(setAlerts);
  }, [periodSel, reloadTick, cmpMode]);

  useEffect(() => {
    if (!periodSel) return;
    loadTopRows(periodParams(periodSel));
  }, [periodSel, topDim, reloadTick]);

  // Luôn tải cơ cấu theo đơn vị, độc lập với lựa chọn Đơn vị/Sản phẩm/Nhân viên của Top 20.
  useEffect(() => {
    if (!periodSel) return;
    let active = true;
    setUnitRevenueRows(null);
    api.revenue('unit', null, periodParams(periodSel)).then((d) => {
      if (active) setUnitRevenueRows(d.rows || []);
    });
    return () => { active = false; };
  }, [periodSel, reloadTick]);

  // Hàng thông tin điều hành: dùng dữ liệu Phân tích + Target đã có, không tạo công thức/API mới.
  useEffect(() => {
    if (!periodSel) return;
    let active = true;
    setRichInsights(null);
    Promise.allSettled([
      api.analysis({ ...periodParams(periodSel), compareMode: cmpMode }),
      api.targets(periodParams(periodSel)),
    ]).then(([analysisResult, targetResult]) => {
      if (!active) return;
      setRichInsights({
        analysis: analysisResult.status === 'fulfilled' ? analysisResult.value : null,
        targets: targetResult.status === 'fulfilled' ? targetResult.value : null,
      });
    });
    return () => { active = false; };
  }, [periodSel, reloadTick, cmpMode]);

  function viewAll(group) {
    if (!onNavigate) return;
    if (group.key === 'target') onNavigate('target', { fromAlert: group.key });
    else if (group.key === 'unit_up' || group.key === 'unit_down') onNavigate('revenue', { fromAlert: group.key, dimension: 'unit' });
    else if (group.key === 'cst_low') onNavigate('cst', { fromAlert: group.key, cstFilter: 'low' });
    else if (group.key === 'cst_high') onNavigate('cst', { fromAlert: group.key, cstFilter: 'high' });
    else if (group.key === 'cst_queued') onNavigate('analysis', { fromAlert: group.key });
    else if (group.key === 'target_near') onNavigate('target', { fromAlert: group.key });
    else if (group.key === 'cst_untouched' || group.key === 'product_growth') onNavigate('analysis', { fromAlert: group.key });
  }

  const summary = alerts?.summary;
  const groups = alerts?.groups || [];
  const cstHighGroup = groups.find((g) => g.key === 'cst_high') || { key: 'cst_high', icon: '🟡', tone: 'neutral', title: 'Cơ số thầu tồn nhiều (>85%)', total: 0, items: [] };
  const cstLowGroup = groups.find((g) => g.key === 'cst_low') || { key: 'cst_low', icon: '📦', tone: 'danger', title: 'Cơ số thầu sắp cạn (<10%)', total: 0, items: [] };
  const cstQueuedGroup = groups.find((g) => g.key === 'cst_queued') || { key: 'cst_queued', icon: '⏳', tone: 'neutral', title: 'QLNB kế tiếp đang chờ mã hiện hành', total: 0, items: [] };
  const targetSlowGroup = groups.find((g) => g.key === 'target') || { key: 'target', icon: '🎯', tone: 'danger', title: 'Nhân viên chậm tiến độ target', total: 0, items: [] };
  const unitDownGroup = groups.find((g) => g.key === 'unit_down') || { key: 'unit_down', icon: '📉', tone: 'warning', title: 'Đơn vị giảm doanh thu mạnh', total: 0, items: [] };
  const unitUpGroup = groups.find((g) => g.key === 'unit_up') || { key: 'unit_up', icon: '📈', tone: 'ok', title: 'Đơn vị tăng trưởng mạnh', total: 0, items: [] };
  const analysisInsights = richInsights?.analysis;
  const targetPacing = richInsights?.targets?.pacing;
  const targetItems = richInsights?.targets?.items || [];
  const cstUntouched = analysisInsights?.cstUntouched || [];
  const nearTarget = targetItems
    .filter((item) => item.target_assigned && Number(item.pct) >= 80 && Number(item.pct) < 100)
    .sort((a, b) => Number(b.pct) - Number(a.pct));
  const growthProducts = (analysisInsights?.topGrowthProducts || [])
    .filter((item) => Number(item.prevRevenue) > 0 && Number(item.delta) > 0)
    .sort((a, b) => Number(b.delta) - Number(a.delta));
  const targetSlowUsesPacing = periodSel?.mode === 'month';
  const targetSlowItems = targetSlowUsesPacing
    ? (targetSlowGroup.items || [])
    : targetItems
      .filter((item) => item.target_assigned && Number(item.pct) < 80)
      .sort((a, b) => Number(a.pct) - Number(b.pct))
      .map((item) => ({ ...item, name: item.emp_name || item.emp_code, target: item.target_full || item.target }));
  const targetSlowTotal = targetSlowUsesPacing ? Number(targetSlowGroup.total || 0) : targetSlowItems.length;
  const targetSlowNote = targetSlowUsesPacing && targetPacing?.isCurrent
    ? `Tiến độ thời gian ${pct(Number(targetPacing.factor || 0) * 100)} · dưới 80% mức cần đạt đến hôm nay`
    : `${periodSel ? periodLabel(periodSel) : 'Kỳ đang chọn'} · dưới 80% target toàn phạm vi`;
  const decisionGroups = [
    { ...cstHighGroup, note: 'CST hiện tại · đã loại mã đang chờ và mã cần xác nhận', empty: 'Không có CST tồn trên 85% cần hành động.' },
    { ...cstQueuedGroup, empty: 'Không có QLNB kế tiếp đang chờ.' },
    { key: 'cst_untouched', icon: '🌱', tone: 'warning', title: 'Có CST nhưng chưa phát sinh bán', total: Number(analysisInsights?.cstUntouchedTotal || cstUntouched.length), items: cstUntouched, note: 'CST hiện tại · cơ hội chưa khai thác', empty: 'Không có CST còn nguyên cần khai thác.' },
    { key: 'target_near', icon: '🚀', tone: 'ok', title: 'Nhân viên gần đạt target (80–99%)', total: nearTarget.length, items: nearTarget, note: periodSel ? periodLabel(periodSel) : '', empty: 'Chưa có nhân viên trong vùng 80–99%.' },
    { ...targetSlowGroup, title: 'Nhân viên chậm tiến độ target', total: targetSlowTotal, items: targetSlowItems, note: targetSlowNote, empty: 'Không có nhân viên chậm tiến độ target.' },
    { key: 'product_growth', icon: '✨', tone: 'ok', title: 'Sản phẩm tăng trưởng nổi bật', total: growthProducts.length, items: growthProducts, note: analysisInsights?.growthNote || 'So với kỳ đối chiếu gần nhất', empty: 'Chưa đủ dữ liệu để xác định sản phẩm tăng trưởng.' },
    { ...cstLowGroup, note: 'CST hiện tại · cần theo dõi bổ sung', empty: 'Không có CST sắp cạn dưới 10%.' },
    { ...unitDownGroup, title: 'Đơn vị giảm doanh thu mạnh', empty: 'Không có đơn vị giảm từ 15% trở lên.' },
    { ...unitUpGroup, title: 'Đơn vị tăng trưởng mạnh', empty: 'Không có đơn vị tăng từ 15% trở lên.' },
  ];
  const revenueUnits = (unitRevenueRows || []).filter((r) => Number(r.revenue || 0) > 0);
  const unitRevenueTotal = revenueUnits.reduce((sum, r) => sum + Number(r.revenue || 0), 0);
  const topFiveRevenue = [...revenueUnits]
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
    .slice(0, 5)
    .reduce((sum, r) => sum + Number(r.revenue || 0), 0);
  const topFiveShare = unitRevenueTotal > 0 ? topFiveRevenue / unitRevenueTotal * 100 : null;
  const selectedKy = periodSel?.mode === 'range' ? periodSel.to : periodSel?.ky;
  const selectedPeriod = periods.find((p) => p.ky === selectedKy) || null;
  const dataAsOf = selectedPeriod?.data_as_of;
  const dataAsOfText = dataAsOf ? formatDateTime(dataAsOf) : null;

  async function refreshNow() {
    if (!selectedKy) return;
    setRefreshing(true);
    try {
      await api.revenueRefreshRun(selectedKy);
      const p = await api.periods();
      setPeriods(p.periods);
      setKpi(null);
      api.overview(periodParams(periodSel)).then(setKpi);
      setTrend(null);
      api.trend().then(setTrend);
      loadTopRows(periodParams(periodSel));
      setUnitRevenueRows(null);
      api.revenue('unit', null, periodParams(periodSel)).then((d) => setUnitRevenueRows(d.rows || []));
      setRichInsights(null);
      Promise.allSettled([
        api.analysis({ ...periodParams(periodSel), compareMode: cmpMode }),
        api.targets(periodParams(periodSel)),
      ]).then(([analysisResult, targetResult]) => setRichInsights({
        analysis: analysisResult.status === 'fulfilled' ? analysisResult.value : null,
        targets: targetResult.status === 'fulfilled' ? targetResult.value : null,
      }));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <DrillNav crumbs={[{ label: 'Tổng quan' }]} onReload={reload} busy={!kpi} />
      {periodSel && <PeriodFilter periods={periods} value={periodSel} onChange={setPeriodSel} />}
      {periodSel && (
        <div className="muted" style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', margin: '-6px 0 10px' }}>
          <span>{dataAsOfText ? `Cập nhật đến ${dataAsOfText}` : 'Chưa có mốc cập nhật tự động'}</span>
          {me.isAdmin && <button className="btn ghost" onClick={refreshNow} disabled={refreshing}>{refreshing ? 'Đang làm mới…' : '↻ Làm mới'}</button>}
        </div>
      )}

      {!kpi ? <Spinner /> : (
        <>
          <div className="kpi-grid overview-kpi-grid">
            <Kpi variant="blue" icon={kpi.momPct != null && kpi.momPct < 0 ? '⚠️' : '📊'} label={me.isAdmin ? 'Doanh thu toàn công ty' : 'Doanh thu của bạn'} value={<MoneyBig value={kpi.revenue} />} delta={kpi.momPct} sub={periodLabel(periodSel)} onClick={() => onNavigate?.('revenue')} />
            <Kpi variant="purple" icon="🧾" label="Trước VAT" value={<MoneyBig value={kpi.revenueBeforeVat} />} sub="đã ÷ 1,05" onClick={() => onNavigate?.('revenue')} />
            <Kpi icon="📋" label="Số dòng dữ liệu" value={(kpi.rowCount || 0).toLocaleString('vi-VN')} sub={periodLabel(periodSel)} onClick={() => onNavigate?.('revenueFull')} />
            <DailySalesKpi data={analysisInsights?.dailySales} />
            <Kpi variant="green" icon="🎯" label="Đạt target" value={<MoneyBig value={kpi.targetTotal || 0} />}
                 sub={kpi.pctTarget != null ? `Đã đạt ${pct(kpi.pctTarget)} (chưa VAT)` : 'Chưa có target (chưa VAT)'} onClick={() => onNavigate?.('target')} />
            <Kpi variant="green" icon="🎯" label="NV đạt target" value={`${kpi.empTarget?.achieved ?? 0}/${kpi.empTarget?.total ?? 0} đạt`} sub={me.isAdmin ? 'NV đang bán có target' : 'Theo phạm vi của bạn'} onClick={() => onNavigate?.('target')} />
            <Kpi variant="red" icon="⚠️" label="Cơ số thầu sắp cạn" value={`${kpi.cstLowCount || 0} dòng <10%`} sub="Hiện tại · bấm để xem" onClick={() => onNavigate?.('cst', { cstFilter: 'low' })} />
            <Kpi variant="amber" icon="🗺️" label="Quy mô kỳ" value={`${kpi.unitCount} ĐV · ${kpi.productCount} SP · ${kpi.empCount} NV`} sub={`${kpi.rowCount} dòng · xem ›`} onClick={() => onNavigate?.('revenue')} />
          </div>
          <div className="chart-grid overview-charts">
            <div className="card chart-card wide">
              <div className="section-head">📈 Doanh thu theo kỳ · overlay target</div>
              {!trend ? <Spinner /> : <RevenueTrendChart rows={trend} selectedKys={kpi.kys} />}
            </div>
            <div className="card chart-card target-card">
              <div className="section-head">🎯 Tiến độ target {periodLabel(periodSel)}</div>
              <TargetGauge pct={kpi.pctTarget} />
              {Number(kpi.targetTotal || 0) > 0 ? (
                <div className="gauge-caption">
                  <span className="gc-item">
                    <i>Đã đạt</i>
                    <b style={{ color: kpi.pctTarget == null ? '#94a3b8' : kpi.pctTarget >= 100 ? '#1f9d6b' : kpi.pctTarget >= 80 ? '#e08a1e' : '#d64545' }}>{money(kpi.revenueBeforeVat)}</b>
                  </span>
                  <span className="gc-sep">/</span>
                  <span className="gc-item">
                    <i>Mục tiêu tháng</i>
                    <b className="gc-target">{money(kpi.targetTotal)}</b>
                  </span>
                  <span className="gc-note">trước VAT</span>
                </div>
              ) : (
                <div className="center compact-center">{money(kpi.revenueBeforeVat)} · Chưa giao target</div>
              )}
            </div>
            <div className="card chart-card wide">
              <div className="chart-head">
                <div className="section-head">🏆 Top {topLimit} doanh thu</div>
                <div className="seg compact">
                  <button className={topDim === 'unit' ? 'active' : ''} onClick={() => setTopDim('unit')}>Đơn vị</button>
                  <button className={topDim === 'product' ? 'active' : ''} onClick={() => setTopDim('product')}>Sản phẩm</button>
                  {me.isAdmin && <button className={topDim === 'emp' ? 'active' : ''} onClick={() => setTopDim('emp')}>Nhân viên</button>}
                </div>
              </div>
              {!topRows ? <Spinner /> : <TopBarChart rows={topRows} limit={topLimit} totalRevenue={kpi.revenue} dimension={topDim} />}
            </div>
            <div className="card chart-card overview-revenue-mix-card">
              <div className="section-head">🍩 Cơ cấu doanh thu Top 5</div>
              <div className="overview-revenue-mix-sub">Theo đơn vị · {periodLabel(periodSel)}</div>
              {!unitRevenueRows ? <Spinner /> : revenueUnits.length === 0 ? (
                <div className="chart-empty overview-mix-empty">Chưa có doanh thu đơn vị trong kỳ này</div>
              ) : (
                <>
                  <div className="overview-mix-stats" aria-label="Tóm tắt cơ cấu doanh thu đơn vị">
                    <span><i>Tỷ trọng Top 5</i><b>{pct(topFiveShare)}</b></span>
                    <span><i>Đơn vị có doanh thu</i><b>{revenueUnits.length.toLocaleString('vi-VN')}</b></span>
                  </div>
                  <DonutChart rows={unitRevenueRows} topCount={5} compact />
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div className="section-title">🔔 Cần chú ý {alerts ? `(${alerts.count})` : ''} · CST hiện tại</div>
      <div className="cmp-toggle-row">
        <span className="cmp-toggle-label">So tăng/giảm đơn vị:</span>
        <div className="seg compact">
          <button className={cmpMode === 'prev' ? 'active' : ''} onClick={() => setCmpMode('prev')}>Tháng liền trước</button>
          <button className={cmpMode === 'yoy' ? 'active' : ''} onClick={() => setCmpMode('yoy')}>Cùng kỳ năm ngoái</button>
        </div>
      </div>
      {!alerts ? <Spinner /> : (
        <>
          <div className="card alert-summary-strip">
            <span><b>{summary?.emp_below_target || 0}</b> NV chưa đạt</span>
            <span className="up"><b>{summary?.units_up || 0}</b> đơn vị tăng</span>
            <span><b>{summary?.units_down || 0}</b> đơn vị giảm</span>
            <span><b>{summary?.cst_low || 0}</b> CST sắp cạn</span>
            <span><b>{summary?.cst_high || 0}</b> CST tồn nhiều</span>
          </div>
          <div className="section-title overview-opportunity-title">🧭 8 báo cáo điều hành · theo từng ngữ cảnh</div>
          {!richInsights ? <Spinner /> : <div className="alerts-grid grouped-alerts overview-decision-grid overview-opportunity-grid">
            {decisionGroups.map((g) => (
              <div key={g.key} className={'card alert-group ' + (g.tone || '') + (g.key === 'target' ? ' slow-target-alert' : '')}>
                <div className="alert-group-head">
                  <div>
                    {g.key === 'target' ? (
                      <span className="slow-target-icon" aria-label="Cảnh báo target chậm"><span aria-hidden="true">🎯</span><i aria-hidden="true">⚠</i></span>
                    ) : <span className="alert-ic">{g.icon}</span>}
                    <b>{g.title}</b>
                  </div>
                  <span className="pill muted-pill">{g.total}</span>
                </div>
                {g.note && <div className={'alert-group-note' + (g.note.startsWith('⚠') ? ' warn' : '')}>{g.note}</div>}
                <div className="alert-lines">
                  {g.items.length === 0 ? <div className="alert-line overview-alert-empty"><span>{g.empty || 'Không có dữ liệu trong kỳ này.'}</span></div> : g.items.slice(0, 5).map((item, i) => <AlertLine key={i} group={g} item={item} />)}
                </div>
                <button type="button" className="btn ghost alert-more" aria-label={`Xem báo cáo ${g.title}`} onClick={() => viewAll(g)}>Xem báo cáo{g.total > 0 ? ` (${g.total})` : ''} ›</button>
              </div>
            ))}
          </div>}
        </>
      )}
      <ZaloCard />
    </>
  );
}
