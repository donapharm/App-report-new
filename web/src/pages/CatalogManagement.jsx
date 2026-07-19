import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDonaTableCellTools } from '@donapharm/dona-table-cell-tools/react';
import '@donapharm/dona-table-cell-tools/css';
import { api, downloadFilteredEmployeeReport, downloadFilteredEmployeeSummary } from '../api.js';
import { Spinner } from '../components.jsx';

const uiToHub = (ky) => { const m = String(ky || '').match(/^(\d{2})\.(\d{4})$/); return m ? `${m[2]}-${m[1]}` : ky; };
const hubToUi = (period) => { const m = String(period || '').match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}.${m[1]}` : period; };
const currentKy = () => `${String(new Date().getMonth() + 1).padStart(2, '0')}.${new Date().getFullYear()}`;
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
const provinceOf = (row) => String(row?.province || '').trim();
const normalizeSearch = (value) => String(value || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const editDistanceWithin = (a, b, limit) => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
};
const smartTokenMatch = (queryToken, candidateToken) => {
  if (queryToken === candidateToken || (queryToken.length >= 2 && candidateToken.includes(queryToken))) return true;
  if (!/^[a-z]+$/.test(queryToken) || !/^[a-z]+$/.test(candidateToken)) return false;
  const limit = queryToken.length >= 8 ? 2 : queryToken.length >= 4 ? 1 : 0;
  return limit > 0 && editDistanceWithin(queryToken, candidateToken, limit) <= limit;
};
const catalogSearchText = (row) => [row.emp_code, row.emp_name, row.type, row.value, row.label, row.province, row.route, row.contractor_code, row.unit_code, row.qlnb_code, row.product_name, row.active_ingredient, row.strength, row.uom].filter(Boolean).join(' ');
const matchesSmartSearch = (row, query) => {
  const q = normalizeSearch(query); if (!q) return true;
  const haystack = normalizeSearch(catalogSearchText(row));
  if (haystack.includes(q)) return true;
  const candidates = haystack.split(' ');
  return q.split(' ').every((token) => candidates.some((candidate) => smartTokenMatch(token, candidate)));
};
const drugNameKey = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
const drugQlnbCounts = (rows) => {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = drugNameKey(row.product_name);
    const qlnb = String(row.qlnb_code || '').trim();
    if (!key || !qlnb) continue;
    if (!grouped.has(key)) grouped.set(key, new Set());
    grouped.get(key).add(qlnb);
  }
  return new Map([...grouped].map(([key, codes]) => [key, codes.size]));
};
const ROUTES = ['CL', 'NCL', 'NT'];
const PAGE_SIZE = 200;

function CatalogTableCard({ id, tableId, children }) {
  const { rootRef } = useDonaTableCellTools({
    appId: 'app-report',
    tableId,
    cellSelector: 'td[data-full-value]'
  });
  return <div ref={rootRef} id={id} className="card table-card catalog-table-card" data-app-id="app-report" data-table-id={tableId}>{children}</div>;
}

function PreviewCell({ value, children, className }) {
  const visibleValue = String(value ?? '');
  return <td className={className} data-full-value={visibleValue}><span className="dona-cell-value">{children ?? visibleValue}</span></td>;
}

function DrugName({ row, counts }) {
  const name = row.product_name || '—';
  const count = counts.get(drugNameKey(row.product_name)) || 0;
  const needsAttention = count > 1;
  const title = needsAttention ? `${name} · Tên thuốc này có ${count} mã QLNB trong kỳ đang xem` : name;
  return <b className={`catalog-two-lines${needsAttention ? ' catalog-drug-multi-qlnb' : ''}`} title={title}>{name}</b>;
}

function SourceStatus({ meta }) {
  if (!meta) return null;
  return <div className={`catalog-source-inline ${meta.stale ? 'is-stale' : 'is-fresh'}`} title={`Đồng bộ ${dateText(meta.lastSyncAt || meta.updatedAt)} · Version ${meta.version || '—'}`}>
    <i aria-hidden="true" /><div><b>{sourceLabel(meta.source)}</b><small>{meta.readOnly ? 'Chỉ đọc' : 'Đã kết nối'}</small></div>
  </div>;
}

function CatalogSearch({ value, onChange, employee = false }) {
  return <label className="catalog-search-label"><span>{employee ? 'Tìm thông minh trong danh mục của tôi' : 'Tìm thông minh toàn danh mục'}</span><div className="catalog-search-wrap"><input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Tên thuốc, QLNB, đơn vị, nhà thầu…" aria-label="Tìm kiếm thông minh danh mục" />{value && <button type="button" onClick={() => onChange('')} aria-label="Xóa nội dung tìm kiếm" title="Xóa tìm kiếm">×</button>}</div></label>;
}

function EmployeeSections({ data }) {
  const [query, setQuery] = useState('');
  const [province, setProvince] = useState('');
  const [route, setRoute] = useState('');
  const [unit, setUnit] = useState('');
  const [page, setPage] = useState(1);
  const currentRows = useMemo(() => data?.sections?.current || [], [data]);
  const qlnbCounts = useMemo(() => drugQlnbCounts(currentRows), [currentRows]);
  const provinceOptions = useMemo(() => [...new Set(currentRows.map(provinceOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [currentRows]);
  const routeOptions = useMemo(() => [...new Set(currentRows.filter((row) => !province || provinceOf(row) === province).map(routeOf).filter(Boolean))].sort(), [currentRows, province]);
  const unitOptions = useMemo(() => [...new Set(currentRows.filter((row) => (!province || provinceOf(row) === province) && (!route || routeOf(row) === route)).map((row) => row.unit_code).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [currentRows, province, route]);
  const rows = useMemo(() => currentRows.filter((row) => {
    return matchesSmartSearch(row, query) && (!province || provinceOf(row) === province) && (!route || routeOf(row) === route) && (!unit || row.unit_code === unit);
  }), [currentRows, query, province, route, unit]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, province, route, unit, data?.period]);
  const goPage = (next) => { setPage(Math.max(1, Math.min(pageCount, next))); requestAnimationFrame(() => document.getElementById('employee-catalog-table-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  return <>
    <div className="card catalog-help"><b>Danh mục của {data?.employee?.name || data?.employee?.code}</b><p>Chỉ hiển thị các cặp đơn vị – mã QLNB Anh/Chị đang phụ trách trong kỳ {data?.period_ui || hubToUi(data?.period)}.</p></div>
    <div className="card catalog-controls-compact">
      <div className="catalog-filter-row catalog-filter-row-employee">
        <CatalogSearch value={query} onChange={setQuery} employee />
        <label><span>Vùng/Tỉnh</span><select value={province} onChange={(e) => { setProvince(e.target.value); setRoute(''); setUnit(''); }}><option value="">Tất cả vùng</option>{provinceOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Tuyến</span><select value={route} onChange={(e) => { setRoute(e.target.value); setUnit(''); }}><option value="">Tất cả tuyến</option>{routeOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Đơn vị</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Tất cả đơn vị</option>{unitOptions.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <div className="catalog-result-count"><span>Đang phụ trách</span><b>{rows.length.toLocaleString('vi-VN')} cặp</b></div>
      </div>
    </div>
    <CatalogTableCard id="employee-catalog-table-top" tableId="employee-catalog">
      <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} location="top" />
      <div className="table-scroll"><table className="catalog-table catalog-table-simple catalog-table-products catalog-table-employee"><thead><tr><th>Tuyến</th><th>Mã nhà thầu</th><th>Mã đơn vị</th><th>Mã QLNB</th><th>Tên thuốc</th><th>Hoạt chất + Hàm lượng</th><th>ĐVT</th><th className="catalog-money">Đơn giá trúng thầu</th><th className="catalog-money">CST ban đầu</th><th className="catalog-money">CST còn lại</th><th>Từ kỳ</th><th>Đến kỳ</th></tr></thead><tbody>{visibleRows.map((r) => {
        const pct = Number(r.cst_initial) > 0 && r.cst_remaining != null ? (Number(r.cst_remaining) / Number(r.cst_initial)) * 100 : null;
        const pctClass = pct == null ? '' : pct <= 10 ? ' is-low' : pct <= 30 ? ' is-warning' : ' is-ok';
        const ingredientText = [r.active_ingredient, r.strength].filter(Boolean).join(' · ') || '—';
        const effectiveToText = r.effective_to ? hubToUi(r.effective_to) : 'Đang phụ trách';
        return <tr key={r.id}>
          <PreviewCell value={routeOf(r) || '—'} />
          <PreviewCell value={r.contractor_code || '—'} />
          <PreviewCell value={r.unit_code || '—'} />
          <PreviewCell value={r.qlnb_code || '—'} />
          <PreviewCell value={r.product_name || '—'}><DrugName row={r} counts={qlnbCounts} /></PreviewCell>
          <PreviewCell value={ingredientText}><span className="catalog-two-lines" title={ingredientText}>{ingredientText}</span></PreviewCell>
          <PreviewCell value={r.uom || '—'} />
          <td className="catalog-money" data-sensitive=""><b>{moneyText(r.bid_price)}</b></td>
          <td className="catalog-money" data-sensitive="">{quantityText(r.cst_initial)}</td>
          <td className={`catalog-money catalog-cst${pctClass}`} data-sensitive=""><b>{quantityText(r.cst_remaining)}</b>{pct != null && <small>{pct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</small>}</td>
          <PreviewCell value={hubToUi(r.effective_from)} />
          <PreviewCell value={effectiveToText}>{r.effective_to ? effectiveToText : <span className="catalog-active-label">{effectiveToText}</span>}</PreviewCell>
        </tr>;
      })}</tbody></table></div>
      {rows.length === 0 && <div className="muted catalog-empty">Chưa có danh mục trong phạm vi đang lọc.</div>}
      <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} location="bottom" />
    </CatalogTableCard>
  </>;
}

function Pager({ page, pageCount, total, onPage, location }) {
  return <div className={`catalog-pager ${location === 'top' ? 'is-top' : 'is-bottom'}`}>
    <div className="catalog-pager-capsule" role="group" aria-label={`Chuyển trang, trang ${page} trên ${pageCount}`}>
      <button className="catalog-pager-prev" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Trước</button>
      <span><svg className="catalog-capsule-mark" viewBox="0 0 42 22" aria-hidden="true"><path d="M11 1h10v20H11A10 10 0 0 1 11 1Z" fill="#1676bd"/><path d="M21 1h10a10 10 0 0 1 0 20H21Z" fill="#f29313"/><path d="M8 5c6-4 20-4 27 0" fill="none" stroke="#fff" strokeOpacity=".62" strokeWidth="2" strokeLinecap="round"/><path d="M21 1v20" stroke="#fff" strokeOpacity=".82"/></svg><b>Trang {page.toLocaleString('vi-VN')}/{pageCount.toLocaleString('vi-VN')}</b><i>· {total.toLocaleString('vi-VN')} dòng</i></span>
      <button className="catalog-pager-next" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Sau ›</button>
    </div>
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

const REPORT_DEFAULTS = {
  emp_codes: [], provinces: [], routes: [], units: [], contractors: [], qlnb_codes: [], query: '',
  cst_band: 'all', dormant_status: 'all', review_status: 'all', c30_status: 'all',
};
const compactNumber = (value) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const percentText = (value) => value == null ? '—' : `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

