import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { money, pct as fmtPct, pairText, unitText } from '../util.js';
import { Spinner, Bar } from '../components.jsx';
import { ComboSelect, Select } from './revenueFilters.jsx';

const FILTERS = [
  { key: 'all', label: 'Tất cả', params: {} },
  { key: 'empty', label: 'Chưa bán', params: { status: 'empty' } },
  { key: 'low', label: 'Sắp cạn <10%', params: { remainMax: 10 } },
  { key: 'mid', label: 'Dưới 30%', params: { remainMax: 30 } },
  { key: 'high', label: 'Tồn nhiều >70%', params: { remainMin: 70 } },
];
const empty = { emp: '', unit: '', product: '', priority: '', q: '' };
const n = (v) => Number(v || 0).toLocaleString('vi-VN');
const compact = (v) => String(v || '—').replace('Công Ty ', '').replace('Tnhh ', '');
function groupOf(code) { const m = String(code || '').match(/\.(N\d)\./i); return m ? m[1].toUpperCase() : ''; }
function qdOf(c) { const m = String(`${c.iit_code || ''} ${c.bid_package || ''}`).match(/QĐ\s*(\d+)|QD\s*(\d+)/i); return m ? `QĐ${m[1] || m[2]}` : ''; }
function qd139Ingredient(c, qd) { return qd === 'QĐ139' && (c.active_ingredient || c.ham_luong); }
function decision(c) {
  const p = Number(c.remain_pct || 0), remain = Number(c.remain_qty || 0), sold = Number(c.sold_qty || 0);
  if (remain <= 0 || p <= 1) return { cls: 'muted-pill', text: 'Hết CST', action: 'Đã khai thác hết cơ số.' };
  if (sold <= 0 && remain > 0) return { cls: 'bad', text: '⚠️ Chưa bán', action: 'Cần tiếp cận đơn vị này.' };
  if (p < 10) return { cls: 'bad', text: '🔴 Sắp hết', action: 'Sắp hết, đẩy đơn bổ sung cơ số.' };
  if (p > 80) return { cls: 'warn', text: '🟡 Tồn nhiều', action: 'Còn dư địa, đẩy mạnh bán hàng.' };
  if (p > 50) return { cls: 'warn', text: '🟡 Còn nhiều', action: 'Theo dõi và tiếp tục khai thác.' };
  return { cls: 'ok', text: '✅ Đang bán', action: 'Tiếp tục giữ nhịp bán.' };
}
function pctTone(p) { if (p < 10) return 'bad'; if (p < 30 || p > 80) return 'warn'; return 'ok'; }
function sourceLabel(c) {
  const base = c.cst_baseline_covered_ky || (String(c.source_from_date || '').includes('MAY') ? '05.2026' : '');
  const up = c.cst_upload_ky || '';
  if (base && up) return `Baseline ${base} + bán đến ${up.split(',').at(-1)}`;
  if (base) return `Cập nhật đến kỳ ${base}`;
  return c.source_from_date || '—';
}
function contractorText(c) { return pairText(c.contractor_code, c.contractor_name); }
function unitRollup(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const key = r.unit_code || r.unit_name || '—';
    const cur = m.get(key) || { key, unit_code: r.unit_code || '', unit_name: r.unit_name || key, rows: [], remainAmount: 0, low: 0, empty: 0, remainQty: 0 };
    cur.rows.push(r); cur.remainAmount += Number(r.remain_amount || 0); cur.remainQty += Number(r.remain_qty || 0);
    if (Number(r.remain_pct || 0) < 10) cur.low += 1;
    if (Number(r.sold_qty || 0) === 0 && Number(r.remain_qty || 0) > 0) cur.empty += 1;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => (b.low + b.empty) - (a.low + a.empty) || b.remainAmount - a.remainAmount);
}

