import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, pairText, unitText } from '../util.js';
import { Spinner, Bar, Pager, usePager, SkeletonCards, MoneyBig, UnitLabel } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';
import { DrillNav, useDrillStack, useReloadTick } from '../drillNav.jsx';

const DIMS = { emp: 'Nhân viên', unit: 'Đơn vị', product: 'Sản phẩm' };
function qdClass(qd) { return qd === 'QĐ139' ? 'qd139-card' : (qd === 'QĐ141' ? 'qd141-card' : ''); }
const pctText = (v) => v == null ? '—' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
const targetTone = (v) => v == null ? 'muted' : (v >= 100 ? 'ok' : (v >= 80 ? 'warn' : 'danger'));

function EmployeeRevenueBars({ row, maxRevenue, totalRevenue, pacing }) {
  const comparePct = maxRevenue > 0 ? (Number(row.revenue || 0) / maxRevenue * 100) : 0;
  const sharePct = totalRevenue > 0 ? (Number(row.revenue || 0) / totalRevenue * 100) : 0;
  const targetPct = row.pctTarget;
  const timePct = Number(pacing?.time_pct ?? (pacing?.factor != null ? Number(pacing.factor) * 100 : 0));
  return (
    <div className="employee-bars">
      <div className="employee-bar-block compare">
        <div className="employee-bar-head">
          <span>So sánh doanh thu</span>
          <b>{pctText(comparePct)} so NV cao nhất</b>
        </div>
        <div className="employee-bar-track"><i style={{ width: `${Math.min(100, comparePct)}%` }} /></div>
      </div>
      <div className={`employee-bar-block target ${targetTone(targetPct)}`}>
        <div className="employee-bar-head">
          <span>Tiến độ Target <small>(DT trước VAT)</small></span>
          <b>{targetPct == null ? 'Chưa giao target' : `${pctText(targetPct)} target`}</b>
        </div>
        <div className="employee-bar-track target-track">
          <i style={{ width: `${Math.min(100, Math.max(0, Number(targetPct || 0)))}%` }} />
          {timePct > 0 && timePct < 100 && <span className="time-marker" style={{ left: `${timePct}%` }} title={`Tiến độ ngày lịch: ${pctText(timePct)}`} />}
        </div>
        <div className="employee-bar-foot">
          <span>Tỷ trọng tổng DT: <b>{pctText(sharePct)}</b></span>
          {timePct > 0 && <span>│ = ngày {pacing?.daysElapsed || '—'}/{pacing?.daysInMonth || '—'} ({pctText(timePct)})</span>}
        </div>
      </div>
    </div>
  );
}

