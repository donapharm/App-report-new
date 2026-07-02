// Thành phần dùng chung: loading, KPI, thanh bar, hàng danh sách.
import React from 'react';
import { money, short } from './util.js';

export const Spinner = () => <div className="spin" />;
export const Empty = ({ children }) => <div className="center">{children}</div>;

export function Kpi({ label, value, sub, delta, tone, onClick }) {
  return (
    <div className={'kpi ' + (tone || '') + (onClick ? ' clickable' : '')} onClick={onClick}>
      <div className="label">{label}</div>
      <div className={'value' + (String(value).length > 12 ? ' small' : '')}>{value}</div>
      {delta != null && (
        <div className={'delta ' + (delta >= 0 ? 'up' : 'down')}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% so kỳ trước
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

// Hàng xếp hạng doanh thu, có mini-bar và có thể bấm để drill-down.
export function RankRow({ i, name, meta, amount, max, onClick }) {
  return (
    <div className="row" onClick={onClick} style={onClick ? { cursor: 'pointer' } : null}>
      <div className="main">
        <div className="name"><span className="rank">{i}</span>{name}</div>
        {meta && <div className="meta">{meta}</div>}
        {max != null && <Bar value={amount} max={max} />}
      </div>
      <div className="amt">{short(amount)}{onClick ? ' ›' : ''}</div>
    </div>
  );
}
