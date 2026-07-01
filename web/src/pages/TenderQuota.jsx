import React, { useEffect, useState } from 'react';
import { api, downloadExport } from '../api.js';
import { Spinner, Bar } from '../components.jsx';

// Cơ số thầu: lọc theo ngưỡng còn lại + gói thầu, cảnh báo màu.
const FILTERS = [
  { key: 'all', label: 'Tất cả', params: {} },
  { key: 'low', label: 'Sắp cạn <10%', params: { remainMax: 10 } },
  { key: 'mid', label: 'Dưới 30%', params: { remainMax: 30 } },
  { key: 'high', label: 'Tồn nhiều >70%', params: { remainMin: 70 } },
];

export default function TenderQuota() {
  const [f, setF] = useState('all');
  const [bid, setBid] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setData(null);
    const params = { ...FILTERS.find((x) => x.key === f).params, ...(bid ? { bid } : {}) };
    api.cst(params).then((d) => setData(d.rows));
  }, [f, bid]);

  async function doExport() {
    setBusy(true);
    try { await downloadExport('cst', {}); } catch (e) { alert(e.message); }
    setBusy(false);
  }

  const tone = (p) => (p < 10 ? 'danger' : p < 30 ? 'warn' : '');

  return (
    <>
      <div className="chips">
        {FILTERS.map((x) => (
          <button key={x.key} className={'chip' + (f === x.key ? ' active' : '')} onClick={() => setF(x.key)}>{x.label}</button>
        ))}
      </div>
      <div className="chips">
        {['', 'QĐ139', 'QĐ141'].map((b) => (
          <button key={b} className={'chip' + (bid === b ? ' active' : '')} onClick={() => setBid(b)}>{b || 'Mọi gói thầu'}</button>
        ))}
        <button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy} onClick={doExport}>⬇ Excel</button>
      </div>

      {!data ? <Spinner /> : data.length === 0 ? (
        <div className="center">Không có dòng nào khớp bộ lọc.</div>
      ) : (
        data.map((c, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c.product_name} <span className="muted" style={{ fontWeight: 400 }}>· {c.ham_luong}</span></div>
                <div className="meta muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.unit_name} · {c.bid_package}</div>
              </div>
              <span className={'pill ' + (c.remain_pct < 10 ? 'bad' : c.remain_pct < 30 ? 'warn' : 'ok')}>{c.remain_pct}%</span>
            </div>
            <Bar value={c.remain_qty} max={c.bid_qty_initial} tone={tone(c.remain_pct)} />
            <div className="meta muted" style={{ marginTop: 5 }}>
              Còn {c.remain_qty.toLocaleString('vi-VN')} / {c.bid_qty_initial.toLocaleString('vi-VN')} · đã bán {c.sold_qty.toLocaleString('vi-VN')}
            </div>
          </div>
        ))
      )}
    </>
  );
}
