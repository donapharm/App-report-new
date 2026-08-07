import React, { useEffect, useState } from 'react';
import { api as defaultApi } from '../api.js';
import { Kpi, Spinner } from '../components.jsx';
import { maskNumberText } from '../privacyMask.js';

// MÀN "CHƯA ĐỒNG BỘ" (SPEC_REVENUE_SYNC_EXCEPTIONS.md)
// Chỉ ĐỌC. Mọi số do backend tính và đã kiểm bất biến; màn này không cộng trừ lại.
const money = (value) => (value == null ? '—' : maskNumberText(`${Number(value).toLocaleString('vi-VN')}đ`));
const GROUP_LABEL = {
  excluded: { text: 'Bị loại — KHÔNG tính tiền', tone: 'warn' },
  incomplete: { text: 'Vào đủ tiền nhưng THIẾU THÔNG TIN', tone: 'warn' },
  note: { text: 'Ghi chú — vẫn tính tiền', tone: 'ok' },
};
const periodValue = (item) => String(item?.ky || item || '').trim();
const rowSearchText = (row) => [
  row.orderCode,
  row.productCode,
  row.unitCode,
  row.empCode,
  row.code,
  row.sourceSystem,
].map((value) => String(value || '').toLocaleLowerCase('vi-VN')).join(' ');

