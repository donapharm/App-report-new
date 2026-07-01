import React from 'react';

export const emptyRevenueFilters = { emp: '', unit: '', product: '', route: '', priority: '', contractor: '', bid: '', q: '' };

export function Select({ value, onChange, options, all }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {(options || []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}

export function RevenueFilters({ me, ky, periods, options, filters, setKy, setFilters }) {
  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  return (
    <div className="card filter-card">
      <div className="filter-grid">
        <Select value={ky} onChange={setKy} options={(periods || []).map((p) => ({ key: p.ky, label: p.ky }))} all="Chọn kỳ" />
        {me.isAdmin && <Select value={filters.emp} onChange={(v) => setF('emp', v)} options={options?.employees} all="Tất cả NV" />}
        <Select value={filters.unit} onChange={(v) => setF('unit', v)} options={options?.units} all="Tất cả đơn vị" />
        <Select value={filters.product} onChange={(v) => setF('product', v)} options={options?.products} all="Tất cả sản phẩm" />
        <Select value={filters.route} onChange={(v) => setF('route', v)} options={options?.routes} all="Tất cả tuyến" />
        <Select value={filters.priority} onChange={(v) => setF('priority', v)} options={options?.priorities} all="Tất cả UT" />
        <Select value={filters.contractor} onChange={(v) => setF('contractor', v)} options={options?.contractors} all="Tất cả nhà thầu" />
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
