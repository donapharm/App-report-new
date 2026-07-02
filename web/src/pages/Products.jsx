import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, short } from '../util.js';
import { Spinner, Bar } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';

export default function Products({ me }) {
  const { periods, ky, setKy, filters, setFilters, options } = usePeriodsAndFilters(api);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ky) return;
    setData(null);
    api.products({ ky, pageSize: 100, ...filters }).then(setData);
  }, [ky, filters]);

  const max = data?.rows?.[0]?.revenue || 0;
  async function doExport() {
    setBusy(true);
    try { await downloadExport('products', { ky, ...filters }); }
    catch (e) { alert(e.message); }
    setBusy(false);
  }

  return (
    <>
      <RevenueFilters me={me} ky={ky} periods={periods} options={options} filters={filters} setKy={setKy} setFilters={setFilters} />
      <div className="card summary-card">
        <div>
          <div className="meta muted">Sản phẩm / mã QLNB · kỳ {ky} · {data?.total || 0} mã</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}>{money(data?.totalRevenue || 0)}</div>
        </div>
        <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel sản phẩm</button>
      </div>
      {!data ? <Spinner /> : data.rows.length === 0 ? <div className="center">Không có dữ liệu.</div> : (
        <div className="list-grid">
          {data.rows.map((r, i) => (
            <div className="card" key={r.key}>
              <div className="list-card-title">
                <div>
                  <div className="name"><span className="rank">{i + 1}</span>{r.product_name}</div>
                  <div className="meta mono">{r.iit_code || '—'}</div>
                </div>
                <div className="amt">{short(r.revenue)}</div>
              </div>
              <Bar value={r.revenue} max={max} />
              <div className="list-card-meta">
                <span className="pill muted-pill">SL {r.quantity.toLocaleString('vi-VN')}</span>
                <span className="pill muted-pill">{r.unitCount} ĐV</span>
                <span className="pill muted-pill">{r.empCount} NV</span>
                {r.bidPackages && <span className="pill muted-pill">{r.bidPackages}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
