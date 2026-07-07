import React from 'react';

export const emptyRevenueFilters = { emp: '', province: '', unit: '', product: '', route: '', priority: '', contractor: '', bid: '', dateFrom: '', dateTo: '', q: '' };

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
  const period = (periods || []).find((p) => p.ky === ky) || {};
  const asOf = period.data_as_of || period.dataAsOf || period.dateTo || period.dateFrom;
  const baseDate = asOf ? new Date(asOf) : new Date();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const clamp = (d) => {
    const s = iso(d);
    if (period.dateFrom && s < period.dateFrom) return period.dateFrom;
    if (period.dateTo && s > period.dateTo) return period.dateTo;
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
  return (
    <div className={'card filter-card' + (open ? ' open' : ' collapsed')}>
      {/* Thanh gọn luôn hiện: kỳ + tìm nhanh + nút đóng/mở + xoá lọc */}
      <div className="filter-bar">
        <div className="filter-ky"><Select value={ky} onChange={setKy} options={(periods || []).map((p) => ({ key: p.ky, label: p.ky }))} all="Chọn kỳ" /></div>
        <input className="filter-quick" value={filters.q} onChange={(e) => setF('q', e.target.value)} placeholder="Tìm mã/tên NV, đơn vị, sản phẩm, mã QLNB…" />
        <button type="button" className="btn ghost filter-toggle" aria-expanded={open} onClick={toggle}>{open ? '▴ Thu gọn lọc' : '▾ Bộ lọc'}{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
        {activeFilterCount > 0 && <button className="btn ghost" onClick={() => setFilters({ ...emptyRevenueFilters })}>Xoá lọc</button>}
      </div>
      {open && (
        <div className="filter-body">
          <div className="filter-asof">
            <b>{asOf ? `Cập nhật đến ${new Date(asOf).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} GMT+7` : 'Chưa có giờ cập nhật'}</b>
            <span>{period.canFilterByDay ? 'Nguồn có ngày chi tiết: lọc ngày/tuần/tháng/quý dùng đúng ngày dòng.' : 'Kỳ này chỉ có tổng theo tháng: lọc ngày không phân bổ giả.'}</span>
          </div>
          <div className="filter-grid">
            {me.isAdmin && <ComboSelect value={filters.emp} onChange={(v) => setF('emp', v)} options={options?.employees} all="Tất cả NV" />}
            <Select value={filters.province} onChange={(v) => setF('province', v)} options={options?.provinces} all="Tất cả tỉnh/thành" />
            <ComboSelect value={filters.unit} onChange={(v) => setF('unit', v)} options={options?.units} all="Tất cả đơn vị" placeholder="Gõ mã/tên đơn vị…" />
            <ComboSelect value={filters.product} onChange={(v) => setF('product', v)} options={options?.products} all="Tất cả sản phẩm" placeholder="Gõ tên/mã QLNB/hoạt chất…" />
            <Select value={filters.route} onChange={(v) => setF('route', v)} options={options?.routes} all="Tất cả tuyến" />
            <Select value={filters.priority} onChange={(v) => setF('priority', v)} options={options?.priorities} all="Tất cả UT" />
            <ComboSelect value={filters.contractor} onChange={(v) => setF('contractor', v)} options={options?.contractors} all="Tất cả nhà thầu" placeholder="Gõ mã/tên nhà thầu…" />
            <Select value={filters.bid} onChange={(v) => setF('bid', v)} options={options?.bidPackages} all="Tất cả gói thầu" />
            <input type="date" value={filters.dateFrom || ''} onChange={(e) => setF('dateFrom', e.target.value)} />
            <input type="date" value={filters.dateTo || ''} onChange={(e) => setF('dateTo', e.target.value)} />
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
  React.useEffect(() => { api.periods().then((p) => { setPeriods(p.periods || []); setKy(p.latest); }); }, []);
  React.useEffect(() => { if (ky) api.filters(ky).then(setOptions); }, [ky]);
  return { periods, ky, setKy, filters, setFilters, options };
}
