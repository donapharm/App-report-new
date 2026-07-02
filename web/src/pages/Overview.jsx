import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, short, pct } from '../util.js';
import { Spinner, Kpi } from '../components.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams, periodLabel } from './PeriodFilter.jsx';
import { RevenueTrendChart, TargetGauge, TopBarChart } from '../charts.jsx';

function AlertLine({ group, item }) {
  if (group.key === 'target') {
    return (
      <div className="alert-line">
        <b>{item.name}</b>
        <span>{item.pct}% target · {short(item.revenue_before_vat)} / {short(item.target)}</span>
      </div>
    );
  }
  if (group.key === 'unit_down') {
    return (
      <div className="alert-line">
        <b>{item.unit_name}</b>
        <span>Giảm {Math.abs(item.mom).toFixed(0)}% · {short(item.prev)} → {short(item.cur)}</span>
      </div>
    );
  }
  return (
    <div className="alert-line">
      <b>{item.product_name || '—'}</b>
      <span>{item.unit_name} · còn {item.remain_pct}% ({Number(item.remain_qty || 0).toLocaleString('vi-VN')} / {Number(item.bid_qty_initial || 0).toLocaleString('vi-VN')})</span>
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
  const [topRows, setTopRows] = useState(null);

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
    api.alerts(periodParams(periodSel)).then(setAlerts);
  }, [periodSel]);

  useEffect(() => {
    if (!periodSel) return;
    setTopRows(null);
    api.revenue(topDim, null, periodParams(periodSel)).then((d) => setTopRows((d.rows || []).slice(0, 10)));
  }, [periodSel, topDim]);

  function viewAll(group) {
    if (!onNavigate) return;
    if (group.key === 'target') onNavigate('target', { fromAlert: group.key });
    else if (group.key === 'unit_down') onNavigate('revenue', { fromAlert: group.key, dimension: 'unit' });
    else if (group.key === 'cst_low') onNavigate('cst', { fromAlert: group.key, cstFilter: 'low' });
    else if (group.key === 'cst_high') onNavigate('cst', { fromAlert: group.key, cstFilter: 'high' });
  }

  const summary = alerts?.summary;
  const groups = alerts?.groups || [];

  return (
    <>
      {periodSel && <PeriodFilter periods={periods} value={periodSel} onChange={setPeriodSel} />}

      {!kpi ? <Spinner /> : (
        <>
          <div className="kpi-grid">
            <Kpi label={me.isAdmin ? 'Doanh thu toàn công ty' : 'Doanh thu của bạn'} value={short(kpi.revenue)} delta={kpi.momPct} sub={periodLabel(periodSel)} />
            <Kpi label="Trước VAT" value={short(kpi.revenueBeforeVat)} sub={money(kpi.revenue) + ' sau VAT'} />
            <Kpi label="Đạt target (%)" value={pct(kpi.pctTarget)}
                 sub={kpi.pctTarget != null ? (kpi.pctTarget >= 100 ? 'Đã đạt 🎉' : 'Chưa đạt') : 'Chưa có target'} />
            <Kpi label="NV đạt target" value={`${kpi.empTarget?.achieved ?? 0}/${kpi.empTarget?.total ?? 0} đạt`} sub={me.isAdmin ? 'NV đang bán có target' : 'Theo phạm vi của bạn'} />
            <Kpi label="Cơ số thầu sắp cạn" value={`${kpi.cstLowCount || 0} dòng <10%`} sub="Hiện tại · bấm để xem" tone="danger" onClick={() => onNavigate?.('cst', { cstFilter: 'low' })} />
            <Kpi label="Quy mô kỳ" value={`${kpi.unitCount} ĐV · ${kpi.productCount} SP · ${kpi.empCount} NV`} sub={`${kpi.rowCount} dòng`} />
          </div>
          <div className="chart-grid overview-charts">
            <div className="card chart-card wide">
              <div className="section-head">📈 Doanh thu theo kỳ · overlay target</div>
              {!trend ? <Spinner /> : <RevenueTrendChart rows={trend} selectedKys={kpi.kys} />}
            </div>
            <div className="card chart-card target-card">
              <div className="section-head">🎯 Tiến độ target {periodLabel(periodSel)}</div>
              <TargetGauge pct={kpi.pctTarget} />
              <div className="center compact-center">{short(kpi.revenueBeforeVat)} / {short(kpi.targetTotal)} trước VAT</div>
            </div>
            <div className="card chart-card wide">
              <div className="chart-head">
                <div className="section-head">🏆 Top 10 doanh thu</div>
                <div className="seg compact">
                  <button className={topDim === 'unit' ? 'active' : ''} onClick={() => setTopDim('unit')}>Đơn vị</button>
                  <button className={topDim === 'product' ? 'active' : ''} onClick={() => setTopDim('product')}>Sản phẩm</button>
                </div>
              </div>
              {!topRows ? <Spinner /> : <TopBarChart rows={topRows} />}
            </div>
          </div>
        </>
      )}

      <div className="section-title">🔔 Cần chú ý {alerts ? `(${alerts.count})` : ''} · CST hiện tại</div>
      {!alerts ? <Spinner /> : alerts.count === 0 ? (
        <div className="center">Không có cảnh báo nào. Mọi thứ ổn ✅</div>
      ) : (
        <>
          <div className="card alert-summary-strip">
            <span><b>{summary.emp_below_target}</b> NV chưa đạt</span>
            <span><b>{summary.units_down}</b> đơn vị giảm</span>
            <span><b>{summary.cst_low}</b> CST sắp cạn</span>
            <span><b>{summary.cst_high}</b> CST tồn nhiều</span>
          </div>
          <div className="alerts-grid grouped-alerts">
            {groups.map((g) => (
              <div key={g.key} className={'card alert-group ' + (g.tone || '')}>
                <div className="alert-group-head">
                  <div>
                    <span className="alert-ic">{g.icon}</span>
                    <b>{g.title}</b>
                  </div>
                  <span className="pill muted-pill">{g.total}</span>
                </div>
                <div className="alert-lines">
                  {g.items.length === 0 ? <div className="alert-line"><span>Không có cảnh báo trong kỳ này.</span></div> : g.items.slice(0, 8).map((item, i) => <AlertLine key={i} group={g} item={item} />)}
                </div>
                {g.total > 0 && <button className="btn ghost alert-more" onClick={() => viewAll(g)}>Xem tất cả ({g.total}) ›</button>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
