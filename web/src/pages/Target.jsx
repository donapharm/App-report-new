import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { money, pct } from '../util.js';
import { Spinner, Bar } from '../components.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams, periodLabel } from './PeriodFilter.jsx';
import { TargetGauge } from '../charts.jsx';

const rowsFmt = (n) => Number(n || 0).toLocaleString('vi-VN');

function TargetAdminPanel({ ky }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);
  const [ai, setAi] = useState(null);
  const fileRef = useRef(null);
  async function load() { if (!ky) return; setData(null); setData(await api.adminTargets(ky)); }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [ky]);
  async function manual(row) {
    const raw = prompt(`Nhập target cho ${row.emp_code} - ${row.emp_name} kỳ ${ky}`, row.target || 0);
    if (raw == null) return;
    setBusy(true); setErr(''); setMsg('');
    try { await api.adminTargetManual({ ky, emp_code: row.emp_code, target: raw }); setMsg('Đã lưu target sửa tay.'); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true); setErr(''); setMsg(''); setPreview(null);
    try { setPreview(await api.targetUploadPreview(f)); }
    catch (e2) { setErr((e2.errors || [e2.message]).join(' ')); }
    setBusy(false);
  }
  async function commitUpload() {
    if (!preview?.previewId) return;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.adminTargetUploadCommit(preview.previewId); setMsg(`Đã import ${r.result.rows} dòng target.`); setPreview(null); if (fileRef.current) fileRef.current.value = ''; await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function proposeAi() {
    setBusy(true); setErr(''); setMsg('');
    try { setAi(await api.adminTargetAiPropose()); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function applyAi() {
    if (!ai?.items?.length) return;
    if (!confirm(`Áp dụng ${ai.items.length} target AI đề xuất cho kỳ ${ai.next_ky}?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.adminTargetAiApply({ ky: ai.next_ky, items: ai.items }); setMsg(`Đã áp AI ${r.rows} dòng cho kỳ ${ai.next_ky}.`); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <>
      <div className="card">
        <div className="section-head">🛠️ Quản target kỳ {ky}</div>
        <div className="meta muted">Resolver đang dùng: sửa tay &gt; upload &gt; App Sale &gt; AI &gt; target cũ. Telesale VP018 không nằm trong danh sách target.</div>
        <div className="target-admin-actions">
          <input ref={fileRef} type="file" accept=".xlsx" onChange={onFile} />
          <button className="btn ghost" disabled={busy} onClick={proposeAi}>🤖 AI đề xuất</button>
          {ai?.items?.length > 0 && <button className="btn" disabled={busy} onClick={applyAi}>Áp dụng AI ({ai.next_ky})</button>}
        </div>
      </div>
      {busy && <Spinner />}
      {err && <div className="card" style={{ borderColor: 'var(--hi)', color: 'var(--hi)' }}>⚠ {err}</div>}
      {msg && <div className="card" style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }}>✔ {msg}</div>}
      {preview && <div className="card">
        <b>Preview target upload</b>
        <div className="meta muted">{preview.filename} · {rowsFmt(preview.meta.totalRows)} dòng · tổng {money(preview.meta.totalTarget)}</div>
        {preview.sample.map((r, i) => <div key={i} className="row"><div className="main"><div className="name">{r.emp_code} · {r.ky}</div></div><div className="amt">{money(r.target)}</div></div>)}
        <button className="btn" disabled={busy} onClick={commitUpload}>✔ Ghi target upload</button>
      </div>}
      {ai?.items?.length > 0 && <div className="card">
        <b>AI đề xuất {ai.next_ky}</b>
        {ai.items.slice(0, 8).map((r) => <div key={r.emp_code} className="row"><div className="main"><div className="name">{r.emp_code} · {r.emp_name}</div><div className="meta">Neo {r.last_ky} · {r.reason}</div></div><div className="amt">{money(r.suggested_target)}</div></div>)}
      </div>}
      {!data ? <Spinner /> : <div className="card table-card">
        <div className="section-head">Danh sách đang dùng ({data.rows.length} NV/CTV)</div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>NV</th><th>Loại</th><th>Target đang dùng</th><th>Nguồn</th><th></th></tr></thead><tbody>
          {data.rows.map((r) => <tr key={r.emp_code}><td><b>{r.emp_code}</b><div className="muted small">{r.emp_name}</div></td><td>{r.employee_type}</td><td className="num strong">{money(r.target)}</td><td>{r.source || '—'}</td><td><button className="btn ghost" onClick={() => manual(r)}>Sửa tay</button></td></tr>)}
        </tbody></table></div>
      </div>}
    </>
  );
}

export default function Target({ me }) {
  const [view, setView] = useState('now'); // now | forecast | admin
  const [periods, setPeriods] = useState([]);
  const [periodSel, setPeriodSel] = useState(null);
  const [now, setNow] = useState(null);
  const [fc, setFc] = useState(null);

  useEffect(() => {
    api.periods().then((p) => { setPeriods(p.periods || []); setPeriodSel(defaultPeriodSelection(p.periods || [], p.latest)); });
  }, []);
  useEffect(() => { if (!periodSel) return; setNow(null); api.targets(periodParams(periodSel)).then(setNow); }, [periodSel]);
  useEffect(() => { api.forecast().then(setFc); }, []);
  const selectedKy = periodSel?.mode === 'range' ? periodSel.to : periodSel?.ky;

  return (
    <>
      <div className="seg">
        <button className={view === 'now' ? 'active' : ''} onClick={() => setView('now')}>Kỳ này</button>
        <button className={view === 'forecast' ? 'active' : ''} onClick={() => setView('forecast')}>Dự báo{fc ? ` (${fc.next_ky})` : ''}</button>
        {me.isAdmin && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>Quản target</button>}
      </div>
      {view === 'now' && periodSel && <PeriodFilter periods={periods} value={periodSel} onChange={setPeriodSel} />}
      {view === 'admin' && me.isAdmin && periodSel && <PeriodFilter periods={periods} value={periodSel} onChange={setPeriodSel} />}

      {view === 'now' ? (
        !now ? <Spinner /> : now.items.length === 0 ? <div className="center">Chưa có target.</div> : (
          <>
          <div className="section-title">Kỳ target: {periodLabel(periodSel)}{now.pacing?.isCurrent ? ` · so theo nhịp ${now.pacing.daysElapsed}/${now.pacing.daysInMonth} ngày` : ''}</div>
          <div className="list-grid">
            {now.items.map((t) => {
              const p = t.pct;
              const cls = p == null ? 'ok' : p >= 100 ? 'ok' : p >= 80 ? 'warn' : 'bad';
              return (
                <div key={t.emp_code} className="card" style={{ padding: 12 }}>
                  <div className="target-card-row">
                    <TargetGauge pct={p} size="small" />
                    <div className="target-card-body">
                      <div className="list-card-title"><div className="name">{t.emp_name || t.emp_code}</div><span className={'pill ' + cls}>{pct(p)}</span></div>
                      <Bar value={t.revenue_before_vat} max={t.target_compare || t.target} tone={p != null && p < 80 ? 'warn' : ''} />
                      <div className="meta muted" style={{ marginTop: 5 }}>
                        Đạt {money(t.revenue_before_vat)} / target {money(t.target_compare || t.target)}{t.target_full && t.target_compare !== t.target_full ? ` (tháng ${money(t.target_full)})` : ''} ·{' '}
                        <span style={{ color: t.gap >= 0 ? 'var(--ok)' : 'var(--hi)' }}>{t.gap >= 0 ? 'vượt ' : 'thiếu '}{money(Math.abs(t.gap))}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )
      ) : view === 'forecast' ? (
        !fc ? <Spinner /> : (
          <>
            <div className="card" style={{ background: '#eef4f2', border: 'none' }}>
              <div style={{ fontWeight: 700, color: 'var(--brand)' }}>🎯 Đề xuất target {fc.next_ky}</div>
              <div className="meta muted">Neo theo tháng đủ gần nhất {fc.items?.[0]?.last_ky || ''}, xu hướng doanh thu thật + mức đạt gần nhất + hệ số mùa vụ {fc.season_factor}. CEO bấm “Áp dụng AI” ở tab Quản target mới thành target thật.</div>
            </div>
            <div className="list-grid">
              {fc.items.map((t) => <div key={t.emp_code} className="card" style={{ padding: 12 }}><div className="list-card-title"><div className="name">{t.emp_name}</div><div className="amt">{money(t.suggested_target)}</div></div><div className="meta muted" style={{ marginTop: 3 }}>Target cũ {money(t.last_target)} · đạt {pct(t.attain_pct)} · xu hướng {money(t.trend_revenue)}</div><div className="meta" style={{ marginTop: 4, color: 'var(--muted)', fontStyle: 'italic' }}>{t.reason}</div></div>)}
            </div>
          </>
        )
      ) : <TargetAdminPanel ky={selectedKy} />}
    </>
  );
}
