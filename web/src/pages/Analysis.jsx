import React, { useEffect, useRef, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, pct } from '../util.js';
import { Spinner, Kpi, useCollapse, TargetKpiStrip, UnitLabel, Pager, usePager } from '../components.jsx';
import { ComboSelect, emptyRevenueFilters, MultiSelect, Select } from './revenueFilters.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams } from './PeriodFilter.jsx';
import { DonutChart, TopBarChart } from '../charts.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';

function formatCompareKy(ky) {
  const [mm, yyyy] = String(ky || '').split('.');
  return mm && yyyy ? `T${String(mm).padStart(2, '0')}/${yyyy}` : String(ky || '—');
}

function formatCompareRange(kys, fallback) {
  const list = (Array.isArray(kys) ? kys : []).filter(Boolean);
  if (!list.length) return formatCompareKy(fallback);
  if (list.length === 1) return formatCompareKy(list[0]);
  const [fromMm, fromYy] = String(list[0]).split('.');
  const [toMm, toYy] = String(list.at(-1)).split('.');
  if (fromYy && fromYy === toYy) return `T${String(fromMm).padStart(2, '0')}–T${String(toMm).padStart(2, '0')}/${toYy}`;
  return `${formatCompareKy(list[0])}–${formatCompareKy(list.at(-1))}`;
}

function comparePeriodLabel(compare = {}) {
  const current = formatCompareRange(compare.curKys, compare.curKy);
  const previous = formatCompareRange(compare.prevKys, compare.prevKy);
  if (compare.yoyMissing) return `${current} · chưa có dữ liệu ${previous} để so cùng kỳ năm ngoái`;
  const relation = compare.mode === 'yoy'
    ? 'cùng kỳ năm ngoái'
    : (compare.adjusted
      ? 'hai tháng hoàn tất gần nhất'
      : ((compare.curKys || []).length > 1 ? 'giai đoạn liền trước' : 'tháng liền trước'));
  return `${current} so với ${previous} · ${relation}`;
}

function dailyUpdatedLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric', hour12: false,
  });
}

function DailySalesKpi({ data }) {
  if (!data) return <Kpi label="Doanh số trong ngày" value="—" sub="Đang tải dữ liệu…" />;
  const tone = data.stale ? 'daily-stale' : (data.status === 'day_off' ? 'daily-day-off' : 'daily-ready');
  const updated = dailyUpdatedLabel(data.sourceUpdatedAt);
  return (
    <div className={`kpi daily-sales-kpi ${tone}`}>
      <span className="kpi-ic" aria-hidden="true">🗓️</span>
      <div className="label">Doanh số trong ngày</div>
      <div className="value small">{money(data.revenue || 0)}</div>
      <div className="daily-sales-date">Ngày {String(data.date || '').split('-').reverse().join('/')}</div>
      {!!data.note && <div className="daily-sales-note">{data.note}</div>}
      {!!updated && <div className="daily-sales-updated">Cập nhật lúc {updated}</div>}
    </div>
  );
}

function DeltaRow({ i, r, kind }) {
  const up = (r.delta || 0) >= 0;
  const changeValue = Number(r.prevRevenue || 0) > 0
    ? pct(Math.abs(r.deltaPct), 0)
    : (Number(r.revenue || 0) > 0 ? 'mới' : pct(Math.abs(r.deltaPct), 0));
  const title = kind === 'unit' ? <UnitLabel code={r.key} name={r.label} /> : r.label;
  return (
    <div className={'row' + (kind === 'contractor' ? ' contractor-delta-row' : '')}>
      <div className="main">
        <div className={'name' + (kind === 'contractor' ? ' contractor-delta-name' : '')} title={kind === 'contractor' ? String(r.label || '') : undefined}>
          <span className="rank">{i}</span><span className="delta-row-label">{title}</span>
        </div>
        <div className="meta">
          <span className={'chg-chip ' + (up ? 'up' : 'down')}>{up ? '▲ Tăng' : '▼ Giảm'} {changeValue}</span>
          Kỳ trước {money(r.prevRevenue)} → kỳ này {money(r.revenue)}
        </div>
      </div>
      <div className="amt" style={{ color: up ? 'var(--ok)' : 'var(--hi)' }}>{up ? '+' : ''}{money(r.delta)}</div>
    </div>
  );
}

