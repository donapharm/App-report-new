// Thành phần dùng chung: loading, KPI, thanh bar, hàng danh sách.
import React from 'react';
import { money, pct, short } from './util.js';

export const Spinner = () => <div className="spin" />;

// Số tiền lớn: hiện GỌN to (4,76 tỷ) + số ĐẦY ĐỦ nhỏ ngay bên dưới (luôn thấy cả hai).
export function MoneyBig({ value, className }) {
  if (value == null || Number.isNaN(Number(value))) return <span>—</span>;
  return (
    <span className={'money-big' + (className ? ' ' + className : '')}>
      <b className="mb-s">{short(value)}</b>
      <span className="mb-f">{money(value)}</span>
    </span>
  );
}
export const Empty = ({ children }) => <div className="center">{children}</div>;

// Ô xương (skeleton) khi đang tải — cảm giác nhanh hơn, không nhảy layout.
export function Skeleton({ w = '100%', h = 14, r = 6, style }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}
export function SkeletonCards({ count = 6, kpi = false }) {
  return (
    <div className={kpi ? 'kpi-grid' : 'list-grid'} aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div className="card skeleton-card" key={i}>
          <Skeleton w="55%" h={12} />
          <Skeleton w="80%" h={20} style={{ marginTop: 8 }} />
          {!kpi && <Skeleton w="100%" h={7} style={{ marginTop: 10 }} />}
        </div>
      ))}
    </div>
  );
}

// Nút "Lên đầu trang" nổi khi cuộn xuống — hoạt động cả mobile (window) lẫn desktop (.main-desktop).
export function ScrollTopButton() {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const scroller = document.querySelector('.main-desktop') || window;
    const readTop = () => (scroller === window ? window.scrollY : scroller.scrollTop);
    const onScroll = () => setShow(readTop() > 400);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  const toTop = () => {
    const scroller = document.querySelector('.main-desktop') || window;
    scroller.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return <button className="scroll-top-btn" onClick={toTop} aria-label="Lên đầu trang" title="Lên đầu trang">⬆</button>;
}

// Đồng hồ chạy giây (giờ VN) + NGÀY hiện tại — hiện ở header như bản chuẩn CEO.
export function Clock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const tz = { timeZone: 'Asia/Bangkok' };
  const time = now.toLocaleTimeString('vi-VN', { ...tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const date = now.toLocaleDateString('vi-VN', { ...tz, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  return (
    <span className="clock-pill" aria-label="Ngày giờ hiện tại">
      🕐 <span className="clock-dt"><b>{time}</b><i>{date}</i></span>
    </span>
  );
}

export function Kpi({ label, value, sub, delta, tone, variant, icon, onClick }) {
  return (
    <div className={'kpi' + (variant ? ' k-' + variant : '') + (tone ? ' ' + tone : '') + (onClick ? ' clickable' : '')} onClick={onClick}>
      {icon && <span className="kpi-ic" aria-hidden="true">{icon}</span>}
      <div className="label">{label}</div>
      <div className={'value' + (typeof value === 'string' && value.length > 12 ? ' small' : '')}>{value}</div>
      {delta != null && (
        <div className={'delta ' + (delta >= 0 ? 'up' : 'down')}>
          {delta >= 0 ? '▲' : '▼'} {pct(Math.abs(delta))} so kỳ trước
        </div>
      )}
      {sub && <div className="delta muted">{sub}</div>}
    </div>
  );
}

export function Bar({ value, max, tone }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar-wrap">
      <div className={'bar-fill ' + (tone || '')} style={{ width: w + '%' }} />
    </div>
  );
}

// Đóng/mở khối lọc, nhớ lựa chọn (dùng chung 1 key -> đồng bộ mọi trang).
export function useCollapse(storageKey = 'rpt_filters_collapsed') {
  const [open, setOpen] = React.useState(() => { try { return localStorage.getItem(storageKey) !== '1'; } catch { return true; } });
  const toggle = () => setOpen((v) => { const nv = !v; try { localStorage.setItem(storageKey, nv ? '0' : '1'); } catch { /* ignore */ } return nv; });
  return { open, toggle };
}

// Phân trang phía client cho danh sách dài. resetKey đổi -> tự về trang 1.
export function usePager(items, pageSize = 20, resetKey = '') {
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { setPage(1); }, [resetKey]);
  const total = items?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), totalPages);
  const pageItems = (items || []).slice((cur - 1) * pageSize, cur * pageSize);
  return { page: cur, setPage, totalPages, total, pageItems, startIndex: (cur - 1) * pageSize };
}

// Thanh phân trang: ‹ Trước · Trang X/Y · N mục · Sau ›
export function Pager({ page, totalPages, total, onPage, unit = 'mục' }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Trước</button>
      <span className="pager-info">Trang <b>{page}</b>/{totalPages}{total != null ? ` · ${Number(total).toLocaleString('vi-VN')} ${unit}` : ''}</span>
      <button className="btn ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Sau ›</button>
    </div>
  );
}

// Hàng xếp hạng doanh thu, có mini-bar và có thể bấm để drill-down.
export function RankRow({ i, name, meta, amount, max, onClick }) {
  return (
    <div className="row" onClick={onClick} style={onClick ? { cursor: 'pointer' } : null}>
      <div className="main">
        <div className="name"><span className="rank">{i}</span>{name}</div>
        {meta && <div className="meta">{meta}</div>}
        {max != null && <Bar value={amount} max={max} />}
      </div>
      <div className="amt">{money(amount)}{onClick ? ' ›' : ''}</div>
    </div>
  );
}
