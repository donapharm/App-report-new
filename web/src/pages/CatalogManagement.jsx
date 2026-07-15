import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Spinner } from '../components.jsx';

const TYPE_LABELS = { unit_qlnb: 'Đơn vị + Mã QLNB', unit: 'Đơn vị', group: 'Nhóm ưu tiên', route: 'Tuyến', iit: 'Mã QLNB', special: 'Hàng cần đẩy', all: 'Toàn bộ' };
const uiToHub = (ky) => { const m = String(ky || '').match(/^(\d{2})\.(\d{4})$/); return m ? `${m[2]}-${m[1]}` : ky; };
const hubToUi = (period) => { const m = String(period || '').match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}.${m[1]}` : period; };
const currentKy = () => `${String(new Date().getMonth() + 1).padStart(2, '0')}.${new Date().getFullYear()}`;
const typeLabel = (type) => TYPE_LABELS[type] || type || 'Danh mục';
const sourceLabel = (source) => ({ 'data-hub': 'Data Hub', 'data-hub-lkg': 'Data Hub · bản tốt gần nhất' }[source] || source || '—');
const dateText = (iso) => iso ? new Date(iso).toLocaleString('vi-VN') : 'Chưa đồng bộ';
const moneyText = (value) => {
  if (value == null || value === '') return '—';
  const amount = Number(String(value).replace(/[,\s]/g, ''));
  return Number.isFinite(amount) ? `${amount.toLocaleString('vi-VN')} đ` : String(value);
};
const quantityText = (value) => {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : String(value);
};
const activeInPeriod = (row, period) => row?.active !== false && row?.effective_from <= period && (!row?.effective_to || row.effective_to >= period);
const routeOf = (row) => String(row?.route || '').trim().toUpperCase();
const ROUTES = ['CL', 'NCL', 'NT'];
const PAGE_SIZE = 200;

function SourceStatus({ meta }) {
  if (!meta) return null;
  return <div className={`catalog-source-inline ${meta.stale ? 'is-stale' : 'is-fresh'}`} title={`Đồng bộ ${dateText(meta.lastSyncAt || meta.updatedAt)} · Version ${meta.version || '—'}`}>
    <i aria-hidden="true" /><div><b>{sourceLabel(meta.source)}</b><small>{meta.readOnly ? 'Chỉ đọc' : 'Đã kết nối'}</small></div>
  </div>;
}

function EmployeeSections({ data }) {
  const sections = [
    ['Tôi phụ trách', data?.sections?.current || [], 'current'],
    ['Sắp kết thúc', data?.sections?.ending || [], 'ending'],
    ['Sắp bắt đầu', data?.sections?.starting || [], 'starting'],
  ];
  return <>
    <div className="card catalog-help"><b>Mục đích</b><p>Xem các cặp đơn vị – mã QLNB Anh/Chị đang phụ trách trong kỳ. Dữ liệu chỉ hiển thị phạm vi của chính Anh/Chị.</p></div>
    <div className="card"><b>{data?.employee?.name || data?.employee?.code}</b><div className="meta muted">Kỳ {data?.period_ui || hubToUi(data?.period)}</div></div>
    <div className="catalog-section-grid">{sections.map(([title, rows, kind]) => <section className="card" key={kind}>
      <div className="catalog-card-head"><h3>{title}</h3><span className={`pill catalog-${kind}`}>{rows.length}</span></div>
      {rows.length === 0 ? <div className="muted catalog-empty">Chưa có mục trong kỳ đã chọn.</div> : <div className="catalog-item-list">{rows.map((row) => <div className="catalog-item" key={`${kind}-${row.id}`}>
        <b>{row.label}</b><span>{typeLabel(row.type)}</span><small>Hiệu lực {hubToUi(row.effective_from)}{row.effective_to ? ` – ${hubToUi(row.effective_to)}` : ''}</small>
      </div>)}</div>}
    </section>)}</div>
  </>;
}

function Pager({ page, pageCount, total, onPage, location }) {
  if (pageCount <= 1) return null;
  return <div className={`catalog-pager ${location === 'top' ? 'is-top' : 'is-bottom'}`}>
    <button className="btn ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Trước</button>
    <span><b>Trang {page.toLocaleString('vi-VN')} / {pageCount.toLocaleString('vi-VN')}</b><small>{total.toLocaleString('vi-VN')} kết quả</small></span>
    <button className="btn ghost" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Sau →</button>
  </div>;
}

function TransferPanel({ period, rows, meta, onDone }) {
  const [form, setForm] = useState({ from_emp_code: '', to_emp_code: '', type: 'unit_qlnb', values: [], effective_period: period, note: '' });
  const [pickQuery, setPickQuery] = useState('');
  const [route, setRoute] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const employees = useMemo(() => [...new Set(rows.map((r) => r.emp_code).filter(Boolean))].sort(), [rows]);
  useEffect(() => { setForm((x) => ({ ...x, effective_period: period, values: [] })); setPreview(null); }, [period]);
  const set = (key, value) => { setForm((x) => ({ ...x, [key]: value })); setPreview(null); setMessage(''); setError(''); };
  const candidates = useMemo(() => rows.filter((row) => row.type === 'unit_qlnb' && (!form.from_emp_code || row.emp_code === form.from_emp_code)), [rows, form.from_emp_code]);
  const pickRows = useMemo(() => candidates.filter((row) => (!route || routeOf(row) === route) && (!pickQuery || `${row.label} ${row.value} ${row.unit_code} ${row.qlnb_code}`.toLowerCase().includes(pickQuery.toLowerCase()))).slice(0, 300), [candidates, route, pickQuery]);
  const toggleValue = (value) => set('values', form.values.includes(value) ? form.values.filter((x) => x !== value) : [...form.values, value]);
  function makePreview() {
    if (!form.from_emp_code) return setError('Bước 1: chọn nhân viên hiện tại.');
    if (!form.values.length) return setError('Bước 1: chọn ít nhất một cặp đơn vị – mã QLNB.');
    if (!form.to_emp_code) return setError('Bước 2: chọn nhân viên mới.');
    if (form.from_emp_code === form.to_emp_code) return setError('Nhân viên hiện tại và nhân viên mới phải khác nhau.');
    const selected = rows.filter((row) => row.emp_code === form.from_emp_code && row.type === 'unit_qlnb' && form.values.includes(row.value));
    if (selected.length !== form.values.length) return setError('Có mục quản lý không còn thuộc nhân viên hiện tại trong dữ liệu đang xem.');
    setError(''); setPreview({ before: selected, after_emp: form.to_emp_code, effective_from: form.effective_period });
  }
  async function submit() {
    if (!preview) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.adminCatalogManagementTransfer({ ...form, period: form.effective_period });
      setMessage('Data Hub đã ghi nhận điều chuyển.'); setPreview(null); setForm((x) => ({ ...x, values: [] })); await onDone?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return <div className="catalog-transfer-flow">
    <section className="card catalog-step">
      <div className="catalog-step-title"><span>1</span><div><h3>Chọn phạm vi đang phụ trách</h3><p>Chọn nhân viên hiện tại, sau đó đánh dấu các cặp đơn vị – mã QLNB cần chuyển.</p></div></div>
      <div className="filter-grid catalog-transfer-filters">
        <label><span>Nhân viên hiện tại</span><select value={form.from_emp_code} onChange={(e) => { set('from_emp_code', e.target.value); setForm((x) => ({ ...x, from_emp_code: e.target.value, values: [] })); }}><option value="">Chọn mã NV</option>{employees.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Tuyến</span><select value={route} onChange={(e) => setRoute(e.target.value)}><option value="">Tất cả CL/NCL/NT</option>{ROUTES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Tìm đơn vị hoặc QLNB</span><input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="Nhập tên/mã cần tìm" /></label>
      </div>
      {!form.from_emp_code ? <div className="catalog-callout">Hãy chọn nhân viên hiện tại để xem danh sách phụ trách.</div> : <div className="catalog-picker">
        <div className="catalog-picker-head"><b>{pickRows.length.toLocaleString('vi-VN')} kết quả đang hiển thị</b><div><button className="btn ghost" type="button" onClick={() => set('values', [...new Set([...form.values, ...pickRows.map((r) => r.value)])])}>Chọn tất cả đang lọc</button><button className="btn ghost" type="button" onClick={() => set('values', [])}>Bỏ chọn</button></div></div>
        <div className="catalog-pick-list">{pickRows.map((row) => <label key={row.id} className={form.values.includes(row.value) ? 'selected' : ''}><input type="checkbox" checked={form.values.includes(row.value)} onChange={() => toggleValue(row.value)} /><span><b>{routeOf(row)}</b> · {row.label}</span></label>)}</div>
        <div className="catalog-selected-count">Đã chọn <b>{form.values.length.toLocaleString('vi-VN')}</b> cặp đơn vị – QLNB</div>
      </div>}
    </section>

    <section className="card catalog-step">
      <div className="catalog-step-title"><span>2</span><div><h3>Chọn người nhận và kỳ hiệu lực</h3><p>Nhân viên chỉ thấy phạm vi của mình; không thấy danh tính người giao/nhận đối ứng.</p></div></div>
      <div className="filter-grid catalog-transfer-filters">
        <label><span>Nhân viên mới</span><select value={form.to_emp_code} onChange={(e) => set('to_emp_code', e.target.value)}><option value="">Chọn mã NV</option>{employees.filter((x) => x !== form.from_emp_code).map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Kỳ bắt đầu (MM.YYYY)</span><input value={hubToUi(form.effective_period)} onChange={(e) => set('effective_period', uiToHub(e.target.value))} placeholder="08.2026" /></label>
        <label><span>Lý do nội bộ</span><input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Chỉ CEO/admin nhìn thấy" /></label>
      </div>
    </section>

    <section className="card catalog-step">
      <div className="catalog-step-title"><span>3</span><div><h3>Kiểm tra và phê duyệt</h3><p>Chưa ghi dữ liệu cho đến khi bấm Xem trước rồi chọn ✅ Duyệt.</p></div></div>
      <button className="btn" disabled={busy} onClick={makePreview}>Xem trước điều chuyển</button>
      {preview && <div className="catalog-preview">
        <div><small>Phạm vi hiện tại</small><b>{form.from_emp_code} · {preview.before.length} cặp</b><span>{preview.before.slice(0, 3).map((x) => x.label).join(' | ')}{preview.before.length > 3 ? ` · +${preview.before.length - 3} cặp` : ''}</span></div>
        <div className="catalog-preview-arrow">→</div>
        <div><small>Hiệu lực mới</small><b>{preview.after_emp} · {preview.before.length} cặp</b><span>Từ kỳ {hubToUi(preview.effective_from)}</span></div>
        <p>⚠ Kiểm tra đúng nhân viên, phạm vi và kỳ trước khi duyệt.</p>
        <div className="catalog-approval-actions" aria-label="Phê duyệt điều chuyển">
          <button className="btn" disabled={busy || meta?.readOnly} onClick={submit}>{busy ? 'Đang gửi…' : '✅ Duyệt'}</button>
          <button className="btn ghost" disabled={busy} onClick={() => { setPreview(null); setMessage('Đã dừng, không gửi Data Hub.'); }}>❌ Không duyệt</button>
          <button className="btn ghost" disabled={busy} onClick={() => { setPreview(null); setMessage('Hãy cập nhật phần lựa chọn hoặc lý do rồi xem trước lại.'); }}>📝 Ý kiến khác</button>
        </div>
        {meta?.readOnly && <div className="meta muted">Nguồn hiện ở chế độ chỉ đọc nên không thể gửi điều chuyển.</div>}
      </div>}
      {error && <div className="catalog-alert error">⚠ {error}</div>}{message && <div className="catalog-alert success">✓ {message}</div>}
    </section>
  </div>;
}

function AdminView({ data, period, onReload, history, diagnostics }) {
  const [mode, setMode] = useState('view');
  const [query, setQuery] = useState('');
  const [emp, setEmp] = useState('');
  const [route, setRoute] = useState('');
  const [unit, setUnit] = useState('');
  const [page, setPage] = useState(1);
  const currentRows = useMemo(() => (data?.rows || []).filter((row) => activeInPeriod(row, period)), [data, period]);
  const routeOptions = useMemo(() => [...new Set(currentRows.filter((row) => !emp || row.emp_code === emp).map(routeOf).filter(Boolean))].sort(), [currentRows, emp]);
  const unitOptions = useMemo(() => [...new Set(currentRows.filter((row) => (!emp || row.emp_code === emp) && (!route || routeOf(row) === route)).map((row) => row.unit_code).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [currentRows, emp, route]);
  const rows = useMemo(() => currentRows.filter((row) => {
    const text = `${row.emp_code} ${row.emp_name} ${row.type} ${row.value} ${row.label} ${row.product_name || ''} ${row.active_ingredient || ''} ${row.strength || ''} ${row.uom || ''}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (!emp || row.emp_code === emp) && (!route || routeOf(row) === route) && (!unit || row.unit_code === unit);
  }), [currentRows, query, emp, route, unit]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [period, query, emp, route, unit]);
  const goPage = (next) => { setPage(Math.max(1, Math.min(pageCount, next))); requestAnimationFrame(() => document.getElementById('catalog-table-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  return <>
    <details className="card catalog-help-compact">
      <summary>❓ Hướng dẫn sử dụng</summary>
      <div><p>Màn hình quản lý theo từng tháng: nhân viên nào đang phụ trách từng cặp <b>đơn vị + mã QLNB</b>.</p><ol><li>Chọn kỳ</li><li>Chọn tuyến/NV hoặc nhập mã cần tìm</li><li>Nếu cần, mở tab Điều chuyển nhân viên</li></ol></div>
    </details>
    <div className="catalog-mode-tabs" role="tablist" aria-label="Chức năng danh mục quản lý">
      <button role="tab" aria-selected={mode === 'view'} className={mode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>🔎 Xem phân công</button>
      <button role="tab" aria-selected={mode === 'transfer'} className={mode === 'transfer' ? 'active' : ''} onClick={() => setMode('transfer')}>⇄ Điều chuyển nhân viên</button>
    </div>

    {mode === 'view' ? <>
      <div className="card catalog-controls-compact">
        <div className="catalog-filter-row">
          <label><span>Tìm NV, đơn vị, QLNB hoặc tên thuốc</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nhập tên hoặc mã cần tìm…" /></label>
          <label><span>Nhân viên</span><select value={emp} onChange={(e) => { setEmp(e.target.value); setRoute(''); setUnit(''); }}><option value="">Tất cả nhân viên</option>{[...new Set(currentRows.map((r) => r.emp_code).filter(Boolean))].sort().map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Tuyến</span><select value={route} onChange={(e) => { setRoute(e.target.value); setUnit(''); }}><option value="">Tất cả tuyến</option>{routeOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Đơn vị</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Tất cả đơn vị</option>{unitOptions.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <div className="catalog-result-count"><span>Kết quả</span><b>{rows.length.toLocaleString('vi-VN')} cặp</b></div>
        </div>
      </div>
      <div id="catalog-table-top" className="card table-card catalog-table-card">
        <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} location="top" />
        <div className="table-scroll"><table className="catalog-table catalog-table-simple catalog-table-products"><thead><tr><th>Nhân viên</th><th>Tuyến</th><th>Mã đơn vị</th><th>Mã QLNB</th><th>Tên thuốc</th><th>Hoạt chất + Hàm lượng</th><th>ĐVT</th><th className="catalog-money">Đơn giá trúng thầu</th><th className="catalog-money">CST ban đầu</th><th className="catalog-money">CST còn lại</th><th>Từ kỳ</th><th>Đến kỳ</th></tr></thead><tbody>{visibleRows.map((r) => { const pct = Number(r.cst_initial) > 0 && r.cst_remaining != null ? (Number(r.cst_remaining) / Number(r.cst_initial)) * 100 : null; const pctClass = pct == null ? '' : pct <= 10 ? ' is-low' : pct <= 30 ? ' is-warning' : ' is-ok'; return <tr key={r.id}><td><b>{r.emp_code}</b><small>{r.emp_name}</small></td><td><b>{routeOf(r) || '—'}</b></td><td>{r.unit_code || '—'}</td><td><b>{r.qlnb_code || '—'}</b></td><td><span className="catalog-two-lines" title={r.product_name || ''}>{r.product_name || '—'}</span></td><td><span className="catalog-two-lines" title={[r.active_ingredient, r.strength].filter(Boolean).join(' · ')}>{[r.active_ingredient, r.strength].filter(Boolean).join(' · ') || '—'}</span></td><td>{r.uom || '—'}</td><td className="catalog-money"><b>{moneyText(r.bid_price)}</b></td><td className="catalog-money">{quantityText(r.cst_initial)}</td><td className={`catalog-money catalog-cst${pctClass}`}><b>{quantityText(r.cst_remaining)}</b>{pct != null && <small>{pct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</small>}</td><td>{hubToUi(r.effective_from)}</td><td>{r.effective_to ? hubToUi(r.effective_to) : <span className="catalog-active-label">Đang phụ trách</span>}</td></tr>; })}</tbody></table></div>
        <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} location="bottom" />
      </div>
    </> : <TransferPanel period={period} rows={currentRows} meta={data?.meta} onDone={onReload} />}

    <details className="card catalog-advanced">
      <summary>Quản trị nâng cao: lịch sử và trạng thái hệ thống</summary>
      <div className="catalog-admin-bottom">
        <section><div className="catalog-card-head"><h3>Lịch sử CEO</h3><span>{history.length}</span></div>{history.length ? history.slice(0, 30).map((x, i) => { const items = x.items || []; const relation = items.slice(0, 3).map((it) => `${it.scope}:${it.code} · ${it.from_emp || 'Chưa gán'} → ${it.to_emp || x.to_emp || '—'}`).join(' | '); return <div className="catalog-history" key={x.id || i}><div><b>{x.action || x.event || 'Thay đổi'}</b>{relation && <small>{relation}{items.length > 3 ? ` · +${items.length - 3} mã` : ''}</small>}</div><span>{x.actor || x.by || '—'} · {dateText(x.at || x.updatedAt)}</span></div>; }) : <div className="muted catalog-empty">Chưa có lịch sử từ nguồn hiện tại.</div>}</section>
        <section><div className="catalog-card-head"><h3>Trạng thái kỹ thuật</h3></div><dl className="catalog-diag"><dt>Đã cấu hình</dt><dd>{diagnostics?.configured ? 'Có' : 'Chưa'}</dd><dt>Timeout</dt><dd>{diagnostics?.timeoutMs || '—'} ms</dd><dt>LKG cache</dt><dd>{diagnostics?.cache?.available ? 'Có' : 'Chưa'}</dd><dt>Giai đoạn</dt><dd>Đợt 1</dd></dl></section>
      </div>
    </details>
  </>;
}

export default function CatalogManagement({ me }) {
  const [period, setPeriod] = useState(currentKy());
  const [periods, setPeriods] = useState([]);
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [error, setError] = useState('');
  const isAdmin = !!me?.isAdmin;
  async function load(selected = period) {
    setError(''); setData(null);
    try {
      const p = uiToHub(selected); const result = await api.catalogManagement(p); setData(result);
      if (isAdmin) {
        const [h, d] = await Promise.allSettled([api.adminCatalogManagementHistory(p), api.adminCatalogManagementDiagnostics()]);
        setHistory(h.status === 'fulfilled' ? (h.value.history || []) : []); setDiagnostics(d.status === 'fulfilled' ? d.value : null);
      }
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { api.periods().then((p) => { const list = (p.periods || p || []).map((x) => x.ky || x).filter((x) => /^\d{2}\.\d{4}$/.test(x)); setPeriods(list); if (list.length && !list.includes(period)) setPeriod(list.at(-1)); }).catch(() => {}); }, []);
  useEffect(() => { load(period); }, [period, isAdmin]);
  return <div className="catalog-management">
    <div className="card catalog-heading catalog-heading-compact">
      <div><div className="section-head">🗂️ Phân công danh mục bán hàng</div><div className="meta muted">Theo cặp đơn vị + mã QLNB và từng kỳ</div></div>
      <div className="catalog-heading-actions">{data?.meta && <SourceStatus meta={data.meta} />}<label><span>Kỳ</span><select value={period} onChange={(e) => setPeriod(e.target.value)}>{(periods.length ? periods : [period]).map((x) => <option key={x}>{x}</option>)}</select></label></div>
    </div>
    {error && <div className="card catalog-alert error">⚠ {error}</div>}
    {!data && !error ? <Spinner /> : data && (isAdmin ? <AdminView data={data} period={uiToHub(period)} history={history} diagnostics={diagnostics} onReload={() => load(period)} /> : <EmployeeSections data={data} />)}
  </div>;
}
