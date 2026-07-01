import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { money, short } from '../util.js';
import { Spinner } from '../components.jsx';

// Upload doanh thu (chỉ admin). Parse + validate ở BACKEND, preview trước khi ghi.
export default function Upload() {
  const [tab, setTab] = useState('new'); // new | history
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [meta, setMeta] = useState({ ky: '', dateFrom: '', dateTo: '' });
  const [slots, setSlots] = useState(null);
  const [done, setDone] = useState('');
  const fileRef = useRef(null);

  function loadSlots() { api.uploadSlots().then(setSlots).catch(() => {}); }
  useEffect(() => { loadSlots(); }, []);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(''); setPreview(null); setDone('');
    try {
      const p = await api.uploadPreview(file);
      setPreview(p);
      // đoán kỳ từ tên file nếu có dạng _YYYY-MM-DD_
      const m = file.name.match(/(\d{4})-?(\d{2})/);
      if (m) setMeta((s) => ({ ...s, ky: `${m[2]}.${m[1]}` }));
    } catch (e2) {
      setErr((e2.errors || [e2.message]).join(' '));
    }
    setBusy(false);
  }

  async function commit() {
    if (!meta.ky) { setErr('Nhập kỳ (VD 06.2026).'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.uploadCommit({ previewId: preview.previewId, ...meta });
      setDone(`Đã lưu slot kỳ ${r.slot.ky}: ${r.slot.totalRows} dòng · ${money(r.slot.totalRevenue)}.`);
      setPreview(null); if (fileRef.current) fileRef.current.value = '';
      loadSlots();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function rollback(id) {
    if (!confirm('Khôi phục dữ liệu về slot này?')) return;
    await api.uploadActivate(id);
    loadSlots();
  }

  return (
    <>
      <div className="seg">
        <button className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>Tải file mới</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Lịch sử & khôi phục</button>
      </div>

      {tab === 'new' ? (
        <>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>⬆️ Upload doanh thu (.xlsx)</div>
            <div className="meta muted" style={{ marginBottom: 10 }}>
              File được kiểm tra ở máy chủ (cột bắt buộc, tổng tiền, dòng trùng) trước khi lưu. Chưa ghi gì cho tới khi bấm “Xác nhận lưu”.
            </div>
            <input ref={fileRef} type="file" accept=".xlsx" onChange={onFile} />
          </div>

          {busy && <Spinner />}
          {err && <div className="card" style={{ borderColor: 'var(--hi)', color: 'var(--hi)' }}>⚠ {err}</div>}
          {done && <div className="card" style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }}>✔ {done}</div>}

          {preview && (
            <>
              <div className="kpi-grid">
                <div className="kpi"><div className="label">Số dòng hợp lệ</div><div className="value">{preview.meta.totalRows.toLocaleString('vi-VN')}</div></div>
                <div className="kpi"><div className="label">Tổng doanh thu</div><div className="value small">{short(preview.meta.totalRevenue)}</div></div>
                <div className="kpi"><div className="label">Số nhân viên</div><div className="value">{preview.meta.empCount}</div></div>
                <div className="kpi"><div className="label">Cảnh báo</div><div className="value" style={{ color: preview.warningCount ? 'var(--mid)' : 'var(--ok)' }}>{preview.warningCount}</div></div>
              </div>

              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Xác nhận kỳ & lưu</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <input placeholder="Kỳ (06.2026)" value={meta.ky} onChange={(e) => setMeta({ ...meta, ky: e.target.value })} />
                  <input placeholder="Từ ngày" type="date" value={meta.dateFrom} onChange={(e) => setMeta({ ...meta, dateFrom: e.target.value })} />
                  <input placeholder="Đến ngày" type="date" value={meta.dateTo} onChange={(e) => setMeta({ ...meta, dateTo: e.target.value })} />
                </div>
                <button className="btn" disabled={busy} onClick={commit}>✔ Xác nhận lưu slot kỳ {meta.ky || '…'}</button>
              </div>

              {preview.warnings?.length > 0 && (
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
                    <div className="amt">{short(r.revenue)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        !slots ? <Spinner /> : (
          <>
            <div className="section-title">Các slot đã lưu</div>
            {slots.slots.length === 0 ? <div className="center">Chưa có slot nào.</div> : slots.slots.map((s) => (
              <div key={s.id} className="card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Kỳ {s.ky} {s.active && <span className="pill ok">đang dùng</span>}</div>
                    <div className="meta muted">{s.totalRows} dòng · {short(s.totalRevenue)} · {s.uploadedByName || s.uploadedBy}</div>
                    <div className="meta muted">{new Date(s.uploadedAt).toLocaleString('vi-VN')}</div>
                  </div>
                  {!s.active && <button className="btn ghost" onClick={() => rollback(s.id)}>↩ Khôi phục</button>}
                </div>
              </div>
            ))}
            <div className="section-title">Nhật ký thao tác</div>
            {slots.audit.length === 0 ? <div className="center muted">Chưa có.</div> : slots.audit.slice(0, 20).map((a, i) => (
              <div key={i} className="meta muted" style={{ padding: '4px 6px' }}>
                {new Date(a.at).toLocaleString('vi-VN')} · <b>{a.by}</b> · {a.action} kỳ {a.ky}{a.rows ? ` · ${a.rows} dòng` : ''}
              </div>
            ))}
          </>
        )
      )}
    </>
  );
}
