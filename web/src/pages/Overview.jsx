import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, pct, unitText } from '../util.js';
import { Spinner, Kpi, MoneyBig, ZaloCard } from '../components.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams, periodLabel } from './PeriodFilter.jsx';
import { DonutChart, RevenueTrendChart, TargetGauge, TopBarChart } from '../charts.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';

function AlertLine({ group, item }) {
  if (group.key === 'target') {
    return (
      <div className="alert-line">
        <b>{item.name}</b>
        <span>{pct(item.pct)} target · {money(item.revenue_before_vat)} / {money(item.target)}</span>
      </div>
    );
  }
  if (group.key === 'unit_up') {
    return (
      <div className="alert-line">
        <b>{unitText(item.unit_code, item.unit_name)}</b>
        <span><span className="chg-chip up">▲ Tăng {pct(Math.abs(item.mom), 0)}</span>{money(item.prev)} → {money(item.cur)}</span>
      </div>
    );
  }
  if (group.key === 'unit_down') {
    return (
      <div className="alert-line">
        <b>{unitText(item.unit_code, item.unit_name)}</b>
        <span><span className="chg-chip down">▼ Giảm {pct(Math.abs(item.mom), 0)}</span>{money(item.prev)} → {money(item.cur)}</span>
      </div>
    );
  }
  return (
    <div className="alert-line">
      <b>{item.product_name || '—'}</b>
      <span>{unitText(item.unit_code, item.unit_name)} · còn {pct(item.remain_pct)} ({Number(item.remain_qty || 0).toLocaleString('vi-VN')} / {Number(item.bid_qty_initial || 0).toLocaleString('vi-VN')})</span>
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
  const [refreshing, setRefreshing] = useState(false);
  const [cmpMode, setCmpModeState] = useState(() => { try { return localStorage.getItem('rpt_cmp_mode') || 'prev'; } catch { return 'prev'; } });
  const setCmpMode = (m) => { setCmpModeState(m); try { localStorage.setItem('rpt_cmp_mode', m); } catch { /* ignore */ } };
  const { reloadTick, reload } = useReloadTick();

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

  function viewAll(group) {
    if (!onNavigate) return;
    if (group.key === 'target') onNavigate('target', { fromAlert: group.key });
    else if (group.key === 'unit_up' || group.key === 'unit_down') onNavigate('revenue', { fromAlert: group.key, dimension: 'unit' });
    else if (group.key === 'cst_low') onNavigate('cst', { fromAlert: group.key, cstFilter: 'low' });
    else if (group.key === 'cst_high') onNavigate('cst', { fromAlert: group.key, cstFilter: 'high' });
  }

  const summary = alerts?.summary;
  const groups = alerts?.groups || [];
  const decisionGroupOrder = ['cst_high', 'cst_low', 'unit_down', 'unit_up'];
  const decisionGroupFallback = {
    cst_high: { icon: '🟡', tone: 'neutral', title: 'Cơ số thầu tồn nhiều (>85%)' },
    cst_low: { icon: '📦', tone: 'danger', title: 'Cơ số thầu sắp cạn (<10%)' },
    unit_down: { icon: '📉', tone: 'warning', title: 'Đơn vị giảm mạnh (so kỳ trước)' },
    unit_up: { icon: '📈', tone: 'ok', title: 'Đơn vị tăng trưởng mạnh (so kỳ trước)' },
  };
  const decisionGroups = decisionGroupOrder.map((key) => groups.find((g) => g.key === key) || ({ key, ...decisionGroupFallback[key], total: 0, items: [] }));
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
  const dataAsOfText = dataAsOf ? new Date(dataAsOf).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : null;

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
          <div className="kpi-grid">
            <Kpi variant="blue" icon={kpi.momPct != null && kpi.momPct < 0 ? '⚠️' : '📊'} label={me.isAdmin ? 'Doanh thu toàn công ty' : 'Doanh thu của bạn'} value={<MoneyBig value={kpi.revenue} />} delta={kpi.momPct} sub={periodLabel(periodSel)} onClick={() => onNavigate?.('revenue')} />
            <Kpi variant="purple" icon="🧾" label="Trước VAT" value={<MoneyBig value={kpi.revenueBeforeVat} />} sub="đã ÷ 1,05" onClick={() => onNavigate?.('revenue')} />
            <Kpi variant="green" icon="🎯" label="Đạt target (%)" value={pct(kpi.pctTarget)}
                 sub={kpi.pctTarget != null ? (kpi.pctTarget >= 100 ? 'Đã đạt 🎉' : 'Chưa đạt') : 'Chưa có target'} onClick={() => onNavigate?.('target')} />
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
          <div className="alerts-grid grouped-alerts overview-decision-grid">
            {decisionGroups.map((g) => (
              <div key={g.key} className={'card alert-group ' + (g.tone || '')}>
                <div className="alert-group-head">
                  <div>
                    <span className="alert-ic">{g.icon}</span>
                    <b>{g.title}</b>
                  </div>
                  <span className="pill muted-pill">{g.total}</span>
                </div>
                {g.note && <div className={'alert-group-note' + (g.note.startsWith('⚠') ? ' warn' : '')}>{g.note}</div>}
                <div className="alert-lines">
                  {g.items.length === 0 ? <div className="alert-line overview-alert-empty"><span>Không có dữ liệu cần chú ý trong kỳ này.</span></div> : g.items.slice(0, 5).map((item, i) => <AlertLine key={i} group={g} item={item} />)}
                </div>
                {g.total > 0 && <button type="button" className="btn ghost alert-more" aria-label={`Xem tất cả ${g.title}`} onClick={() => viewAll(g)}>Xem tất cả ({g.total}) ›</button>}
              </div>
            ))}
          </div>
        </>
      )}
      <ZaloCard />
    </>
  );
}