export default function Revenue({ me }) {
  const [dim, setDim] = useState(me.isAdmin ? 'emp' : 'unit');
  const { periods, ky, setKy, filters, setFilters, options, queryFilters, filterBusy, filterNotice, filtersReady } = usePeriodsAndFilters(api);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const { reloadTick, reload } = useReloadTick();
  const applyDrill = React.useCallback((s) => { if (!s) return; setDim(s.dim); setFilters(s.filters || {}); }, [setFilters]);
  const drillNav = useDrillStack({ key: 'revenue', root: { label: 'Doanh thu', dim: me.isAdmin ? 'emp' : 'unit', filters: {} }, apply: applyDrill });

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('app_nav_payload');
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.tab === 'revenue' && p.dimension) setDim(p.dimension);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!ky || !filtersReady) return;
    let cancelled = false;
    setData(null);
    if (dim === 'emp' && me.isAdmin) {
      Promise.all([api.revenue(dim, ky, queryFilters), api.targets({ ky, ...queryFilters })]).then(([d, t]) => {
        if (cancelled) return;
        const targetByEmp = Object.fromEntries((t.items || []).map((x) => [x.emp_code, x]));
        setData({
          ...d,
          pacing: t.pacing || null,
          rows: (d.rows || []).map((r) => {
            const target = targetByEmp[r.key] || null;
            return { ...r, pctTarget: target?.pct ?? null, target: target?.target ?? null, revenueBeforeVat: target?.revenue_before_vat ?? null };
          }),
        });
      });
    } else {
      api.revenue(dim, ky, queryFilters).then((d) => { if (!cancelled) setData(d); });
    }
    return () => { cancelled = true; };
  }, [ky, dim, queryFilters, filtersReady, reloadTick]);

  const total = data ? data.rows.reduce((s, r) => s + r.revenue, 0) : 0;
  const max = data && data.rows.length ? data.rows[0].revenue : 0;
  const pager = usePager(data?.rows, 20, `${ky}|${dim}|${JSON.stringify(queryFilters)}`);
  const rowSub = (r) => dim === 'product'
    ? `${r.iit_code || r.key || '—'} · ${r.uom || '—'}`
    : (dim === 'emp' ? (r.key || '—') : (r.key || '—'));

  function pickDim(d) {
    const next = { label: `Doanh thu · ${DIMS[d]}`, dim: d, filters };
    drillNav.setRoot(next);
  }
  function setF(k, v) { setFilters((f) => ({ ...f, [k]: v })); }
  function drill(row) {
    if (dim === 'emp') {
      const nextFilters = { ...filters, emp: row.key };
      drillNav.push({ label: `${row.label || row.key} (${row.key})`, dim: 'unit', filters: nextFilters });
    } else if (dim === 'unit') {
      const nextFilters = { ...filters, unit: row.key };
      drillNav.push({ label: unitText(row.key, row.label), dim: 'product', filters: nextFilters });
    }
  }
  async function doExport() {
    setBusy(true);
    try { await downloadExport('revenue', { ky, dimension: dim, ...queryFilters }); }
    catch (e) { alert(e.message); }
    setBusy(false);
  }

  return (
    <>
      <DrillNav crumbs={drillNav.crumbs} onBack={drillNav.back} onCrumb={drillNav.jump} onReload={reload} busy={!data}
        right={(
          <div className="seg compact seg-inline">
            {Object.entries(DIMS).map(([k, v]) => {
              if (k === 'emp' && !me.isAdmin) return null;
              return <button key={k} className={dim === k ? 'active' : ''} onClick={() => pickDim(k)}>{v}</button>;
            })}
          </div>
        )} />

      <RevenueFilters me={me} ky={ky} periods={periods} options={options} filters={filters} setKy={setKy} setFilters={setFilters} filterBusy={filterBusy} filterNotice={filterNotice} />

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="meta muted">Tổng {DIMS[dim].toLowerCase()} · kỳ {ky} · {data?.rows?.length || 0} dòng nhóm</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}><MoneyBig value={total} /></div>
        </div>
        <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel</button>
      </div>

      {!data ? <SkeletonCards count={6} /> : data.rows.length === 0 ? (
        <div className="center">Không có dữ liệu.</div>
      ) : (
        <>
        <Pager page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={pager.setPage} unit="dòng" />
        <div className="list-grid">
          {pager.pageItems.map((r, i) => (
            <div className={`card detail-card revenue-detail-card ${dim === 'product' ? qdClass(r.qd) : ''}`} key={r.key} onClick={dim !== 'product' ? () => drill(r) : undefined} style={dim !== 'product' ? { cursor: 'pointer' } : null}>
              <div className="detail-head">
                <div className="detail-title-wrap">
                  <span className="rank">{pager.startIndex + i + 1}</span>
                  <div>
                    <div className="detail-title">{dim === 'unit' ? <UnitLabel code={r.key} name={r.label} /> : (r.label || '—')}</div>
                    <div className="detail-sub mono">{dim === 'product' && <span className={`qd-badge ${qdClass(r.qd)}`}>{r.qd || '—'}</span>} {rowSub(r)}</div>
                    {dim === 'product' && r.qd === 'QĐ139' && <div className="detail-sub">{r.active_ingredient || 'Thiếu nguồn hoạt chất'} · {r.ham_luong || 'Thiếu nguồn hàm lượng'}</div>}
                  </div>
                </div>
                <div className="detail-money">{money(r.revenue)}{dim !== 'product' ? ' ›' : ''}</div>
              </div>
              {dim === 'emp'
                ? <EmployeeRevenueBars row={r} maxRevenue={max} totalRevenue={total} pacing={data.pacing} />
                : <Bar value={r.revenue} max={max} />}
              <div className="detail-facts two">
                <span><b>{(r.quantity || 0).toLocaleString('vi-VN')}</b><em>Số lượng</em></span>
                <span><b>{money(r.revenue)}</b><em>Doanh thu</em></span>
                {dim === 'product' ? (
                  <>
                    <span><b>{r.unitCount || 0}</b><em>Đơn vị</em></span>
                    <span><b>{r.empCount || 0}</b><em>Nhân viên</em></span>
                    <span><b>{r.routes || 'Thiếu nguồn tuyến'}</b><em>Tuyến</em></span>
                    <span><b>{pairText(r.contractor_code || r.contractor, r.contractor_name)}</b><em>Nhà thầu</em></span>
                    <span><b>{r.bid_price != null ? money(r.bid_price) : 'Thiếu nguồn giá'}</b><em>Giá trúng thầu</em></span>
                    <span><b>{r.priority || 'Thiếu nguồn UT'}</b><em>Ưu tiên</em></span>
                  </>
                ) : dim === 'emp' ? (
                  <>
                    <span><b>{(r.unitCount || 0).toLocaleString('vi-VN')}</b><em>Số đơn vị</em></span>
                    <span><b>{(r.productCount || 0).toLocaleString('vi-VN')}</b><em>Số sản phẩm</em></span>
                  </>
                ) : (
                  <>
                    <span><b>{(r.productCount || 0).toLocaleString('vi-VN')}</b><em>Số sản phẩm</em></span>
                    <span><b>{(r.empCount || 0).toLocaleString('vi-VN')}</b><em>Số nhân viên</em></span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <Pager page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={pager.setPage} unit="dòng" />
        </>
      )}
      <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
        {dim !== 'product' ? 'Chạm một dòng để drill-down; bộ lọc luôn chạy ở backend theo quyền.' : 'Đã ở mức sản phẩm'}
      </p>
    </>
  );
}
