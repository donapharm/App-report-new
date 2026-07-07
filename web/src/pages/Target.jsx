import React, { useEffect, useRef, useState } from 'react';
import { api, downloadTargetTemplate, downloadAssignmentTemplate, downloadExport } from '../api.js';
import { money, pct, unitText } from '../util.js';
import { Spinner, Bar, Kpi, TargetKpiStrip, RankRow } from '../components.jsx';
import PeriodFilter, { defaultPeriodSelection, periodParams, periodLabel } from './PeriodFilter.jsx';
import { TargetGauge } from '../charts.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';

const rowsFmt = (n) => Number(n || 0).toLocaleString('vi-VN');
const SOURCE_LABELS = { carryover: 'Nhân bản kỳ trước', upload: 'Upload', manual: 'Sửa tay', ai: 'AI đề xuất' };
// kỳ kế tiếp dạng MM.YYYY (client) để điền sẵn ô "sang kỳ".
function nextMonthKy(ky) {
  const [m, y] = String(ky || '').split('.').map(Number);
  if (!m || !y) return '';
  return `${String(m === 12 ? 1 : m + 1).padStart(2, '0')}.${m === 12 ? y + 1 : y}`;
}
function targetSourceText(t = {}) {
  if (t.target_assigned === false || (!Number(t.target || t.target_full || 0) && !(t.target_source_label || t.source_label || t.target_source || t.source))) return 'Chưa giao target';
  const raw = t.target_source_label || t.source_label || t.target_source || t.source || '—';
  const src = SOURCE_LABELS[raw] || raw;
  const ky = t.target_source_ky || t.source_ky;
  const ref = t.target_reference || t.reference;
  if (!src || src === '—') return 'Nguồn: —';
  return `Nguồn: ${src}${ky ? ` · kỳ ${ky}` : ''}${ref ? ' · tham khảo tự động' : ''}`;
}


const reasonLabel = (r) => ({ dut_hang: 'Đứt hàng / Hết CST', cong_no: 'Công nợ', khac: 'Khác' }[r] || r || 'Khác');
const statusLabel = (s) => ({ pending: 'Chờ CEO duyệt', approved: 'Đã duyệt', rejected: 'Không duyệt' }[s] || s || '—');

