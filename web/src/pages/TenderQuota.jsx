import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money } from '../util.js';
import { Spinner, Bar } from '../components.jsx';

const FILTERS = [
  { key: 'all', label: 'Tất cả', params: {} },
  { key: 'low', label: 'Sắp cạn <10%', params: { remainMax: 10 } },
  { key: 'mid', label: 'Dưới 30%', params: { remainMax: 30 } },
  { key: 'high', label: 'Tồn nhiều >70%', params: { remainMin: 70 } },
];
const empty = { emp: '', unit: '', product: '', priority: '', q: '' };
function Select({ value, onChange, options, all }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {(options || []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}

export default function TenderQuota({ me }) {
  const [f, setF] = useState('all');
  const [bid, setBid] = useState('');
  const [filters, setFilters] = useState(empty);
  const [options, setOptions] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.filters().then(setOptions); }, []);
  useEffect(() => {
    setData(null);
    const params = { ...FILTERS.find((x) => x.key === f).params, ...(bid ? { bid } : {}), ...filters };
    api.cst(params).then((d) => setData(d.rows));
  }, [f, bid, filters]);

  function setFilter(k, v) { setFilters((x) => ({ ...x, [k]: v })); }
  function reset() { setFilters(empty); setBid(''); setF('all'); }
  async function doExport() {
    setBusy(true);
    try { await downloadExport('cst', { bid, ...filters }); } catch (e) { alert(e.message); }
    setBusy(false);
  }
  const tone = (p) => (p < 10 ? 'danger' : p < 30 ? 'warn' : '');
  const totalRemain = data ? data.reduce((s, r) => s + (Number(r.remain_amount) || 0), 0) : 0;
  const totalSold = data ? data.reduce((s, r) => s + (Number(r.sold_amount) || 0), 0) : 0;

  return (
    <>
      <div className="chips">
        {FILTERS.map((x) => <button key={x.key} className={'chip' + (f === x.key ? ' active' : '')} onClick={() => setF(x.key)}>{x.label}</button>)}
      </div>
      <div className="card filter-card">
        <div className="filter-grid">
          <Select value={bid} onChange={setBid} options={options?.bidPackages} all="Mọi gói thầu" />
          {me.isAdmin && <Select value={filters.emp} onChange={(v) => setFilter('emp', v)} options={options?.employees} all="Tất cả NV" />}
          <Select value={filters.unit} onChange={(v) => setFilter('unit', v)} options={options?.units} all="Tất cả đơn vị" />
          <Select value={filters.product} onChange={(v) => setFilter('product', v)} options={options?.products} all="Tất cả sản phẩm" />
          <Select value={filters.priority} onChange={(v) => setFilter('priority', v)} options={options?.priorities} all="Tất cả UT" />
        </div>
        <div className="filter-search">
          <input value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Tìm đơn vị, sản phẩm, mã QLNB, hoạt chất…" />
          <button className="btn ghost" onClick={reset}>Xoá lọc</button>
          <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">Dòng CST</div><div className="value">{data ? data.length.toLocaleString('vi-VN') : '—'}</div></div>
        <div className="kpi"><div className="label">TT đã bán</div><div className="value small">{data ? money(totalSold) : '—'}</div></div>
        <div className="kpi"><div className="label">TT còn lại</div><div className="value small">{data ? money(totalRemain) : '—'}</div></div>
      </div>

      {!data ? <Spinner /> : data.length === 0 ? (
        <div className="center">Không có dòng nào khớp bộ lọc.</div>
      ) : (
        data.slice(0, 300).map((c, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c.product_name} <span className="muted" style={{ fontWeight: 400 }}>· {c.ham_luong}</span></div>
                <div className="meta muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.unit_name} · {c.bid_package} · NV {c.emp_code || '—'}</div>
              </div>
              <span className={'pill ' + (c.remain_pct < 10 ? 'bad' : c.remain_pct < 30 ? 'warn' : 'ok')}>{c.remain_pct}%</span>
            </div>
            <Bar value={c.remain_qty} max={c.bid_qty_initial} tone={tone(c.remain_pct)} />
            <div className="meta muted" style={{ marginTop: 5 }}>
              Còn {Number(c.remain_qty).toLocaleString('vi-VN')} / {Number(c.bid_qty_initial).toLocaleString('vi-VN')} · đã bán {Number(c.sold_qty).toLocaleString('vi-VN')}
            </div>
            <div className="meta muted" style={{ marginTop: 3 }}>
              Giá thầu {money(c.bid_price)} · Đã bán {money(c.sold_amount)} · Còn lại {money(c.remain_amount)} · UT {c.priority || '—'}
            </div>
          </div>
        ))
      )}
      {data && data.length > 300 && <p className="muted" style={{ textAlign: 'center', fontSize: 12 }}>Đang hiển thị 300 dòng đầu, dùng bộ lọc để thu hẹp thêm.</p>}
    </>
  );
}
