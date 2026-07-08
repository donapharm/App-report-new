import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { money } from '../util.js';
import { Spinner } from '../components.jsx';
import { DrillNav } from '../drillNav.jsx';

const emptyMeta = { ky: '', dateFrom: '', dateTo: '' };
const fmtRows = (n) => Number(n || 0).toLocaleString('vi-VN');

// Đối soát tính toàn vẹn dữ liệu 1 kỳ (chỉ admin). Gọi /admin/reconcile.
function ReconcilePanel({ recon, reconKy, setReconKy, activeSlots, run, busy }) {
  const s = recon?.summary;
  return (
    <>
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>🔎 Đối soát dữ liệu doanh thu</div>
        <div className="meta muted" style={{ marginBottom: 10 }}>
          Kiểm tra tự động: ngày ngoài biên kỳ (dấu hiệu lỗi múi giờ 01/07→30/06), lệch số dòng/doanh thu so metadata,
          đếm trùng, và đơn vị của từng NV biến mất so kỳ trước. Đối soát sâu với nguồn Sale-New: chạy
          <code> node server/scripts/reconcile_revenue.js</code> trên server.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={reconKy} onChange={(e) => setReconKy(e.target.value)}>
            <option value="">Kỳ mới nhất</option>
            {activeSlots.map((x) => <option key={x.id} value={x.ky}>{x.ky}</option>)}
          </select>
          <button className="btn" disabled={busy} onClick={() => run(reconKy)}>Đối soát</button>
        </div>
      </div>

      {busy && <Spinner />}
      {recon && !recon.hasSlot && <div className="card" style={{ borderColor: 'var(--mid)' }}>⚠ {recon.note}</div>}
      {recon && recon.hasSlot && (
        <>
          <div className="card" style={{ borderColor: recon.ok ? 'var(--ok)' : 'var(--hi)' }}>
            <b>Kỳ {recon.ky}</b> {recon.ok
              ? <span style={{ color: 'var(--ok)' }}>✔ Dữ liệu sạch — không phát hiện lệch.</span>
              : <span style={{ color: 'var(--hi)' }}>⚠ Phát hiện {s.issues} vấn đề (ngoài biên {s.dateOutOfBand} · lệch meta {s.metaMismatch} · trùng {s.duplicateLines} · đơn vị mất {s.unitDrop}).</span>}
          </div>
          {recon.dateOutOfBand.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, color: 'var(--hi)', marginBottom: 6 }}>⛔ Ngày ngoài biên kỳ (lỗi gán ngày ở nguồn)</div>
              {recon.dateOutOfBand.map((u, i) => (
                <div key={i} className="meta">• <b>{u.unit_code}</b> {u.unit_name} — {u.rows} dòng · ngày {u.dates.join(', ')} ({u.side === 'before' ? 'trước kỳ' : 'sau kỳ'}) · {money(u.revenue)} · NV {u.emps.join(', ')}</div>
              ))}
            </div>
          )}
          {recon.unitDrop.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, color: 'var(--mid)', marginBottom: 6 }}>⚠ Đơn vị biến mất so kỳ trước ({recon.prevKy})</div>
              {recon.unitDrop.map((nv, i) => (
                <div key={i} className="meta">• <b>{nv.emp_code}</b> {nv.emp_name}: mất {nv.units.length} đơn vị — {nv.units.map((u) => u.unit_code).join(', ')}</div>
              ))}
            </div>
          )}
          {recon.metaMismatch.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, color: 'var(--mid)', marginBottom: 6 }}>⚠ Lệch metadata slot</div>
              {recon.metaMismatch.map((m, i) => <div key={i} className="meta">• {m.field}: metadata={fmtRows(m.meta)} · thực tế={fmtRows(m.actual)}</div>)}
            </div>
          )}
          {recon.duplicateLines.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, color: 'var(--mid)', marginBottom: 6 }}>⚠ Dòng trùng ({recon.duplicateLines.length})</div>
              {recon.duplicateLines.slice(0, 20).map((d, i) => <div key={i} className="meta">• {d.source_line_id} · {d.unit_code} · {money(d.revenue)}</div>)}
            </div>
          )}
        </>
      )}
    </>
  );
}

