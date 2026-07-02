import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import { short } from './util.js';

const COLORS = ['#1568b8', '#f5a11e', '#1f9d6b', '#2f80ed', '#e08a1e', '#7c3aed', '#94a3b8'];
const targetColor = (pct) => (pct == null ? '#94a3b8' : pct >= 100 ? '#1f9d6b' : pct >= 80 ? '#e08a1e' : '#d64545');
const nameShort = (s, n = 26) => String(s || '—').length > n ? String(s).slice(0, n - 1) + '…' : String(s || '—');

function EmptyChart() { return <div className="chart-empty">Chưa có dữ liệu</div>; }
function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <b>{label}</b>
      {payload.map((p) => <div key={p.dataKey || p.name} style={{ color: p.color }}>{p.name}: {short(p.value)}</div>)}
      {payload[0]?.payload?.pctTarget != null && <div>% target: {payload[0].payload.pctTarget}%</div>}
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

export function TopBarChart({ rows = [] }) {
  const data = (rows || []).slice(0, 10).map((r) => ({ ...r, name: nameShort(r.label || r.product_name || r.unit_name || r.key, 32) })).reverse();
  if (!data.length) return <EmptyChart />;
  return (
    <div className="chart-box bar-chart">
      <ResponsiveContainer width="100%" height={Math.max(260, data.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, left: 6, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e3e9f1" />
          <XAxis type="number" tickFormatter={short} tick={{ fontSize: 12 }} />
          <YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 12 }} />
          <Tooltip content={<MoneyTooltip />} />
          <Bar dataKey="revenue" name="Doanh thu" fill="#1568b8" radius={[0, 8, 8, 0]} />
        </BarChart>
      </ResponsiveContainer>
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
      <div className="gauge-label" style={{ color }}>{pct == null ? '—' : `${pct}%`}</div>
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
  return <div className="chart-tip"><b>{p.name}</b><div>{short(p.value)} · {total ? ((p.value / total) * 100).toFixed(1) : 0}%</div></div>;
}
export function DonutChart({ rows = [] }) {
  const data = topWithOther(rows);
  const total = data.reduce((s, r) => s + r.value, 0);
  if (!data.length) return <EmptyChart />;
  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="100%" height={210}>
        <PieChart>
          <Pie data={data.map((d) => ({ ...d, total }))} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip content={<PieTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-legend">{data.map((d, i) => <span key={d.name}><i style={{ background: COLORS[i % COLORS.length] }} />{d.name}</span>)}</div>
    </div>
  );
}
