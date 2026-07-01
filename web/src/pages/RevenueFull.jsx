import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, short } from '../util.js';
import { Spinner } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';

const pageSize = 50;

export default function RevenueFull({ me }) {
  const { periods, ky, setKy, filters, setFilters, options } = usePeriodsAndFilters(api);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPage(1); }, [ky, filters]);
  useEffect(() => {
    if (!ky) return;
    setData(null);
    api.revenueFull({ ky, page, pageSize, ...filters }).then(setData);
  }, [ky, page, filters]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  async function doExport() {
    setBusy(true);
    try { await downloadExport('revenue_full', { ky, ...filters }); }
    catch (e) { alert(e.message); }
    setBusy(false);
  }

  return (
    <>
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
        <div className="card table-card">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>NV</th><th>Tuyến</th><th>Đơn vị</th><th>Mã QLNB / sản phẩm</th><th>Nhà thầu</th><th>Gói</th><th>SL</th><th>Doanh thu</th></tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.emp_code}-${r.unit_code}-${r.iit_code}-${i}`}>
                    <td><b>{r.emp_code}</b><div className="muted small">{r.emp_name || ''}</div></td>
                    <td>{r.route || '—'}</td>
                    <td><b>{r.unit_code || '—'}</b><div className="muted small">{r.unit_name || ''}</div></td>
                    <td><b>{r.iit_code || '—'}</b><div className="muted small">{r.product_name || ''}</div></td>
                    <td>{r.contractor_code || '—'}</td>
                    <td>{r.bid_package || '—'}</td>
                    <td className="num">{(r.quantity || 0).toLocaleString('vi-VN')}</td>
                    <td className="num strong">{short(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
