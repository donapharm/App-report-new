import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import { money, short, pct } from './util.js';

const COLORS = ['#1568b8', '#f5a11e', '#1f9d6b', '#2f80ed', '#e08a1e', '#7c3aed', '#94a3b8'];
const targetColor = (pct) => (pct == null ? '#94a3b8' : pct >= 100 ? '#1f9d6b' : pct >= 80 ? '#e08a1e' : '#d64545');
const nameShort = (s, n = 26) => String(s || '—').length > n ? String(s).slice(0, n - 1) + '…' : String(s || '—');

function EmptyChart() { return <div className="chart-empty">Chưa có dữ liệu</div>; }
function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <b>{label}</b>
      {payload.map((p) => <div key={p.dataKey || p.name} style={{ color: p.color }}>{p.name}: {money(p.value)}</div>)}
      {payload[0]?.payload?.target > 0 && <div>Target: {money(payload[0].payload.target)}</div>}
      {payload[0]?.payload?.revenueBeforeVat != null && <div>Trước VAT: {money(payload[0].payload.revenueBeforeVat)}</div>}
      {payload[0]?.payload?.pctTarget != null && <div>% target: {pct(payload[0].payload.pctTarget)}</div>}
    </div>
  );
}

export function RevenueTrendChart({ rows = [], selectedKys = [] }) {
  if (!rows.length) return <EmptyChart />;
  const sel = new Set(selectedKys || []);
  const data = rows.map((r) => ({ ...r, targetTotal: r.targetTotal || null, selectedRevenue: sel.has(r.ky) ? r.revenue : null }));
  return (
    <div className="chart-box trend-chart">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e3e9f1" />
          <XAxis dataKey="ky" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={short} width={48} tick={{ fontSize: 12 }} />
          <Tooltip content={<MoneyTooltip />} />
          <Legend />
          <Line type="monotone" dataKey="revenue" name="Doanh thu" stroke="#1568b8" strokeWidth={3} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="targetTotal" name="Target" stroke="#f5a11e" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
          <Line type="monotone" dataKey="selectedRevenue" name="Kỳ đang chọn" stroke="#d64545" strokeWidth={0} dot={{ r: 6, fill: '#d64545' }} legendType="none" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function topPercentText(row) {
  if (!row) return null;
  if (row.dimension === 'emp' && row.pctTarget != null) return pct(row.pctTarget);
  return row.totalRevenue > 0 ? pct((Number(row.revenue || 0) / row.totalRevenue) * 100) : null;
}

export function TopBarChart({ rows = [], limit = 20, dimension = '', totalRevenue = 0 }) {
  const list = (rows || []).slice(0, limit).map((r) => ({
    ...r,
    dimension,
    totalRevenue,
    name: nameShort(r.label || r.product_name || r.unit_name || r.key, 32),
  }));
  const data = [...list].reverse();
  if (!data.length) return <EmptyChart />;
  return (
    <div className="chart-box bar-chart top-chart-layout">
      <div className="top-chart-plot">
        <ResponsiveContainer width="100%" height={Math.max(300, data.length * 28)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e3e9f1" />
            <XAxis type="number" tickFormatter={short} tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
            <Tooltip content={<MoneyTooltip />} />
            <Bar dataKey="revenue" name="Doanh thu" fill="#1568b8" radius={[0, 8, 8, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="top-chart-side" aria-label="Bảng xếp hạng số tiền và phần trăm">
        <div className="top-chart-side-head">
          <b>Bảng xếp hạng</b>
          <span>{dimension === 'emp' ? '% target' : '% doanh thu'}</span>
        </div>
        <div className="top-chart-values">
          {list.map((r, i) => {
            const pText = topPercentText(r);
            const pVal = dimension === 'emp' && r.pctTarget != null
              ? Math.min(100, Math.max(0, Number(r.pctTarget || 0)))
              : (r.totalRevenue > 0 ? Math.min(100, Math.max(0, Number(r.revenue || 0) / r.totalRevenue * 100)) : 0);
            return <div className="top-chart-value" key={r.key || r.name || i}>
              <span className="rank">#{i + 1}</span>
              <span className="name" title={r.label || r.name}>{r.name}</span>
              <b>{short(r.revenue)}</b>
              {pText && <em>{pText}</em>}
              <i className="mini-bar"><i style={{ width: `${pVal}%` }} /></i>
            </div>;
          })}
        </div>
      </div>
    </div>
  );
}

export function TargetGauge({ pct, size = 'large' }) {
  const val = Math.max(0, Math.min(140, Number(pct || 0)));
  const color = targetColor(pct);
  const h = size === 'small' ? 72 : 190;
  return (
    <div className={'gauge ' + size}>
      <ResponsiveContainer width="100%" height={h}>
        <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ name: 'target', value: val, fill: color }]} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 140]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={12} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="gauge-label" style={{ color }}>{pct == null ? '—' : Number(pct).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%'}</div>
    </div>
  );
}

function topWithOther(rows = []) {
  const sorted = [...rows].filter((r) => Number(r.revenue || 0) > 0).sort((a, b) => b.revenue - a.revenue);
  const top = sorted.slice(0, 6).map((r) => ({ name: nameShort(r.label || r.key, 22), value: r.revenue }));
  const other = sorted.slice(6).reduce((s, r) => s + Number(r.revenue || 0), 0);
  return other > 0 ? top.concat({ name: 'Khác', value: other }) : top;
}
function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const total = p.payload?.total || 0;
  return <div className="chart-tip"><b>{p.name}</b><div>{money(p.value)} · {pct(total ? ((p.value / total) * 100) : 0)}</div></div>;
}
// Nhãn % ngay trên lát bánh (chỉ hiện với lát đủ lớn để không rối).
const RAD = Math.PI / 180;
function sliceLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.07) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  return <text x={x} y={y} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle" dominantBaseline="central">{Math.round(percent * 100)}%</text>;
}
export function DonutChart({ rows = [] }) {
  const data = topWithOther(rows);
  const total = data.reduce((s, r) => s + r.value, 0);
  if (!data.length) return <EmptyChart />;
  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="100%" height={210}>
        <PieChart>
          <Pie data={data.map((d) => ({ ...d, total }))} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2} label={sliceLabel} labelLine={false}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip content={<PieTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {/* Chú thích: tên · số tiền rút gọn · % để đọc nhanh không cần rê chuột */}
      <div className="donut-legend">{data.map((d, i) => (
        <span key={d.name}><i style={{ background: COLORS[i % COLORS.length] }} />{d.name} <b>{short(d.value)} · {pct(total ? (d.value / total) * 100 : 0, 0)}</b></span>
      ))}</div>
    </div>
  );
}
