import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, pct, unitText } from '../util.js';
import { Spinner, Kpi, useCollapse, TargetKpiStrip } from '../components.jsx';
import { ComboSelect, emptyRevenueFilters, Select } from './revenueFilters.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams } from './PeriodFilter.jsx';
import { DonutChart, TopBarChart } from '../charts.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';

function DeltaRow({ i, r, kind }) {
  const up = (r.delta || 0) >= 0;
  const title = kind === 'unit' ? unitText(r.key, r.label) : r.label;
  return (
    <div className="row">
      <div className="main">
        <div className="name"><span className="rank">{i}</span>{title}</div>
        <div className="meta">
          <span className={'chg-chip ' + (up ? 'up' : 'down')}>{up ? '▲ Tăng' : '▼ Giảm'} {pct(Math.abs(r.deltaPct), 0)}</span>
          Kỳ trước {money(r.prevRevenue)} → kỳ này {money(r.revenue)}
        </div>
      </div>
      <div className="amt" style={{ color: up ? 'var(--ok)' : 'var(--hi)' }}>{up ? '+' : ''}{money(r.delta)}</div>
    </div>
  );
}

function Block({ title, rows, negative, kind }) {
  return (
    <div className="card analysis-list-block">
      <div className="section-head">{title}</div>
      {!rows?.length ? <div className="center">Chưa có dữ liệu so sánh.</div> : rows.map((r, i) => <DeltaRow key={r.key} i={i + 1} r={r} negative={negative} kind={kind} />)}
    </div>
  );
}

function CstLowBlock({ rows }) {
  return (
    <div className="card analysis-list-block">
      <div className="section-head">📦 SP sắp hết CST</div>
      {!rows?.length ? <div className="center">Không có sản phẩm sắp hết CST trong phạm vi lọc.</div> : rows.map((r, i) => (
        <div className="row" key={r.key || i}>
          <div className="main">
            <div className="name"><span className="rank">{i + 1}</span>{r.label}</div>
            <div className="meta">{r.iit_code || '—'} · {r.qd || '—'} · {unitText(r.unit_code, r.unit_name)} {r.qd === 'QĐ139' ? `· ${r.active_ingredient || '—'} ${r.ham_luong || ''}` : ''}</div>
          </div>
          <div className="amt" style={{ color: 'var(--hi)' }}>còn {r.remain_pct}%</div>
        </div>
      ))}
    </div>
  );
}

