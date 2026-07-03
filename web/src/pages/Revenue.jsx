import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, pairText, unitText } from '../util.js';
import { Spinner, Bar } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';
import { DrillNav, useDrillStack, useReloadTick } from '../drillNav.jsx';

const DIMS = { emp: 'Nhân viên', unit: 'Đơn vị', product: 'Sản phẩm' };

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
  const rowSub = (r) => dim === 'product'
    ? `${r.iit_code || r.key || '—'} · ${r.qd || '—'}${r.qd === 'QĐ139' ? ` · ${r.active_ingredient || '—'} ${r.ham_luong || ''}` : ''}`
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
      <DrillNav crumbs={drillNav.crumbs} onBack={drillNav.back} onCrumb={drillNav.jump} onReload={reload} busy={!data} />
      <div className="seg">
        {Object.entries(DIMS).map(([k, v]) => {
          if (k === 'emp' && !me.isAdmin) return null;
          return <button key={k} className={dim === k ? 'active' : ''} onClick={() => pickDim(k)}>{v}</button>;
        })}
      </div>

      <RevenueFilters me={me} ky={ky} periods={periods} options={options} filters={filters} setKy={setKy} setFilters={setFilters} />

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="meta muted">Tổng {DIMS[dim].toLowerCase()} · kỳ {ky} · {data?.rows?.length || 0} dòng nhóm</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}>{money(total)}</div>
        </div>
        <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel</button>
      </div>

      {!data ? <Spinner /> : data.rows.length === 0 ? (
        <div className="center">Không có dữ liệu.</div>
      ) : (
        <div className="list-grid">
          {data.rows.map((r, i) => (
            <div className="card detail-card revenue-detail-card" key={r.key} onClick={dim !== 'product' ? () => drill(r) : undefined} style={dim !== 'product' ? { cursor: 'pointer' } : null}>
              <div className="detail-head">
                <div className="detail-title-wrap">
                  <span className="rank">{i + 1}</span>
                  <div>
                    <div className="detail-title">{dim === 'unit' ? unitText(r.key, r.label) : (r.label || '—')}</div>
                    <div className="detail-sub mono">{rowSub(r)}</div>
                  </div>
                </div>
                <div className="detail-money">{money(r.revenue)}{dim !== 'product' ? ' ›' : ''}</div>
              </div>
              <Bar value={r.revenue} max={max} />
              <div className="detail-facts two">
                <span><b>{(r.quantity || 0).toLocaleString('vi-VN')}</b><em>Số lượng</em></span>
                <span><b>{DIMS[dim]}</b><em>Nhóm xem</em></span>
                {dim === 'product' && (r.contractor_code || r.contractor || r.contractor_name) && <span><b>{pairText(r.contractor_code || r.contractor, r.contractor_name)}</b><em>Nhà thầu</em></span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
        {dim !== 'product' ? 'Chạm một dòng để drill-down; bộ lọc luôn chạy ở backend theo quyền.' : 'Đã ở mức sản phẩm'}
      </p>
    </>
  );
}
