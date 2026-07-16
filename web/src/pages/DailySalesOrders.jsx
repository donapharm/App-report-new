import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { money } from '../util.js';
import { DrillNav, useReloadTick } from '../drillNav.jsx';
import { Pager, Spinner, UnitLabel } from '../components.jsx';

const SOURCE_LABELS = {
  CRM_MISA: 'MISA',
  APP_WEB_PARTNER: 'App Partner',
};

function sourceLabel(value) {
  return SOURCE_LABELS[value] || value || 'Chưa rõ nguồn';
}

function navPayload() {
  try {
    const value = JSON.parse(sessionStorage.getItem('app_nav_payload') || '{}');
    return value?.tab === 'dailySales' ? value : {};
  } catch {
    return {};
  }
}

function formatDate(value) {
  const [y, m, d] = String(value || '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

function updatedLabel(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Chưa có mốc cập nhật';
  return date.toLocaleString('vi-VN', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric', hour12: false,
  });
}

function EmployeeList({ rows = [], isAdmin }) {
  if (!isAdmin) return null;
  const text = rows.map((x) => [x.code, x.name].filter(Boolean).join(' · ')).filter(Boolean).join(', ');
  return <span><b>{text || '—'}</b><em>Nhân viên</em></span>;
}

function OrderCard({ order, index, open, onToggle, isAdmin }) {
  const lines = order.lines || [];
  const orderCode = order.source_order || order.order_code || `Dòng phát sinh ${String(order.key || '').slice(0, 8)}`;
  return (
    <article className={'card daily-order-card' + (open ? ' open' : '')}>
      <button type="button" className="daily-order-head" onClick={onToggle} aria-expanded={open}>
        <span className="rank">{index}</span>
        <span className="daily-order-title">
          <b>{orderCode}</b>
          <em>{sourceLabel(order.source)} · {formatDate(order.date)}</em>
        </span>
        <span className="daily-order-money"><b>{money(order.revenue || 0)}</b><em>{Number(order.line_count ?? lines.length).toLocaleString('vi-VN')} mặt hàng</em></span>
        <span className="daily-order-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <div className="daily-order-entity"><UnitLabel code={order.unit_code} name={order.unit_name} /></div>
      <div className="detail-facts daily-order-facts">
        <EmployeeList rows={order.employees} isAdmin={isAdmin} />
        <span><b>{sourceLabel(order.source)}</b><em>Nguồn</em></span>
        <span><b>{order.revenue_status || 'Đã ghi'}</b><em>Trạng thái</em></span>
      </div>
      {open && (
        <div className="daily-order-lines">
          <div className="daily-order-lines-title">Chi tiết mặt hàng</div>
          {lines.map((line, i) => (
            <div className="daily-order-line" key={line.source_line_id || `${line.iit_code}-${i}`}>
              <div className="daily-order-line-main">
                <span className="rank">{i + 1}</span>
                <div>
                  <b>{line.product_name || 'Chưa có tên thuốc'}</b>
                  <em>{line.iit_code || 'Chưa có mã QLNB'} · {line.uom || '—'}</em>
                </div>
                <strong>{money(line.revenue || 0)}</strong>
              </div>
              <div className="daily-order-line-facts">
                <span><b>{Number(line.quantity || 0).toLocaleString('vi-VN')}</b><em>Số lượng</em></span>
                <span><b>{money(line.unit_price || 0)}</b><em>Đơn giá</em></span>
                <span><b>{line.route || '—'}</b><em>Tuyến</em></span>
                <span><b>{line.bid_package || '—'}</b><em>Gói thầu</em></span>
                <span><b>{line.contractor_code || line.contractor_name || '—'}</b><em>Nhà thầu</em></span>
              </div>
            </div>
          ))}
          {!lines.length && <div className="center">Đơn này chưa có dòng hàng để hiển thị.</div>}
        </div>
      )}
    </article>
  );
}

export default function DailySalesOrders({ me }) {
  const initial = useMemo(navPayload, []);
  const baseFilters = useMemo(() => {
    const allowed = ['emp', 'province', 'unit', 'group', 'product', 'route', 'priority', 'contractor', 'bid', 'q'];
    return Object.fromEntries(allowed.map((key) => [key, initial?.filters?.[key] || '']).filter(([, value]) => value));
  }, [initial]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState('revenue');
  const [openKey, setOpenKey] = useState('');
  const { reloadTick, reload } = useReloadTick();
  const pageSize = 30;

  useEffect(() => {
    const id = setTimeout(() => { setPage(1); setSearch(searchText.trim()); }, 250);
    return () => clearTimeout(id);
  }, [searchText]);

  useEffect(() => {
    let active = true;
    setError('');
    api.dailySalesOrders({ ...baseFilters, page, pageSize, search, source, sort }).then((value) => {
      if (active) setData(value);
    }).catch((e) => {
      if (active) setError(e.message || 'Không tải được chi tiết doanh số ngày.');
    });
    return () => { active = false; };
  }, [baseFilters, page, search, source, sort, reloadTick]);

  const summary = data?.summary || {};
  const orders = data?.orders || [];
  const totalPages = Number(data?.totalPages || Math.max(1, Math.ceil(Number(data?.total || 0) / pageSize)));
  const filterCount = Object.keys(baseFilters).length;
  const isListFiltered = !!search || !!source;
  const backToSource = () => {
    try { if (initial?.fromTab) localStorage.setItem('rpt_tab', initial.fromTab); } catch { /* ignore */ }
    window.history.back();
    setTimeout(() => {
      const desktopMain = document.querySelector('.main-desktop');
      if (desktopMain) desktopMain.scrollTo({ top: Number(initial?.returnScroll || 0), behavior: 'auto' });
      else window.scrollTo({ top: Number(initial?.returnScroll || 0), behavior: 'auto' });
    }, 80);
  };

  return (
    <>
      <DrillNav crumbs={[{ label: initial?.fromLabel || 'Tổng quan' }, { label: 'Doanh số trong ngày' }]} onBack={backToSource} onReload={reload} busy={!data && !error} />
      <section className="card daily-orders-summary">
        <div className="daily-orders-summary-head">
          <div>
            <span>Doanh số ngày {formatDate(data?.date || summary.date)}</span>
            <b>{money(summary.revenue || 0)}</b>
            <em>Sau VAT · cập nhật {updatedLabel(summary.sourceUpdatedAt)}</em>
          </div>
          <span className={'daily-reconcile-badge' + (summary.reconciled === false ? ' warn' : '')}>
            {summary.reconciled === false ? '⚠ Chưa khớp tổng' : `✓ Đã đối chiếu khớp ${money(summary.revenue || 0)}`}
          </span>
        </div>
        <div className="daily-orders-summary-grid">
          <span><b>{Number(summary.orderCount || 0).toLocaleString('vi-VN')}</b><em>Đơn hàng</em></span>
          <span><b>{Number(summary.rowCount || 0).toLocaleString('vi-VN')}</b><em>Dòng hàng</em></span>
          <span><b>{Number(summary.unitCount || 0).toLocaleString('vi-VN')}</b><em>Đơn vị</em></span>
          <span><b>{money((summary.revenue || 0) / 1.05)}</b><em>Trước VAT tham khảo</em></span>
        </div>
        {!!summary.note && <div className={'daily-orders-note' + (summary.stale ? ' warn' : '')}>{summary.note}</div>}
        {filterCount > 0 && <div className="daily-orders-scope-note">Đang giữ {filterCount} bộ lọc từ màn hình Phân tích; tổng đơn khớp đúng KPI đã bấm.</div>}
      </section>

      <section className="card daily-orders-toolbar">
        <label><span>Tìm đơn/đơn vị/NV</span><input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Nhập mã đơn hoặc tên đơn vị…" /></label>
        <label><span>Nguồn</span><select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}><option value="">Tất cả nguồn</option>{(data?.availableSources || []).map((x) => <option key={x} value={x}>{sourceLabel(x)}</option>)}</select></label>
        <label><span>Sắp xếp</span><select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="revenue">Giá trị lớn nhất</option><option value="newest">Mới nhất</option></select></label>
      </section>

      {error ? <div className="card error-box">{error}<button className="btn ghost" onClick={reload}>Thử lại</button></div> : !data ? <Spinner /> : (
        <section className="daily-orders-list">
          <div className="card daily-orders-list-head">
            <div><b>{Number(data.total || 0).toLocaleString('vi-VN')} đơn đang hiển thị</b>{isListFiltered && <span> · đã lọc danh sách</span>}</div>
            <Pager page={Number(data.page || page)} totalPages={totalPages} total={Number(data.total || 0)} onPage={setPage} unit="đơn" />
          </div>
          {!orders.length ? <div className="card center">Không tìm thấy đơn hàng phù hợp.</div> : orders.map((order, i) => (
            <OrderCard key={order.key || `${order.source}-${order.source_order}-${i}`} order={order} index={(Number(data.page || page) - 1) * pageSize + i + 1} open={openKey === (order.key || `${order.source}-${order.source_order}-${i}`)} onToggle={() => { const key = order.key || `${order.source}-${order.source_order}-${i}`; setOpenKey((value) => value === key ? '' : key); }} isAdmin={me.isAdmin} />
          ))}
          {totalPages > 1 && <div className="card"><Pager page={Number(data.page || page)} totalPages={totalPages} total={Number(data.total || 0)} onPage={setPage} unit="đơn" /></div>}
        </section>
      )}
    </>
  );
}
