import React, { useEffect, useRef, useState } from 'react';
import { api, downloadTargetTemplate } from '../api.js';
import { money, pct } from '../util.js';
import { Spinner, Bar, Kpi } from '../components.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams, periodLabel } from './PeriodFilter.jsx';
import { TargetGauge } from '../charts.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';

const rowsFmt = (n) => Number(n || 0).toLocaleString('vi-VN');
function targetSourceText(t = {}) {
  if (t.target_assigned === false || (!Number(t.target || t.target_full || 0) && !(t.target_source_label || t.source_label || t.target_source || t.source))) return 'Chưa giao target';
  const src = t.target_source_label || t.source_label || t.target_source || t.source || '—';
  const ky = t.target_source_ky || t.source_ky;
  const ref = t.target_reference || t.reference;
  if (!src || src === '—') return 'Nguồn: —';
  return `Nguồn: ${src}${ky ? ` · kỳ ${ky}` : ''}${ref ? ' · tham khảo tự động' : ''}`;
}

function TargetAdminPanel({ ky, onKyChange, onTargetsChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);
  const [lastBatch, setLastBatch] = useState(null);
  const [ai, setAi] = useState(null);
  const [templateBasis, setTemplateBasis] = useState('t06');
  const [qYear, setQYear] = useState(String(new Date().getFullYear()));
  const [qQuarter, setQQuarter] = useState('3');
  const [qLines, setQLines] = useState('DN001\t6000000000');
  const [tool, setTool] = useState(null);
  const [rollbackId, setRollbackId] = useState('');
  const fileRef = useRef(null);
  async function load() { if (!ky) return; setData(null); setData(await api.adminTargets(ky)); }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [ky]);
  async function manual(row) {
    const raw = prompt(`Nhập target cho ${row.emp_code} - ${row.emp_name} kỳ ${ky}`, row.target || 0);
    if (raw == null) return;
    setBusy(true); setErr(''); setMsg('');
    try { await api.adminTargetManual({ ky, emp_code: row.emp_code, target: raw }); setMsg('Đã lưu target sửa tay. KPI Tổng đã cập nhật.'); await load(); await onTargetsChanged?.(); }
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
  async function downloadTemplate() {
    setBusy(true); setErr(''); setMsg('');
    try { await downloadTargetTemplate(ky, templateBasis); setMsg(`Đã tải template target kỳ ${ky} theo căn cứ ${templateBasis === 'blank' ? 'Trống' : templateBasis === 'latest' ? 'kỳ gần nhất đã giao' : 'T06/2026 Lumos'}.`); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function commitUpload() {
    if (!preview?.previewId) return;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.adminTargetUploadCommit(preview.previewId); setLastBatch(r.result); setMsg(`Đã import ${r.result.rows} dòng target. Mã rollback: ${r.result.batchId}. KPI Tổng đã cập nhật.`); setPreview(null); setTool(null); if (fileRef.current) fileRef.current.value = ''; await load(); await onTargetsChanged?.(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function rollbackBatch(batchId) {
    const id = batchId || prompt('Nhập mã batch cần rollback', lastBatch?.batchId || '');
    if (!id) return;
    if (!confirm(`Rollback batch target ${id}?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.adminTargetUploadRollback(id); setMsg(`Đã rollback ${r.result.rows} dòng target của batch ${id}. KPI Tổng đã cập nhật.`); if (lastBatch?.batchId === id) setLastBatch(null); setRollbackId(''); setTool(null); await load(); await onTargetsChanged?.(); }
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
    try { const r = await api.adminTargetAiApply({ ky: ai.next_ky, items: ai.items }); setMsg(`Đã áp AI ${r.rows} dòng cho kỳ ${ai.next_ky}.`); setTool(null); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  function parseQuarterLines() {
    return qLines.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [emp_code, raw] = line.split(/[\t,; ]+/).filter(Boolean);
      return { emp_code, target: raw };
    });
  }
  async function applyQuarter() {
    const items = parseQuarterLines();
    if (!items.length) { setErr('Chưa có dòng target quý'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.adminTargetQuarter({ year: qYear, quarter: qQuarter, items, note: 'quarter_split3_ui' });
      setMsg(`Đã chia quý Q${qQuarter}/${qYear} thành ${r.result.rows} dòng cho ${r.result.kys.join(', ')}.`);
      setTool(null);
      if (r.result.kys?.[0]) onKyChange?.(r.result.kys[0]);
      await load(); await onTargetsChanged?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const Modal = ({ id, title, children }) => tool === id ? (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setTool(null); }}>
      <div className="modal-card smart-drawer">
        <div className="modal-head"><b>{title}</b><button className="btn ghost" onClick={() => setTool(null)}>Đóng</button></div>
        {children}
      </div>
    </div>
  ) : null;
  return (
    <>
      <div className="card smart-admin-head">
        <div className="smart-title-row">
          <div className="section-head">🛠️ Quản target kỳ {ky}</div>
          <span className="info-tip" tabIndex="0" data-tip="Resolver đang dùng: sửa tay > upload > AI. Từ kỳ 07.2026 trở đi không lấy Lumos/App Sale làm target đang dùng. Roster Target lấy theo allowlist CEO chốt 21 mã.">ⓘ</span>
        </div>
        <div className="smart-toolbar">
          <label className="field-inline smart-period"><span>Kỳ</span><input value={ky || ''} onChange={(e) => onKyChange?.(e.target.value)} placeholder="08.2026" /></label>
          <button className="btn ghost" onClick={() => onKyChange?.('08.2026')}>Mở 08.2026</button>
          <button className="btn" disabled={busy} onClick={() => setTool('template')}>⬇ Template</button>
          <button className="btn ghost" disabled={busy} onClick={() => setTool('upload')}>⬆ Upload</button>
          <button className="btn ghost" disabled={busy} onClick={() => setTool('quarter')}>📅 Nhập theo Quý</button>
          <button className="btn ghost" disabled={busy} onClick={() => setTool('ai')}>🤖 AI đề xuất</button>
          <button className="btn ghost" disabled={busy} onClick={() => { setRollbackId(lastBatch?.batchId || ''); setTool('rollback'); }}>↩ Rollback</button>
        </div>
      </div>
      {busy && <Spinner />}
      {err && <div className="card" style={{ borderColor: 'var(--hi)', color: 'var(--hi)' }}>⚠ {err}</div>}
      {msg && <div className="card" style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }}>✔ {msg}</div>}
      {lastBatch?.batchId && <div className="card compact-status" style={{ borderColor: 'var(--warn)', color: 'var(--text)' }}>
        <b>Batch upload mới nhất:</b> <span className="mono">{lastBatch.batchId}</span> · {rowsFmt(lastBatch.rows)} dòng · tổng {money(lastBatch.totalTarget)}{' '}
        <button className="btn ghost" disabled={busy} onClick={() => { setRollbackId(lastBatch.batchId); setTool('rollback'); }}>↩ Rollback batch này</button>
      </div>}
      {!data ? <Spinner /> : <>
        <div className="section-title">Danh sách đang dùng ({data.rows.length} NV/CTV)</div>
        <div className="list-grid target-admin-grid">
          {data.rows.map((r) => (
            <div className="card detail-card" key={r.emp_code}>
              <div className="detail-head detail-head-two">
                <div className="detail-title-wrap">
                  <div>
                    <div className="detail-title">{r.emp_name || r.emp_code}</div>
                    <div className="detail-sub mono">{r.emp_code} · {r.employee_type || '—'}</div>
                  </div>
                </div>
                <div className="detail-money">{Number(r.target || 0) > 0 ? money(r.target) : 'Chưa giao'}<em>Target đang dùng</em></div>
              </div>
              <div className="detail-facts two">
                <span><b>{Number(r.target || 0) > 0 ? targetSourceText(r).replace(/^Nguồn: /, '') : 'Chưa giao target'}</b><em>Nguồn</em></span>
                <span><button className="btn ghost" onClick={() => manual(r)}>Sửa tay</button><em>Thao tác</em></span>
              </div>
            </div>
          ))}
        </div>
      </>}
      <Modal id="template" title="⬇ Xuất/Tải template target">
        <div className="meta muted">Template xuất đúng kỳ đang chọn, đủ 21 NV theo DB. Căn cứ chỉ là mốc để CEO sửa, không tự thành target live.</div>
        <label className="field-inline modal-field"><span>Căn cứ template</span><select value={templateBasis} onChange={(e) => setTemplateBasis(e.target.value)}><option value="t06">Theo T06/2026 (Lumos)</option><option value="blank">Trống</option><option value="latest">Theo kỳ gần nhất đã giao</option></select></label>
        <button className="btn" disabled={busy} onClick={downloadTemplate}>⬇ Xuất/Tải template target</button>
      </Modal>
      <Modal id="upload" title="⬆ Upload target">
        <div className="meta muted">Upload lại file template đã sửa. Ô Target trống sẽ giữ nguyên, không ghi đè target hiện tại.</div>
        <input ref={fileRef} type="file" accept=".xlsx" onChange={onFile} />
        {preview && <div className="upload-preview-box">
          <b>Preview target upload</b>
          <div className="meta muted">{preview.filename} · {rowsFmt(preview.meta.totalRows)} dòng sẽ ghi · {rowsFmt(preview.meta.skippedRows || 0)} dòng trống giữ nguyên · {preview.meta.kyCount || 0} kỳ ({preview.meta.kys?.join(', ') || '—'}) · tổng {money(preview.meta.totalTarget)}</div>
          {preview.sample.map((r, i) => <div key={i} className="row"><div className="main"><div className="name">{r.emp_code} · {r.ky}</div></div><div className="amt">{money(r.target)}</div></div>)}
          {preview.skipped?.length > 0 && <div className="meta muted">Giữ nguyên do ô target trống: {preview.skipped.map((r) => `${r.emp_code}/${r.ky}`).join(', ')}</div>}
          <button className="btn" disabled={busy} onClick={commitUpload}>✔ Ghi target upload</button>
        </div>}
      </Modal>
      <Modal id="quarter" title="📅 Nhập target Quý — chia đều 3 tháng">
        <div className="meta muted">Nhập tổng target quý theo từng NV, hệ thống tự tách thành 3 tháng. Sau khi chia, từng tháng vẫn sửa tay từng NV được.</div>
        <div className="target-admin-actions compact-actions">
          <label className="field-inline"><span>Năm</span><input value={qYear} onChange={(e) => setQYear(e.target.value)} /></label>
          <label className="field-inline"><span>Quý</span><select value={qQuarter} onChange={(e) => setQQuarter(e.target.value)}><option value="1">Q1</option><option value="2">Q2</option><option value="3">Q3</option><option value="4">Q4</option></select></label>
        </div>
        <textarea className="target-quarter-textarea" value={qLines} onChange={(e) => setQLines(e.target.value)} placeholder="DN001 6000000000&#10;DN002 4500000000" />
        <button className="btn" disabled={busy} onClick={applyQuarter}>Chia target quý thành 3 tháng</button>
      </Modal>
      <Modal id="ai" title="🤖 AI đề xuất target">
        <div className="meta muted">AI chỉ đề xuất song song. CEO bấm áp dụng thì mới ghi thành target thật.</div>
        <button className="btn" disabled={busy} onClick={proposeAi}>Tạo đề xuất AI</button>
        {ai?.items?.length > 0 && <div className="upload-preview-box">
          <b>AI đề xuất {ai.next_ky}</b>
          {ai.items.slice(0, 8).map((r) => <div key={r.emp_code} className="row"><div className="main"><div className="name">{r.emp_code} · {r.emp_name}</div><div className="meta">Neo {r.last_ky} · {r.reason}</div></div><div className="amt">{money(r.suggested_target)}</div></div>)}
          <button className="btn" disabled={busy} onClick={applyAi}>Áp dụng AI ({ai.next_ky})</button>
        </div>}
      </Modal>
      <Modal id="rollback" title="↩ Rollback target upload">
        <div className="meta muted">Nhập mã batch cần rollback. Có thể dùng batch mới nhất nếu vừa upload.</div>
        <input value={rollbackId} onChange={(e) => setRollbackId(e.target.value)} placeholder="Mã batch rollback" />
        <button className="btn" disabled={busy || !rollbackId} onClick={() => rollbackBatch(rollbackId)}>↩ Rollback batch</button>
      </Modal>
    </>
  );
}

export default function Target({ me }) {
  const [view, setView] = useState('now'); // now | forecast | admin
  const [periods, setPeriods] = useState([]);
  const [periodSel, setPeriodSel] = useState(null);
  const [adminKy, setAdminKy] = useState('');
  const [now, setNow] = useState(null);
  const [fc, setFc] = useState(null);
  const { reloadTick, reload } = useReloadTick();

  useEffect(() => {
    api.periods().then((p) => { setPeriods(p.periods || []); setPeriodSel(defaultPeriodSelection(p.periods || [], p.latest)); setAdminKy(p.latest || p.periods?.at(-1)?.ky || ''); });
  }, []);
  useEffect(() => {
    // Không để tab Target kẹt spinner nếu PeriodFilter hydrate chậm: backend tự dùng kỳ mới nhất.
    setNow(null);
    api.targets(periodSel ? periodParams(periodSel) : undefined).then(setNow);
  }, [periodSel, reloadTick]);
  useEffect(() => { api.forecast().then(setFc); }, [reloadTick]);
  const selectedKy = (periodSel?.mode === 'range' ? periodSel.to : periodSel?.ky) || periods.at(-1)?.ky || now?.ky;
  const adminSelectedKy = adminKy || selectedKy;
  async function refreshTargetKpis() {
    if (!periodSel) return;
    setNow(await api.targets(periodParams(periodSel)));
  }

  return (
    <>
      <DrillNav crumbs={[{ label: 'Target' }, ...(view !== 'now' ? [{ label: view === 'forecast' ? 'Dự báo' : 'Quản target' }] : [])]} onBack={view !== 'now' ? () => setView('now') : undefined} onCrumb={(i) => { if (i === 0) setView('now'); }} onReload={reload} busy={!now && view === 'now'} />
      <div className="seg">
        <button className={view === 'now' ? 'active' : ''} onClick={() => setView('now')}>Kỳ này</button>
        <button className={view === 'forecast' ? 'active' : ''} onClick={() => setView('forecast')}>Dự báo{fc ? ` (${fc.next_ky})` : ''}</button>
        {me.isAdmin && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>Quản target</button>}
      </div>
      {view === 'now' && periodSel && <PeriodFilter periods={periods} value={periodSel} onChange={setPeriodSel} />}
      {/* DIRECTIVE_LAYOUT_SMART: Quản target dùng kỳ compact trong toolbar, không phơi period card riêng để danh sách 21 NV lên ngay. */}

      {view === 'now' ? (
        !now ? <Spinner /> : now.items.length === 0 ? <div className="center">Chưa có target.</div> : (
          <>
          <div className="section-title">Kỳ target: {periodLabel(periodSel)} · KPI so với target cả tháng</div>
          <div className="kpi-grid">
            <Kpi label="Tổng đạt trước VAT" value={money(now.summary?.totalRevenueBeforeVat || 0)} sub={now.summary?.totalTarget > 0 ? `Target tháng ${money(now.summary.totalTarget)}` : 'Chưa giao target tổng'} />
            <Kpi label="% đạt target tháng" value={pct(now.summary?.pct)} sub={now.summary?.gap == null ? 'Chưa giao target' : (now.summary.gap >= 0 ? `Vượt ${money(now.summary.gap)}` : `Thiếu ${money(Math.abs(now.summary.gap))}`)} />
            <Kpi label="NV có target" value={`${now.summary?.assignedCount || 0}/${now.summary?.totalEmployees || now.items.length}`} sub={(now.summary?.unassignedCount || 0) ? `${now.summary.unassignedCount} NV chưa giao target` : 'Đã giao đủ'} />
            <Kpi label="NV đạt target" value={`${now.summary?.achievedCount || 0}/${now.summary?.assignedCount || 0}`} sub="So với target cả tháng" />
          </div>
          <div className="list-grid">
            {now.items.map((t) => {
              const p = t.pct;
              const cls = p == null ? 'ok' : p >= 100 ? 'ok' : p >= 80 ? 'warn' : 'bad';
              const assigned = t.target_assigned !== false && Number(t.target_full || t.target || 0) > 0;
              return (
                <div key={t.emp_code} className="card" style={{ padding: 12 }}>
                  <div className="target-card-row">
                    <TargetGauge pct={p} size="small" />
                    <div className="target-card-body">
                      <div className="list-card-title"><div className="name">{t.emp_name || t.emp_code}</div><span className={'pill ' + (assigned ? cls : 'muted-pill')}>{assigned ? pct(p) : 'Chưa giao target'}</span></div>
                      <div className="meta muted mono">{t.emp_code} · {t.employee_type || '—'}</div>
                      {assigned && <Bar value={t.revenue_before_vat} max={t.target_full || t.target} tone={p != null && p < 80 ? 'warn' : ''} />}
                      <div className="meta muted" style={{ marginTop: 5 }}>
                        Đạt {money(t.revenue_before_vat)} / target cả tháng {assigned ? money(t.target_full || t.target) : 'Chưa giao'}{assigned && <> · <span style={{ color: t.gap >= 0 ? 'var(--ok)' : 'var(--hi)' }}>{t.gap >= 0 ? 'vượt ' : 'thiếu '}{money(Math.abs(t.gap))}</span></>}
                      </div>
                      <div className="meta muted" style={{ marginTop: 3 }}>{targetSourceText(t)}</div>
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
      ) : <TargetAdminPanel ky={adminSelectedKy} onKyChange={setAdminKy} onTargetsChanged={refreshTargetKpis} />}
    </>
  );
}
