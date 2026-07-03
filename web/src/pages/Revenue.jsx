import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, pairText, unitText } from '../util.js';
import { Spinner, Bar, Pager, usePager, SkeletonCards } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';
import { DrillNav, useDrillStack, useReloadTick } from '../drillNav.jsx';

const DIMS = { emp: 'Nhân viên', unit: 'Đơn vị', product: 'Sản phẩm' };
function qdClass(qd) { return qd === 'QĐ139' ? 'qd139-card' : (qd === 'QĐ141' ? 'qd141-card' : ''); }

export default function Revenue({ me }) {
  const [dim, setDim] = useState(me.isAdmin ? 'emp' : 'unit');
  const { periods, ky, setKy, filters, setFilters, options } = usePeriodsAndFilters(api);
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
    if (!ky) return;
    setData(null);
    api.revenue(dim, ky, filters).then(setData);
  }, [ky, dim, filters, reloadTick]);

  const total = data ? data.rows.reduce((s, r) => s + r.revenue, 0) : 0;
  const max = data && data.rows.length ? data.rows[0].revenue : 0;
  const pager = usePager(data?.rows, 20, `${ky}|${dim}|${JSON.stringify(filters)}`);
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
    try { await downloadExport('revenue', { ky, dimension: dim, ...filters }); }
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

      <RevenueFilters me={me} ky={ky} periods={periods} options={options} filters={filters} setKy={setKy} setFilters={setFilters} />

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="meta muted">Tổng {DIMS[dim].toLowerCase()} · kỳ {ky} · {data?.rows?.length || 0} dòng nhóm</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}>{money(total)}</div>
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
                    <div className="detail-title">{dim === 'unit' ? unitText(r.key, r.label) : (r.label || '—')}</div>
                    <div className="detail-sub mono">{dim === 'product' && <span className={`qd-badge ${qdClass(r.qd)}`}>{r.qd || '—'}</span>} {rowSub(r)}</div>
                    {dim === 'product' && r.qd === 'QĐ139' && <div className="detail-sub">{r.active_ingredient || 'Thiếu nguồn hoạt chất'} · {r.ham_luong || 'Thiếu nguồn hàm lượng'}</div>}
                  </div>
                </div>
                <div className="detail-money">{money(r.revenue)}{dim !== 'product' ? ' ›' : ''}</div>
              </div>
              <Bar value={r.revenue} max={max} />
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
