import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money } from '../util.js';
import { Spinner, Bar } from '../components.jsx';

const FILTERS = [
  { key: 'all', label: 'Tất cả', params: {} },
  { key: 'empty', label: 'Chưa bán', params: { status: 'empty' } },
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

const n = (v) => Number(v || 0).toLocaleString('vi-VN');
const compact = (v) => String(v || '—').replace('Công Ty ', '').replace('Tnhh ', '');
function groupOf(code) {
  const m = String(code || '').match(/\.(N\d)\./i);
  return m ? m[1].toUpperCase() : '';
}
function decision(c) {
  const p = Number(c.remain_pct || 0);
  const remain = Number(c.remain_qty || 0);
  const sold = Number(c.sold_qty || 0);
  if (remain <= 0) return { cls: 'muted-pill', text: 'Hết CST' };
  if (sold <= 0 && remain > 0) return { cls: 'bad', text: '⚠️ Chưa bán' };
  if (p > 80) return { cls: 'warn', text: '🔴 Chưa khai thác' };
  if (p > 50) return { cls: 'warn', text: '🟡 Còn nhiều' };
  return { cls: 'ok', text: '✅ Đang bán' };
}
function pctTone(p) {
  if (p < 10) return 'bad';
  if (p < 30 || p > 80) return 'warn';
  return 'ok';
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
    try {
      const raw = sessionStorage.getItem('app_nav_payload');
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.tab === 'cst' && p.cstFilter === 'low') setF('low');
      if (p.tab === 'cst' && p.cstFilter === 'high') setF('high');
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    setData(null);
    const selected = FILTERS.find((x) => x.key === f) || FILTERS[0];
    const params = { ...selected.params, ...(bid ? { bid } : {}), ...filters };
    api.cst(params).then((d) => setData(d.rows));
  }, [f, bid, filters]);

  function setFilter(k, v) { setFilters((x) => ({ ...x, [k]: v })); }
  function reset() { setFilters(empty); setBid(''); setF('all'); }
  async function doExport() {
    setBusy(true);
    try { await downloadExport('cst', { bid, ...filters }); } catch (e) { alert(e.message); }
    setBusy(false);
  }

  const totalRemain = data ? data.reduce((s, r) => s + (Number(r.remain_amount) || 0), 0) : 0;
  const totalSold = data ? data.reduce((s, r) => s + (Number(r.sold_amount) || 0), 0) : 0;
  const totalBid = data ? data.reduce((s, r) => s + (Number(r.bid_amount) || 0), 0) : 0;
  const lowCount = data ? data.filter((r) => Number(r.remain_pct || 0) < 10).length : 0;
  const emptyCount = data ? data.filter((r) => Number(r.sold_qty || 0) === 0 && Number(r.remain_qty || 0) > 0).length : 0;
  const highCount = data ? data.filter((r) => Number(r.remain_pct || 0) > 80).length : 0;

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
          <input value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Tìm đơn vị, sản phẩm, mã QLNB, hoạt chất, gói thầu…" />
          <button className="btn ghost" onClick={reset}>Xoá lọc</button>
          <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">Dòng CST</div><div className="value">{data ? data.length.toLocaleString('vi-VN') : '—'}</div></div>
        <div className="kpi"><div className="label">Tổng cơ số thầu</div><div className="value small">{data ? money(totalBid) : '—'}</div></div>
        <div className="kpi"><div className="label">TT đã bán</div><div className="value small">{data ? money(totalSold) : '—'}</div></div>
        <div className="kpi"><div className="label">TT còn lại</div><div className="value small">{data ? money(totalRemain) : '—'}</div></div>
      </div>

      {data && (
        <div className="card cst-alert-card">
          <b>Cảnh báo CST giống app cũ:</b>
          <span className="pill bad">Sắp cạn/Hết CST: {lowCount.toLocaleString('vi-VN')}</span>
          <span className="pill bad">Chưa bán: {emptyCount.toLocaleString('vi-VN')}</span>
          <span className="pill warn">Chưa khai thác/tồn nhiều: {highCount.toLocaleString('vi-VN')}</span>
        </div>
      )}

      {!data ? <Spinner /> : data.length === 0 ? (
        <div className="center">Không có dòng nào khớp bộ lọc.</div>
      ) : (
        <div className="list-grid">
          {data.slice(0, 600).map((c, i) => {
            const st = decision(c);
            const pct = Number(c.remain_pct || 0);
            return (
              <div key={`${c.unit_code}-${c.iit_code || c.product_name}-${c.emp_code}-${i}`} className={'card cst-list-card ' + (pct > 70 ? 'highlight-need' : '')}>
                <div className="list-card-title">
                  <div>
                    <div className="name">{c.product_name || '—'}</div>
                    <div className="meta mono">{c.iit_code || '—'} · {c.active_ingredient || '—'} · {c.ham_luong || '—'} · {c.uom || '—'}</div>
                  </div>
                  <span className={'pill ' + pctTone(pct)}>{c.remain_pct}%</span>
                </div>
                <Bar value={Math.max(0, Math.min(100, pct))} max={100} tone={pct < 10 || pct > 80 ? 'warn' : ''} />
                <div className="meta muted" style={{ marginTop: 6 }}>{c.unit_name || c.unit_code || '—'} · NV {c.emp_code || c.sales_emps || '—'}</div>
                <div className="list-card-meta">
                  <span className="pill muted-pill">Nhóm {groupOf(c.iit_code) || '—'}</span>
                  <span className="pill muted-pill">UT {c.priority || '—'}</span>
                  <span className="pill muted-pill">{compact(c.bid_package)}</span>
                  <span className={'pill ' + st.cls}>{st.text}</span>
                </div>
                <div className="cst-metrics">
                  <span>Giá thầu <b>{n(c.bid_price)}</b></span>
                  <span>Giá bán <b>{n(c.sale_price)}</b></span>
                  <span>Tổng TT <b>{n(c.bid_qty_initial)}</b></span>
                  <span>CST còn <b>{n(c.remain_qty)}</b></span>
                  <span>SL bán <b>{n(c.sold_qty)}</b></span>
                  <span>TT bán <b>{money(c.sold_amount)}</b></span>
                  <span>TT còn <b>{money(c.remain_amount)}</b></span>
                  <span>Nguồn <b>{c.source_from_date || '—'}</b></span>
                </div>
              </div>
            );
          })}
          {data.length > 600 && <p className="muted" style={{ textAlign: 'center', fontSize: 12, paddingBottom: 12 }}>Đang hiển thị 600 dòng đầu, dùng bộ lọc hoặc xuất Excel để xem toàn bộ {data.length.toLocaleString('vi-VN')} dòng.</p>}
        </div>
      )}
    </>
  );
}
