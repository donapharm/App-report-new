import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, short, pct } from '../util.js';
import { Spinner, Kpi } from '../components.jsx';

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
  const [ky, setKy] = useState('');
  const [kpi, setKpi] = useState(null);
  const [alerts, setAlerts] = useState(null);

  useEffect(() => {
    api.periods().then((p) => { setPeriods(p.periods); setKy(p.latest); });
  }, []);

  useEffect(() => {
    if (!ky) return;
    setKpi(null);
    api.overview(ky).then(setKpi);
  }, [ky]);

  useEffect(() => { api.alerts().then(setAlerts); }, []);

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
      <div className="chips">
        {periods.map((p) => (
          <button key={p.ky} className={'chip' + (p.ky === ky ? ' active' : '')} onClick={() => setKy(p.ky)}>
            Kỳ {p.ky}
          </button>
        ))}
      </div>

      {!kpi ? <Spinner /> : (
        <>
          <div className="kpi-grid">
            <Kpi label={me.isAdmin ? 'Doanh thu toàn công ty' : 'Doanh thu của bạn'} value={short(kpi.revenue)} delta={kpi.momPct} />
            <Kpi label="Đạt target (trước VAT)" value={pct(kpi.pctTarget)}
                 sub={kpi.pctTarget != null ? (kpi.pctTarget >= 100 ? 'Đã đạt 🎉' : 'Chưa đạt') : 'Chưa có target'} />
            <Kpi label="Trước VAT" value={short(kpi.revenueBeforeVat)} sub={money(kpi.revenue) + ' sau VAT'} />
            <Kpi label="Quy mô kỳ" value={`${kpi.unitCount} ĐV · ${kpi.productCount} SP`} sub={`${kpi.empCount} NV · ${kpi.rowCount} dòng`} />
          </div>
        </>
      )}

      <div className="section-title">🔔 Cần chú ý {alerts ? `(${alerts.count})` : ''}</div>
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
            {groups.filter((g) => g.total > 0).map((g) => (
              <div key={g.key} className={'card alert-group ' + (g.tone || '')}>
                <div className="alert-group-head">
                  <div>
                    <span className="alert-ic">{g.icon}</span>
                    <b>{g.title}</b>
                  </div>
                  <span className="pill muted-pill">{g.total}</span>
                </div>
                <div className="alert-lines">
                  {g.items.slice(0, 8).map((item, i) => <AlertLine key={i} group={g} item={item} />)}
                </div>
                <button className="btn ghost alert-more" onClick={() => viewAll(g)}>Xem tất cả ({g.total}) ›</button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
