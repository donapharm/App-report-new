import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, short } from '../util.js';
import { Spinner, Kpi } from '../components.jsx';
import { emptyRevenueFilters, Select } from './revenueFilters.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams } from './PeriodFilter.jsx';
import { DonutChart, TopBarChart } from '../charts.jsx';

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
  const [periods, setPeriods] = useState([]);
  const [periodSel, setPeriodSel] = useState(null);
  const [filters, setFilters] = useState(emptyRevenueFilters);
  const [options, setOptions] = useState(null);
  const [data, setData] = useState(null);
  const [topDim, setTopDim] = useState('unit');
  const [topRows, setTopRows] = useState(null);

  useEffect(() => {
    api.periods().then((p) => { setPeriods(p.periods || []); setPeriodSel(defaultPeriodSelection(p.periods || [], p.latest)); });
  }, []);

  useEffect(() => {
    if (!periodSel) return;
    api.filters(periodParams(periodSel)).then(setOptions);
  }, [periodSel]);

  useEffect(() => {
    if (!periodSel) return;
    setData(null);
    api.analysis({ ...periodParams(periodSel), ...filters }).then(setData);
  }, [periodSel, filters]);

  useEffect(() => {
    if (!periodSel) return;
    setTopRows(null);
    api.revenue(topDim, null, { ...periodParams(periodSel), ...filters }).then((d) => setTopRows((d.rows || []).slice(0, 10)));
  }, [periodSel, filters, topDim]);

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <>
      {periodSel && <PeriodFilter periods={periods} value={periodSel} onChange={setPeriodSel} />}
      <div className="card filter-card">
        <div className="filter-grid">
          {me.isAdmin && <Select value={filters.emp} onChange={(v) => setF('emp', v)} options={options?.employees} all="Tất cả NV" />}
          <Select value={filters.unit} onChange={(v) => setF('unit', v)} options={options?.units} all="Tất cả đơn vị" />
          <Select value={filters.product} onChange={(v) => setF('product', v)} options={options?.products} all="Tất cả sản phẩm" />
          <Select value={filters.route} onChange={(v) => setF('route', v)} options={options?.routes} all="Tất cả tuyến" />
          <Select value={filters.priority} onChange={(v) => setF('priority', v)} options={options?.priorities} all="Tất cả UT" />
          <Select value={filters.contractor} onChange={(v) => setF('contractor', v)} options={options?.contractors} all="Tất cả nhà thầu" />
          <Select value={filters.bid} onChange={(v) => setF('bid', v)} options={options?.bidPackages} all="Tất cả gói thầu" />
        </div>
        <div className="filter-search">
          <input value={filters.q} onChange={(e) => setF('q', e.target.value)} placeholder="Tìm mã/tên NV, đơn vị, sản phẩm, mã QLNB…" />
          <button className="btn ghost" onClick={() => setFilters(emptyRevenueFilters)}>Xoá lọc ({activeFilterCount})</button>
        </div>
      </div>
      {!data ? <Spinner /> : (
        <>
          <div className="kpi-grid">
            <Kpi label={`Doanh thu ${data.ky}`} value={short(data.currentRevenue)} sub={money(data.currentRevenue)} />
            <Kpi label={`So với ${data.prevKy || 'kỳ trước'}`} value={(data.delta >= 0 ? '+' : '') + short(data.delta)} sub={data.deltaPct == null ? 'Chưa có kỳ trước' : `${data.deltaPct}%`} />
            <Kpi label="Số dòng dữ liệu" value={(data.rowCount || 0).toLocaleString('vi-VN')} />
          </div>
          <div className="card">
            <div className="section-head">🥯 Cơ cấu Tuyến / Nhà thầu / Gói thầu</div>
            <div className="donut-grid">
              <div><b>Tuyến</b><DonutChart rows={data.byRoute || []} /></div>
              <div><b>Nhà thầu</b><DonutChart rows={data.byContractor || []} /></div>
              <div><b>Gói thầu</b><DonutChart rows={data.byBidPackage || []} /></div>
            </div>
          </div>
          <div className="card chart-card">
            <div className="chart-head">
              <div className="section-head">🏆 Top 10 doanh thu</div>
              <div className="seg compact">
                <button className={topDim === 'unit' ? 'active' : ''} onClick={() => setTopDim('unit')}>Đơn vị</button>
                <button className={topDim === 'product' ? 'active' : ''} onClick={() => setTopDim('product')}>Sản phẩm</button>
              </div>
            </div>
            {!topRows ? <Spinner /> : <TopBarChart rows={topRows} />}
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