function TargetAdjustmentPanel({ ky, isAdmin, onChanged }) {
  const [data, setData] = useState(null);
  const [suggest, setSuggest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ emp_code: '', reason_type: 'dut_hang', impact_amount: '', note: '' });
  async function load() {
    if (!ky) return;
    setErr('');
    const params = { ky };
    setData(await api.targetAdjustments(params));
    if (isAdmin) setSuggest(await api.adminTargetAdjustmentSuggestions(params));
  }
  useEffect(() => { setData(null); load().catch((e) => setErr(e.message)); }, [ky, isAdmin]);
  const setF = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  async function create(payload = form) {
    setBusy(true); setErr(''); setMsg('');
    try {
      await api.targetAdjustmentCreate({ ky, ...payload });
      setMsg('Đã ghi lý do điều chỉnh. Chỉ khi CEO/admin duyệt thì target đánh giá mới hạ xuống.');
      setForm({ emp_code: isAdmin ? payload.emp_code || '' : '', reason_type: 'dut_hang', impact_amount: '', note: '' });
      await load(); await onChanged?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function approve(id, ok) {
    setBusy(true); setErr(''); setMsg('');
    try {
      if (ok) await api.adminTargetAdjustmentApprove(id); else await api.adminTargetAdjustmentReject(id);
      setMsg(ok ? 'Đã duyệt điều chỉnh target.' : 'Đã từ chối điều chỉnh target.');
      await load(); await onChanged?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const rows = data?.rows || [];
  const audit = data?.audit || [];
  return (
    <>
      <div className="card smart-admin-head">
        <div className="smart-title-row"><div className="section-head">🧾 Điều chỉnh target — GĐ2a</div><span className="info-tip" tabIndex="0" data-tip="Ghi lý do đứt hàng/công nợ/khác. Chỉ dòng đã CEO/admin duyệt mới hạ target chính thức. Gợi ý tự động chỉ là draft, không tự áp.">ⓘ</span></div>
        <div className="meta muted">Kỳ {ky || '—'} · target đánh giá = target gốc trừ tổng tiền ảnh hưởng đã duyệt, không âm.</div>
        <div className="smart-toolbar"><button className="btn ghost" disabled={busy || !rows.length} onClick={async () => { setErr(''); setMsg(''); try { await downloadExport('adjustments', { ky }); } catch (e) { setErr(e.message); } }}>⬇ Xuất Excel điều chỉnh</button></div>
      </div>
      {busy && <Spinner />}
      {err && <div className="card" style={{ borderColor: 'var(--hi)', color: 'var(--hi)' }}>⚠ {err}</div>}
      {msg && <div className="card" style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }}>✔ {msg}</div>}
      <div className="card">
        <div className="section-title">Ghi lý do đề xuất hạ target</div>
        <div className="filter-grid">
          {isAdmin && <label><span>NV</span><input value={form.emp_code} onChange={(e) => setF('emp_code', e.target.value.toUpperCase())} placeholder="DN001" /></label>}
          <label><span>Lý do</span><select value={form.reason_type} onChange={(e) => setF('reason_type', e.target.value)}><option value="dut_hang">Đứt hàng / Hết CST</option><option value="cong_no">Công nợ</option><option value="khac">Khác</option></select></label>
          <label><span>Số tiền ảnh hưởng</span><input value={form.impact_amount} onChange={(e) => setF('impact_amount', e.target.value)} placeholder="VD 120000000" /></label>
          <label><span>Ghi chú</span><input value={form.note} onChange={(e) => setF('note', e.target.value)} placeholder="Mặt hàng/đơn vị/lý do cụ thể" /></label>
        </div>
        <button className="btn" disabled={busy} onClick={() => create()}>Ghi lý do, chờ duyệt</button>
      </div>
      {isAdmin && <>
        <div className="section-title">Gợi ý tự động từ Hết CST / còn nợ</div>
        {!suggest ? <Spinner /> : <div className="list-grid">
          {(suggest.suggestions || []).length === 0 ? <div className="card">Chưa có gợi ý tự động.</div> : suggest.suggestions.slice(0, 30).map((x, i) => <div className="card detail-card" key={`${x.source}-${x.emp_code}-${i}`}>
            <div className="detail-head detail-head-two"><div><div className="detail-title">{x.emp_code}</div><div className="detail-sub">{reasonLabel(x.reason_type)} · {x.source}</div></div><div className="detail-money">{money(x.impact_amount || 0)}<em>Draft</em></div></div>
            <div className="meta muted">{x.note || '—'}{x.lines ? ` · ${x.lines} dòng nguồn` : ''}</div>
            <button className="btn ghost" disabled={busy} onClick={() => create({ emp_code: x.emp_code, reason_type: x.reason_type, impact_amount: x.impact_amount || 0, note: x.note || '', source: x.source })}>Tạo đề xuất</button>
          </div>)}
          <div className="card"><b>Nguồn</b><div className="meta muted">Đứt hàng: {suggest.source_notes?.dut_hang || 'draft từ CST'}<br />Công nợ: {suggest.source_notes?.cong_no || 'chờ nguồn WEB partner'}</div></div>
        </div>}
      </>}
      <div className="section-title">Danh sách điều chỉnh ({rows.length})</div>
      {!data ? <Spinner /> : <div className="list-grid target-admin-grid">
        {rows.length === 0 ? <div className="card">Chưa có điều chỉnh target kỳ này.</div> : rows.map((r) => <div className="card detail-card" key={r.id}>
          <div className="detail-head detail-head-two"><div><div className="detail-title">{r.emp_code}</div><div className="detail-sub mono">{r.ky} · {reasonLabel(r.reason_type)} · {r.by || '—'}</div></div><div className="detail-money">{money(r.impact_amount)}<em>{statusLabel(r.status)}</em></div></div>
          <div className="detail-facts two"><span><b>{r.note || '—'}</b><em>Ghi chú</em></span><span><b>{r.approved_by || '—'}</b><em>Duyệt bởi</em></span></div>
          {isAdmin && r.status === 'pending' && <div className="target-admin-actions compact-actions"><button className="btn" disabled={busy} onClick={() => approve(r.id, true)}>✅ Duyệt hạ target</button><button className="btn ghost" disabled={busy} onClick={() => approve(r.id, false)}>❌ Không duyệt</button></div>}
        </div>)}
      </div>}
      {isAdmin && <><div className="section-title">Audit điều chỉnh</div><div className="card">{audit.slice(0, 10).map((h, i) => <div className="row" key={i}><div className="main"><div className="name">{h.action} · {h.by}</div><div className="meta muted">{h.at} · {h.emp_code || ''} · {money(h.impact_amount || 0)}</div></div></div>)}</div></>}
    </>
  );
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
  const [coTo, setCoTo] = useState('');
  const [coOverwrite, setCoOverwrite] = useState(false);
  const fileRef = useRef(null);
  async function load() { if (!ky) return; setData(null); setData(await api.adminTargets(ky)); }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [ky]);
  async function manual(row) {
    const raw = prompt(`Nhập target cho ${row.emp_code} - ${row.emp_name} kỳ ${ky} (để trống = huỷ, không đổi)`, row.target || 0);
    if (raw == null) return;
    const s = String(raw).trim();
    // Bỏ trống = HUỶ (tránh vô tình ghi đè target về 0 như vụ DN001).
    if (s === '') return;
    const num = Number(s.replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(num) || num < 0) { setErr('Target không hợp lệ — nhập số ≥ 0 (vd 2000000000).'); return; }
    if (num === 0 && !window.confirm(`Đặt target ${row.emp_code} = 0 (Chưa giao)? Việc này sẽ ghi đè target đang có.`)) return;
    setBusy(true); setErr(''); setMsg('');
    try { await api.adminTargetManual({ ky, emp_code: row.emp_code, target: num }); setMsg('Đã lưu target sửa tay. KPI Tổng đã cập nhật.'); await load(); await onTargetsChanged?.(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function clearManual(row) {
    const back = Number(row.fallback_target || 0) > 0
      ? `${SOURCE_LABELS[row.fallback_source] || row.fallback_source} ${money(row.fallback_target)}`
      : (row.fallback_label || row.fallback_source || 'nguồn kế');
    if (!window.confirm(`Gỡ target Sửa tay của ${row.emp_code} kỳ ${ky}? Sẽ quay về: ${back}.`)) return;
    setBusy(true); setErr(''); setMsg('');
    try { await api.adminTargetManualClear({ ky, emp_code: row.emp_code }); setMsg(`Đã gỡ Sửa tay của ${row.emp_code}, quay về ${back}.`); await load(); await onTargetsChanged?.(); }
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
  async function applyCarryover() {
    const toKy = (coTo || '').trim();
    if (!/^\d{2}\.\d{4}$/.test(toKy)) { setErr('Kỳ đích phải dạng MM.YYYY, ví dụ 08.2026'); return; }
    if (toKy === ky) { setErr('Kỳ đích trùng kỳ nguồn.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.adminTargetCarryover({ fromKy: ky, toKy, overwrite: coOverwrite });
      setLastBatch(r.result);
      setMsg(`Đã nhân bản ${rowsFmt(r.result.rows)} NV từ kỳ ${r.result.fromKy} sang ${r.result.toKy}${r.result.skipped ? `, bỏ qua ${r.result.skipped} NV đã có target` : ''}. Mã rollback: ${r.result.batchId}. Giờ Sếp Sửa tay các NV cần đổi.`);
      setTool(null);
      onKyChange?.(toKy); // chuyển sang kỳ đích để sửa tay ngay
      await onTargetsChanged?.();
    } catch (e) { setErr(e.message); }
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
          <span className="info-tip" tabIndex="0" data-tip="Resolver đang dùng: sửa tay > upload/nhân bản > AI. Từ kỳ 07.2026 trở đi không lấy Lumos/App Sale làm target đang dùng. Roster Target lấy theo allowlist CEO chốt 21 mã.">ⓘ</span>
        </div>
        <div className="smart-toolbar">
          <label className="field-inline smart-period"><span>Kỳ</span><input value={ky || ''} onChange={(e) => onKyChange?.(e.target.value)} placeholder="08.2026" /></label>
          <button className="btn ghost" onClick={() => onKyChange?.('08.2026')}>Mở 08.2026</button>
          <button className="btn" disabled={busy} onClick={() => { setCoTo(nextMonthKy(ky)); setTool('carryover'); }}>📤 Nhân bản sang kỳ sau</button>
          <button className="btn" disabled={busy} onClick={() => setTool('template')}>⬇ Template</button>
          <button className="btn ghost" disabled={busy} onClick={() => setTool('upload')}>⬆ Upload</button>
          <button className="btn ghost" disabled={busy} onClick={() => setTool('quarter')}>📅 Nhập theo Quý</button>
          <button className="btn ghost" disabled={busy} onClick={() => setTool('ai')}>🤖 AI đề xuất</button>
          <button className="btn ghost" disabled={busy} onClick={() => { setRollbackId(lastBatch?.batchId || ''); setTool('rollback'); }}>↩ Rollback</button>
        </div>
      </div>
      <TargetKpiStrip kpi={data?.kpi} />
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
                <span>
                  <button className="btn ghost" onClick={() => manual(r)}>Sửa tay</button>
                  {r.manual_override && <button className="btn ghost danger-btn" disabled={busy} onClick={() => clearManual(r)}>🗑️ Gỡ sửa tay</button>}
                  <em>Thao tác</em>
                </span>
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
      <Modal id="carryover" title="📤 Nhân bản target sang kỳ khác">
        <div className="meta muted">Copy toàn bộ target đang dùng của kỳ <b>{ky}</b> sang kỳ đích — KHÔNG cần file. Sau đó chỉ cần <b>Sửa tay</b> vài NV muốn đổi (Sửa tay luôn ưu tiên hơn nên không bị đè).</div>
        <div className="target-admin-actions compact-actions">
          <label className="field-inline"><span>Từ kỳ</span><input value={ky || ''} readOnly /></label>
          <label className="field-inline"><span>Sang kỳ</span><input value={coTo} onChange={(e) => setCoTo(e.target.value)} placeholder="08.2026" /></label>
        </div>
        <label className="field-check"><input type="checkbox" checked={coOverwrite} onChange={(e) => setCoOverwrite(e.target.checked)} /> Ghi đè cả NV đã có target ở kỳ đích <span className="muted">(mặc định chỉ điền NV chưa giao)</span></label>
        <button className="btn" disabled={busy} onClick={applyCarryover}>📤 Nhân bản {ky} → {coTo || '…'}</button>
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


function AssignmentAdminPanel({ ky }) {
  const [rows, setRows] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [mine, setMine] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ emp_code: 'DN001', type: 'unit', value: '', from_ky: ky || '07.2026', to_ky: '', active: true, note: '' });
  const assignFileRef = useRef(null);
  async function load() {
    setErr('');
    const [a, c, m, h] = await Promise.all([
      api.adminAssignments({ ky }),
      api.salesCatalog({ all: 1, pageSize: 30 }),
      api.myAssignments({ ky }),
      api.adminAssignmentHistory(),
    ]);
    setRows(a.rows || []); setCatalog(c); setMine(m); setHistory(h.history || []);
  }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [ky]);
  function setF(k, v) { setForm((x) => ({ ...x, [k]: v })); }
  async function seed(replaceAuto = false) {
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.adminAssignmentSeed(replaceAuto); setMsg(`Đã gieo mầm ${r.result.rows} phân công tự động từ 04-06/2026.`); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try { await api.adminAssignmentSave(form); setMsg('Đã lưu phân công manual + audit.'); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function del(id) {
    if (!confirm('Ngưng hiệu lực phân công này?')) return;
    setBusy(true); setErr(''); setMsg('');
    try { await api.adminAssignmentDelete(id); setMsg('Đã ngưng hiệu lực phân công + audit.'); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  function editRow(a) {
    setForm({ id: a.id, emp_code: a.emp_code, type: a.type, value: a.value || '', from_ky: a.from_ky || ky || '07.2026', to_ky: a.to_ky || '', active: a.active !== false, note: a.note || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function uploadAssignments(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.adminAssignmentUpload(f); setMsg(`Đã upload ${r.result.rows} dòng phân công + audit.`); if (assignFileRef.current) assignFileRef.current.value = ''; await load(); }
    catch (err2) { setErr(err2.message); }
    setBusy(false);
  }
  const typeLabel = (t) => ({ unit: 'Đơn vị', group: 'Nhóm UT', route: 'Tuyến', iit: 'Mã QLNB', special: 'Hàng cần đẩy', all: 'Toàn bộ' }[t] || t);
  return (
    <>
      <div className="card smart-admin-head">
        <div className="smart-title-row"><div className="section-head">🧭 Phân công phụ trách — GĐ1</div><span className="info-tip" tabIndex="0" data-tip="Backend quyết quyền. Gieo mầm từ lịch sử bán 04-06/2026; manual có audit và hiệu lực từ kỳ, không hồi tố.">ⓘ</span></div>
        <div className="smart-toolbar">
          <button className="btn" disabled={busy} onClick={() => seed(false)}>🌱 Gieo mầm 04-06</button>
          <button className="btn ghost" disabled={busy} onClick={() => seed(true)}>Gieo lại auto</button>
          <button className="btn ghost" disabled={busy} onClick={load}>↻ Tải lại</button>
          <button className="btn ghost" disabled={busy} onClick={async () => { setErr(''); setMsg(''); try { await downloadAssignmentTemplate(ky); } catch (e) { setErr(e.message); } }}>⬇ Mẫu phân công</button>
          <button className="btn ghost" disabled={busy || !rows?.length} onClick={async () => { setErr(''); setMsg(''); try { await downloadExport('assignments', { ky }); } catch (e) { setErr(e.message); } }}>⬇ Xuất Excel</button>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>⬆ Upload Excel<input ref={assignFileRef} type="file" accept=".xlsx" onChange={uploadAssignments} style={{ display: 'none' }} /></label>
        </div>
      </div>
      {busy && <Spinner />}
      {err && <div className="card" style={{ borderColor: 'var(--hi)', color: 'var(--hi)' }}>⚠ {err}</div>}
      {msg && <div className="card" style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }}>✔ {msg}</div>}
      <div className="card">
        <div className="section-title">Thêm/sửa phân công</div>
        <div className="filter-grid">
          <label><span>NV</span><input value={form.emp_code} onChange={(e) => setF('emp_code', e.target.value.toUpperCase())} /></label>
          <label><span>Loại</span><select value={form.type} onChange={(e) => setF('type', e.target.value)}><option value="unit">Đơn vị</option><option value="group">Nhóm UT</option><option value="route">Tuyến</option><option value="iit">Mã QLNB</option><option value="special">Hàng cần đẩy</option><option value="all">Toàn bộ</option></select></label>
          <label><span>Giá trị</span><input value={form.value} onChange={(e) => setF('value', e.target.value)} placeholder="001.BV... / H.A / CL / mã QLNB" /></label>
          <label><span>Từ kỳ</span><input value={form.from_ky} onChange={(e) => setF('from_ky', e.target.value)} /></label>
          <label><span>Đến kỳ</span><input value={form.to_ky} onChange={(e) => setF('to_ky', e.target.value)} placeholder="trống = còn hiệu lực" /></label>
          <label><span>Ghi chú</span><input value={form.note} onChange={(e) => setF('note', e.target.value)} /></label>
        </div>
        <button className="btn" disabled={busy} onClick={save}>{form.id ? 'Cập nhật phân công' : 'Lưu phân công manual'}</button>
        {form.id && <button className="btn ghost" onClick={() => setForm({ emp_code: 'DN001', type: 'unit', value: '', from_ky: ky || '07.2026', to_ky: '', active: true, note: '' })}>Tạo mới</button>}
      </div>
      <div className="section-title">Danh mục bán hàng tổng ({catalog?.total || 0} mã)</div>
      {!catalog ? <Spinner /> : <div className="list-grid">
        {(catalog.rows || []).slice(0, 12).map((r) => <div className="card detail-card" key={r.iit_code}>
          <div className="detail-title">{r.product_name}</div>
          <div className="detail-sub mono">{r.iit_code} · {r.uom || '—'} · {r.priority || '—'} · {r.routes || '—'}</div>
          {r.qd === 'QĐ139' && <div className="detail-sub">{r.active_ingredient || '—'} · {r.ham_luong || '—'}</div>}
          <div className="detail-facts"><span><b>{money(r.bid_price)}</b><em>Giá thầu</em></span><span><b>{money(r.cst_remain_amount)}</b><em>CST còn</em></span><span><b>{r.contractors || '—'}</b><em>Nhà thầu</em></span><span><b>{r.bidPackages || '—'}</b><em>Gói</em></span></div>
        </div>)}
      </div>}
      <div className="section-title">Phân công hiện có ({rows?.length || 0})</div>
      {!rows ? <Spinner /> : <div className="list-grid target-admin-grid">
        {rows.slice(0, 80).map((a) => <div className="card detail-card" key={a.id}>
          <div className="detail-head detail-head-two"><div><div className="detail-title">{a.emp_name || a.emp_code}</div><div className="detail-sub mono">{a.emp_code} · {typeLabel(a.type)} · {a.value}</div></div><span className={'pill ' + (a.active ? 'ok' : 'muted-pill')}>{a.source || 'manual'}</span></div>
          <div className="detail-facts two"><span><b>{a.from_ky || '—'} → {a.to_ky || 'hiện tại'}</b><em>Hiệu lực</em></span><span><b>{a.by || '—'}</b><em>Người sửa</em></span><span><b>{a.note || '—'}</b><em>Ghi chú</em></span><span><button className="btn ghost" onClick={() => editRow(a)}>Sửa</button> <button className="btn ghost" onClick={() => del(a.id)}>Ngưng</button><em>Thao tác</em></span></div>
        </div>)}
      </div>}
      <AssignmentMinePanel data={mine} title="Tôi phụ trách (preview theo quyền hiện tại)" />
      <div className="section-title">Audit gần nhất</div>
      <div className="card">
        {(history || []).slice(0, 8).map((h) => <div className="row" key={h.id}><div className="main"><div className="name">{h.action} · {h.by}</div><div className="meta muted">{h.at} · {h.assignment_id || ''}</div></div></div>)}
      </div>
    </>
  );
}

function MyAssignmentsView({ ky }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setData(null); api.myAssignments({ ky }).then(setData).catch((e) => setErr(e.message)); }, [ky]);
  if (err) return <div className="card" style={{ borderColor: 'var(--hi)', color: 'var(--hi)' }}>⚠ {err}</div>;
  return <AssignmentMinePanel data={data} />;
}

function AssignmentMinePanel({ data, title = 'Tôi phụ trách' }) {
  if (!data) return <Spinner />;
  const specials = data.specials || {};
  return (
    <>
      <div className="section-title">{title}: {data.emp_name || data.emp_code}</div>
      <div className="list-grid">
        {(data.assignments || []).length === 0 ? <div className="card">Chưa có phân công đang hiệu lực.</div> : data.assignments.map((a) => <div className="card detail-card" key={a.id}>
          <div className="detail-title">{a.label}</div>
          <div className="detail-sub mono">{a.emp_code} · {a.from_ky || '—'} → {a.to_ky || 'hiện tại'} · {a.source || 'manual'}</div>
          <div className="meta muted">{a.note || '—'}</div>
        </div>)}
      </div>
      <div className="section-title">Hàng cần đẩy gợi ý</div>
      <div className="list-grid">
        {(specials.ton_nhieu || []).slice(0, 6).map((x) => <div className="card detail-card" key={'tn'+x.iit_code}><div className="detail-title">{x.product_name}</div><div className="detail-sub mono">{x.iit_code} · tồn nhiều · {x.priority || '—'}</div><div className="detail-facts"><span><b>{x.remain_pct}%</b><em>CST còn</em></span><span><b>{money(x.remain_amount)}</b><em>TT còn</em></span></div></div>)}
        {(specials.hang_ngach || []).slice(0, 6).map((x) => <div className="card detail-card" key={'hn'+x.iit_code}><div className="detail-title">{x.product_name}</div><div className="detail-sub mono">{x.iit_code} · hàng ngách · {x.priority || '—'}</div><div className="meta muted">{x.reason || 'Doanh số thấp / độ phủ hẹp'}</div></div>)}
        <div className="card"><b>Cận date</b><div className="meta muted">{specials.can_date?.message || 'Thiếu nguồn hạn dùng; CEO chọn thủ công.'}</div></div>
        <div className="card"><b>Sắp hết thầu-CST lớn</b><div className="meta muted">{specials.sap_het_thau_cst_lon?.message || 'Thiếu nguồn hạn gói thầu.'}</div></div>
      </div>
    </>
  );
}

function NotifyPreview({ data, ky }) {
  const evs = data.events || [];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [oneEmp, setOneEmp] = useState('DN001');
  async function sendOne() {
    const emp = (oneEmp || '').trim().toUpperCase();
    if (!emp) { setErr('Nhập mã NV, ví dụ DN007'); return; }
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.notificationsSendOne(emp, ky); setMsg(`Đã gửi cho ${emp} qua ${(r.channels || []).join(' + ') || 'kênh có sẵn'}. Nhờ NV kiểm tra.`); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function sendTest() {
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.notificationsSend({ ky, testOnly: true }); setMsg(`Đã gửi thử bản tổng cho chính bạn qua ${(r.channels || []).join(' + ') || 'kênh có sẵn'}. Kiểm tra nhé.`); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function sendNow() {
    if (!window.confirm(`Gửi NGAY ${evs.length} tin cho NV (mốc/chậm nhịp) + bản tổng cho CEO qua Telegram? Sau khi gửi sẽ không gửi lại các mốc này trong kỳ.`)) return;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.notificationsSend({ ky, testOnly: false }); setMsg(`Đã gửi ${r.sentNv || 0} tin NV${r.skipped ? ` (bỏ qua ${r.skipped})` : ''} + ${r.ceoSent || 0} bản tổng CEO.`); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <>
      <div className="card notify-banner">
        <b>🔔 Xem trước — mặc định CHƯA gửi gì cả.</b>
        <span className="meta muted">Kỳ {data.ky} · thời gian đã trôi {pct(data.timePct)}.</span>
        <span className="meta muted">Có <b>2 cách gửi</b>: (1) <b>Tự động</b> — bot chạy theo giờ (đặt <span className="mono">TARGET_NOTIFY=1</span>); (2) <b>Chủ động</b> — bấm <b>“Gửi ngay”</b> bên dưới.</span>
        <div className="notify-actions">
          <button className="btn ghost" disabled={busy} onClick={sendTest}>🧪 Gửi thử cho tôi</button>
          <button className="btn" disabled={busy || evs.length === 0} onClick={sendNow}>📤 Gửi ngay ({evs.length})</button>
        </div>
        <div className="notify-actions notify-one">
          <input className="notify-emp-input" value={oneEmp} onChange={(e) => setOneEmp(e.target.value)} placeholder="Mã NV (vd DN007)" />
          <button className="btn ghost" disabled={busy} onClick={sendOne}>👤 Gửi cho 1 NV này</button>
        </div>
        {err && <div className="meta" style={{ color: 'var(--hi)' }}>⚠ {err}</div>}
        {msg && <div className="meta" style={{ color: 'var(--ok)' }}>✔ {msg}</div>}
      </div>
      <div className="section-title">📊 Bản tổng gửi CEO</div>
      <div className="card"><pre className="notify-digest">{data.ceoDigest}</pre></div>
      <div className="section-title">✉️ Tin sẽ gửi cho NV ({evs.length})</div>
      {evs.length === 0 ? <div className="center">Chưa có tin nào cần gửi (chưa ai vừa vượt mốc / chậm nhịp trong kỳ này).</div> : (
        <div className="list-grid">
          {evs.map((e, i) => (
            <div key={`${e.emp_code}-${e.type}-${e.milestone || i}`} className="card" style={{ padding: 12 }}>
              <div className="list-card-title"><div className="name">{e.name}</div><span className={'pill ' + (e.type === 'behind' ? 'bad' : e.milestone === 100 ? 'ok' : 'warn')}>{e.type === 'behind' ? '⏱️ Chậm nhịp' : `🎯 Mốc ${e.milestone}%`}</span></div>
              <div className="meta muted mono">{e.emp_code} · đạt {pct(e.pct)}</div>
              <div className="notify-msg">{e.message}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function EmployeeDetail({ data }) {
  const maxMonthly = Math.max(1, ...(data.monthly || []).flatMap((m) => [m.target || 0, m.achieved || 0]));
  const maxProd = Math.max(1, ...(data.topProducts || []).map((p) => p.revenue || 0));
  const maxUnit = Math.max(1, ...(data.topUnits || []).map((u) => u.revenue || 0));
  return (
    <>
      <div className="section-title">👤 {data.emp.name} · <span className="mono">{data.emp.code}</span> · {data.emp.type || '—'}</div>
      <TargetKpiStrip kpi={data.kpi} />
      <div className="card">
        <div className="section-head">📈 Target vs Đã đạt theo tháng</div>
        <div className="emp-monthly">
          {(data.monthly || []).map((m) => (
            <div key={m.ky} className="emp-month-row">
              <span className="emp-month-ky mono">{m.ky}</span>
              <div className="emp-month-bars">
                <div className="emp-bar target" style={{ width: Math.min(100, (m.target || 0) / maxMonthly * 100) + '%' }} title={'Target ' + money(m.target)} />
                <div className={'emp-bar achieved ' + (m.pct == null ? '' : m.pct >= 100 ? 'ok' : m.pct >= 80 ? 'warn' : 'bad')} style={{ width: Math.min(100, (m.achieved || 0) / maxMonthly * 100) + '%' }} title={'Đạt ' + money(m.achieved)} />
              </div>
              <span className="emp-month-val">{money(m.achieved)} / {m.target > 0 ? money(m.target) : '—'}{m.pct != null ? ` · ${pct(m.pct)}` : ''}</span>
            </div>
          ))}
        </div>
        <div className="meta muted" style={{ marginTop: 6 }}>Thanh xám = target · thanh màu = đã đạt (xanh ≥100%, vàng ≥80%, đỏ &lt;80%).</div>
      </div>
      <div className="mini-columns">
        <div className="card">
          <div className="section-head">💊 Top sản phẩm · kỳ {data.ky}</div>
          {(data.topProducts || []).length ? data.topProducts.map((p, i) => (
            <RankRow key={p.iit_code || i} i={i + 1} name={p.product_name} meta={p.iit_code} amount={p.revenue} max={maxProd} />
          )) : <div className="center">Chưa có doanh thu kỳ này.</div>}
        </div>
        <div className="card">
          <div className="section-head">🏥 Top đơn vị · kỳ {data.ky}</div>
          {(data.topUnits || []).length ? data.topUnits.map((u, i) => (
            <RankRow key={u.unit_code || i} i={i + 1} name={unitText(u.unit_code, u.unit_name)} amount={u.revenue} max={maxUnit} />
          )) : <div className="center">Chưa có doanh thu kỳ này.</div>}
        </div>
      </div>
    </>
  );
}

export default function Target({ me, onNavigate }) {
  const [view, setView] = useState('now'); // now | forecast | admin | assignment | adjustment | mine
  const [periods, setPeriods] = useState([]);
  const [periodSel, setPeriodSel] = useState(null);
  const [adminKy, setAdminKy] = useState('');
  const [now, setNow] = useState(null);
  const [fc, setFc] = useState(null);
  const [empSel, setEmpSel] = useState(null);
  const [empData, setEmpData] = useState(null);
  const [notif, setNotif] = useState(null);
  const { reloadTick, reload } = useReloadTick();
  const openEmp = (emp) => { setEmpSel(emp); setEmpData(null); setView('employee'); };

  useEffect(() => {
    api.periods().then((p) => { setPeriods(p.periods || []); setPeriodSel(defaultPeriodSelection(p.periods || [], p.latest)); setAdminKy(p.latest || p.periods?.at(-1)?.ky || ''); });
  }, []);
  useEffect(() => {
    // Không để tab Target kẹt spinner nếu PeriodFilter hydrate chậm: backend tự dùng kỳ mới nhất.
    setNow(null);
    api.targets(periodSel ? periodParams(periodSel) : undefined).then(setNow);
  }, [periodSel, reloadTick]);
  useEffect(() => {
    // Perf/mobile: dự báo target khá nặng; chỉ tải khi người dùng mở tab Dự báo.
    if (view === 'forecast' && !fc) api.forecast().then(setFc);
  }, [view, reloadTick]);
  const selectedKy = (periodSel?.mode === 'range' ? periodSel.to : periodSel?.ky) || periods.at(-1)?.ky || now?.ky;
  const adminSelectedKy = adminKy || selectedKy;
  async function refreshTargetKpis() {
    if (!periodSel) return;
    setNow(await api.targets(periodParams(periodSel)));
  }
  useEffect(() => {
    if (view === 'employee' && empSel) api.employeeDetail(empSel, selectedKy).then(setEmpData).catch(() => setEmpData(null));
  }, [view, empSel, selectedKy, reloadTick]);
  useEffect(() => {
    if (view === 'notify') { setNotif(null); api.notificationsPreview(adminSelectedKy).then(setNotif).catch(() => setNotif({ events: [], ceoDigest: 'Không tải được bản xem trước.' })); }
  }, [view, adminSelectedKy, reloadTick]);

  return (
    <>
      <DrillNav crumbs={[{ label: 'Target' }, ...(view === 'employee' ? [{ label: 'Kỳ này' }, { label: empData?.emp?.name || empSel || 'NV' }] : view !== 'now' ? [{ label: view === 'forecast' ? 'Dự báo' : view === 'assignment' ? 'Phân công' : view === 'notify' ? 'Thông báo' : view === 'adjustment' ? 'Điều chỉnh' : view === 'mine' ? 'Tôi phụ trách' : 'Quản target' }] : [])]} onBack={view !== 'now' ? () => setView('now') : undefined} onCrumb={(i) => { if (i === 0) setView('now'); if (i === 1 && view === 'employee') setView('now'); }} onReload={reload} busy={!now && view === 'now'} />
      <div className="seg">
        <button className={view === 'now' ? 'active' : ''} onClick={() => setView('now')}>Kỳ này</button>
        <button className={view === 'forecast' ? 'active' : ''} onClick={() => setView('forecast')}>Dự báo{fc ? ` (${fc.next_ky})` : ''}</button>
        {me.isAdmin && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>Quản target</button>}
        {me.isAdmin && <button className={view === 'assignment' ? 'active' : ''} onClick={() => setView('assignment')}>Phân công</button>}
        {me.isAdmin && <button className={view === 'notify' ? 'active' : ''} onClick={() => setView('notify')}>🔔 Thông báo</button>}
        <button className={view === 'adjustment' ? 'active' : ''} onClick={() => setView('adjustment')}>Điều chỉnh</button>
        <button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>Tôi phụ trách</button>
      </div>
      {view === 'now' && periodSel && <PeriodFilter periods={periods} value={periodSel} onChange={setPeriodSel} />}
      {/* DIRECTIVE_LAYOUT_SMART: Quản target dùng kỳ compact trong toolbar, không phơi period card riêng để danh sách 21 NV lên ngay. */}

      {view === 'employee' ? (
        !empData ? <Spinner /> : <EmployeeDetail data={empData} />
      ) : view === 'notify' ? (
        !notif ? <Spinner /> : <NotifyPreview data={notif} ky={adminSelectedKy} />
      ) : view === 'now' ? (
        !now ? <Spinner /> : now.items.length === 0 ? <div className="center">Chưa có target.</div> : (
          <>
          <div className="section-title">Kỳ target: {periodLabel(periodSel)} · KPI so với target cả tháng</div>
          <TargetKpiStrip kpi={now.kpi} />
          <div className="kpi-grid">
            <Kpi label="Tổng đạt trước VAT" value={money(now.summary?.totalRevenueBeforeVat || 0)} sub={now.summary?.totalTarget > 0 ? `Target tháng ${money(now.summary.totalTarget)}` : 'Chưa giao target tổng'} />
            <Kpi label="% đạt target tháng" value={pct(now.summary?.pct)} sub={now.summary?.gap == null ? 'Chưa giao target' : (now.summary.gap >= 0 ? `Vượt ${money(now.summary.gap)}` : `Thiếu ${money(Math.abs(now.summary.gap))}`)} />
            <Kpi label="% đạt sau điều chỉnh" value={pct(now.summary?.pctAdjusted)} sub={(now.summary?.totalAdjustment || 0) > 0 ? `Giảm ${money(now.summary.totalAdjustment)} · ĐH ${money(now.summary.adjustmentByReason?.dut_hang || 0)} · CN ${money(now.summary.adjustmentByReason?.cong_no || 0)} · Khác ${money(now.summary.adjustmentByReason?.khac || 0)}` : 'Chưa có điều chỉnh đã duyệt'} />
            <Kpi label="NV có target" value={`${now.summary?.assignedCount || 0}/${now.summary?.totalEmployees || now.items.length}`} sub={(now.summary?.unassignedCount || 0) ? `${now.summary.unassignedCount} NV chưa giao target` : 'Đã giao đủ'} />
            <Kpi label="NV đạt target" value={`${now.summary?.achievedCount || 0}/${now.summary?.assignedCount || 0}`} sub={`Sau điều chỉnh: ${now.summary?.achievedAdjustedCount || 0}/${now.summary?.assignedCount || 0}`} />
          </div>
          <div className="list-grid">
            {now.items.map((t) => {
              const p = t.pct_original ?? t.pct;
              const pa = t.pct_adjusted;
              const cls = p == null ? 'ok' : p >= 100 ? 'ok' : p >= 80 ? 'warn' : 'bad';
              const assigned = t.target_assigned !== false && Number(t.target_full || t.target || 0) > 0;
              const pac = now.pacing || {};
              const daysLeft = Math.max(0, (pac.daysInMonth || 0) - (pac.daysElapsed || 0));
              const targetCmp = t.target_adjusted || t.target_full || t.target || 0;
              const short = assigned ? Math.max(0, targetCmp - (t.revenue_before_vat || 0)) : 0;
              const perDay = pac.isCurrent && daysLeft > 0 && short > 0 ? Math.round(short / daysLeft) : null;
              return (
                <div key={t.emp_code} className="card target-nv-card" style={{ padding: 12, cursor: 'pointer' }} onClick={() => openEmp(t.emp_code)} title="Bấm xem phân tích chi tiết NV này">
                  <div className="target-card-row">
                    <TargetGauge pct={p} size="small" />
                    <div className="target-card-body">
                      <div className="list-card-title"><div className="name">{t.emp_name || t.emp_code}</div><span className={'pill ' + (assigned ? cls : 'muted-pill')}>{assigned ? pct(p) : 'Chưa giao target'}</span></div>
                      <div className="meta muted mono">{t.emp_code} · {t.employee_type || '—'}</div>
                      {assigned && <Bar value={t.revenue_before_vat} max={t.target_adjusted || t.target_full || t.target} tone={pa != null && pa < 80 ? 'warn' : ''} />}
                      <div className="meta muted" style={{ marginTop: 5 }}>
                        Đạt {money(t.revenue_before_vat)} / target gốc {assigned ? money(t.target_full || t.target) : 'Chưa giao'}{assigned && <> · <span style={{ color: t.gap >= 0 ? 'var(--ok)' : 'var(--hi)' }}>{t.gap >= 0 ? 'vượt ' : 'thiếu '}{money(Math.abs(t.gap))}</span></>}
                      </div>
                      {assigned && <div className="meta muted" style={{ marginTop: 3 }}> % đạt gốc: <b>{pct(t.pct_original ?? t.pct)}</b> · % sau điều chỉnh: <b>{pct(t.pct_adjusted)}</b></div>}
                      {assigned && perDay != null && <div className="meta" style={{ marginTop: 3, color: 'var(--hi)' }}>⏱️ Còn thiếu {money(short)} · {daysLeft} ngày → cần ~<b>{money(perDay)}/ngày</b> để kịp</div>}
                      {assigned && perDay == null && short === 0 && pac.isCurrent && <div className="meta" style={{ marginTop: 3, color: 'var(--ok)' }}>✅ Đã đạt/vượt target</div>}
                      {assigned && (t.target_adjustment?.approved_total || 0) > 0 && <div className="meta muted" style={{ marginTop: 3 }}>Target sau điều chỉnh {money(t.target_adjusted)} · giảm {money(t.target_adjustment.approved_total)} (đứt hàng {money(t.target_adjustment.by_reason?.dut_hang || 0)}, công nợ {money(t.target_adjustment.by_reason?.cong_no || 0)}, khác {money(t.target_adjustment.by_reason?.khac || 0)})</div>}
                      <div className="meta muted" style={{ marginTop: 3 }}>{targetSourceText(t)}</div>
                      <div className="meta" style={{ marginTop: 4, color: 'var(--brand)', fontWeight: 600 }}>Xem phân tích chi tiết ›</div>
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
      ) : view === 'assignment' ? (
        <AssignmentAdminPanel ky={adminSelectedKy} />
      ) : view === 'adjustment' ? (
        <TargetAdjustmentPanel ky={selectedKy} isAdmin={me.isAdmin} onChanged={refreshTargetKpis} />
      ) : view === 'mine' ? (
        <MyAssignmentsView ky={selectedKy} />
      ) : <TargetAdminPanel ky={adminSelectedKy} onKyChange={setAdminKy} onTargetsChanged={refreshTargetKpis} />}
    </>
  );
}