function CstCard({ c, i, duplicateName }) {
  const st = decision(c); const pct = Number(c.remain_pct || 0); const qd = qdOf(c);
  return (
    <div key={`${c.unit_code}-${c.iit_code || c.product_name}-${c.emp_code}-${i}`} className={'card detail-card cst-list-card ' + (pct > 70 || pct < 10 ? 'highlight-need' : '')}>
      <div className="detail-head">
        <div className="detail-title-wrap">
          <span className="rank">{i + 1}</span>
          <div>
            <div className="detail-title">{c.product_name || '—'}</div>
            <div className="detail-sub mono">{c.iit_code || '—'} · {qd || '—'} · {c.uom || '—'}</div>
            {(qd139Ingredient(c, qd) || (duplicateName && qd !== 'QĐ141' && (c.active_ingredient || c.ham_luong))) && <div className="detail-sub">{c.active_ingredient || '—'} · {c.ham_luong || '—'}</div>}
          </div>
        </div>
        <div className="detail-money cst-money">{money(c.remain_amount)}<em>TT còn</em></div>
      </div>
      <Bar value={Math.max(0, Math.min(100, pct))} max={100} tone={pct < 10 ? 'danger' : (pct < 30 || pct > 80 ? 'warn' : 'ok')} />
      <div className="progress-caption">Đã bán {fmtPct(Math.max(0, +(100 - pct).toFixed(1)))} · còn {fmtPct(pct)}</div>
      <div className="detail-entity"><b>{unitText(c.unit_code, c.unit_name)}</b><span>NV {c.emp_code || c.sales_emps || '—'}</span></div>
      <div className="list-card-meta">
        <span className={'pill ' + pctTone(pct)}>Còn {c.remain_pct}%</span>
        <span className="pill muted-pill">Nhóm {groupOf(c.iit_code) || '—'}</span>
        <span className="pill muted-pill">UT {c.priority || '—'}</span>
        <span className="pill muted-pill">NT {contractorText(c)}</span>
        <span className="pill muted-pill">{compact(c.bid_package)}</span>
        <span className={'pill ' + st.cls}>{st.text}</span>
      </div>
      <div className="action-hint">👉 {st.action}</div>
      <div className="cst-metrics">
        <span>Giá thầu <b>{money(c.bid_price)}</b></span>
        <span>SL thầu <b>{n(c.bid_qty_initial)}</b></span>
        <span>CST còn <b>{n(c.remain_qty)}</b></span>
        <span>SL bán <b>{n(c.sold_qty)}</b></span>
        <span>TT bán <b>{money(c.sold_amount)}</b></span>
        <span className="wide-metric">Nguồn <b>{sourceLabel(c)}</b></span>
      </div>
    </div>
  );
}

