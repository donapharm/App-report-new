import React from 'react';
import { DateInput } from '../components.jsx';
import { formatDate, formatDateTime } from '../util.js';

export const emptyRevenueFilters = { emp: '', province: '', unit: '', group: '', product: '', route: '', priority: '', contractor: '', bid: '', dateFrom: '', dateTo: '', q: '' };

const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const productMeta = (o) => [o.qd, o.active_ingredient, o.ham_luong, o.uom, o.contractor, o.bid_price ? `Giá ${Number(o.bid_price).toLocaleString('vi-VN')}` : '', o.iit_code || o.key]
  .filter(Boolean).join(' · ');
export function optionLabel(o) {
  if (!o) return '';
  if (o.kind === 'product' || o.iit_code) return `${o.label || o.product_name || o.key}${productMeta(o) ? ` · ${productMeta(o)}` : ''}`;
  if (o.kind === 'unit' || /^\d{3}\./.test(String(o.key || ''))) {
    const key = String(o.key || ''); const label = String(o.label || o.key || '');
    // Tránh lặp: mã đã chứa tên (hoặc bằng tên) thì chỉ hiện 1 lần.
    return (!label || label === key || key.includes(label) || label.includes(key)) ? (label || key) : `${key} · ${label}`;
  }
  return o.label || o.key || '';
}
function optionSearchText(o) {
  return norm([o.key, o.label, o.iit_code, o.product_name, o.unit_code, o.unit_name, o.active_ingredient, o.ham_luong, o.uom, o.contractor, o.contractor_code, ...(o.names || []), o.qd, o.bid_price].join(' '));
}

export function Select({ value, onChange, options, all }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {(options || []).map((o) => <option key={o.key} value={o.key}>{optionLabel(o)}</option>)}
    </select>
  );
}

// Chọn NHIỀU (vd nhiều gói thầu). Lưu dạng chuỗi nối bằng '|' để serialize params
// không đổi (backend tách '|'). value='' = tất cả.
export function MultiSelect({ value, onChange, options, all, unit = 'mục' }) {
  const arr = String(value || '').split('|').map((s) => s.trim()).filter(Boolean);
  const list = options || [];
  const [open, setOpen] = React.useState(false);
  const has = (k) => arr.includes(String(k));
  const toggle = (k) => {
    const key = String(k);
    onChange((has(key) ? arr.filter((x) => x !== key) : [...arr, key]).join('|'));
  };
  const summary = arr.length === 0 ? all
    : arr.length === 1 ? (list.find((o) => String(o.key) === arr[0])?.label || arr[0])
      : `${arr.length} ${unit}`;
  return (
    <div className={'combo multi' + (open ? ' open' : '')} onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <button type="button" className={'multi-toggle' + (arr.length ? ' has' : '')} onClick={() => setOpen((o) => !o)}>
        <span className="multi-sum">{summary}</span><span className="multi-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="combo-menu">
          <button type="button" className="combo-item muted-choice" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(''); setOpen(false); }}>{all}</button>
          {list.map((o) => (
            <button type="button" className={'combo-item multi-item' + (has(o.key) ? ' checked' : '')} key={o.key} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(o.key)}>
              <span className="multi-box" aria-hidden>{has(o.key) ? '☑' : '☐'}</span>
              <b>{o.label || o.key}</b>
            </button>
          ))}
          {!list.length && <div className="combo-empty">Không có lựa chọn.</div>}
        </div>
      )}
    </div>
  );
}