function uniqueReportOptions(rows, key, label) {
  const seen = new Map();
  for (const row of rows || []) {
    const value = String(row?.[key] || '').trim();
    if (!value) continue;
    const title = label ? label(row, value) : value;
    if (!seen.has(value)) seen.set(value, { key: value, label: title });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

function ReportMultiFilter({ label, values, options, onChange, searchPlaceholder }) {
  const [query, setQuery] = useState('');
  const selected = new Set(values || []);
  const normalized = normalizeSearch(query);
  const shown = (options || []).filter((item) => !normalized || normalizeSearch(`${item.key} ${item.label}`).includes(normalized));
  const toggle = (key) => onChange(selected.has(key) ? values.filter((value) => value !== key) : [...values, key]);
  const summary = selected.size ? `${selected.size} đã chọn` : `Tất cả (${(options || []).length})`;
  return <details className="catalog-report-multi">
    <summary><span>{label}</span><b>{summary}</b></summary>
    <div className="catalog-report-multi-menu">
      {(options || []).length > 8 && <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder || `Tìm ${label.toLowerCase()}…`} />}
      <div className="catalog-report-multi-actions"><button type="button" onClick={() => onChange((options || []).map((item) => item.key))}>Chọn tất cả</button><button type="button" onClick={() => onChange([])}>Dùng tất cả</button></div>
      <div className="catalog-report-checks">{shown.map((item) => <label key={item.key} className={selected.has(item.key) ? 'selected' : ''}><input type="checkbox" checked={selected.has(item.key)} onChange={() => toggle(item.key)} /><span><b>{item.key}</b>{item.label !== item.key && <small>{item.label}</small>}</span></label>)}</div>
      {!shown.length && <div className="muted catalog-empty">Không tìm thấy lựa chọn phù hợp.</div>}
    </div>
  </details>;
}

function ReportPanel({ period, rows }) {
  const [form, setForm] = useState(REPORT_DEFAULTS);
  const [preview, setPreview] = useState(null);
  const [deliveryPreview, setDeliveryPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const previewRequestRef = useRef(0);
  const deliveryRequestRef = useRef(0);
  const options = useMemo(() => ({
    employees: uniqueReportOptions(rows, 'emp_code', (row, value) => `${value} · ${row.emp_name || value}`),
    provinces: uniqueReportOptions(rows, 'province'),
    routes: uniqueReportOptions(rows, 'route'),
    units: uniqueReportOptions(rows, 'unit_code'),
    contractors: uniqueReportOptions(rows, 'contractor_code'),
    qlnb: uniqueReportOptions(rows, 'qlnb_code', (row, value) => `${value} · ${row.product_name || value}`),
  }), [rows]);
  useEffect(() => {
    previewRequestRef.current += 1; deliveryRequestRef.current += 1;
    setBusy(false); setDeliveryBusy(false); setForm(REPORT_DEFAULTS); setPreview(null); setDeliveryPreview(null); setError(''); setMessage('');
  }, [period]);
  const set = (key, value) => {
    previewRequestRef.current += 1; deliveryRequestRef.current += 1;
    setBusy(false); setDeliveryBusy(false); setForm((current) => ({ ...current, [key]: value })); setPreview(null); setDeliveryPreview(null); setError(''); setMessage('');
  };
  const resetFilters = () => {
    previewRequestRef.current += 1; deliveryRequestRef.current += 1;
    setBusy(false); setDeliveryBusy(false); setForm(REPORT_DEFAULTS); setPreview(null); setDeliveryPreview(null); setError(''); setMessage('');
  };
  const payload = useMemo(() => ({ period, ...form }), [period, form]);
  async function makePreview() {
    const requestId = ++previewRequestRef.current;
    const requestPayload = payload;
    deliveryRequestRef.current += 1;
    setBusy(true); setDeliveryBusy(false); setError(''); setMessage(''); setPreview(null); setDeliveryPreview(null);
    try {
      const result = await api.adminCatalogManagementReportPreview(requestPayload);
      if (requestId === previewRequestRef.current) setPreview(result);
    } catch (requestError) {
      if (requestId === previewRequestRef.current) setError(requestError.message);
    } finally {
      if (requestId === previewRequestRef.current) setBusy(false);
    }
  }
  async function makeDeliveryPreview() {
    if (!preview) return;
    const requestId = ++deliveryRequestRef.current;
    const requestPayload = { ...payload, channels: { email: true, telegram: true } };
    setDeliveryBusy(true); setError(''); setMessage(''); setDeliveryPreview(null);
    try {
      const result = await api.adminCatalogManagementDeliveryPreview(requestPayload);
      if (requestId === deliveryRequestRef.current) setDeliveryPreview(result);
    } catch (requestError) {
      if (requestId === deliveryRequestRef.current) setError(requestError.message);
    } finally {
      if (requestId === deliveryRequestRef.current) setDeliveryBusy(false);
    }
  }
  const exportPayload = preview ? { ...preview.filters, preview_id: preview.preview_id } : null;
  async function downloadEmployee(empCode) {
    if (!exportPayload) return;
    setDownloading(empCode); setError(''); setMessage('');
    try { await downloadFilteredEmployeeReport(empCode, exportPayload); setMessage(`Đã tạo file cá nhân ${empCode}. Không có email/Telegram nào được gửi.`); }
    catch (downloadError) { setError(downloadError.message); }
    setDownloading('');
  }
  async function downloadSummary() {
    if (!exportPayload) return;
    setDownloading('summary'); setError(''); setMessage('');
    try { await downloadFilteredEmployeeSummary(exportPayload); setMessage('Đã tạo file tổng hợp CEO. Không có email/Telegram nào được gửi.'); }
    catch (downloadError) { setError(downloadError.message); }
    setDownloading('');
  }
  const selectedFilterCount = Object.entries(form).filter(([key, value]) => key !== 'query' ? (Array.isArray(value) ? value.length : value !== 'all') : !!value).length;
  return <div className="catalog-report-flow">
    <section className="card catalog-report-intro">
      <div><span className="catalog-report-icon" aria-hidden="true">📊</span><div><h3>Lập báo cáo cá nhân theo bộ lọc</h3><p>Mỗi nhân viên được tách thành một file riêng, chỉ chứa dữ liệu trong phạm vi họ phụ trách.</p></div></div>
      <strong>XEM TRƯỚC / XUẤT FILE / PREVIEW GỬI · CHƯA GỬI THẬT</strong>
    </section>

    <section className="card catalog-report-filters">
      <div className="catalog-step-title"><span>1</span><div><h3>Chọn người và phạm vi</h3><p>Để trống danh sách chọn nghĩa là dùng tất cả giá trị trong phạm vi hiện tại.</p></div></div>
      <div className="catalog-report-filter-grid">
        <ReportMultiFilter label="Nhân viên" values={form.emp_codes} options={options.employees} onChange={(value) => set('emp_codes', value)} />
        <ReportMultiFilter label="Tỉnh/Thành" values={form.provinces} options={options.provinces} onChange={(value) => set('provinces', value)} />
        <ReportMultiFilter label="Tuyến" values={form.routes} options={options.routes} onChange={(value) => set('routes', value)} />
        <ReportMultiFilter label="Đơn vị" values={form.units} options={options.units} onChange={(value) => set('units', value)} />
        <ReportMultiFilter label="Nhà thầu" values={form.contractors} options={options.contractors} onChange={(value) => set('contractors', value)} />
        <ReportMultiFilter label="Mã QLNB" values={form.qlnb_codes} options={options.qlnb} onChange={(value) => set('qlnb_codes', value)} />
      </div>
      <div className="catalog-report-select-grid">
        <label><span>Tìm kiếm</span><input value={form.query} onChange={(event) => set('query', event.target.value)} placeholder="Tên thuốc, hoạt chất, đơn vị, QLNB…" /></label>
        <label><span>Mức CST còn lại</span><select value={form.cst_band} onChange={(event) => set('cst_band', event.target.value)}><option value="all">Tất cả mức CST</option><option value="missing">Chưa có CST</option><option value="le10">≤ 10%</option><option value="10_30">Trên 10% đến 30%</option><option value="gt30">Trên 30%</option><option value="full">Còn gần nguyên ≥ 99,5%</option></select></label>
        <label><span>Phát sinh 60 ngày</span><select value={form.dormant_status} onChange={(event) => set('dormant_status', event.target.value)}><option value="all">Tất cả trạng thái</option><option value="dormant">Ngủ đông ≥ 60 ngày</option><option value="not_activated">Chưa kích hoạt</option><option value="normal">Đang hoạt động</option></select></label>
        <label><span>Trạng thái review</span><select value={form.review_status} onChange={(event) => set('review_status', event.target.value)}><option value="all">Tất cả review</option><option value="unplanned">Chưa lập kế hoạch</option><option value="in_progress">Đang triển khai</option><option value="upcoming">Sắp đến hạn</option><option value="due">Đến hạn</option><option value="overdue">Quá hạn</option></select></label>
        <label><span>C30</span><select value={form.c30_status} onChange={(event) => set('c30_status', event.target.value)}><option value="all">Tất cả C30</option><option value="available">Có tùy chọn C30</option><option value="actionable">C30 cần hành động</option><option value="none">Không có C30</option></select></label>
      </div>
      <div className="catalog-report-filter-footer"><span>{selectedFilterCount ? `${selectedFilterCount} nhóm lọc đang áp dụng` : 'Đang dùng toàn bộ phạm vi được giao'}</span><button type="button" className="btn ghost" onClick={resetFilters}>Xóa bộ lọc</button></div>
    </section>

    <section className="card catalog-report-preview-step">
      <div className="catalog-step-title"><span>2</span><div><h3>Xem trước bắt buộc</h3><p>Hệ thống kiểm lại số báo cáo, số dòng và khóa phạm vi trước khi cho tải file.</p></div></div>
      <button type="button" className="btn catalog-report-preview-button" disabled={busy} onClick={makePreview}>{busy ? 'Đang kiểm tra dữ liệu…' : '👁 Xem trước phạm vi báo cáo'}</button>
      {preview && <div className="catalog-report-preview">
        <div className="catalog-report-kpis"><div><small>NV đã chọn</small><b>{compactNumber(preview.selected_employees)}</b></div><div><small>Báo cáo có dữ liệu</small><b>{compactNumber(preview.total_employees)}</b></div><div><small>Tổng dòng sau lọc</small><b>{compactNumber(preview.total_rows)}</b></div><div><small>Không có dòng</small><b>{compactNumber(preview.empty_employees)}</b></div></div>
        <p><b>Phạm vi:</b> {preview.filter_text}</p>
        <div className="catalog-report-safety">🔒 Server đã tách dữ liệu theo từng mã nhân viên. File cá nhân không có CP Total, chi phí, lợi nhuận hoặc margin.</div>
        {preview.c30_source && !preview.c30_source.ready && <div className="catalog-report-source-warning">⚠ Nguồn C30 chưa sẵn sàng nên cột C30 để trống; hệ thống không suy diễn thành “không có C30”.</div>}
      </div>}
      {error && <div className="catalog-alert error">⚠ {error}</div>}{message && <div className="catalog-alert success">✓ {message}</div>}
    </section>

    {preview && <section className="card catalog-report-results">
      <div className="catalog-step-title"><span>3</span><div><h3>Xuất báo cáo</h3><p>File tổng hợp dành cho CEO; file cá nhân chỉ có dữ liệu đúng người. Không có nút gửi thật trong màn hình này.</p></div></div>
      <div className="catalog-report-summary-download"><div><b>Tổng hợp CEO</b><span>{preview.total_employees} nhân viên · {preview.total_rows.toLocaleString('vi-VN')} dòng</span></div><button type="button" className="btn" disabled={!preview.total_employees || !!downloading} onClick={downloadSummary}>{downloading === 'summary' ? 'Đang tạo…' : '⬇ Tải tổng hợp CEO'}</button></div>
      <div className="catalog-report-employee-list">{preview.employees.map((employee) => <article key={employee.emp_code} className={!employee.exportable ? 'is-empty' : ''}>
        <div className="catalog-report-employee-head"><div><b>{employee.emp_code} · {employee.emp_name}</b><span>{employee.row_count.toLocaleString('vi-VN')} dòng · {employee.unit_count} đơn vị · {employee.qlnb_count} QLNB</span></div><button type="button" className="btn ghost" disabled={!employee.exportable || !!downloading} onClick={() => downloadEmployee(employee.emp_code)}>{!employee.exportable ? 'Không có dữ liệu' : downloading === employee.emp_code ? 'Đang tạo…' : '⬇ Tải file cá nhân'}</button></div>
        {employee.exportable && <div className="catalog-report-employee-metrics"><span>CST còn <b>{percentText(employee.cst_remaining_pct)}</b></span><span>Ngủ đông <b>{employee.dormant_count}</b></span><span>Chưa kích hoạt <b>{employee.not_activated_count}</b></span><span>Review đến/quá hạn <b>{employee.review_due_count}</b></span><span>Target đạt <b>{percentText(employee.target_pct)}</b></span></div>}
      </article>)}</div>
    </section>}

    {preview && <section className="card catalog-delivery-preview-step">
      <div className="catalog-step-title"><span>4</span><div><h3>Preview gửi riêng</h3><p>Hệ thống dựng đúng file sẽ gửi, khóa checksum và người nhận. Bước này tuyệt đối chưa gửi email/Telegram.</p></div></div>
      <div className="catalog-delivery-exclusions"><b>Không bao giờ gửi:</b> DN021 · DN023 · VP004 · VP018</div>
      <button type="button" className="btn catalog-report-preview-button" disabled={deliveryBusy || !preview.total_employees} onClick={makeDeliveryPreview}>{deliveryBusy ? 'Đang dựng file và khóa checksum…' : '🔐 Lập preview người nhận & file gửi'}</button>
      {deliveryPreview && <div className="catalog-delivery-preview">
        <div className="catalog-report-kpis"><div><small>Người nhận</small><b>{deliveryPreview.summary.recipients}</b></div><div><small>File cá nhân</small><b>{deliveryPreview.summary.files}</b></div><div><small>Email dự kiến</small><b>{deliveryPreview.summary.email}</b></div><div><small>Telegram dự kiến</small><b>{deliveryPreview.summary.telegram}</b></div></div>
        <div className="catalog-report-safety">🔒 Mỗi file đã khóa SHA-256 và đúng một mã nhân viên. Gửi thật vẫn đang khóa, cần Sếp duyệt lần hai.</div>
        {!!deliveryPreview.summary.missing_telegram?.length && <div className="catalog-report-source-warning">Telegram chưa mapping: {deliveryPreview.summary.missing_telegram.join(', ')} — các mã này chỉ nhận email.</div>}
        <div className="catalog-delivery-list">{deliveryPreview.recipients.map((recipient) => <article key={recipient.emp_code}><div><b>{recipient.emp_code} · {recipient.name}</b><span>{recipient.file?.row_count || 0} dòng · {recipient.file?.unit_count || 0} đơn vị · SHA {String(recipient.file?.sha256 || '').slice(0, 12)}…</span></div><div className="catalog-delivery-channels"><i className={recipient.email_planned ? 'ready' : 'missing'}>✉ {recipient.email_masked || 'Thiếu email'}</i><i className={recipient.telegram_planned ? 'ready' : 'missing'}>Telegram {recipient.telegram_fingerprint || 'chưa mapping'}</i></div></article>)}</div>
        <small className="catalog-delivery-expiry">Preview hết hạn: {dateText(deliveryPreview.expires_at)} · Trạng thái: {deliveryPreview.send_enabled ? 'Đã mở quyền gửi tạm thời' : 'Chưa mở quyền gửi thật'}</small>
      </div>}
    </section>}
  </div>;
}

function AdminView({ data, period, onReload, history, diagnostics }) {
  const [mode, setMode] = useState('view');
  const [query, setQuery] = useState('');
  const [emp, setEmp] = useState('');
  const [province, setProvince] = useState('');
  const [route, setRoute] = useState('');
  const [unit, setUnit] = useState('');
  const [page, setPage] = useState(1);
  const currentRows = useMemo(() => (data?.rows || []).filter((row) => activeInPeriod(row, period)), [data, period]);
  const qlnbCounts = useMemo(() => drugQlnbCounts(currentRows), [currentRows]);
  const provinceOptions = useMemo(() => [...new Set(currentRows.filter((row) => !emp || row.emp_code === emp).map(provinceOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [currentRows, emp]);
  const routeOptions = useMemo(() => [...new Set(currentRows.filter((row) => (!emp || row.emp_code === emp) && (!province || provinceOf(row) === province)).map(routeOf).filter(Boolean))].sort(), [currentRows, emp, province]);
  const unitOptions = useMemo(() => [...new Set(currentRows.filter((row) => (!emp || row.emp_code === emp) && (!province || provinceOf(row) === province) && (!route || routeOf(row) === route)).map((row) => row.unit_code).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [currentRows, emp, province, route]);
  const rows = useMemo(() => currentRows.filter((row) => {
    return matchesSmartSearch(row, query) && (!emp || row.emp_code === emp) && (!province || provinceOf(row) === province) && (!route || routeOf(row) === route) && (!unit || row.unit_code === unit);
  }), [currentRows, query, emp, province, route, unit]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [period, query, emp, province, route, unit]);
  const goPage = (next) => { setPage(Math.max(1, Math.min(pageCount, next))); requestAnimationFrame(() => document.getElementById('catalog-table-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  return <>
    <details className="card catalog-help-compact">
      <summary>❓ Hướng dẫn sử dụng</summary>
      <div><p>Màn hình quản lý theo từng tháng: nhân viên nào đang phụ trách từng cặp <b>đơn vị + mã QLNB</b>.</p><ol><li>Chọn kỳ</li><li>Chọn tuyến/NV hoặc nhập mã cần tìm</li><li>Nếu cần, mở tab Điều chuyển nhân viên</li></ol></div>
    </details>
    <div className="catalog-mode-tabs" role="tablist" aria-label="Chức năng danh mục quản lý">
      <button role="tab" aria-selected={mode === 'view'} className={mode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>🔎 Xem phân công</button>
      <button role="tab" aria-selected={mode === 'report'} className={mode === 'report' ? 'active' : ''} onClick={() => setMode('report')}>📊 Lập báo cáo NV</button>
      <button role="tab" aria-selected={mode === 'transfer'} className={mode === 'transfer' ? 'active' : ''} onClick={() => setMode('transfer')}>⇄ Điều chuyển nhân viên</button>
    </div>

    {mode === 'view' ? <>
      <div className="card catalog-controls-compact">
        <div className="catalog-filter-row">
          <CatalogSearch value={query} onChange={setQuery} />
          <label><span>Vùng/Tỉnh</span><select value={province} onChange={(e) => { setProvince(e.target.value); setRoute(''); setUnit(''); }}><option value="">Tất cả vùng</option>{provinceOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Nhân viên</span><select value={emp} onChange={(e) => { setEmp(e.target.value); setProvince(''); setRoute(''); setUnit(''); }}><option value="">Tất cả nhân viên</option>{[...new Set(currentRows.map((r) => r.emp_code).filter(Boolean))].sort().map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Tuyến</span><select value={route} onChange={(e) => { setRoute(e.target.value); setUnit(''); }}><option value="">Tất cả tuyến</option>{routeOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Đơn vị</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Tất cả đơn vị</option>{unitOptions.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <div className="catalog-result-count"><span>Kết quả</span><b>{rows.length.toLocaleString('vi-VN')} cặp</b></div>
        </div>
      </div>
      <CatalogTableCard id="catalog-table-top" tableId="admin-catalog">
        <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} location="top" />
        <div className="table-scroll"><table className="catalog-table catalog-table-simple catalog-table-products"><thead><tr><th>Nhân viên</th><th>Tuyến</th><th>Mã nhà thầu</th><th>Mã đơn vị</th><th>Mã QLNB</th><th>Tên thuốc</th><th>Hoạt chất + Hàm lượng</th><th>ĐVT</th><th className="catalog-money">Đơn giá trúng thầu</th><th className="catalog-money">CST ban đầu</th><th className="catalog-money">CST còn lại</th><th>Từ kỳ</th><th>Đến kỳ</th></tr></thead><tbody>{visibleRows.map((r) => {
          const pct = Number(r.cst_initial) > 0 && r.cst_remaining != null ? (Number(r.cst_remaining) / Number(r.cst_initial)) * 100 : null;
          const pctClass = pct == null ? '' : pct <= 10 ? ' is-low' : pct <= 30 ? ' is-warning' : ' is-ok';
          const ingredientText = [r.active_ingredient, r.strength].filter(Boolean).join(' · ') || '—';
          const effectiveToText = r.effective_to ? hubToUi(r.effective_to) : 'Đang phụ trách';
          return <tr key={r.id}>
            <td data-sensitive=""><b>{r.emp_code}</b><small>{r.emp_name}</small></td>
            <PreviewCell value={routeOf(r) || '—'} />
            <PreviewCell value={r.contractor_code || '—'} />
            <PreviewCell value={r.unit_code || '—'} />
            <PreviewCell value={r.qlnb_code || '—'} />
            <PreviewCell value={r.product_name || '—'}><DrugName row={r} counts={qlnbCounts} /></PreviewCell>
            <PreviewCell value={ingredientText}><span className="catalog-two-lines" title={ingredientText}>{ingredientText}</span></PreviewCell>
            <PreviewCell value={r.uom || '—'} />
            <td className="catalog-money" data-sensitive=""><b>{moneyText(r.bid_price)}</b></td>
            <td className="catalog-money" data-sensitive="">{quantityText(r.cst_initial)}</td>
            <td className={`catalog-money catalog-cst${pctClass}`} data-sensitive=""><b>{quantityText(r.cst_remaining)}</b>{pct != null && <small>{pct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</small>}</td>
            <PreviewCell value={hubToUi(r.effective_from)} />
            <PreviewCell value={effectiveToText}>{r.effective_to ? effectiveToText : <span className="catalog-active-label">{effectiveToText}</span>}</PreviewCell>
          </tr>;
        })}</tbody></table></div>
        <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} location="bottom" />
      </CatalogTableCard>
    </> : mode === 'report' ? <ReportPanel period={period} rows={currentRows} /> : <TransferPanel period={period} rows={currentRows} meta={data?.meta} onDone={onReload} />}

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
      <div><div className="section-head">🗂️ {isAdmin ? 'Phân công danh mục bán hàng' : 'Danh mục bán hàng của tôi'}</div><div className="meta muted">{isAdmin ? 'Theo cặp đơn vị + mã QLNB và từng kỳ' : 'Chỉ hiển thị phạm vi Anh/Chị đang phụ trách'}</div></div>
      <div className="catalog-heading-actions">{data?.meta && <SourceStatus meta={data.meta} />}<label><span>Kỳ</span><select value={period} onChange={(e) => setPeriod(e.target.value)}>{(periods.length ? periods : [period]).map((x) => <option key={x}>{x}</option>)}</select></label></div>
    </div>
    {error && <div className="card catalog-alert error">⚠ {error}</div>}
    {!data && !error ? <Spinner /> : data && (isAdmin ? <AdminView data={data} period={uiToHub(period)} history={history} diagnostics={diagnostics} onReload={() => load(period)} /> : <EmployeeSections data={data} />)}
  </div>;
}