export default function TenderQuota({ me }) {
  const [f, setF] = useState('all');
  const [bid, setBid] = useState('');
  const [filters, setFilters] = useState(empty);
  const [options, setOptions] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('unit');
  const [actionFirst, setActionFirst] = useState(true);
  const [openUnits, setOpenUnits] = useState({});

  useEffect(() => { api.filters().then(setOptions); }, []);
  useEffect(() => {
    try { const p = JSON.parse(sessionStorage.getItem('app_nav_payload') || '{}'); if (p.tab === 'cst' && p.cstFilter === 'low') setF('low'); if (p.tab === 'cst' && p.cstFilter === 'high') setF('high'); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    setData(null);
    const selected = FILTERS.find((x) => x.key === f) || FILTERS[0];
    const params = { ...selected.params, ...(bid ? { bid } : {}), ...filters };
    api.cst(params).then((d) => setData(d.rows));
  }, [f, bid, filters]);

  function setFilter(k, v) { setFilters((x) => ({ ...x, [k]: v })); }
  function reset() { setFilters(empty); setBid(''); setF('all'); }
  async function doExport() { setBusy(true); try { await downloadExport('cst', { bid, ...filters }); } catch (e) { alert(e.message); } setBusy(false); }

  const sortedData = useMemo(() => {
    const rows = [...(data || [])];
    if (!actionFirst) return rows;
    return rows.sort((a, b) => {
      const score = (r) => (Number(r.remain_pct || 0) < 10 ? 3 : 0) + (Number(r.sold_qty || 0) === 0 && Number(r.remain_qty || 0) > 0 ? 2 : 0) + (Number(r.remain_pct || 0) > 80 ? 1 : 0);
      return score(b) - score(a) || Number(a.remain_pct || 0) - Number(b.remain_pct || 0);
    });
  }, [data, actionFirst]);
  const groups = useMemo(() => unitRollup(sortedData), [sortedData]);
  const duplicateProducts = useMemo(() => new Set(Object.entries((sortedData || []).reduce((m, r) => { const k = r.product_name || ''; if (k) m[k] = (m[k] || 0) + 1; return m; }, {})).filter(([, c]) => c > 1).map(([k]) => k)), [sortedData]);
  const selectedUnit = filters.unit ? groups.find((g) => g.key === filters.unit || g.unit_name === filters.unit) : null;
  const totalRemain = data ? data.reduce((s, r) => s + (Number(r.remain_amount) || 0), 0) : 0;
  const totalSold = data ? data.reduce((s, r) => s + (Number(r.sold_amount) || 0), 0) : 0;
  const totalBid = data ? data.reduce((s, r) => s + (Number(r.bid_amount) || 0), 0) : 0;
  const lowCount = data ? data.filter((r) => Number(r.remain_pct || 0) < 10).length : 0;
  const emptyCount = data ? data.filter((r) => Number(r.sold_qty || 0) === 0 && Number(r.remain_qty || 0) > 0).length : 0;
  const highCount = data ? data.filter((r) => Number(r.remain_pct || 0) > 80).length : 0;

  return (
    <>
      <div className="chips">{FILTERS.map((x) => <button key={x.key} className={'chip' + (f === x.key ? ' active' : '')} onClick={() => setF(x.key)}>{x.label}</button>)}</div>
      <div className="card filter-card">
        <div className="filter-grid">
          <Select value={bid} onChange={setBid} options={options?.bidPackages} all="Mọi gói thầu" />
          {me.isAdmin && <ComboSelect value={filters.emp} onChange={(v) => setFilter('emp', v)} options={options?.employees} all="Tất cả NV" />}
          <ComboSelect value={filters.unit} onChange={(v) => setFilter('unit', v)} options={options?.units} all="Tất cả đơn vị" placeholder="Gõ mã/tên đơn vị…" />
          <ComboSelect value={filters.product} onChange={(v) => setFilter('product', v)} options={options?.products} all="Tất cả sản phẩm" placeholder="Gõ tên/mã QLNB/hoạt chất…" />
          <Select value={filters.priority} onChange={(v) => setFilter('priority', v)} options={options?.priorities} all="Tất cả UT" />
        </div>
        <div className="filter-search">
          <input value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Tìm đơn vị, sản phẩm, mã QLNB, hoạt chất, gói thầu…" />
          <button className="btn ghost" onClick={reset}>Xoá lọc</button>
          <button className="btn ghost" disabled={busy} onClick={doExport}>⬇ Excel</button>
        </div>
      </div>

      <div className="seg compact view-toggle">
        <button className={view === 'unit' ? 'active' : ''} onClick={() => setView('unit')}>Gom theo ĐV</button>
        <button className={view === 'flat' ? 'active' : ''} onClick={() => setView('flat')}>Danh sách dòng</button>
        <button className={actionFirst ? 'active' : ''} onClick={() => setActionFirst((x) => !x)}>Ưu tiên cần làm</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">Dòng CST</div><div className="value">{data ? data.length.toLocaleString('vi-VN') : '—'}</div></div>
        <div className="kpi"><div className="label">Tổng cơ số thầu</div><div className="value small">{data ? money(totalBid) : '—'}</div></div>
        <div className="kpi"><div className="label">TT đã bán</div><div className="value small">{data ? money(totalSold) : '—'}</div></div>
        <div className="kpi"><div className="label">TT còn lại</div><div className="value small">{data ? money(totalRemain) : '—'}</div></div>
      </div>

      {selectedUnit && <div className="card unit-focus"><b>{unitText(selectedUnit.unit_code || selectedUnit.key, selectedUnit.unit_name)}</b><span>{selectedUnit.rows.length} mã QLNB · {selectedUnit.low} sắp hết · {selectedUnit.empty} chưa bán · còn {money(selectedUnit.remainAmount)}</span></div>}
      {data && <div className="card cst-alert-card"><b>Cảnh báo CST giống app cũ:</b><span className="pill bad">Sắp cạn/Hết CST: {lowCount.toLocaleString('vi-VN')}</span><span className="pill bad">Chưa bán: {emptyCount.toLocaleString('vi-VN')}</span><span className="pill warn">Chưa khai thác/tồn nhiều: {highCount.toLocaleString('vi-VN')}</span></div>}

      {!data ? <Spinner /> : data.length === 0 ? <div className="center">Không có dòng nào khớp bộ lọc.</div> : view === 'unit' ? (
        <div className="unit-rollup-grid">
          {groups.slice(0, 120).map((g) => {
            const open = openUnits[g.key] || filters.unit;
            return <div className="card unit-rollup" key={g.key}>
              <div className="unit-rollup-head" onClick={() => setOpenUnits((x) => ({ ...x, [g.key]: !x[g.key] }))}>
                <div><b>{unitText(g.unit_code || g.key, g.unit_name)}</b><div className="meta">{g.rows.length} mã QLNB · còn {money(g.remainAmount)}</div></div>
                <div className="list-card-meta"><span className="pill bad">{g.low} sắp hết</span><span className="pill bad">{g.empty} chưa bán</span><span className="pill muted-pill">{n(g.remainQty)} CST còn</span></div>
              </div>
              {open && <div className="list-grid nested-grid">{g.rows.slice(0, 80).map((c, i) => <CstCard key={`${g.key}-${i}`} c={c} i={i} duplicateName={duplicateProducts.has(c.product_name)} />)}</div>}
            </div>;
          })}
        </div>
      ) : (
        <div className="list-grid">{sortedData.slice(0, 600).map((c, i) => <CstCard key={i} c={c} i={i} duplicateName={duplicateProducts.has(c.product_name)} />)}{sortedData.length > 600 && <p className="muted" style={{ textAlign: 'center', fontSize: 12, paddingBottom: 12 }}>Đang hiển thị 600 dòng đầu, dùng bộ lọc hoặc xuất Excel để xem toàn bộ {sortedData.length.toLocaleString('vi-VN')} dòng.</p>}</div>
      )}
    </>
  );
}