export function ComboSelect({ value, onChange, options, all, placeholder, className }) {
  const list = options || [];
  const selected = list.find((o) => String(o.key) === String(value));
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { setQuery(selected ? optionLabel(selected) : ''); }, [value, options]);
  const q = norm(query);
  const shown = (q ? list.filter((o) => optionSearchText(o).includes(q)) : list).slice(0, 30);
  return (
    <div className={'combo ' + (className || '')} onBlur={() => setTimeout(() => setOpen(false), 120)}>
      <input
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(''); }}
        placeholder={placeholder || all}
      />
      {value && <button type="button" className="combo-clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(''); setQuery(''); }}>×</button>}
      {open && (
        <div className="combo-menu">
          <button type="button" className="combo-item muted-choice" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(''); setQuery(''); setOpen(false); }}>{all}</button>
          {shown.map((o) => (
            <button type="button" className="combo-item" key={o.key} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o.key); setQuery(optionLabel(o)); setOpen(false); }}>
              <b>{o.label || o.key}</b>
              <span>{optionLabel(o).replace(String(o.label || o.key), '').replace(/^\s*·\s*/, '') || o.key}</span>
            </button>
          ))}
          {!shown.length && <div className="combo-empty">Không tìm thấy.</div>}
        </div>
      )}
    </div>
  );
}

