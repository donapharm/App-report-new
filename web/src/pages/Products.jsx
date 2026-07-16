import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, pairText } from '../util.js';
import { Spinner, Bar, Pager, usePager, SkeletonCards, MoneyBig } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';
import ProductIdentity, { productQdClass } from '../ProductIdentity.jsx';

export default function Products({ me, onNavigate }) {
  const { periods, ky, setKy, filters, setFilters, options, queryFilters, filterBusy, filterNotice, filtersReady } = usePeriodsAndFilters(api);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const { reloadTick, reload } = useReloadTick();

  useEffect(() => {
    if (!ky || !filtersReady) return;
    let cancelled = false;
    setData(null);
    api.products({ ky, pageSize: 500, ...queryFilters }).then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [ky, queryFilters, filtersReady, reloadTick]);

  const max = data?.rows?.[0]?.revenue || 0;
  const pager = usePager(data?.rows, 20, `${ky}|${JSON.stringify(queryFilters)}`);
  const duplicateProducts = new Set(Object.entries((data?.rows || []).reduce((m, r) => { const k = r.product_name || ''; if (k) m[k] = (m[k] || 0) + 1; return m; }, {})).filter(([, c]) => c > 1).map(([k]) => k));
  async function doExport() {
    setBusy(true);
    try { await downloadExport('products', { ky, ...queryFilters }); }
    catch (e) { alert(e.message); }
    setBusy(false);
  }

  return (
    <div className="products-page">
      <DrillNav crumbs={[{ label: 'Sản phẩm' }]} onReload={reload} busy={!data} />
      <RevenueFilters
        me={me}
        ky={ky}
        periods={periods}
        options={options}
        filters={filters}
        setKy={setKy}
        setFilters={setFilters}
        filterBusy={filterBusy}
        filterNotice={filterNotice}
        showQuickProvince
        quickSearchPlaceholder="Tìm thông minh: tên thuốc, mã QLNB, hoạt chất…"
      />
      <div className="card summary-card product-summary-card">
        <div>
          <div className="meta muted">Sản phẩm / mã QLNB · kỳ {ky} · {data?.total || 0} mã</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}><MoneyBig value={data?.totalRevenue || 0} /></div>
        </div>
        <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel sản phẩm</button>
      </div>
      {!data ? <SkeletonCards count={6} /> : data.rows.length === 0 ? <div className="center">Không có dữ liệu.</div> : (
        <>
        <Pager page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={pager.setPage} unit="mã" capsule className="product-capsule-pager" />
        <div className="list-grid">
          {pager.pageItems.map((r, i) => (
            <div className={`card detail-card table-detail-card product-detail-card ${productQdClass(r)}`} key={r.key}>
              <div className="detail-head">
                <div className="detail-title-wrap">
                  <span className="rank">{pager.startIndex + i + 1}</span>
                  <div className="product-identity-wrap">
                    <ProductIdentity
                      row={r}
                      duplicateName={duplicateProducts.has(r.product_name)}
                      headingAside={<div className="detail-money">{money(r.revenue)}<em>Doanh thu</em></div>}
                    />
                  </div>
                </div>
              </div>
              <Bar value={r.revenue} max={max} />
              <div className="detail-facts">
                <span><b>{r.quantity.toLocaleString('vi-VN')}</b><em>Số lượng</em></span>
                <span><b>{r.uom || 'Chưa có'}</b><em>Đơn vị tính</em></span>
                <span><b>{r.rows?.toLocaleString('vi-VN') || 0}</b><em>Dòng nguồn</em></span>
                <span><b>{r.unitCount}</b><em>Đơn vị</em></span>
                <span><b>{r.empCount}</b><em>Nhân viên</em></span>
                <span><b>{r.routes || 'Thiếu nguồn tuyến'}</b><em>Tuyến</em></span>
                <span><b>{pairText(r.contractor_code || r.contractor, r.contractor_name)}</b><em>Nhà thầu</em></span>
                <span><b>{r.bid_price != null ? money(r.bid_price) : 'Thiếu nguồn giá'}</b><em>Giá trúng thầu</em></span>
                <span><b>{r.priority || 'Thiếu nguồn UT'}</b><em>Ưu tiên</em></span>
              </div>
              <button type="button" className="btn ghost product-detail-action" onClick={() => onNavigate?.('revenueFull', { product: r.iit_code })}>Xem chi tiết doanh thu</button>
            </div>
          ))}
        </div>
        <Pager page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={pager.setPage} unit="mã" capsule className="product-capsule-pager" />
        </>
      )}
    </div>
  );
}
