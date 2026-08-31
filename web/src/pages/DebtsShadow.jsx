import React, { useMemo, useState } from 'react';
import { api as defaultApi } from '../api.js';
import { Spinner } from '../components.jsx';

const REASON_LABELS = {
  unmapped: 'Thiếu binding chính thức',
  legal_entity_unattested: 'Mã số chưa được attestation',
  ambiguous: 'Binding chưa đơn trị',
  uom_mismatch: 'Đơn vị tính không khớp',
  amount_inconsistent: 'Số tiền nguồn không nhất quán',
  invoice_00002319: 'Hóa đơn 00002319 giữ quarantine',
};

const count = (value) => Number(value || 0).toLocaleString('vi-VN');
const reasonLabel = (value) => REASON_LABELS[value] || value || 'Không xác định';

function exportCsv(data) {
  const rows = [['Pháp nhân', 'Ngày HĐ', 'Số HĐ', 'Dòng nguồn', 'Mã đơn vị', 'QLNB', 'ĐVT', 'Lý do']];
  for (const row of data.quarantineRows || []) rows.push([
    data.legalEntity, row.invoiceDate, row.invoiceNumber, row.sourceLineId,
    row.unitCode, row.qlnbCode, row.uom, (row.reasons || []).map(reasonLabel).join(' | '),
  ]);
  const body = `\ufeff${rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `cong-no-${data.period}-${data.legalEntity}-quarantine.csv`; link.click();
  URL.revokeObjectURL(url);
}

export default function DebtsShadow({ me, apiClient = defaultApi }) {
  const [period, setPeriod] = useState('2026-08');
  const [legalEntity, setLegalEntity] = useState('DONA');
  const [data, setData] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('ALL');

  const rows = useMemo(() => (data?.quarantineRows || []).filter((row) => (
    reason === 'ALL' || (row.reasons || []).includes(reason)
  )), [data, reason]);

  async function load() {
    setLoading(true); setError('');
    try {
      const [ready, preview] = await Promise.all([
        apiClient.debtsShadowReadiness(), apiClient.debtsShadowPreview({ period, legalEntity }),
      ]);
      setReadiness(ready); setData(preview); setReason('ALL');
    } catch (e) { setError(e.message || 'Không tải được dữ liệu Công nợ.'); }
    finally { setLoading(false); }
  }

  if (!me?.is_ceo) return <div className="card"><p>Menu này chỉ dành cho tài khoản CEO.</p></div>;
  return <div className="debts-shadow-page">
    <div className="card debts-shadow-banner">
      <div><b>🧮 Công nợ T08 · Chỉ xem</b><p>Preview trực tiếp từ nguồn Công nợ. Chưa publish, không ghi snapshot và không đổi dữ liệu doanh thu.</p></div>
      <span className="pill warn">READ-ONLY</span>
    </div>
    <div className="card debts-shadow-controls">
      <label><span>Kỳ</span><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="2026-08">T08.2026</option></select></label>
      <label><span>Pháp nhân</span><select value={legalEntity} onChange={(e) => setLegalEntity(e.target.value)}><option>DONA</option><option>AFP</option></select></label>
      <button type="button" className="btn" onClick={load} disabled={loading}>{loading ? 'Đang tải…' : 'Xem preview'}</button>
      <button type="button" className="btn ghost" onClick={() => data && exportCsv(data)} disabled={!data || loading}>Xuất CSV quarantine</button>
    </div>
    {error && <div className="card catalog-alert error" role="alert">⚠ {error}</div>}
    {loading && !data && <div className="card"><Spinner /> Đang đọc nguồn Công nợ…</div>}
    {data && <>
      <div className="debts-shadow-kpis">
        <div className="card"><small>Tổng dòng</small><b>{count(data.rowCount)}</b></div>
        <div className="card"><small>Hóa đơn</small><b>{count(data.invoiceCount)}</b></div>
        <div className="card ok"><small>Đã map</small><b>{count(data.mappedCount)}</b></div>
        <div className="card warn"><small>Quarantine</small><b>{count(data.quarantinedCount)}</b></div>
      </div>
      <div className="card debts-shadow-proof">
        <b>{data.legalEntity} · {data.period}</b>
        <span>Mapping: {data.mappingVersion || '—'} · checksum {String(data.mappingChecksum || '').slice(0, 12)}…</span>
        <span>Persisted: <b>{data.persisted ? 'CÓ' : 'KHÔNG'}</b> · Publish ready: <b>{readiness?.publishReady ? 'CÓ' : 'KHÔNG'}</b></span>
      </div>
      <div className="card debts-shadow-reasons">
        <b>Lý do quarantine</b>
        <div><button className={reason === 'ALL' ? 'btn' : 'btn ghost'} onClick={() => setReason('ALL')}>Tất cả · {count(data.quarantinedCount)}</button>
          {Object.entries(data.quarantineReasonCounts || {}).map(([key, value]) => <button key={key} className={reason === key ? 'btn' : 'btn ghost'} onClick={() => setReason(key)}>{reasonLabel(key)} · {count(value)}</button>)}</div>
      </div>
      <div className="card table-wrap debts-shadow-table-wrap"><table className="table debts-shadow-table"><thead><tr><th>Ngày</th><th>Hóa đơn</th><th>Mã đơn vị</th><th>QLNB</th><th>ĐVT</th><th>Lý do giữ lại</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.sourceLineId}><td>{row.invoiceDate}</td><td><b>{row.invoiceNumber}</b><small>{row.invoiceLineId}</small></td><td>{row.unitCode}</td><td>{row.qlnbCode}</td><td>{row.uom}</td><td>{(row.reasons || []).map(reasonLabel).join(' · ')}</td></tr>)}
        {!rows.length && <tr><td colSpan="6">Không có dòng phù hợp bộ lọc.</td></tr>}
      </tbody></table></div>
    </>}
  </div>;
}