function Block({ title, subtitle, rows, negative, kind }) {
  const [expanded, setExpanded] = useState(false);
  const resetKey = `${rows?.length || 0}|${rows?.[0]?.key || ''}|${rows?.at(-1)?.key || ''}`;
  useEffect(() => setExpanded(false), [resetKey]);
  const visibleRows = expanded ? (rows || []) : (rows || []).slice(0, 10);
  return (
    <div className="card analysis-list-block">
      <div className="section-head">{title}</div>
      {subtitle && <div className="analysis-compare-period">{subtitle}</div>}
      {!rows?.length ? <div className="center">Chưa có dữ liệu so sánh.</div> : <>
        {visibleRows.map((r, i) => <DeltaRow key={r.key} i={i + 1} r={r} negative={negative} kind={kind} />)}
        {rows.length > 10 && <button type="button" className="analysis-expand-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '▴ Thu gọn về Top 10' : `▾ Xem tất cả (${rows.length.toLocaleString('vi-VN')} dòng)`}
        </button>}
      </>}
    </div>
  );
}

function CstLowBlock({ rows }) {
  const [expanded, setExpanded] = useState(false);
  const resetKey = `${rows?.length || 0}|${rows?.[0]?.key || ''}|${rows?.at(-1)?.key || ''}`;
  useEffect(() => setExpanded(false), [resetKey]);
  const visibleRows = expanded ? (rows || []) : (rows || []).slice(0, 10);
  return (
    <div className="card analysis-list-block">
      <div className="section-head">📦 SP sắp hết CST</div>
      {!rows?.length ? <div className="center">Không có sản phẩm sắp hết CST trong phạm vi lọc.</div> : <>
        {visibleRows.map((r, i) => (
          <div className="row" key={r.key || i}>
            <div className="main">
              <div className="name"><span className="rank">{i + 1}</span>{r.label}</div>
              <div className="meta">{r.iit_code || '—'} · {r.qd || '—'} · <UnitLabel code={r.unit_code} name={r.unit_name} /> {r.qd === 'QĐ139' ? `· ${r.active_ingredient || '—'} ${r.ham_luong || ''}` : ''}</div>
            </div>
            <div className="amt" style={{ color: 'var(--hi)' }}>còn {r.remain_pct}%</div>
          </div>
        ))}
        {rows.length > 10 && <button type="button" className="analysis-expand-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '▴ Thu gọn về Top 10' : `▾ Xem tất cả (${rows.length.toLocaleString('vi-VN')} dòng)`}
        </button>}
      </>}
    </div>
  );
}