function CstUntouchedBlock({ rows }) {
  return (
    <div className="card analysis-list-block">
      <div className="section-head">🆕 SP chưa khai thác (còn 100% CST)</div>
      {!rows?.length ? <div className="center">Không có mặt hàng nào còn nguyên cơ số trong phạm vi lọc.</div> : rows.map((r, i) => (
        <div className="row" key={r.key || i}>
          <div className="main">
            <div className="name"><span className="rank">{i + 1}</span>{r.label}</div>
            <div className="meta">{r.iit_code || '—'} · {unitText(r.unit_code, r.unit_name)}{r.qd === 'QĐ139' && r.active_ingredient ? ` · ${r.active_ingredient} ${r.ham_luong || ''}` : ''}</div>
          </div>
          <div className="amt" style={{ color: 'var(--hi)' }}>còn {(Number(r.remain_qty) || 0).toLocaleString('vi-VN')}</div>
        </div>
      ))}
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
  const [exporting, setExporting] = useState(false);
  const [targetKpi, setTargetKpi] = useState(null);
  const [cmpMode, setCmpModeState] = useState(() => { try { return localStorage.getItem('rpt_cmp_mode') || 'prev'; } catch { return 'prev'; } });
  const setCmpMode = (m) => { setCmpModeState(m); try { localStorage.setItem('rpt_cmp_mode', m); } catch { /* ignore */ } };
  const { reloadTick, reload } = useReloadTick();

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
    api.analysis({ ...periodParams(periodSel), ...filters, compareMode: cmpMode }).then(setData);
  }, [periodSel, filters, reloadTick, cmpMode]);

  useEffect(() => {
    if (!periodSel) return;
    setTopRows(null);
    api.revenue(topDim, null, { ...periodParams(periodSel), ...filters }).then((d) => setTopRows((d.rows || []).slice(0, 10)));
  }, [periodSel, filters, topDim, reloadTick]);

  useEffect(() => {
    if (!periodSel) { setTargetKpi(null); return; }
    api.targetKpi(periodParams(periodSel).ky).then((d) => setTargetKpi(d.kpi)).catch(() => setTargetKpi(null));
  }, [periodSel, reloadTick]);

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const { open, toggle } = useCollapse();

  return (
    <>
      <DrillNav crumbs={[{ label: 'Phân tích' }]} onReload={reload} busy={!data} />
      {periodSel && <PeriodFilter periods={periods} value={periodSel} onChange={setPeriodSel} />}
      <div className={'card filter-card' + (open ? ' open' : ' collapsed')}>
        <div className="filter-bar">
          <input className="filter-quick" value={filters.q} onChange={(e) => setF('q', e.target.value)} placeholder="Tìm mã/tên NV, đơn vị, sản phẩm, mã QLNB…" />
          <button type="button" className="btn ghost filter-toggle" aria-expanded={open} onClick={toggle}>{open ? '▴ Thu gọn lọc' : '▾ Bộ lọc'}{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
          {activeFilterCount > 0 && <button className="btn ghost" onClick={() => setFilters(emptyRevenueFilters)}>Xoá lọc</button>}
          <button className="btn ghost" disabled={!data || exporting} onClick={async () => { setExporting(true); try { await downloadExport('analysis', { ...periodParams(periodSel), ...filters }); } catch (e) { alert(e.message); } setExporting(false); }}>⬇ Excel</button>
        </div>
        {open && (
          <div className="filter-body">
            <div className="filter-grid">
              {me.isAdmin && <ComboSelect value={filters.emp} onChange={(v) => setF('emp', v)} options={options?.employees} all="Tất cả NV" />}
              <Select value={filters.province} onChange={(v) => setF('province', v)} options={options?.provinces} all="Tất cả tỉnh/thành" />
              <ComboSelect value={filters.unit} onChange={(v) => setF('unit', v)} options={options?.units} all="Tất cả đơn vị" placeholder="Gõ mã/tên đơn vị…" />
              <ComboSelect value={filters.product} onChange={(v) => setF('product', v)} options={options?.products} all="Tất cả sản phẩm" placeholder="Gõ tên/mã QLNB/hoạt chất…" />
              <Select value={filters.route} onChange={(v) => setF('route', v)} options={options?.routes} all="Tất cả tuyến" />
              <Select value={filters.priority} onChange={(v) => setF('priority', v)} options={options?.priorities} all="Tất cả UT" />
              <ComboSelect value={filters.contractor} onChange={(v) => setF('contractor', v)} options={options?.contractors} all="Tất cả nhà thầu" placeholder="Gõ mã/tên nhà thầu…" />
              <Select value={filters.bid} onChange={(v) => setF('bid', v)} options={options?.bidPackages} all="Tất cả gói thầu" />
            </div>
          </div>
        )}
      </div>
      {!data ? <Spinner /> : (
        <>
          <div className="kpi-grid">
            <Kpi label={`Doanh thu ${data.ky}`} value={money(data.currentRevenue)} />
            <Kpi label={`So với ${data.prevKy || 'kỳ trước'}`} value={(data.delta >= 0 ? '+' : '') + money(data.delta)} sub={data.deltaPct == null ? 'Chưa có kỳ trước' : pct(data.deltaPct)} />
            <Kpi label="Số dòng dữ liệu" value={(data.rowCount || 0).toLocaleString('vi-VN')} />
          </div>
          {targetKpi && <><div className="section-title">🎯 Target vs Đã đạt (tháng &amp; quý)</div><TargetKpiStrip kpi={targetKpi} /></>}
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
          <div className="cmp-toggle-row">
            <span className="cmp-toggle-label">So tăng/giảm:</span>
            <div className="seg compact">
              <button className={cmpMode === 'prev' ? 'active' : ''} onClick={() => setCmpMode('prev')}>Tháng liền trước</button>
              <button className={cmpMode === 'yoy' ? 'active' : ''} onClick={() => setCmpMode('yoy')}>Cùng kỳ năm ngoái</button>
            </div>
          </div>
          {data.growthNote && <div className={'alert-group-note' + (data.growthNote.startsWith('⚠') ? ' warn' : '')} style={{ margin: '4px 2px 8px' }}>{data.growthNote}</div>}
          <div className="list-grid analysis-block-grid">
            <Block title="Đơn vị tăng mạnh" rows={data.topGrowthUnits} kind="unit" />
            <Block title="Đơn vị giảm mạnh" rows={data.topDeclineUnits} kind="unit" negative />
            <Block title="Sản phẩm tăng mạnh" rows={data.topGrowthProducts} />
            <Block title="Sản phẩm giảm mạnh" rows={data.topDeclineProducts} negative />
            <Block title="SP cần đẩy mạnh" rows={data.pushProducts} negative />
            <CstLowBlock rows={data.cstLowProducts} />
            <CstUntouchedBlock rows={data.cstUntouched} />
            <Block title="🛣️ Biến động theo tuyến (so kỳ trước)" rows={data.routeDelta} />
          </div>
        </>
      )}
    </>
  );
}