// Upload doanh thu (chỉ admin). Parse + validate ở BACKEND, preview trước khi ghi.
export default function Upload() {
  const [tab, setTab] = useState('new'); // new | update | history
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [meta, setMeta] = useState(emptyMeta);
  const [slots, setSlots] = useState(null);
  const [done, setDone] = useState('');
  const [recon, setRecon] = useState(null);
  const [reconKy, setReconKy] = useState('');
  const fileRef = useRef(null);

  async function runReconcile(ky) {
    setBusy(true); setErr(''); setRecon(null);
    try { setRecon(await api.adminReconcile(ky || '')); }
    catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  function loadSlots() { api.uploadSlots().then(setSlots).catch(() => {}); }
  useEffect(() => { loadSlots(); }, []);
  useEffect(() => { setPreview(null); setErr(''); setDone(''); if (fileRef.current) fileRef.current.value = ''; }, [tab]);

  const activeSlots = useMemo(() => (slots?.slots || []).filter((s) => s.active).sort((a, b) => String(a.ky).localeCompare(String(b.ky), 'vi')), [slots]);
  const activeByKy = useMemo(() => Object.fromEntries(activeSlots.map((s) => [s.ky, s])), [activeSlots]);
  const currentSlot = meta.ky ? activeByKy[meta.ky] : null;

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(''); setPreview(null); setDone('');
    try {
      const p = await api.uploadPreview(file);
      setPreview(p);
      // đoán kỳ từ tên file nếu có dạng _YYYY-MM-DD_
      const m = file.name.match(/(\d{4})-?(\d{2})/);
      if (m && tab === 'new') setMeta((s) => ({ ...s, ky: `${m[2]}.${m[1]}` }));
    } catch (e2) {
      setErr((e2.errors || [e2.message]).join(' '));
    }
    setBusy(false);
  }

  async function commit() {
    if (!preview?.previewId) { setErr('Chưa có preview hợp lệ.'); return; }
    if (!meta.ky) { setErr('Nhập/chọn kỳ (VD 06.2026).'); return; }
    if (tab === 'new' && currentSlot) { setErr(`Kỳ ${meta.ky} đã tồn tại. Vui lòng chuyển sang “Import cập nhật (kỳ hiện có)”.`); return; }
    if (tab === 'update' && !currentSlot) { setErr(`Kỳ ${meta.ky} chưa có dữ liệu. Vui lòng chuyển sang “Import mới (kỳ mới)”.`); return; }
    if (tab === 'update') {
      const ok = confirm(`Sẽ thay dữ liệu kỳ ${meta.ky} (đang có ${fmtRows(currentSlot.totalRows)} dòng / ${money(currentSlot.totalRevenue)}) bằng file mới (${fmtRows(preview.meta.totalRows)} dòng / ${money(preview.meta.totalRevenue)}). Slot cũ vẫn được giữ để khôi phục. Tiếp tục?`);
      if (!ok) return;
    }
    setBusy(true); setErr('');
    try {
      const r = await api.uploadCommit({ previewId: preview.previewId, mode: tab === 'update' ? 'update' : 'new', ...meta });
      const verb = tab === 'update' ? 'cập nhật' : 'tạo mới';
      setDone(`Đã ${verb} kỳ ${r.slot.ky}: ${fmtRows(r.slot.totalRows)} dòng · ${money(r.slot.totalRevenue)}.`);
      setPreview(null); if (fileRef.current) fileRef.current.value = '';
      loadSlots();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function rollback(id) {
    if (!confirm('Khôi phục dữ liệu về slot này? Slot hiện tại của cùng kỳ sẽ được giữ lại để có thể khôi phục ngược.')) return;
    await api.uploadActivate(id);
    loadSlots();
  }

  function ModeHelp() {
    return tab === 'new' ? (
      <div className="meta muted" style={{ marginBottom: 10 }}>
        Tạo slot cho <b>kỳ chưa có dữ liệu</b>. Nếu kỳ đã tồn tại, hệ thống sẽ chặn và yêu cầu chuyển sang Import cập nhật.
      </div>
    ) : (
      <div className="meta muted" style={{ marginBottom: 10 }}>
        Thay dữ liệu của <b>kỳ đang có</b> bằng file lũy kế mới nhất. Slot cũ không xoá, vẫn nằm trong “Lịch sử & khôi phục”.
      </div>
    );
  }

  function PreviewPanel() {
    if (!preview) return null;
    const duplicateCount = preview.meta.duplicateCount || 0;
    return (
      <>
        <div className="kpi-grid">
          <div className="kpi"><div className="label">Số dòng hợp lệ</div><div className="value">{fmtRows(preview.meta.totalRows)}</div></div>
          <div className="kpi"><div className="label">Tổng doanh thu</div><div className="value small">{money(preview.meta.totalRevenue)}</div></div>
          <div className="kpi"><div className="label">Số nhân viên</div><div className="value">{preview.meta.empCount}</div></div>
          <div className="kpi"><div className="label">Dòng nghi trùng</div><div className="value" style={{ color: duplicateCount ? 'var(--mid)' : 'var(--ok)' }}>{duplicateCount}</div></div>
        </div>

        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{tab === 'update' ? 'Xác nhận Import cập nhật' : 'Xác nhận Import mới'}</div>
          {tab === 'new' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              <input placeholder="Kỳ mới (06.2026)" value={meta.ky} onChange={(e) => setMeta({ ...meta, ky: e.target.value.trim() })} />
              <input placeholder="Từ ngày" type="date" value={meta.dateFrom} onChange={(e) => setMeta({ ...meta, dateFrom: e.target.value })} />
              <input placeholder="Đến ngày" type="date" value={meta.dateTo} onChange={(e) => setMeta({ ...meta, dateTo: e.target.value })} />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              <select value={meta.ky} onChange={(e) => setMeta({ ...meta, ky: e.target.value })}>
                <option value="">Chọn kỳ đang có</option>
                {activeSlots.map((s) => <option key={s.id} value={s.ky}>{s.ky} · {fmtRows(s.totalRows)} dòng · {money(s.totalRevenue)}</option>)}
              </select>
              <input placeholder="Từ ngày" type="date" value={meta.dateFrom} onChange={(e) => setMeta({ ...meta, dateFrom: e.target.value })} />
              <input placeholder="Đến ngày" type="date" value={meta.dateTo} onChange={(e) => setMeta({ ...meta, dateTo: e.target.value })} />
            </div>
          )}
          {tab === 'new' && currentSlot && <div className="meta" style={{ color: 'var(--hi)', marginBottom: 8 }}>⚠ Kỳ {meta.ky} đã tồn tại: {fmtRows(currentSlot.totalRows)} dòng / {money(currentSlot.totalRevenue)}. Hãy chuyển sang Import cập nhật.</div>}
          {tab === 'update' && currentSlot && (
            <div className="card" style={{ background: '#fff8e8', marginBottom: 10 }}>
              ⚠ Sẽ thay dữ liệu kỳ <b>{meta.ky}</b> đang có <b>{fmtRows(currentSlot.totalRows)} dòng / {money(currentSlot.totalRevenue)}</b> bằng file mới <b>{fmtRows(preview.meta.totalRows)} dòng / {money(preview.meta.totalRevenue)}</b>. Slot cũ giữ lại để khôi phục.
            </div>
          )}
          <button className="btn" disabled={busy || (tab === 'new' && !!currentSlot) || (tab === 'update' && !currentSlot)} onClick={commit}>
            ✔ {tab === 'update' ? `Xác nhận thay dữ liệu kỳ ${meta.ky || '…'}` : `Xác nhận tạo kỳ ${meta.ky || '…'}`}
          </button>
        </div>

        {preview.warningCount > 0 && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--mid)' }}>Cảnh báo ({preview.warningCount})</div>
            {preview.warnings.slice(0, 12).map((w, i) => <div key={i} className="meta muted">• {w}</div>)}
          </div>
        )}

        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Xem trước 8 dòng đầu</div>
          {preview.sample.map((r, i) => (
            <div key={i} className="row">
              <div className="main"><div className="name">{r.emp_code} · {r.unit_code || '—'}</div><div className="meta">{r.product_name || r.iit_code || ''}</div></div>
              <div className="amt">{money(r.revenue)}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <DrillNav crumbs={[{ label: 'Upload' }, ...(tab !== 'new' ? [{ label: tab === 'update' ? 'Cập nhật' : 'Lịch sử' }] : [])]} onBack={tab !== 'new' ? () => setTab('new') : undefined} onCrumb={(i) => { if (i === 0) setTab('new'); }} onReload={loadSlots} busy={busy} />
      <div className="seg">
        <button className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>Import mới (kỳ mới)</button>
        <button className={tab === 'update' ? 'active' : ''} onClick={() => setTab('update')}>Import cập nhật (kỳ hiện có)</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Lịch sử & khôi phục</button>
        <button className={tab === 'reconcile' ? 'active' : ''} onClick={() => setTab('reconcile')}>Đối soát dữ liệu</button>
      </div>

      {(tab === 'new' || tab === 'update') ? (
        <>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>⬆️ {tab === 'new' ? 'Import mới (kỳ mới)' : 'Import cập nhật (kỳ hiện có)'}</div>
            <ModeHelp />
            <div className="meta muted" style={{ marginBottom: 10 }}>
              Cả 2 chế độ đều parse + validate ở backend → preview số dòng/tổng tiền/cảnh báo/dòng trùng → bấm xác nhận mới ghi + audit.
            </div>
            {tab === 'update' && (
              <select value={meta.ky} onChange={(e) => setMeta({ ...meta, ky: e.target.value })} style={{ marginBottom: 8 }}>
                <option value="">Chọn kỳ đang có để cập nhật</option>
                {activeSlots.map((s) => <option key={s.id} value={s.ky}>{s.ky} · {fmtRows(s.totalRows)} dòng · {money(s.totalRevenue)}</option>)}
              </select>
            )}
            <input ref={fileRef} type="file" accept=".xlsx" onChange={onFile} />
          </div>

          {busy && <Spinner />}
          {err && <div className="card" style={{ borderColor: 'var(--hi)', color: 'var(--hi)' }}>⚠ {err}</div>}
          {done && <div className="card" style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }}>✔ {done}</div>}
          <PreviewPanel />
        </>
      ) : tab === 'reconcile' ? (
        <ReconcilePanel recon={recon} reconKy={reconKy} setReconKy={setReconKy} activeSlots={activeSlots} run={runReconcile} busy={busy} />
      ) : (
        !slots ? <Spinner /> : (
          <>
            <div className="section-title">Các slot đã lưu</div>
            {slots.slots.length === 0 ? <div className="center">Chưa có slot nào.</div> : <div className="list-grid upload-slot-grid">{slots.slots.map((s) => (
              <div key={s.id} className="card detail-card" style={{ padding: 12 }}>
                <div className="detail-head detail-head-two">
                  <div>
                    <div className="detail-title">Kỳ {s.ky} {s.active && <span className="pill ok">đang dùng</span>} {s.mode === 'update' && <span className="pill warn">cập nhật</span>}</div>
                    <div className="meta muted">{fmtRows(s.totalRows)} dòng · {money(s.totalRevenue)} · {s.uploadedByName || s.uploadedBy}</div>
                    <div className="meta muted">{new Date(s.uploadedAt).toLocaleString('vi-VN')}{s.replacedSlotId ? ` · thay slot ${s.replacedSlotId}` : ''}</div>
                  </div>
                  {!s.active && <button className="btn ghost" onClick={() => rollback(s.id)}>↩ Khôi phục</button>}
                </div>
              </div>
            ))}</div>}
            <div className="section-title">Nhật ký thao tác</div>
            {slots.audit.length === 0 ? <div className="center muted">Chưa có.</div> : slots.audit.slice(0, 20).map((a, i) => (
              <div key={i} className="meta muted" style={{ padding: '4px 6px' }}>
                {new Date(a.at).toLocaleString('vi-VN')} · <b>{a.by}</b> · {a.action} kỳ {a.ky}{a.rows ? ` · ${fmtRows(a.rows)} dòng` : ''}{a.replacedSlotId ? ` · thay ${a.replacedSlotId}` : ''}
              </div>
            ))}
          </>
        )
      )}
    </>
  );
}
