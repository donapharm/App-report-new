import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, downloadDormantReport } from '../api.js';
import { Pager, usePager } from '../components.jsx';

const REVIEW_LABEL = { unplanned: 'Chưa lập kế hoạch', in_progress: 'Đang triển khai', upcoming: 'Sắp đến hạn', due: 'Đến hạn', overdue: 'Quá hạn', completed: 'Đã hoàn tất' };
const TEMPLATE_LABEL = { standard: 'Chuẩn', ceo_meeting: 'Họp CEO', employee_work: 'Công việc cá nhân', personal_work: 'Công việc cá nhân' };
const REPORT_PAGE_SIZE = 50;
const fmt = (value, digits = 2) => value == null || value === '' ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits });
const dateVi = (value, withTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok', ...(withTime ? {} : { year: 'numeric', month: '2-digit', day: '2-digit' }) });
  return String(value);
};
const optionValue = (item, key) => typeof item === 'string' ? item : item?.[key] || item?.value || item?.key || '';
const optionLabel = (item, key, nameKey) => typeof item === 'string' ? item : item?.label && item?.key ? `${item.key} · ${item.label}` : item?.label || [item?.[key], item?.[nameKey]].filter(Boolean).join(' · ');
const rowsOf = (report) => report?.items || report?.rows || report?.report?.items || report?.report?.rows || [];
const summaryOf = (report) => report?.summary || report?.kpis || report?.report?.summary || report?.report?.kpis || {};

