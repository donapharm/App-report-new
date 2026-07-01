import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, short } from '../util.js';
import { Spinner, RankRow } from '../components.jsx';

const DIMS = { emp: 'Nhân viên', unit: 'Đơn vị', product: 'Sản phẩm' };
const emptyFilters = { emp: '', unit: '', product: '', route: '', priority: '', contractor: '', bid: '', q: '' };

function Select({ value, onChange, options, all }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {(options || []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}

export default function Revenue({ me }) {
  const [periods, setPeriods] = useState([]);
  const [ky, setKy] = useState('');
  const [dim, setDim] = useState(me.isAdmin ? 'emp' : 'unit');
  const [filters, setFilters] = useState(emptyFilters);
  const [options, setOptions] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.periods().then((p) => { setPeriods(p.periods || []); setKy(p.latest); }); }, []);
  useEffect(() => { if (ky) api.filters(ky).then(setOptions); }, [ky]);
  useEffect(() => {
    if (!ky) return;
    setData(null);
    api.revenue(dim, ky, filters).then(setData);
  }, [ky, dim, filters]);

  const total = data ? data.rows.reduce((s, r) => s + r.revenue, 0) : 0;
  const max = data && data.rows.length ? data.rows[0].revenue : 0;
  const activeFilterCount = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);

  function pickDim(d) { setDim(d); }
  function setF(k, v) { setFilters((f) => ({ ...f, [k]: v })); }
  function resetFilters() { setFilters(emptyFilters); }
  function drill(row) {
    if (dim === 'emp') { setF('emp', row.key); setDim('unit'); }
    else if (dim === 'unit') { setF('unit', row.key); setDim('product'); }
  }
  async function doExport() {
    setBusy(true);
    try { await downloadExport('revenue', { ky, dimension: dim, ...filters }); }
    catch (e) { alert(e.message); }
    setBusy(false);
  }

  return (
    <>
      <div className="seg">
        {Object.entries(DIMS).map(([k, v]) => {
          if (k === 'emp' && !me.isAdmin) return null;
          return <button key={k} className={dim === k ? 'active' : ''} onClick={() => pickDim(k)}>{v}</button>;
        })}
      </div>

      <div className="card filter-card">
        <div className="filter-grid">
          <Select value={ky} onChange={setKy} options={periods.map((p) => ({ key: p.ky, label: p.ky }))} all="Chọn kỳ" />
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
          <button className="btn ghost" onClick={resetFilters}>Xoá lọc ({activeFilterCount})</button>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="meta muted">Tổng {DIMS[dim].toLowerCase()} · kỳ {ky} · {data?.rows?.length || 0} dòng nhóm</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}>{money(total)}</div>
        </div>
        <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel</button>
      </div>

      {!data ? <Spinner /> : data.rows.length === 0 ? (
        <div className="center">Không có dữ liệu.</div>
      ) : (
        <div className="card">
          {data.rows.map((r, i) => (
            <RankRow key={r.key} i={i + 1} name={r.label} meta={`${short(r.revenue)} · ${r.quantity.toLocaleString('vi-VN')} SL`} amount={r.revenue} max={max} onClick={dim !== 'product' ? () => drill(r) : undefined} />
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
        {dim !== 'product' ? 'Chạm một dòng để drill-down; bộ lọc luôn chạy ở backend theo quyền.' : 'Đã ở mức sản phẩm'}
      </p>
    </>
  );
}
