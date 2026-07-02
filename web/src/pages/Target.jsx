import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, short } from '../util.js';
import { Spinner, Bar } from '../components.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams, periodLabel } from './PeriodFilter.jsx';
import { TargetGauge } from '../charts.jsx';

export default function Target({ me }) {
  const [view, setView] = useState('now'); // now | forecast
  const [periods, setPeriods] = useState([]);
  const [periodSel, setPeriodSel] = useState(null);
  const [now, setNow] = useState(null);
  const [fc, setFc] = useState(null);

  useEffect(() => {
    api.periods().then((p) => { setPeriods(p.periods || []); setPeriodSel(defaultPeriodSelection(p.periods || [], p.latest)); });
  }, []);
  useEffect(() => {
    if (!periodSel) return;
    setNow(null);
    api.targets(periodParams(periodSel)).then(setNow);
  }, [periodSel]);
  useEffect(() => { api.forecast().then(setFc); }, []);

  return (
    <>
      <div className="seg">
        <button className={view === 'now' ? 'active' : ''} onClick={() => setView('now')}>Kỳ này</button>
        <button className={view === 'forecast' ? 'active' : ''} onClick={() => setView('forecast')}>
          Dự báo kỳ tới{fc ? ` (${fc.next_ky})` : ''}
        </button>
      </div>
      {view === 'now' && periodSel && <PeriodFilter periods={periods} value={periodSel} onChange={setPeriodSel} />}

      {view === 'now' ? (
        !now ? <Spinner /> : now.items.length === 0 ? <div className="center">Chưa có target.</div> : (
          <>
          <div className="section-title">Kỳ target: {periodLabel(periodSel)}</div>
          <div className="list-grid">
            {now.items.map((t) => {
              const p = t.pct;
              const cls = p == null ? 'ok' : p >= 100 ? 'ok' : p >= 80 ? 'warn' : 'bad';
              return (
                <div key={t.emp_code} className="card" style={{ padding: 12 }}>
                  <div className="target-card-row">
                    <TargetGauge pct={p} size="small" />
                    <div className="target-card-body">
                      <div className="list-card-title">
                        <div className="name">{t.emp_name || t.emp_code}</div>
                        <span className={'pill ' + cls}>{p == null ? '—' : p + '%'}</span>
                      </div>
                      <Bar value={t.revenue_before_vat} max={t.target} tone={p != null && p < 80 ? 'warn' : ''} />
                      <div className="meta muted" style={{ marginTop: 5 }}>
                        Đạt {short(t.revenue_before_vat)} / target {short(t.target)} ·{' '}
                        <span style={{ color: t.gap >= 0 ? 'var(--ok)' : 'var(--hi)' }}>
                          {t.gap >= 0 ? 'vượt ' : 'thiếu '}{short(Math.abs(t.gap))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )
      ) : (
        !fc ? <Spinner /> : (
          <>
            <div className="card" style={{ background: '#eef4f2', border: 'none' }}>
              <div style={{ fontWeight: 700, color: 'var(--brand)' }}>🎯 Đề xuất target {fc.next_ky}</div>
              <div className="meta muted">Tính theo xu hướng doanh thu thật + mức đạt gần nhất + hệ số mùa vụ {fc.season_factor}. Con số để CEO tham khảo, chỉnh tay được.</div>
            </div>
            <div className="list-grid">
              {fc.items.map((t) => (
                <div key={t.emp_code} className="card" style={{ padding: 12 }}>
                  <div className="list-card-title">
                    <div className="name">{t.emp_name}</div>
                    <div className="amt">{short(t.suggested_target)}</div>
                  </div>
                  <div className="meta muted" style={{ marginTop: 3 }}>
                    Target cũ {short(t.last_target)} · đạt {t.attain_pct == null ? '—' : t.attain_pct + '%'} · xu hướng {short(t.trend_revenue)}
                  </div>
                  <div className="meta" style={{ marginTop: 4, color: 'var(--muted)', fontStyle: 'italic' }}>{t.reason}</div>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </>
  );
}
