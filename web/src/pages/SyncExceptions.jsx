import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Kpi, Spinner } from '../components.jsx';

// MÀN "CHƯA ĐỒNG BỘ" (SPEC_REVENUE_SYNC_EXCEPTIONS.md)
// CEO 29/07: *"có một màn riêng lọc ra những mã đơn hàng / mặt hàng / nhà thầu chưa
// đồng bộ được, kèm lý do — để xử lý tại chỗ, tránh chạy lòng vòng."*
// Chỉ ĐỌC. Mọi số do backend tính và đã kiểm bất biến; màn này không cộng trừ lại.
const money = (value) => (value == null ? '—' : `${Number(value).toLocaleString('vi-VN')}đ`);
const GROUP_LABEL = {
  excluded: { text: 'Bị loại — KHÔNG tính tiền', tone: 'warn' },
  incomplete: { text: 'Vào đủ tiền nhưng THIẾU THÔNG TIN', tone: 'warn' },
  note: { text: 'Ghi chú — vẫn tính tiền', tone: 'ok' },
};

export default function SyncExceptions({ ky }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });

  useEffect(() => {
    if (!ky) return undefined;
    let alive = true;
    setState({ loading: true, data: null, error: '' });
    api.syncExceptions(ky)
      .then((data) => { if (alive) setState({ loading: false, data, error: '' }); })
      .catch((error) => { if (alive) setState({ loading: false, data: null, error: error.message || 'Không tải được' }); });
    return () => { alive = false; };
  }, [ky]);

  if (state.loading) return <section className="card"><div className="section-head">Chưa đồng bộ</div><Spinner /></section>;
  if (state.error) return <section className="card"><div className="employee-cost-match-warning" role="alert">{state.error}</div></section>;

  const data = state.data;
  // ‼ Chưa chạy phân loại KHÁC HẲN đã chạy và sạch — nói thẳng, không để tưởng sạch.
  if (!data?.ran) {
    return <section className="card">
      <div className="section-head">Chưa đồng bộ <small>· kỳ {ky}</small></div>
      <div className="employee-cost-match-warning" role="status">
        <b>Kỳ này chưa chạy phân loại.</b> Chưa có căn cứ để nói kỳ này sạch hay không —
        đây <b>không phải</b> là "không có dòng nào bị loại".
      </div>
    </section>;
  }

  const { report } = data;
  const { totals } = report;
  return <section className="employee-cost-page">
    <div className="card">
      <div className="section-head">Chưa đồng bộ <small>· kỳ {report.period} · chạy lúc {String(data.at || '').replace('T', ' ').slice(0, 16)}</small></div>
      <p>Mọi dòng bị loại đều có tên và có lý do. Nhìn vào là biết <b>ai xử lý</b> và <b>làm gì</b>.</p>

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
          <tbody>{report.byCode.map((item) => <tr key={item.code}>
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
      <div className="section-head">Từng dòng — {report.rows.length.toLocaleString('vi-VN')} dòng</div>
      <div className="employee-cost-table-wrap">
        <table className="employee-cost-gap-table admin">
          <thead><tr><th>Đơn</th><th>Mã hàng</th><th>Đơn vị</th><th>NV</th><th>Ngày</th><th>Số tiền</th><th>Lý do · ai xử lý</th></tr></thead>
          <tbody>{report.rows.map((row, index) => <tr key={`${row.lineId || row.orderCode}-${index}`}>
            <td><b>{row.orderCode || '—'}</b><small>{row.sourceSystem}</small></td>
            <td>{row.productCode || '—'}</td>
            <td>{row.unitCode || '—'}</td>
            <td>{row.empCode || '—'}</td>
            <td>{row.date ? row.date.split('-').reverse().join('/') : '—'}</td>
            <td className="employee-cost-number"><b>{money(row.amount)}</b></td>
            <td><span className={`employee-cost-gap-reason ${GROUP_LABEL[row.group]?.tone || ''}`}>{row.code}</span><small>{row.owner} · {row.action}</small></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  </section>;
}
