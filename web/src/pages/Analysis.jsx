import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, short } from '../util.js';
import { Spinner, RankRow, Kpi } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';

function DeltaRow({ i, r }) {
  const up = (r.delta || 0) >= 0;
  return (
    <div className="row">
      <div className="main">
        <div className="name"><span className="rank">{i}</span>{r.label}</div>
        <div className="meta">Kỳ trước {short(r.prevRevenue)} → kỳ này {short(r.revenue)} · {r.deltaPct == null ? '—' : r.deltaPct + '%'}</div>
      </div>
      <div className="amt" style={{ color: up ? 'var(--ok)' : 'var(--hi)' }}>{up ? '+' : ''}{short(r.delta)}</div>
    </div>
  );
}

function Block({ title, rows, negative }) {
  return (
    <div className="card">
      <div className="section-head">{title}</div>
      {!rows?.length ? <div className="center">Chưa có dữ liệu so sánh.</div> : rows.map((r, i) => <DeltaRow key={r.key} i={i + 1} r={r} negative={negative} />)}
    </div>
  );
}

export default function Analysis({ me }) {
  const { periods, ky, setKy, filters, setFilters, options } = usePeriodsAndFilters(api);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!ky) return;
    setData(null);
    api.analysis({ ky, ...filters }).then(setData);
  }, [ky, filters]);

  return (
    <>
      <RevenueFilters me={me} ky={ky} periods={periods} options={options} filters={filters} setKy={setKy} setFilters={setFilters} />
      {!data ? <Spinner /> : (
        <>
          <div className="kpi-grid">
            <Kpi label={`Doanh thu ${data.ky}`} value={short(data.currentRevenue)} sub={money(data.currentRevenue)} />
            <Kpi label={`So với ${data.prevKy || 'kỳ trước'}`} value={(data.delta >= 0 ? '+' : '') + short(data.delta)} sub={data.deltaPct == null ? 'Chưa có kỳ trước' : `${data.deltaPct}%`} />
            <Kpi label="Số dòng dữ liệu" value={(data.rowCount || 0).toLocaleString('vi-VN')} />
          </div>
          <div className="card">
            <div className="section-head">Cơ cấu tuyến / nhà thầu / UT</div>
            <div className="mini-columns">
              <div><b>Tuyến</b>{(data.byRoute || []).map((r, i) => <RankRow key={r.key || i} i={i + 1} name={r.label || '—'} meta={short(r.revenue)} amount={r.revenue} max={data.byRoute?.[0]?.revenue || 0} />)}</div>
              <div><b>Nhà thầu</b>{(data.byContractor || []).map((r, i) => <RankRow key={r.key || i} i={i + 1} name={r.label || '—'} meta={short(r.revenue)} amount={r.revenue} max={data.byContractor?.[0]?.revenue || 0} />)}</div>
              <div><b>UT</b>{(data.byPriority || []).map((r, i) => <RankRow key={r.key || i} i={i + 1} name={r.label || '—'} meta={short(r.revenue)} amount={r.revenue} max={data.byPriority?.[0]?.revenue || 0} />)}</div>
            </div>
          </div>
          <Block title="Đơn vị tăng mạnh" rows={data.topGrowthUnits} />
          <Block title="Đơn vị giảm mạnh" rows={data.topDeclineUnits} negative />
          <Block title="Sản phẩm tăng mạnh" rows={data.topGrowthProducts} />
          <Block title="Sản phẩm giảm mạnh" rows={data.topDeclineProducts} negative />
        </>
      )}
    </>
  );
}