export function RevenueFilters({ me, ky, periods, options, filters, setKy, setFilters, filterBusy, filterNotice, showQuickProvince = false, quickSearchPlaceholder = 'Tìm mã/tên NV, đơn vị, sản phẩm, mã QLNB…' }) {
  const setF = (k, v) => setFilters((f) => {
    const next = { ...f, [k]: v };
    // Không cho khoảng ngày đảo chiều; kéo đầu còn lại theo ngày vừa chọn.
    if (k === 'dateFrom' && v && next.dateTo && v > next.dateTo) next.dateTo = v;
    if (k === 'dateTo' && v && next.dateFrom && v < next.dateFrom) next.dateFrom = v;
    return next;
  });
  const effectiveKy = options?.kys?.at(-1) || ky;
  const period = (periods || []).find((p) => p.ky === effectiveKy) || {};
  const asOf = period.data_as_of || period.dataAsOf || period.dateTo || period.dateFrom;
  const firstPeriod = periods?.[0] || {};
  const lastPeriod = periods?.at(-1) || {};
  const availableMinDate = String(firstPeriod.dateFrom || '').slice(0, 10);
  const availableMaxDate = String(lastPeriod.throughDate || lastPeriod.data_as_of || lastPeriod.dataAsOf || lastPeriod.dateTo || '').slice(0, 10);
  const baseDate = asOf ? new Date(asOf) : new Date();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const clamp = (d) => {
    const s = iso(d);
    const minDate = periods?.[0]?.dateFrom;
    const maxDate = periods?.at(-1)?.dateTo;
    if (minDate && s < minDate) return minDate;
    if (maxDate && s > maxDate) return maxDate;
    return s;
  };
  const setRange = (kind) => {
    const d = new Date(baseDate);
    let a = new Date(d), b = new Date(d);
    if (kind === 'week') { const day = (d.getDay() + 6) % 7; a.setDate(d.getDate() - day); b = new Date(a); b.setDate(a.getDate() + 6); }
    if (kind === 'month') { a = new Date(d.getFullYear(), d.getMonth(), 1); b = new Date(d.getFullYear(), d.getMonth() + 1, 0); }
    if (kind === 'quarter') { const q = Math.floor(d.getMonth() / 3) * 3; a = new Date(d.getFullYear(), q, 1); b = new Date(d.getFullYear(), q + 3, 0); }
    setFilters((f) => ({ ...f, dateFrom: clamp(a), dateTo: clamp(b) }));
  };
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  // Mặc định ẨN bộ lọc (CEO chốt) — nhấn để mở, nhấn lại thu gọn.
  const [open, setOpen] = React.useState(false);
  const toggle = () => setOpen((v) => !v);
  const changeKy = (v) => {
    setKy(v);
    // Chọn kỳ là một preset mới; xóa khoảng tùy chỉnh cũ để không còn hai phạm vi xung đột.
    setFilters((f) => ({ ...f, dateFrom: '', dateTo: '' }));
  };
  const rangeText = filters.dateFrom || filters.dateTo
    ? `${filters.dateFrom ? formatDate(filters.dateFrom) : 'đầu dữ liệu'} → ${filters.dateTo ? formatDate(filters.dateTo) : 'hiện tại'}${options?.kys?.length ? ` · ${options.kys.length} kỳ` : ''}`
    : '';
  return (
    <div className={'card filter-card' + (open ? ' open' : ' collapsed')}>
      {/* Thanh gọn luôn hiện: kỳ + tìm nhanh + nút đóng/mở + xoá lọc */}
      <div className="filter-bar">
        <div className="filter-ky"><Select value={ky} onChange={changeKy} options={(periods || []).map((p) => ({ key: p.ky, label: p.ky }))} all="Chọn kỳ" /></div>
        {showQuickProvince && <div className="filter-province-quick"><Select value={filters.province} onChange={(v) => setF('province', v)} options={options?.provinces} all="Tất cả vùng" /></div>}
        <div className="filter-quick-wrap">
          <input className="filter-quick" value={filters.q} onChange={(e) => setF('q', e.target.value)} placeholder={quickSearchPlaceholder} aria-label="Tìm kiếm thông minh" />
          {filters.q && <button type="button" className="filter-quick-clear" aria-label="Xóa nội dung tìm kiếm" title="Xóa tìm kiếm" onClick={() => setF('q', '')}>×</button>}
        </div>
        <button type="button" className="btn ghost filter-toggle" aria-expanded={open} onClick={toggle}>{filterBusy ? '⟳ Đang lọc…' : (open ? '▴ Thu gọn lọc' : '▾ Bộ lọc')}{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
        {activeFilterCount > 0 && <button className="btn ghost filter-clear-all" onClick={() => setFilters({ ...emptyRevenueFilters })}>Xoá lọc</button>}
      </div>
      {(rangeText || filterNotice) && <div className="filter-live-status">{rangeText && <span>📅 {rangeText}</span>}{filterNotice && <b>{filterNotice}</b>}</div>}
      {open && (
        <div className="filter-body">
          <div className="filter-asof">
            <b>{asOf ? `Cập nhật ${formatDateTime(asOf)} GMT+7` : 'Chưa có giờ cập nhật'}</b>
            <span>{period.canFilterByDay ? 'Nguồn có ngày chi tiết: lọc ngày/tuần/tháng/quý dùng đúng ngày dòng.' : 'Kỳ này chỉ có tổng theo tháng: lọc ngày không phân bổ giả.'}</span>
          </div>
          <div className="filter-grid">
            {me.isAdmin && <MultiSelect value={filters.emp} onChange={(v) => setF('emp', v)} options={options?.employees} all="Tất cả NV" unit="NV" />}
            {!showQuickProvince && <Select value={filters.province} onChange={(v) => setF('province', v)} options={options?.provinces} all="Tất cả tỉnh/thành" />}
            <ComboSelect value={filters.unit} onChange={(v) => setF('unit', v)} options={options?.units} all="Tất cả đơn vị" placeholder="Gõ mã/tên đơn vị…" />
            <ComboSelect value={filters.group} onChange={(v) => setF('group', v)} options={options?.groups} all="Tất cả nhóm hàng C14" placeholder="Gõ mã/tên nhóm hàng…" />
            <ComboSelect value={filters.product} onChange={(v) => setF('product', v)} options={options?.products} all="Tất cả sản phẩm" placeholder="Gõ tên/mã QLNB/hoạt chất…" />
            <Select value={filters.route} onChange={(v) => setF('route', v)} options={options?.routes} all="Tất cả tuyến" />
            <Select value={filters.priority} onChange={(v) => setF('priority', v)} options={options?.priorities} all="Tất cả UT" />
            <ComboSelect value={filters.contractor} onChange={(v) => setF('contractor', v)} options={options?.contractors} all="Tất cả nhà thầu" placeholder="Gõ mã/tên nhà thầu…" />
            <MultiSelect value={filters.bid} onChange={(v) => setF('bid', v)} options={options?.bidPackages} all="Tất cả gói thầu" unit="gói thầu" />
            <DateInput value={filters.dateFrom || ''} onChange={(v) => setF('dateFrom', v)} ariaLabel="Từ ngày" min={availableMinDate} max={availableMaxDate} />
            <DateInput value={filters.dateTo || ''} onChange={(v) => setF('dateTo', v)} ariaLabel="Đến ngày" min={availableMinDate} max={availableMaxDate} />
          </div>
          <div className="date-chips">
            <button type="button" className="chip" onClick={() => setRange('day')}>Ngày</button>
            <button type="button" className="chip" onClick={() => setRange('week')}>Tuần</button>
            <button type="button" className="chip" onClick={() => setRange('month')}>Tháng</button>
            <button type="button" className="chip" onClick={() => setRange('quarter')}>Quý</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function usePeriodsAndFilters(api) {
  const [periods, setPeriods] = React.useState([]);
  const [ky, setKy] = React.useState('');
  const [filters, setFilters] = React.useState(emptyRevenueFilters);
  const [options, setOptions] = React.useState(null);
  const [validatedFilters, setValidatedFilters] = React.useState(emptyRevenueFilters);
  const [filterBusy, setFilterBusy] = React.useState(false);
  const [filterNotice, setFilterNotice] = React.useState('');
  const [filtersReady, setFiltersReady] = React.useState(false);
  const [quickQuery, setQuickQuery] = React.useState('');
  React.useEffect(() => { api.periods().then((p) => { setPeriods(p.periods || []); setKy(p.latest); }); }, []);
  React.useEffect(() => {
    const id = setTimeout(() => setQuickQuery(filters.q), 140);
    return () => clearTimeout(id);
  }, [filters.q]);
  const facetFilters = React.useMemo(() => ({ ...filters, q: '' }), [filters.emp, filters.province, filters.unit, filters.group, filters.product, filters.route, filters.priority, filters.contractor, filters.bid, filters.dateFrom, filters.dateTo]);
  const facetSignature = JSON.stringify(facetFilters);
  React.useEffect(() => {
    if (!ky) return;
    let cancelled = false;
    setFilterBusy(true);
    api.filters({ ky, ...facetFilters }).then((nextOptions) => {
      if (cancelled) return;
      const next = { ...facetFilters };
      const removed = [];
      const specs = [
        ['emp', 'employees', true, 'nhân viên'], ['province', 'provinces', false, 'tỉnh/thành'],
        ['unit', 'units', false, 'đơn vị'], ['group', 'groups', false, 'nhóm hàng'], ['product', 'products', false, 'sản phẩm'],
        ['route', 'routes', false, 'tuyến'], ['priority', 'priorities', false, 'ưu tiên'],
        ['contractor', 'contractors', false, 'nhà thầu'], ['bid', 'bidPackages', true, 'gói thầu'],
      ];
      for (const [field, optionKey, multi, label] of specs) {
        if (!next[field]) continue;
        const allowed = new Set((nextOptions?.[optionKey] || []).map((o) => String(o.key)));
        if (multi) {
          const kept = String(next[field]).split('|').filter((v) => allowed.has(v));
          if (kept.join('|') !== next[field]) { next[field] = kept.join('|'); removed.push(label); }
        } else if (!allowed.has(String(next[field]))) { next[field] = ''; removed.push(label); }
      }
      setOptions(nextOptions);
      setValidatedFilters(next);
      setFiltersReady(true);
      setFilterBusy(false);
      setFilterNotice(removed.length ? `Đã bỏ lựa chọn ${[...new Set(removed)].join(', ')} không còn phát sinh trong phạm vi mới.` : '');
      if (JSON.stringify(next) !== facetSignature) setFilters((f) => ({ ...f, ...next }));
    }).catch(() => { if (!cancelled) { setFilterBusy(false); setFiltersReady(true); } });
    return () => { cancelled = true; };
  }, [ky, facetSignature]);
  const queryFilters = React.useMemo(() => ({ ...validatedFilters, q: quickQuery }), [validatedFilters, quickQuery]);
  return { periods, ky, setKy, filters, setFilters, options, queryFilters, filterBusy, filterNotice, filtersReady };
}
