import React, { useMemo } from 'react';
import { formatDate } from '../util.js';

const pad = (n) => String(n).padStart(2, '0');
const monthOf = (ky) => Number(String(ky || '').slice(0, 2));
const yearOf = (ky) => Number(String(ky || '').slice(3));
const qOf = (ky) => Math.ceil(monthOf(ky) / 3);

function rangeKys(periods, from, to) {
  const kys = periods.map((p) => p.ky);
  const a = kys.indexOf(from), b = kys.indexOf(to);
  if (a < 0 || b < 0) return [];
  return kys.slice(Math.min(a, b), Math.max(a, b) + 1);
}

export function periodParams(sel) {
  if (!sel) return {};
  if (sel.mode === 'month') return sel.ky ? { ky: sel.ky } : {};
  return sel.from && sel.to ? { from: sel.from, to: sel.to } : {};
}

export function periodLabel(sel) {
  if (!sel) return '';
  if (sel.mode === 'month') return `Tháng ${sel.ky}`;
  if (sel.mode === 'quarter') return `Quý ${sel.quarter}/${sel.year} (${pad((sel.quarter - 1) * 3 + 1)}–${pad(sel.quarter * 3)})`;
  return `${sel.from} → ${sel.to}`;
}

export function defaultPeriodSelection(periods, latest) {
  const ky = latest || periods.at(-1)?.ky || '';
  return { mode: 'month', ky, from: ky, to: ky, quarter: qOf(ky), year: yearOf(ky) };
}

export default function PeriodFilter({ periods = [], value, onChange, compact = false }) {
  const kys = periods.map((p) => p.ky);
  const years = useMemo(() => [...new Set(kys.map(yearOf).filter(Boolean))].sort((a, b) => a - b), [kys]);
  const sel = value || defaultPeriodSelection(periods, kys.at(-1));
  const idx = kys.indexOf(sel.ky);

  function emit(next) { onChange?.({ ...sel, ...next }); }
  function setMode(mode) {
    if (mode === 'month') emit({ mode, ky: sel.ky || kys.at(-1), from: sel.ky || kys.at(-1), to: sel.ky || kys.at(-1) });
    else if (mode === 'quarter') setQuarter(sel.quarter || qOf(sel.ky), sel.year || yearOf(sel.ky));
    else emit({ mode, from: sel.from || kys[0], to: sel.to || kys.at(-1) });
  }
  function setMonth(ky) { emit({ mode: 'month', ky, from: ky, to: ky, quarter: qOf(ky), year: yearOf(ky) }); }
  function shift(delta) { if (idx >= 0 && kys[idx + delta]) setMonth(kys[idx + delta]); }
  function setQuarter(quarter, year) {
    const from = `${pad((quarter - 1) * 3 + 1)}.${year}`;
    const to = `${pad(quarter * 3)}.${year}`;
    const r = rangeKys(periods, from, to);
    if (!r.length) return;
    onChange?.({ mode: 'quarter', quarter, year, ky: r.at(-1), from: r[0], to: r.at(-1) });
  }
  function setRange(k, v) {
    const next = { ...sel, mode: 'range', [k]: v };
    const r = rangeKys(periods, next.from, next.to);
    if (r.length) onChange?.({ ...next, ky: r.at(-1), from: r[0], to: r.at(-1) });
  }

  const qOptions = [1, 2, 3, 4].filter((q) => years.some((y) => rangeKys(periods, `${pad((q - 1) * 3 + 1)}.${y}`, `${pad(q * 3)}.${y}`).length));

  return (
    <div className={(compact ? 'period-filter period-filter-compact' : 'card period-filter')}>
      <div className="period-head">
        <div className="seg compact">
          <button className={sel.mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>Tháng</button>
          <button className={sel.mode === 'quarter' ? 'active' : ''} onClick={() => setMode('quarter')}>Quý</button>
          <button className={sel.mode === 'range' ? 'active' : ''} onClick={() => setMode('range')}>Khoảng</button>
        </div>
        <b>{periodLabel(sel)}</b>
      </div>
      {sel.mode === 'month' && (
        <div className="period-row">
          <button className="btn ghost" disabled={idx <= 0} onClick={() => shift(-1)}>‹</button>
          <select value={sel.ky || ''} onChange={(e) => setMonth(e.target.value)}>{kys.map((ky) => <option key={ky} value={ky}>{ky}</option>)}</select>
          <button className="btn ghost" disabled={idx < 0 || idx >= kys.length - 1} onClick={() => shift(1)}>›</button>
        </div>
      )}
      {sel.mode === 'quarter' && (
        <div className="period-row">
          <select value={sel.quarter || 1} onChange={(e) => setQuarter(Number(e.target.value), sel.year || years.at(-1))}>{qOptions.map((q) => <option key={q} value={q}>Q{q}</option>)}</select>
          <select value={sel.year || years.at(-1)} onChange={(e) => setQuarter(sel.quarter || 1, Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </div>
      )}
      {sel.mode === 'range' && (
        <div className="period-row">
          <select value={sel.from || kys[0]} onChange={(e) => setRange('from', e.target.value)}>{kys.map((ky) => <option key={ky} value={ky}>{ky}</option>)}</select>
          <span>→</span>
          <select value={sel.to || kys.at(-1)} onChange={(e) => setRange('to', e.target.value)}>{kys.map((ky) => <option key={ky} value={ky}>{ky}</option>)}</select>
        </div>
      )}
      {sel.mode === 'month' && (() => {
        const p = periods.find((x) => x.ky === sel.ky);
        if (!p || p.complete || !p.throughDate) return null;
        return <div className="period-fresh">📅 Dữ liệu tới <b>{formatDate(p.throughDate)}</b> · {p.dayCovered}/{p.daysInMonth} ngày — <i>kỳ đang cập nhật, số có thể tăng tiếp</i></div>;
      })()}
    </div>
  );
}
