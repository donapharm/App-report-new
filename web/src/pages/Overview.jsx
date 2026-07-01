import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, short, pct } from '../util.js';
import { Spinner, Kpi } from '../components.jsx';

export default function Overview({ me }) {
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

      <div className="section-title">
        🔔 Cần chú ý {alerts ? `(${alerts.count})` : ''}
      </div>
      {!alerts ? <Spinner /> : alerts.count === 0 ? (
        <div className="center">Không có cảnh báo nào. Mọi thứ ổn ✅</div>
      ) : (
        alerts.alerts.slice(0, 20).map((a, i) => (
          <div key={i} className={'alert ' + a.severity}>
            <div className="dot" />
            <div>
              <div className="t">{a.title}</div>
              <div className="d">{a.detail}</div>
            </div>
          </div>
        ))
      )}
    </>
  );
}
