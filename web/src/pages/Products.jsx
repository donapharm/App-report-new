import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, pairText } from '../util.js';
import { Spinner, Bar, Pager, usePager, SkeletonCards, MoneyBig } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';

function qd139Ingredient(r) {
  return r.qd === 'QĐ139' && (r.active_ingredient || r.ham_luong);
}
function qdClass(qd) { return qd === 'QĐ139' ? 'qd139-card' : (qd === 'QĐ141' ? 'qd141-card' : ''); }

export default function Products({ me }) {
  const { periods, ky, setKy, filters, setFilters, options } = usePeriodsAndFilters(api);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const { reloadTick, reload } = useReloadTick();

  useEffect(() => {
    if (!ky) return;
    setData(null);
    api.products({ ky, pageSize: 100, ...filters }).then(setData);
  }, [ky, filters, reloadTick]);

  const max = data?.rows?.[0]?.revenue || 0;
  const pager = usePager(data?.rows, 20, `${ky}|${JSON.stringify(filters)}`);
  const duplicateProducts = new Set(Object.entries((data?.rows || []).reduce((m, r) => { const k = r.product_name || ''; if (k) m[k] = (m[k] || 0) + 1; return m; }, {})).filter(([, c]) => c > 1).map(([k]) => k));
  async function doExport() {
    setBusy(true);
    try { await downloadExport('products', { ky, ...filters }); }
    catch (e) { alert(e.message); }
    setBusy(false);
  }

  return (
    <>
      <DrillNav crumbs={[{ label: 'Sản phẩm' }]} onReload={reload} busy={!data} />
      <RevenueFilters me={me} ky={ky} periods={periods} options={options} filters={filters} setKy={setKy} setFilters={setFilters} />
      <div className="card summary-card">
        <div>
          <div className="meta muted">Sản phẩm / mã QLNB · kỳ {ky} · {data?.total || 0} mã</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}><MoneyBig value={data?.totalRevenue || 0} /></div>
        </div>
        <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel sản phẩm</button>
      </div>
      {!data ? <SkeletonCards count={6} /> : data.rows.length === 0 ? <div className="center">Không có dữ liệu.</div> : (
        <>
        <Pager page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={pager.setPage} unit="mã" />
        <div className="list-grid">
          {pager.pageItems.map((r, i) => (
            <div className={`card detail-card table-detail-card product-detail-card ${qdClass(r.qd)}`} key={r.key}>
              <div className="detail-head detail-head-two">
                <div className="detail-title-wrap">
                  <span className="rank">{pager.startIndex + i + 1}</span>
                  <div>
                    <div className="detail-title">{r.product_name}</div>
                    <div className="detail-sub mono"><span className={`qd-badge ${qdClass(r.qd)}`}>{r.qd || '—'}</span> {r.iit_code || '—'} · {r.uom || '—'}</div>
                    {(qd139Ingredient(r) || (duplicateProducts.has(r.product_name) && r.qd !== 'QĐ141' && (r.active_ingredient || r.ham_luong))) && <div className="detail-sub">{r.active_ingredient || '—'} · {r.ham_luong || '—'}</div>}
                  </div>
                </div>
                <div className="detail-money">{money(r.revenue)}<em>Doanh thu</em></div>
              </div>
              <Bar value={r.revenue} max={max} />
              <div className="detail-facts">
                <span><b>{r.quantity.toLocaleString('vi-VN')}</b><em>Số lượng</em></span>
                <span><b>{r.unitCount}</b><em>Đơn vị</em></span>
                <span><b>{r.empCount}</b><em>Nhân viên</em></span>
                <span><b>{r.routes || 'Thiếu nguồn tuyến'}</b><em>Tuyến</em></span>
                <span><b>{pairText(r.contractor_code || r.contractor, r.contractor_name)}</b><em>Nhà thầu</em></span>
                <span><b>{r.bid_price != null ? money(r.bid_price) : 'Thiếu nguồn giá'}</b><em>Giá trúng thầu</em></span>
                <span><b>{r.priority || 'Thiếu nguồn UT'}</b><em>Ưu tiên</em></span>
              </div>
            </div>
          ))}
        </div>
        <Pager page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={pager.setPage} unit="mã" />
        </>
      )}
    </>
  );
}