function Preview({ report, title = 'Báo cáo hiện tại', focusKey = '' }) {
  const rows = rowsOf(report);
  const summary = summaryOf(report);
  const reportCard = useRef(null);
  const pager = usePager(rows, REPORT_PAGE_SIZE, report);

  useEffect(() => {
    if (!focusKey) return;
    const focusIndex = rows.findIndex((row) => row.key === focusKey);
    if (focusIndex >= 0) pager.setPage(Math.floor(focusIndex / REPORT_PAGE_SIZE) + 1);
  }, [focusKey, rows, pager.setPage]);

  function changePage(nextPage) {
    pager.setPage(nextPage);
    window.requestAnimationFrame(() => reportCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  return <section className="dr-report-card">
    <div ref={reportCard} className="dr-report-anchor" />
    <div className="dr-section-head"><div><small>PREVIEW AN TOÀN</small><h2>{title}</h2></div><span>Dữ liệu đến {dateVi(report?.as_of || report?.data_date || report?.report?.as_of)}</span></div>
    <div className="dr-summary">
      <div><small>Tổng QLNB</small><b>{fmt(summary.total ?? summary.dormant_total ?? report?.total ?? rows.length, 0)}</b></div>
      <div><small>Chưa kế hoạch</small><b>{fmt(summary.unplanned ?? 0, 0)}</b></div>
      <div className="warn"><small>Đến hạn</small><b>{fmt(summary.due ?? summary.due_review ?? 0, 0)}</b></div>
      <div className="danger"><small>Quá hạn</small><b>{fmt(summary.overdue ?? summary.overdue_review ?? 0, 0)}</b></div>
    </div>
    {!rows.length ? <div className="dr-empty">Không có QLNB phù hợp bộ lọc.</div> : <div className="dr-report-list">
      <Pager className="dr-report-pager" page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={changePage} unit="QLNB" ariaLabel="Phân trang báo cáo QLNB phía trên" />
      <div className="dr-table-wrap"><table className="dr-table"><thead><tr><th className="dr-row-index">STT</th><th>Nhân viên</th><th>Đơn vị</th><th>QLNB / Sản phẩm</th><th>Ngày ngủ</th><th>CST còn</th><th>Review</th><th>Review lại</th><th>Chu kỳ</th></tr></thead><tbody>{pager.pageItems.map((row, index) => <tr className={focusKey && row.key === focusKey ? 'focused' : ''} key={row.key || row.id || pager.startIndex + index}>
      <td className="dr-row-index" data-label="Số thứ tự">{pager.startIndex + index + 1}</td>
      <td data-label="Nhân viên">{row.emp_code || '—'}{row.employee_name || row.emp_name ? <small>{row.employee_name || row.emp_name}</small> : null}</td>
      <td data-label="Đơn vị">{row.unit_code || '—'}{row.unit_name ? <small>{row.unit_name}</small> : null}</td>
      <td data-label="QLNB / Sản phẩm">{row.iit_code || '—'}{row.product_name ? <small>{row.product_name}</small> : null}</td>
      <td data-label="Số ngày ngủ">{fmt(row.days_idle, 0)}</td><td data-label="CST còn lại">{fmt(row.remain_qty)}</td><td data-label="Review"><span className={`dr-status ${row.review_status || ''}`}>{REVIEW_LABEL[row.review_status] || row.review_status || '—'}</span></td>
      <td data-label="Review lại">{dateVi(row.action?.next_follow_up || row.next_follow_up)}</td><td data-label="Chu kỳ xử lý">{fmt(row.action?.action_cycle ?? row.action?.cycle ?? row.action_cycle ?? 0, 0)}</td>
    </tr>)}</tbody></table></div>
      <Pager className="dr-report-pager" page={pager.page} totalPages={pager.totalPages} total={pager.total} onPage={changePage} unit="QLNB" ariaLabel="Phân trang báo cáo QLNB phía dưới" />
    </div>}
  </section>;
}

function FocusedItem({ detail, busy, isCeo, onClose, onReload }) {
  const [ackBusy, setAckBusy] = useState('');
  const [error, setError] = useState('');
  const item = detail?.item;
  async function acknowledge(feedbackId, kind) {
    if (ackBusy) return;
    setAckBusy(`${feedbackId}:${kind}`); setError('');
    try { await api.dormantFeedbackAck(feedbackId, { kind, request_id: `${kind}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}` }); await onReload(); }
    catch (e) { setError(e.message); }
    finally { setAckBusy(''); }
  }
  if (busy) return <section className="dr-focus-card loading">Đang mở đúng QLNB…</section>;
  if (!item) return null;
  return <section className="dr-focus-card" aria-label="QLNB được mở từ thông báo">
    <div className="dr-focus-head"><div><small>MỞ TỪ THÔNG BÁO</small><h2>{item.product_name || item.iit_code}</h2><code>{item.iit_code}</code></div><button type="button" onClick={onClose}>×</button></div>
    <div className="dr-focus-meta"><span><small>Nhân viên</small><b>{item.emp_code}</b></span><span><small>Đơn vị</small><b>{item.unit_code}</b><em>{item.unit_name}</em></span><span><small>Ngày ngủ</small><b>{fmt(item.days_idle, 0)}</b></span><span><small>Chu kỳ xử lý</small><b>{fmt(item.action?.action_cycle, 0)}</b></span></div>
    <p><b>Kế hoạch hiện tại:</b> {item.action?.status || 'Chưa lập kế hoạch'} · review lại {dateVi(item.action?.next_follow_up)}</p>
    {!!item.ceo_feedback?.length && <div className="dr-feedback-list"><h3>Phản hồi CEO</h3>{item.ceo_feedback.slice().reverse().map((feedback) => {
      const read = feedback.acknowledgements?.some((ack) => ack.kind === 'read' || ack.kind === 'updated');
      const updated = feedback.acknowledgements?.some((ack) => ack.kind === 'updated');
      return <article key={feedback.id}><div><b>{feedback.label}</b><time>{dateVi(feedback.created_at, true)}</time></div>{feedback.note && <p>{feedback.note}</p>}<small>Chu kỳ xử lý {feedback.action_cycle} · {updated ? 'Đã xác nhận cập nhật' : read ? 'Đã xác nhận đọc' : 'Chưa xác nhận'}</small>{!isCeo && <div className="dr-feedback-actions"><button type="button" disabled={read || !!ackBusy} onClick={() => acknowledge(feedback.id, 'read')}>{ackBusy === `${feedback.id}:read` ? 'Đang lưu…' : read ? '✓ Đã đọc' : 'Xác nhận đã đọc'}</button><button type="button" className="primary" disabled={updated || !!ackBusy} onClick={() => acknowledge(feedback.id, 'updated')}>{ackBusy === `${feedback.id}:updated` ? 'Đang lưu…' : updated ? '✓ Đã cập nhật' : 'Xác nhận đã cập nhật'}</button></div>}</article>;
    })}</div>}
    {!item.ceo_feedback?.length && <div className="dr-empty">QLNB này chưa có phản hồi CEO.</div>}
    {error && <div className="dormant-error">{error}</div>}
  </section>;
}

export default function DormantReports({ me }) {
  const isCeo = String(me?.role || '').toLowerCase() === 'ceo' || String(me?.emp_code || '').toUpperCase() === 'CEO';
  const templates = isCeo ? [['standard', 'Chuẩn'], ['ceo_meeting', 'Họp CEO']] : [['standard', 'Chuẩn'], ['employee_work', 'Công việc cá nhân']];
  const [filters, setFilters] = useState({ emp_code: '', unit_code: '', review_status: '', q: '', template: 'standard' });
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [error, setError] = useState('');
  const [focusKey, setFocusKey] = useState('');
  const [focusDetail, setFocusDetail] = useState(null);
  const [focusBusy, setFocusBusy] = useState(false);
  const reportRequest = useRef(0);
  const snapshotRequest = useRef(0);
  const focusRequest = useRef(0);

  const employeeOptions = report?.filters?.employees || report?.employees || report?.top_employees || [];
  const unitOptions = report?.filters?.units || report?.units || report?.top_units || [];
  const queryParams = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && (isCeo || key !== 'emp_code'))), [filters, isCeo]);

  useEffect(() => {
    const apply = (payload) => {
      if (payload?.tab !== 'dormantReports' || !payload?.focus_key) return;
      setFocusKey(String(payload.focus_key));
      if (payload.unit_code) setFilters((old) => ({ ...old, unit_code: String(payload.unit_code) }));
    };
    try { apply(JSON.parse(sessionStorage.getItem('app_nav_payload') || 'null')); } catch { /* ignore */ }
    const listener = (event) => apply(event.detail);
    window.addEventListener('app:navigate', listener);
    return () => window.removeEventListener('app:navigate', listener);
  }, []);
  async function loadFocus(key = focusKey) {
    const requestId = ++focusRequest.current;
    if (!key) { setFocusDetail(null); setFocusBusy(false); return; }
    setFocusBusy(true);
    try {
      const result = await api.dormantItemDetail(key);
      if (requestId !== focusRequest.current) return;
      setFocusDetail(result);
      if (result?.item) setFilters((old) => ({ ...old, unit_code: result.item.unit_code || old.unit_code, q: result.item.iit_code || old.q }));
    } catch (e) {
      if (requestId === focusRequest.current) { setError(e.message); setFocusDetail(null); }
    } finally {
      if (requestId === focusRequest.current) setFocusBusy(false);
    }
  }
  function clearFocus() {
    focusRequest.current += 1;
    setFocusKey(''); setFocusDetail(null); setFocusBusy(false);
    try {
      sessionStorage.removeItem('app_nav_payload');
      const url = new URL(window.location.href);
      url.searchParams.delete('focus_key'); url.searchParams.delete('unit_code');
      window.history.replaceState(window.history.state, '', url);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadFocus(focusKey); }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHistory() {
    try { const result = await api.dormantReportSnapshots(); setHistory(result?.snapshots || result?.items || result || []); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const requestId = ++reportRequest.current;
    const timer = window.setTimeout(() => {
      setBusy(true); setError(''); setSelectedSnapshot(null);
      api.dormantReportCurrent(queryParams).then((result) => { if (requestId === reportRequest.current) setReport(result); }).catch((e) => { if (requestId === reportRequest.current) setError(e.message); }).finally(() => { if (requestId === reportRequest.current) setBusy(false); });
    }, filters.q ? 280 : 0);
    return () => { window.clearTimeout(timer); reportRequest.current += 1; };
  }, [queryParams]);

  function setFilter(key, value) { setFilters((old) => ({ ...old, [key]: value })); }
  async function saveSnapshot() {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const result = await api.dormantReportSnapshotCreate({ ...queryParams, template: filters.template });
      const snapshot = result?.snapshot || result;
      await loadHistory();
      if (snapshot?.id) await selectSnapshot(snapshot.id);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function selectSnapshot(id) {
    if (!id) { snapshotRequest.current += 1; setSelectedSnapshot(null); return; }
    const requestId = ++snapshotRequest.current;
    setError('');
    try { const result = await api.dormantReportSnapshot(id); if (requestId === snapshotRequest.current) setSelectedSnapshot(result?.snapshot || result); }
    catch (e) { if (requestId === snapshotRequest.current) setError(e.message); }
  }
  async function download(format) {
    const id = selectedSnapshot?.id;
    if (!id || downloading) return;
    setDownloading(format); setError('');
    try { await downloadDormantReport(format, id); } catch (e) { setError(e.message); }
    finally { setDownloading(''); }
  }

  return <div className="dr-page">
    <section className="dr-hero"><div><span>📑 BÁO CÁO QLNB</span><h1>Theo dõi kế hoạch QLNB ngủ đông</h1><p>{isCeo ? 'CEO xem dữ liệu đúng phạm vi quản trị và lưu ảnh chụp bất biến cho từng cuộc họp.' : 'Báo cáo chỉ hiển thị chính xác phạm vi QLNB Anh/Chị được phân công.'}</p></div><div className="dr-safety">🔒 Không hiển thị tiền, giá vốn, chi phí hoặc trường nhạy cảm. Trang này không có chức năng gửi ra ngoài.</div></section>
    <section className="dr-filters" aria-label="Bộ lọc báo cáo QLNB">
      {isCeo && <label><span>Nhân viên</span><select value={filters.emp_code} onChange={(e) => setFilter('emp_code', e.target.value)}><option value="">Tất cả nhân viên</option>{employeeOptions.map((item) => { const value = optionValue(item, 'emp_code'); return <option key={value} value={value}>{optionLabel(item, 'emp_code', 'employee_name')}</option>; })}</select></label>}
      <label><span>Đơn vị</span><select value={filters.unit_code} onChange={(e) => setFilter('unit_code', e.target.value)}><option value="">Tất cả đơn vị trong phạm vi</option>{unitOptions.map((item) => { const value = optionValue(item, 'unit_code'); return <option key={value} value={value}>{optionLabel(item, 'unit_code', 'unit_name')}</option>; })}</select></label>
      <label><span>Trạng thái review</span><select value={filters.review_status} onChange={(e) => setFilter('review_status', e.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(REVIEW_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Tìm QLNB / sản phẩm / đơn vị</span><input value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Nhập từ khóa…" /></label>
      <label><span>Mẫu báo cáo</span><select value={filters.template} onChange={(e) => setFilter('template', e.target.value)}>{templates.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </section>
    {error && <div className="dormant-error">{error}</div>}
    <FocusedItem detail={focusDetail} busy={focusBusy} isCeo={isCeo} onReload={() => loadFocus(focusKey)} onClose={clearFocus} />
    {busy ? <div className="dr-loading">Đang dựng báo cáo đúng phạm vi…</div> : <Preview report={report} focusKey={focusKey} />}
    <section className="dr-snapshot-tools"><div><h2>Ảnh chụp báo cáo</h2><p>Lưu trạng thái hiện tại trước khi xuất file. File xuất luôn bám theo ảnh chụp đã chọn.</p></div><button type="button" className="btn" disabled={saving || busy} onClick={saveSnapshot}>{saving ? 'Đang lưu…' : '＋ Lưu ảnh chụp'}</button></section>
    <section className="dr-history"><label><span>Lịch sử ảnh chụp</span><select value={selectedSnapshot?.id || ''} onChange={(e) => selectSnapshot(e.target.value)}><option value="">Chọn ảnh chụp để xem / xuất file</option>{history.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{dateVi(snapshot.created_at || snapshot.at, true)} · {TEMPLATE_LABEL[snapshot.template] || snapshot.template || 'Chuẩn'} · {snapshot.created_by || snapshot.emp_code || '—'}</option>)}</select></label><div className="dr-export"><button type="button" disabled={!selectedSnapshot?.id || !!downloading} onClick={() => download('xlsx')}>{downloading === 'xlsx' ? 'Đang xuất…' : '⬇ Excel'}</button><button type="button" disabled={!selectedSnapshot?.id || !!downloading} onClick={() => download('pdf')}>{downloading === 'pdf' ? 'Đang xuất…' : '⬇ PDF'}</button></div></section>
    {selectedSnapshot && <Preview report={selectedSnapshot} title={`Ảnh chụp #${selectedSnapshot.id}`} />}
  </div>;
}
