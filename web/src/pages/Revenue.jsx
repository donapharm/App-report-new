import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, short } from '../util.js';
import { Spinner, RankRow } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';

const DIMS = { emp: 'Nhân viên', unit: 'Đơn vị', product: 'Sản phẩm' };

export default function Revenue({ me }) {
  const [dim, setDim] = useState(me.isAdmin ? 'emp' : 'unit');
  const { periods, ky, setKy, filters, setFilters, options } = usePeriodsAndFilters(api);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

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
  }, [ky, dim, filters]);

  const total = data ? data.rows.reduce((s, r) => s + r.revenue, 0) : 0;
  const max = data && data.rows.length ? data.rows[0].revenue : 0;

  function pickDim(d) { setDim(d); }
  function setF(k, v) { setFilters((f) => ({ ...f, [k]: v })); }
  function drill(row) {
    if (dim === 'emp') { setF('emp', row.key); setDim('unit'); }
    else if (dim === 'unit') { setF('unit', row.key); setDim('product'); }
  }
  async function doExport() {
    setBusy(true);
    try { await downloadExport('revenue', { ky, dimension: dim, ...filters }); }
    catch (e) { alert(e.message); }
    setBusy(false);
  }

  return (
    <>
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
        <div className="card">
          {data.rows.map((r, i) => (
            <RankRow key={r.key} i={i + 1} name={r.label} meta={`${short(r.revenue)} · ${r.quantity.toLocaleString('vi-VN')} SL`} amount={r.revenue} max={max} onClick={dim !== 'product' ? () => drill(r) : undefined} />
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
        {dim !== 'product' ? 'Chạm một dòng để drill-down; bộ lọc luôn chạy ở backend theo quyền.' : 'Đã ở mức sản phẩm'}
      </p>
    </>
  );
}