export default function SyncExceptions({ ky: initialKy = '', onNavigate, apiClient = defaultApi }) {
  const [periods, setPeriods] = useState([]);
  const [ky, setKy] = useState(initialKy);
  const [query, setQuery] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [periodReloadKey, setPeriodReloadKey] = useState(0);
  const [reportReloadKey, setReportReloadKey] = useState(0);
  const [periodState, setPeriodState] = useState({ loading: true, error: '' });
  const [state, setState] = useState({ loading: false, data: null, error: '' });

  useEffect(() => {
    let alive = true;
    setPeriodState({ loading: true, error: '' });
    apiClient.periods().then((payload) => {
      if (!alive) return;
      const list = (payload?.periods || payload || []).map(periodValue).filter(Boolean);
      setPeriods(list);
      setKy((current) => current || periodValue(payload?.latest) || list.at(-1) || '');
      setPeriodState({ loading: false, error: '' });
    }).catch((error) => {
      if (alive) setPeriodState({ loading: false, error: error.message || 'Không tải được danh sách kỳ' });
    });
    return () => { alive = false; };
  }, [apiClient, periodReloadKey]);

  useEffect(() => {
    if (!ky) return undefined;
    let alive = true;
    setState({ loading: true, data: null, error: '' });
    apiClient.syncExceptions(ky, { freshKey: reportReloadKey > 0 ? reportReloadKey : null })
      .then((data) => { if (alive) setState({ loading: false, data, error: '' }); })
      .catch((error) => { if (alive) setState({ loading: false, data: null, error: error.message || 'Không tải được' }); });
    return () => { alive = false; };
  }, [apiClient, ky, reportReloadKey]);

  const selectPeriod = (event) => {
    setState({ loading: true, data: null, error: '' });
    setKy(event.target.value);
    setQuery('');
    setReasonCode('');
  };
  const reload = () => {
    setPeriodReloadKey((value) => value + 1);
    if (!ky) return;
    setState({ loading: true, data: null, error: '' });
    setReportReloadKey((value) => value + 1);
  };
  const controls = <div className="card">
    <div className="section-head">Chưa đồng bộ <small>{ky ? `· kỳ ${ky}` : '· đang xác định kỳ'}</small></div>
    <div className="sync-exceptions-toolbar">
      <button type="button" className="btn secondary" onClick={() => onNavigate?.('overview')}>← Quay lại Tổng quan</button>
      <label><span>Kỳ đối chiếu</span><select aria-label="Kỳ đối chiếu" value={ky} onChange={selectPeriod}
        disabled={periodState.loading && !periods.length}>
        {!periods.length && <option value={ky}>{ky || (periodState.loading ? 'Đang tải…' : 'Chưa có kỳ')}</option>}
        {periods.map((period) => <option key={period} value={period}>{period}</option>)}
      </select></label>
      <button type="button" className="btn secondary" onClick={reload}>Làm mới</button>
    </div>
    {periodState.error && <div className="employee-cost-match-warning" role={ky ? 'status' : 'alert'}>
      {periodState.error}{ky ? ' — vẫn đang hiển thị kỳ đã chọn.' : ''}
    </div>}
  </div>;

  if (state.error) return <section className="employee-cost-page">{controls}<div className="card"><div className="employee-cost-match-warning" role="alert">{state.error}</div></div></section>;
  if (state.loading || !ky || !state.data) return <section className="employee-cost-page">{controls}<div className="card"><Spinner /></div></section>;

  const data = state.data;
  // ‼ Chưa chạy phân loại KHÁC HẲN đã chạy và sạch — nói thẳng, không để tưởng sạch.
  if (!data?.ran) {
    return <section className="employee-cost-page">{controls}<div className="card">
      <div className="employee-cost-match-warning" role="status">
        <b>Kỳ này chưa chạy phân loại.</b> Chưa có căn cứ để nói kỳ này sạch hay không —
        đây <b>không phải</b> là "không có dòng nào bị loại".
      </div>
    </div></section>;
  }

  const { report } = data;
  const { totals } = report;
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const byCode = Array.isArray(report.byCode) ? report.byCode : [];
  const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN');
  const filteredRows = rows.filter((row) => (!reasonCode || row.code === reasonCode)
    && (!normalizedQuery || rowSearchText(row).includes(normalizedQuery)));
  return <section className="employee-cost-page">
    {controls}
    <div className="card">
      <div className="section-head">Kết quả phân loại <small>· kỳ {report.period} · chạy lúc {String(data.at || '').replace('T', ' ').slice(0, 16)}</small></div>
      <p>Mọi dòng bị loại đều có tên và có lý do. Nhìn vào là biết <b>ai xử lý</b> và <b>làm gì</b>.</p>

      {!rows.length && report.balanced === true && <div className="employee-cost-visibility-success" role="status">
        Kỳ này đã phân loại và không có dòng ngoại lệ.
      </div>}
      {report.balanced === false && <div className="employee-cost-match-warning" role="alert">
        <b>⛔ KHÔNG CÂN — có dòng rơi ở chỗ chưa ai khai báo.</b>{' '}
        Lệch <b>{money(totals.amountDiff)}</b> · <b>{totals.rowDiff}</b> dòng.
        Số bên dưới chưa đáng tin cho tới khi khớp lại.
      </div>}
      {report.balanced === null && <div className="employee-cost-match-warning" role="status">
        <b>Chưa đủ căn cứ để kiểm cân</b> — thiếu số tổng nguồn. Không kết luận là đã cân.
      </div>}
      {!!report.unknownCodes.length && <div className="employee-cost-match-warning" role="alert">
        <b>⚠ Có mã lý do chưa khai báo:</b> {report.unknownCodes.join(', ')} — phải khai báo để người đọc biết phải làm gì.
      </div>}
      {data.truncated && <div className="employee-cost-match-warning" role="status">
        Danh sách bị cắt bớt do quá dài — số tổng vẫn đúng, nhưng bảng chi tiết chưa đủ dòng.
      </div>}

      <div className="kpi-grid">
        <Kpi label="Tổng nguồn" value={money(totals.sourceAmount)} sub={totals.sourceRows == null ? '—' : `${totals.sourceRows.toLocaleString('vi-VN')} dòng`} />
        <Kpi label="Đã đưa vào doanh thu" value={money(totals.includedAmount)} sub={totals.includedRows == null ? '—' : `${totals.includedRows.toLocaleString('vi-VN')} dòng`} tone="employee-cost-tone-base" />
        <Kpi label="Bị loại" value={money(totals.excludedAmount)} sub={`${totals.excludedRows.toLocaleString('vi-VN')} dòng · không tính tiền`} />
        <Kpi label="Vào đủ tiền nhưng thiếu thông tin" value={money(totals.incompleteAmount)}
          sub={`${totals.incompleteRows.toLocaleString('vi-VN')} dòng · nhìn tổng thì đúng, lọc ra thì mất`} />
      </div>
    </div>

    <div className="card">
      <div className="section-head">Gom theo lý do — xử cái nhiều tiền trước</div>
      <div className="employee-cost-table-wrap">
        <table className="employee-cost-gap-table admin">
          <thead><tr><th>Lý do</th><th>Nhóm</th><th>Dòng</th><th>Số tiền</th><th>Ai xử lý</th><th>Làm gì</th></tr></thead>
          <tbody>{byCode.map((item) => <tr key={item.code}>
            <td><b>{item.code}</b><small>{item.meaning}</small></td>
            <td><span className={`employee-cost-gap-reason ${GROUP_LABEL[item.group]?.tone || ''}`}>{GROUP_LABEL[item.group]?.text || item.group}</span></td>
            <td className="employee-cost-number">{item.rows.toLocaleString('vi-VN')}</td>
            <td className="employee-cost-number"><b>{money(item.amount)}</b></td>
            <td>{item.owner}</td>
            <td><small>{item.action}</small></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>

    <div className="card">
      <div className="section-head">Từng dòng — {filteredRows.length.toLocaleString('vi-VN')}/{rows.length.toLocaleString('vi-VN')} dòng</div>
      <div className="sync-exceptions-toolbar">
        <label><span>Tìm nhanh</span><input aria-label="Tìm đơn, mã hàng, đơn vị hoặc nhân viên" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder="Đơn, mã hàng, đơn vị, nhân viên…" /></label>
        <label><span>Lý do</span><select aria-label="Lọc theo lý do" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
          <option value="">Tất cả lý do</option>
          {byCode.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.rows.toLocaleString('vi-VN')} dòng</option>)}
        </select></label>
      </div>
      <div className="employee-cost-table-wrap">
        <table className="employee-cost-gap-table admin">
          <thead><tr><th>Đơn</th><th>Mã hàng</th><th>Đơn vị</th><th>NV</th><th>Ngày</th><th>Số tiền</th><th>Lý do · ai xử lý</th></tr></thead>
          <tbody>{filteredRows.map((row, index) => <tr key={`${row.lineId || row.orderCode}-${index}`}>
            <td><b>{row.orderCode || '—'}</b><small>{row.sourceSystem}</small></td>
            <td>{row.productCode || '—'}</td>
            <td>{row.unitCode || '—'}</td>
            <td>{row.empCode || '—'}</td>
            <td>{row.date ? row.date.split('-').reverse().join('/') : '—'}</td>
            <td className="employee-cost-number"><b>{money(row.amount)}</b></td>
            <td><span className={`employee-cost-gap-reason ${GROUP_LABEL[row.group]?.tone || ''}`}>{row.code}</span><small>{row.owner} · {row.action}</small></td>
          </tr>)}
          {!filteredRows.length && <tr><td colSpan="7"><div className="sync-exceptions-empty">Không có dòng phù hợp bộ lọc.</div></td></tr>}</tbody>
        </table>
      </div>
    </div>
  </section>;
}
