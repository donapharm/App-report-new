import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, LabelList, PieChart, Pie, Cell, RadialBarChart, RadialBar, PolarAngleAxis,
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

// Màu theo % ĐẠT TARGET (dùng cho tab Nhân viên): <50 đỏ · 50–89 cam · 90–119 xanh · ≥120 tím (xuất sắc).
const TARGET_TIERS = [
  { min: 120, color: '#7c3aed', label: '≥120% xuất sắc' },
  { min: 100, color: '#1f9d6b', label: '100–119% đạt' },
  { min: 90, color: '#3aa564', label: '90–99% gần đạt' },
  { min: 50, color: '#f5a11e', label: '50–89% đang tiến' },
  { min: 0, color: '#d64545', label: '<50% chậm' },
];
const targetTierColor = (p) => (p == null ? '#94a3b8' : (TARGET_TIERS.find((t) => p >= t.min) || TARGET_TIERS.at(-1)).color);

// Top doanh thu: hạng + #1 nổi bật (cam), top 2–3 xanh đậm, còn lại gradient; nhãn tiền + % cuối thanh.
// dimension='emp' -> tô màu theo % ĐẠT TARGET + nhãn hiện % target (kèm chú thích màu).
export function TopBarChart({ rows = [], limit = 20, totalRevenue = 0, dimension = '' }) {
  const all = (rows || []).slice(0, limit);
  if (!all.length) return <EmptyChart />;
  const isEmp = dimension === 'emp';
  const total = Number(totalRevenue) || all.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const data = all.map((r, i) => ({
    ...r,
    rank: i + 1,
    name: `${i + 1}. ${nameShort(r.label || r.product_name || r.unit_name || r.key, 24)}`,
    pctOfTotal: total > 0 ? (Number(r.revenue || 0) / total * 100) : null,
  })).reverse();
  const hasTarget = isEmp && data.some((d) => d.pctTarget != null);
  const barColor = (d) => (hasTarget ? targetTierColor(d.pctTarget) : (d.rank === 1 ? '#f5a11e' : d.rank <= 3 ? '#2f80ed' : 'url(#topBarGrad)'));
  const EndLabel = ({ x, y, width, height, index }) => {
    const d = data[index]; if (!d) return null;
    const extra = hasTarget ? (d.pctTarget != null ? `${d.pctTarget.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% TG` : 'chưa target')
      : (d.pctOfTotal != null ? `${d.pctOfTotal.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%` : '');
    return (
      <text x={x + width + 8} y={y + height / 2} dominantBaseline="middle" fontSize={11.5} fontWeight="700" fill="#334155">
        {short(d.revenue)}{extra && <tspan fill="#9aa7b4" fontWeight="500"> · {extra}</tspan>}
      </text>
    );
  };
  return (
    <div className="chart-box bar-chart">
      <ResponsiveContainer width="100%" height={Math.max(280, data.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 104, left: 6, bottom: 4 }}>
          <defs>
            <linearGradient id="topBarGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4c9be8" /><stop offset="100%" stopColor="#1568b8" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
          <XAxis type="number" tickFormatter={short} tick={{ fontSize: 11, fill: '#9aa7b4' }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11.5, fill: '#334155' }} axisLine={false} tickLine={false} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'rgba(21,104,184,.06)' }} />
          <Bar dataKey="revenue" name="Doanh thu" radius={[0, 7, 7, 0]} maxBarSize={22}>
            {data.map((d, i) => <Cell key={i} fill={barColor(d)} />)}
            <LabelList content={EndLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hasTarget && (
        <div className="chart-legend target-legend">
          {TARGET_TIERS.map((t) => <span key={t.min}><i style={{ background: t.color }} />{t.label}</span>)}
        </div>
      )}
    </div>
  );
}

export function TargetGauge({ pct, size = 'large' }) {
  // VÒNG ĐẦY = ĐẠT 100% mục tiêu: 43,3% lấp đúng 43,3% vòng (trực quan "tiến độ").
  // Vượt 100% -> vòng đầy kín, nhãn % vẫn hiện số thật (vd 112%) và đổi màu xanh.
  const raw = Number(pct || 0);
  const val = Math.max(0, Math.min(100, raw));
  const color = targetColor(pct);
  const h = size === 'small' ? 72 : 190;
  return (
    <div className={'gauge ' + size}>
      <ResponsiveContainer width="100%" height={h}>
        <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ name: 'target', value: val, fill: color }]} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={12} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="gauge-label" style={{ color }}>
        <b>{pct == null ? '—' : Number(pct).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%'}</b>
        <i>của mục tiêu</i>
      </div>
    </div>
  );
}

function topWithOther(rows = [], topCount = 6) {
  const sorted = [...rows].filter((r) => Number(r.revenue || 0) > 0).sort((a, b) => b.revenue - a.revenue);
  const top = sorted.slice(0, topCount).map((r) => ({ name: nameShort(r.label || r.key, 22), value: Number(r.revenue || 0) }));
  const other = sorted.slice(topCount).reduce((s, r) => s + Number(r.revenue || 0), 0);
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
export function DonutChart({ rows = [], topCount = 6, compact = false }) {
  const data = topWithOther(rows, topCount);
  const total = data.reduce((s, r) => s + r.value, 0);
  if (!data.length) return <EmptyChart />;
  return (
    <div className={'donut-wrap' + (compact ? ' compact-donut' : '')}>
      <ResponsiveContainer width="100%" height={compact ? 224 : 210}>
        <PieChart>
          <Pie data={data.map((d) => ({ ...d, total }))} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2} label={sliceLabel} labelLine={false} isAnimationActive={!compact}>
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