function CstUntouchedBlock({ rows, productCount }) {
  const resetKey = `${rows?.length || 0}|${rows?.[0]?.key || ''}|${rows?.at(-1)?.key || ''}`;
  const pager = usePager(rows, 51, resetKey); // bội số của 3 để mỗi trang luôn đủ hàng 3 ô
  return (
    <section className="analysis-wide-block cst-untouched-section">
      <div className="card analysis-list-block cst-untouched-head">
        <div className="analysis-block-title">
          <div className="section-head">🆕 SP chưa khai thác (còn 100% CST)</div>
          {!!rows?.length && <span>{rows.length.toLocaleString('vi-VN')} dòng · {Number(productCount || 0).toLocaleString('vi-VN')} sản phẩm</span>}
        </div>
        {!!rows?.length && <Pager page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={pager.setPage} unit="dòng" />}
      </div>
      {!rows?.length ? <div className="card center">Không có mặt hàng nào còn nguyên cơ số trong phạm vi lọc.</div> : <>
        <div className="cst-untouched-grid">
          {Array.from({ length: 3 }, (_, panelIndex) => {
            const panelSize = Math.ceil(pager.pageItems.length / 3);
            const panelRows = pager.pageItems.slice(panelIndex * panelSize, (panelIndex + 1) * panelSize);
            return (
              <div className="card analysis-list-block cst-untouched-panel" key={panelIndex}>
                {panelRows.map((r, rowIndex) => {
                  const absoluteIndex = pager.startIndex + panelIndex * panelSize + rowIndex;
                  const employeeText = (r.employees || []).length
                    ? r.employees.map((e) => e.name && e.name !== e.code ? `${e.code} · ${e.name}` : e.code).join(', ')
                    : 'Chưa có thông tin phụ trách';
                  const bidPrice = Number(r.bid_price || 0);
                  const bidPriceText = bidPrice > 0
                    ? `${bidPrice.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`
                    : 'Chưa có dữ liệu';
                  return (
                    <div className="cst-untouched-row" key={r.key || absoluteIndex}>
                      <div className="cst-untouched-row-head">
                        <div className="cst-untouched-title">
                          <span className="rank">{absoluteIndex + 1}</span>
                          <b title={r.label || ''}>{r.label || 'Chưa có tên sản phẩm'}</b>
                          {r.qd && <span className="qd-badge">{r.qd}</span>}
                        </div>
                        <div className="cst-untouched-row-qty">
                          <strong>{(Number(r.remain_qty) || 0).toLocaleString('vi-VN')}</strong>
                          <span>còn nguyên {Number(r.remain_pct || 100).toLocaleString('vi-VN')}%</span>
                        </div>
                      </div>
                      <div className="cst-untouched-code" title={r.iit_code || ''}>{r.iit_code || 'Chưa có mã QLNB'}</div>
                      {r.qd === 'QĐ139' && r.active_ingredient && <div className="cst-untouched-ingredient">{r.active_ingredient}{r.ham_luong ? ` · ${r.ham_luong}` : ''}</div>}
                      <div className="cst-untouched-row-unit"><UnitLabel code={r.unit_code} name={r.unit_name} /></div>
                      <div className="cst-untouched-row-facts">
                        <span><em>Đơn vị tính</em><b>{r.uom || 'Chưa có dữ liệu'}</b></span>
                        <span><em>Giá thầu</em><b>{bidPriceText}</b></span>
                        <span><em>Nhóm TCKT</em><b>{r.technical_group || 'Chưa có dữ liệu'}</b></span>
                        <span><em>Thứ tự ưu tiên</em><b>{r.priority || 'Chưa có dữ liệu'}</b></span>
                      </div>
                      <div className="cst-untouched-row-employee">👤 <b>{employeeText}</b></div>
                      <div className="cst-untouched-row-initial">Còn lại / ban đầu: <b>{(Number(r.remain_qty) || 0).toLocaleString('vi-VN')} / {(Number(r.bid_qty_initial) || 0).toLocaleString('vi-VN')}</b></div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="card cst-untouched-pager"><Pager page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={pager.setPage} unit="dòng" /></div>
      </>}
    </section>
  );
}

function CstQueuedBlock({ rows, note }) {
  if (!rows?.length) return null;
  return <section className="analysis-wide-block">
    <div className="card analysis-list-block">
      <div className="section-head">⏳ QLNB kế tiếp đang chờ mã hiện hành</div>
      <div className="muted">{note}</div>
      {rows.map((r, i) => <div className="row" key={r.key || i}>
        <div className="main">
          <div className="name">{r.label}</div>
          <div className="meta"><UnitLabel code={r.unit_code} name={r.unit_name} /> · mã hiện hành <b>{r.cst_sequence?.current?.code || 'cần xác nhận'}</b> còn {Number(r.cst_sequence?.current?.remainPct || 0).toLocaleString('vi-VN')}% / {Number(r.cst_sequence?.current?.remainQty || 0).toLocaleString('vi-VN')} {r.uom} · mã kế tiếp <b>{r.iit_code}</b></div>
        </div>
        <div className="amt">ĐANG CHỜ · {Number(r.remain_pct || 0).toLocaleString('vi-VN')}%</div>
      </div>)}
    </div>
  </section>;
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
  const lastAutoRefresh = useRef(Date.now());

  // Backend materialize theo giờ; màn hình kiểm tra nhẹ mỗi 5 phút và khi người dùng
  // quay lại app để mọi KPI cùng nhận bản mới, tránh số cũ như ảnh 07:33.
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

  useEffect(() => {
    api.periods().then((p) => { setPeriods(p.periods || []); setPeriodSel(defaultPeriodSelection(p.periods || [], p.latest)); });
  }, []);

  useEffect(() => {
    if (!periodSel) return;
    api.filters({ ...periodParams(periodSel), ...filters, q: '' }).then(setOptions);
  }, [periodSel, filters.emp, filters.province, filters.unit, filters.group, filters.product, filters.route, filters.priority, filters.contractor, filters.bid]);

  useEffect(() => {
    if (!periodSel) return;
    setData(null);
    api.analysis({ ...periodParams(periodSel), ...filters, compareMode: cmpMode }).then(setData);
  }, [periodSel, filters, reloadTick, cmpMode]);

  useEffect(() => {
    if (!periodSel) return;
    setTopRows(null);
    const p = { ...periodParams(periodSel), ...filters };
    if (topDim === 'emp' && me.isAdmin) {
      Promise.all([api.revenue('emp', null, p), api.targets(periodParams(periodSel))]).then(([d, t]) => {
        const pctByEmp = Object.fromEntries((t.items || []).map((x) => [x.emp_code, x.pct]));
        setTopRows((d.rows || []).slice(0, 20).map((r) => ({ ...r, pctTarget: pctByEmp[r.key] ?? null })));
      });
    } else {
      api.revenue(topDim, null, p).then((d) => setTopRows((d.rows || []).slice(0, 20)));
    }
  }, [periodSel, filters, topDim, reloadTick]);

  useEffect(() => {
    if (!periodSel) { setTargetKpi(null); return; }
    api.targetKpi(periodParams(periodSel).ky).then((d) => setTargetKpi(d.kpi)).catch(() => setTargetKpi(null));
  }, [periodSel, reloadTick]);

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const { open, toggle } = useCollapse();
  const [mobileQuickOpen, setMobileQuickOpen] = useState(false);
  const explicitComparePeriod = data?.growthCompare ? comparePeriodLabel(data.growthCompare) : '';

  return (
    <>
      <DrillNav crumbs={[{ label: 'Phân tích' }]} onReload={reload} busy={!data} />
      <div className={'card filter-card analysis-control-panel' + (open ? ' open' : ' collapsed')}>
        <div className="analysis-control-top">
          {periodSel && <PeriodFilter compact periods={periods} value={periodSel} onChange={setPeriodSel} />}
          <div className="analysis-control-actions">
            <button type="button" className="btn ghost analysis-mobile-filter-toggle" aria-expanded={mobileQuickOpen} onClick={() => setMobileQuickOpen((v) => !v)}>☰ Bộ lọc{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
            <button type="button" className="btn ghost filter-toggle" aria-expanded={open} onClick={toggle}>{open ? '▴ Thu gọn' : '▾ Nâng cao'}</button>
            {activeFilterCount > 0 && <button className="btn ghost" onClick={() => setFilters({ ...emptyRevenueFilters })}>✕ Xóa lọc</button>}
            <button className="btn ghost" disabled={!data || exporting} onClick={async () => { setExporting(true); try { await downloadExport('analysis', { ...periodParams(periodSel), ...filters }); } catch (e) { alert(e.message); } setExporting(false); }}>⬇ Excel</button>
          </div>
        </div>
        <div className={'analysis-quick-filter-grid' + (mobileQuickOpen ? ' mobile-open' : '')}>
          {me.isAdmin && <label><span>Nhân viên</span><MultiSelect value={filters.emp} onChange={(v) => setF('emp', v)} options={options?.employees} all="Tất cả NV" unit="NV" /></label>}
          <label><span>Đơn vị</span><ComboSelect value={filters.unit} onChange={(v) => setF('unit', v)} options={options?.units} all="Tất cả đơn vị" placeholder="Mã/tên đơn vị…" /></label>
          <label><span>Nhóm hàng</span><ComboSelect value={filters.group} onChange={(v) => setF('group', v)} options={options?.groups} all="Tất cả nhóm hàng C14" placeholder="Nhóm hàng C14…" /></label>
          <label className="analysis-quick-search"><span>Thuốc</span><input className="filter-quick" value={filters.q} onChange={(e) => setF('q', e.target.value)} placeholder="Thuốc / mã QLNB…" /></label>
        </div>
        {open && (
          <div className="filter-body analysis-advanced-body">
            <div className="filter-grid">
              <Select value={filters.province} onChange={(v) => setF('province', v)} options={options?.provinces} all="Tất cả tỉnh/thành" />
              <ComboSelect value={filters.product} onChange={(v) => setF('product', v)} options={options?.products} all="Tất cả sản phẩm" placeholder="Chọn chính xác một sản phẩm…" />
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
          <div className="kpi-grid analysis-kpi-grid">
            <Kpi label={`Doanh thu ${data.ky}`} value={money(data.currentRevenue)} />
            <Kpi label={`So với ${data.prevKy || 'kỳ trước'}`} value={(data.delta >= 0 ? '+' : '') + money(data.delta)} sub={data.deltaPct == null ? 'Chưa có kỳ trước' : pct(data.deltaPct)} />
            <Kpi label="Số dòng dữ liệu" value={(data.rowCount || 0).toLocaleString('vi-VN')} />
            <DailySalesKpi data={data.dailySales} />
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
              <div className="section-head">🏆 Top 20 doanh thu</div>
              <div className="seg compact">
                <button className={topDim === 'unit' ? 'active' : ''} onClick={() => setTopDim('unit')}>Đơn vị</button>
                <button className={topDim === 'product' ? 'active' : ''} onClick={() => setTopDim('product')}>Sản phẩm</button>
                {me.isAdmin && <button className={topDim === 'emp' ? 'active' : ''} onClick={() => setTopDim('emp')}>Nhân viên</button>}
              </div>
            </div>
            {!topRows ? <Spinner /> : <TopBarChart rows={topRows} limit={20} totalRevenue={data.currentRevenue} dimension={topDim} />}
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
            <Block title="🛣️ Biến động theo tuyến" subtitle={explicitComparePeriod} rows={data.routeDelta} />
            <CstLowBlock rows={data.cstLowProducts} />
            <Block title="SP cần đẩy mạnh" rows={data.pushProducts} negative />
            <Block title="🏢 Biến động theo nhà thầu" subtitle={explicitComparePeriod} rows={data.contractorDelta} kind="contractor" />
            <CstUntouchedBlock rows={data.cstUntouched} productCount={data.cstUntouchedProductCount} />
            <CstQueuedBlock rows={data.cstQueued} note={data.cstSequenceNote} />
          </div>
        </>
      )}
    </>
  );
}
