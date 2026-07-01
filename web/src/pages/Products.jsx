import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, short } from '../util.js';
import { Spinner, RankRow } from '../components.jsx';
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
        <div className="card">
          {data.rows.map((r, i) => (
            <RankRow
              key={r.key}
              i={i + 1}
              name={r.product_name}
              meta={`${r.iit_code} · ${short(r.revenue)} · SL ${r.quantity.toLocaleString('vi-VN')} · ${r.unitCount} đơn vị · ${r.empCount} NV${r.bidPackages ? ' · ' + r.bidPackages : ''}`}
              amount={r.revenue}
              max={max}
            />
          ))}
        </div>
      )}
    </>
  );
}
