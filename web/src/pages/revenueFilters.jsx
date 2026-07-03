import React from 'react';

export const emptyRevenueFilters = { emp: '', unit: '', product: '', route: '', priority: '', contractor: '', bid: '', q: '' };

const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const productMeta = (o) => [o.qd, o.active_ingredient, o.ham_luong, o.uom, o.contractor, o.bid_price ? `Giá ${Number(o.bid_price).toLocaleString('vi-VN')}` : '', o.iit_code || o.key]
  .filter(Boolean).join(' · ');
export function optionLabel(o) {
  if (!o) return '';
  if (o.kind === 'product' || o.iit_code) return `${o.label || o.product_name || o.key}${productMeta(o) ? ` · ${productMeta(o)}` : ''}`;
  if (o.kind === 'unit' || /^\d{3}\./.test(String(o.key || ''))) return `${o.key} · ${o.label || o.key}`;
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

export function RevenueFilters({ me, ky, periods, options, filters, setKy, setFilters }) {
  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  return (
    <div className="card filter-card">
      <div className="filter-grid">
        <Select value={ky} onChange={setKy} options={(periods || []).map((p) => ({ key: p.ky, label: p.ky }))} all="Chọn kỳ" />
        {me.isAdmin && <ComboSelect value={filters.emp} onChange={(v) => setF('emp', v)} options={options?.employees} all="Tất cả NV" />}
        <ComboSelect value={filters.unit} onChange={(v) => setF('unit', v)} options={options?.units} all="Tất cả đơn vị" placeholder="Gõ mã/tên đơn vị…" />
        <ComboSelect value={filters.product} onChange={(v) => setF('product', v)} options={options?.products} all="Tất cả sản phẩm" placeholder="Gõ tên/mã QLNB/hoạt chất…" />
        <Select value={filters.route} onChange={(v) => setF('route', v)} options={options?.routes} all="Tất cả tuyến" />
        <Select value={filters.priority} onChange={(v) => setF('priority', v)} options={options?.priorities} all="Tất cả UT" />
        <ComboSelect value={filters.contractor} onChange={(v) => setF('contractor', v)} options={options?.contractors} all="Tất cả nhà thầu" placeholder="Gõ mã/tên nhà thầu…" />
        <Select value={filters.bid} onChange={(v) => setF('bid', v)} options={options?.bidPackages} all="Tất cả gói thầu" />
      </div>
      <div className="filter-search">
        <input value={filters.q} onChange={(e) => setF('q', e.target.value)} placeholder="Tìm mã/tên NV, đơn vị, sản phẩm, mã QLNB…" />
        <button className="btn ghost" onClick={() => setFilters(emptyRevenueFilters)}>Xoá lọc ({activeFilterCount})</button>
      </div>
    </div>
  );
}

export function usePeriodsAndFilters(api) {
  const [periods, setPeriods] = React.useState([]);
  const [ky, setKy] = React.useState('');
  const [filters, setFilters] = React.useState(emptyRevenueFilters);
  const [options, setOptions] = React.useState(null);
  React.useEffect(() => { api.periods().then((p) => { setPeriods(p.periods || []); setKy(p.latest); }); }, []);
  React.useEffect(() => { if (ky) api.filters(ky).then(setOptions); }, [ky]);
  return { periods, ky, setKy, filters, setFilters, options };
}
