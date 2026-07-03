import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, pairText, unitText } from '../util.js';
import { Spinner } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';

const pageSize = 50;
function qdOf(r) { const m = String(`${r.iit_code || ''} ${r.bid_package || ''}`).match(/QĐ\s*(\d+)|QD\s*(\d+)/i); return m ? `QĐ${m[1] || m[2]}` : ''; }
function contractorText(r) { return pairText(r.contractor_code, r.contractor_name); }
function qd139Ingredient(r, qd) { return qd === 'QĐ139' && (r.active_ingredient || r.ham_luong); }

export default function RevenueFull({ me }) {
  const { periods, ky, setKy, filters, setFilters, options } = usePeriodsAndFilters(api);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const { reloadTick, reload } = useReloadTick();

  useEffect(() => { setPage(1); }, [ky, filters]);
  useEffect(() => {
    if (!ky) return;
    setData(null);
    api.revenueFull({ ky, page, pageSize, ...filters }).then(setData);
  }, [ky, page, filters, reloadTick]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const duplicateProducts = new Set(Object.entries((data?.rows || []).reduce((m, r) => { const k = r.product_name || ''; if (k) m[k] = (m[k] || 0) + 1; return m; }, {})).filter(([, c]) => c > 1).map(([k]) => k));
  async function doExport() {
    setBusy(true);
    try { await downloadExport('revenue_full', { ky, ...filters }); }
    catch (e) { alert(e.message); }
    setBusy(false);
  }

  return (
    <>
      <DrillNav crumbs={[{ label: 'DT đầy đủ' }]} onReload={reload} busy={!data} />
      <RevenueFilters me={me} ky={ky} periods={periods} options={options} filters={filters} setKy={setKy} setFilters={setFilters} />
      <div className="card summary-card">
        <div>
          <div className="meta muted">Doanh thu đầy đủ · kỳ {ky} · {data?.total?.toLocaleString('vi-VN') || 0} dòng</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}>{money(data?.totalRevenue || 0)}</div>
          <div className="meta muted">Số lượng: {(data?.totalQuantity || 0).toLocaleString('vi-VN')}</div>
        </div>
        <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel đầy đủ</button>
      </div>
      {!data ? <Spinner /> : data.rows.length === 0 ? <div className="center">Không có dữ liệu.</div> : (
        <div className="detail-list-wrap">
          <div className="list-grid">
            {data.rows.map((r, i) => (
              <div className="card detail-card full-revenue-card" key={`${r.emp_code}-${r.unit_code}-${r.iit_code}-${i}`}>
                <div className="detail-head detail-head-two">
                  <div className="detail-title-wrap">
                    <span className="rank">{(page - 1) * pageSize + i + 1}</span>
                    <div>
                      <div className="detail-title">{r.product_name || '—'}</div>
                      <div className="detail-sub mono">{r.iit_code || '—'} · {qdOf(r) || r.bid_package || '—'}</div>
                      {(qd139Ingredient(r, qdOf(r)) || (duplicateProducts.has(r.product_name) && qdOf(r) !== 'QĐ141' && (r.ham_luong || r.active_ingredient))) && <div className="detail-sub">{r.active_ingredient || '—'} · {r.ham_luong || '—'}</div>}
                    </div>
                  </div>
                  <div className="detail-money">{money(r.revenue)}<em>Doanh thu</em></div>
                </div>
                <div className="detail-entity"><b>{unitText(r.unit_code, r.unit_name)}</b></div>
                <div className="detail-facts">
                  <span><b>{r.emp_code || '—'}</b><em>{r.emp_name || 'Nhân viên'}</em></span>
                  <span><b>{r.route || '—'}</b><em>Tuyến</em></span>
                  <span><b>{(r.quantity || 0).toLocaleString('vi-VN')}</b><em>Số lượng</em></span>
                  <span><b>{contractorText(r)}</b><em>Nhà thầu</em></span>
                  <span><b>{r.bid_package || '—'}</b><em>Gói thầu</em></span>
                  {r.bid_price != null && <span><b>{money(r.bid_price)}</b><em>Giá thầu</em></span>}
                </div>
              </div>
            ))}
          </div>
          <div className="pager">
            <button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Trước</button>
            <span>Trang {page}/{pages}</span>
            <button className="btn ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Sau ›</button>
          </div>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Bảng chi tiết lấy dữ liệu backend theo quyền; NV thường chỉ thấy dòng của chính mình.</p>
    </>
  );
}
