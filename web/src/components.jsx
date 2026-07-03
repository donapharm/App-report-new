// Thành phần dùng chung: loading, KPI, thanh bar, hàng danh sách.
import React from 'react';
import { money, pct } from './util.js';

export const Spinner = () => <div className="spin" />;
export const Empty = ({ children }) => <div className="center">{children}</div>;

export function Kpi({ label, value, sub, delta, tone, onClick }) {
  return (
    <div className={'kpi ' + (tone || '') + (onClick ? ' clickable' : '')} onClick={onClick}>
      <div className="label">{label}</div>
      <div className={'value' + (String(value).length > 12 ? ' small' : '')}>{value}</div>
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
