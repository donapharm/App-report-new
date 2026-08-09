import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadCostBreakdown } from '../api.js';
import { Spinner } from '../components.jsx';
// Bộ lọc dùng CHUNG với menu Thành tiền C32·C47 — một luật lọc, một cách thao tác.
import { CostFilterPanel, EMPTY_COST_FILTERS, MultiPick, costFilterParams } from '../costFilterPanel.jsx';

/**
 * TỔNG HỢP CHI PHÍ C33–C46 — CHỈ CEO (CEO yêu cầu 09/08/2026).
 *
 * "Tháng này tao chi hết 8% là bao nhiêu tiền — chi tiết mỗi cột, mỗi đơn vị,
 *  nhóm mã, NV, tuyến; xuất Excel nhiều kỳ, chọn thứ cần."
 *
 * ‼ MỌI ô tiền và % mang `data-sensitive` — con mắt che số phủ toàn màn
 *   (SPEC_PRIVACY_EYE). Số ở đây là chi tiết chi phí toàn công ty, nhạy nhất app.
 * ‼ Hai dòng tổng TÁCH BẠCH: "Tổng chi CÓ C44" ≠ "Phần trừ vào C47 (không C44)".
 *   Chênh lệch = chính tiền C44 — không gộp để khỏi lẫn hai nghĩa.
 */

const money = (value) => (value == null ? '—' : `${Math.round(Number(value)).toLocaleString('vi-VN')}đ`);
const hubToUi = (period) => { const m = String(period || '').match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}.${m[1]}` : period; };
// ‼ null ≠ 0. Doanh thu 0 thì tỷ lệ là KHÔNG TÍNH ĐƯỢC ('—'), không phải "0%" —
// "0%" đọc thành "không tốn đồng nào", sai nguy hiểm.
const pctText = (value) => (value == null ? '—' : `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`);
const signedMoney = (value) => {
  if (value == null) return '—';
  const n = Math.round(Number(value));
  return `${n > 0 ? '+' : ''}${n.toLocaleString('vi-VN')}đ`;
};

const GROUP_LABELS = {
  employee: 'Nhân viên', unit: 'Mã đơn vị', group: 'Nhóm mã đơn vị',
  route: 'Tuyến', contractor: 'Mã nhà thầu', priority: 'Ưu tiên (H.A*…)',
};

export default function CostBreakdown({ me }) {
  const [periods, setPeriods] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [groupBy, setGroupBy] = useState('employee');
  // Bộ lọc dữ liệu dùng CHUNG với menu Thành tiền (8 chiều + gõ nhóm + tìm tự do);
  // `columns` (chọn cột xuất) là chuyện riêng của bảng này nên để state riêng.
  const [filters, setFilters] = useState({ ...EMPTY_COST_FILTERS });
  const [columns, setColumns] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [withVat, setWithVat] = useState(false);
  // Ô "Cột xuất" đứng ngoài panel — vẫn cần cờ mở/đóng của cha.
  const [openPick, setOpenPick] = useState('');

  useEffect(() => {
    api.periods().then((p) => {
      const list = (p.periods || p || []).map((x) => x.ky || x).filter((x) => /^\d{2}\.\d{4}$/.test(x))
        .map((ky) => { const [m, y] = ky.split('.'); return `${y}-${m}`; }).sort();
      setPeriods(list);
      if (list.length) { setFrom(list.at(-1)); setTo(list.at(-1)); }
    }).catch(() => {});
  }, []);

  const params = useMemo(() => ({
    from, to, groupBy,
    ...costFilterParams(filters),
    ...(columns.length ? { columns: columns.join(',') } : {}),
  }), [from, to, groupBy, filters, columns]);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!from || !to) return undefined;
    let alive = true;
    // Gõ ô tìm/nhóm mã thì đợi 300ms mới hỏi backend — mỗi phím một lượt gọi là
    // vừa nặng máy chủ vừa nhấp nháy bảng.
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      api.costBreakdown(params)
        // Giữ bảng cũ khi tải hỏng — không đập màn về trắng.
        .then((r) => { if (alive) setData(r); })
        .catch((e) => { if (alive) setError(e.message); })
        .finally(() => { if (alive) setLoading(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = (row, key) => (withVat ? row.columns[key].withVat : row.columns[key].noVat);
  const totalsCell = (key) => (withVat ? data.totals.columns[key].withVat : data.totals.columns[key].noVat);

  if (!me?.is_ceo) return <div className="card"><p>Menu này chỉ dành cho tài khoản CEO.</p></div>;

  return <div className="cost-breakdown-page">
    <div className="card catalog-help">
      <b>📊 Tổng hợp chi phí C33–C46 — chi hết bao nhiêu tiền, ở đâu</b>
      <p>Tiền từng cột chi phí = % kho cục bộ × doanh thu kỳ, gộp theo chiều anh chọn.
        <b> C44 vẫn được tính</b> nhưng đánh dấu <b>NGOÀI C47</b> — hai dòng tổng tách bạch, chênh lệch đúng bằng tiền C44.</p>
    </div>

    <div className="card cost-breakdown-controls">
      <label><span>Từ kỳ</span><select value={from} onChange={(e) => setFrom(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{hubToUi(p)}</option>)}</select></label>
      <label><span>Đến kỳ</span><select value={to} onChange={(e) => setTo(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{hubToUi(p)}</option>)}</select></label>
      <label><span>Gộp theo</span><select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
        {Object.entries(GROUP_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label className="cost-breakdown-vat"><input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} /> Xem số CÓ VAT</label>
      <button type="button" className="btn" disabled={exporting || !data}
        onClick={async () => { setExporting(true); try { await downloadCostBreakdown(params); } catch (e) { setError(e.message); } finally { setExporting(false); } }}>
        {exporting ? 'Đang xuất…' : '⬇ Xuất Excel (đúng bộ lọc đang chọn)'}
      </button>
    </div>

    {/* Bộ lọc nâng cao dùng CHUNG với menu Thành tiền (CEO 09/08: "khi cần lọc thì
        mở bảng và chọn tính năng") — giá trị chọn backend thu TRƯỚC khi lọc. */}
    <CostFilterPanel options={data?.filterOptions} partnerGroups={data?.partnerGroups}
      value={filters} onChange={setFilters} note={data?.groupQueryNote}
      extra={<MultiPick label="Cột hiển thị" open={openPick === "Cột xuất"} onToggle={(v) => setOpenPick(v ? "Cột xuất" : "")}
        options={(data?.columns || []).map((column) => column.key.toUpperCase())} values={columns.map((k) => k.toUpperCase())}
        onChange={(list) => setColumns(list.map((k) => k.toLowerCase()))} />} />

    {error && <div className="card catalog-alert error" role="alert">⚠ {error}</div>}
    {loading && !data && <div className="card catalog-first-load"><Spinner /><b>Đang tổng hợp chi phí…</b></div>}
    {loading && data && <div className="card catalog-loading-strip" role="status"><i className="catalog-loading-dot" aria-hidden="true" /><span>Đang tính lại… bảng dưới là bản vừa xem.</span></div>}

    {/* ‼ Kỳ chưa đồng bộ mà KHÔNG có kỳ nào có số ⇒ bảng rỗng hoàn toàn. Phải nói to
        ngay chỗ này, kèm việc cần làm — CEO chọn T07 thấy 0 dòng rồi hỏi "đáng lẽ
        phải ra số" (09/08). Bảng 0 dòng mà không giải thích là bỏ mặc người dùng. */}
    {data && !!data.missingPeriods?.length && <div className={`card catalog-alert error${data.rows.length ? '' : ' cost-breakdown-empty-warn'}`} role="alert">
      <b>‼ Kỳ {data.missingPeriods.map(hubToUi).join(' · ')} CHƯA đồng bộ % chi phí</b>
      {data.rows.length
        ? <> — bảng dưới <b>KHÔNG</b> gồm các kỳ đó.</>
        : <> nên <b>bảng trống hoàn toàn</b>, không phải kỳ đó không tốn tiền.</>}
      <div className="cost-breakdown-todo">
        <b>Cần làm:</b> vào <b>Danh mục QL</b> → chọn đúng kỳ <b>{data.missingPeriods.map(hubToUi).join(' / ')}</b> ở ô "Kỳ"
        → bấm <b>"Đồng bộ từ DataHub"</b> → quay lại đây. Mỗi kỳ phải đồng bộ một lần.
      </div>
    </div>}

    {data && <div className="card table-card">
      <div className="cost-amounts-identity">
        Kỳ <b>{data.periods.map(hubToUi).join(' → ')}</b> · gộp theo <b>{GROUP_LABELS[data.groupBy]}</b>
        · {data.rows.length.toLocaleString('vi-VN')} dòng · số {withVat ? 'CÓ VAT' : 'CHƯA VAT'}
      </div>
      <div className="table-scroll"><table className="catalog-table catalog-table-simple"><thead><tr>
        <th>{GROUP_LABELS[data.groupBy]}</th><th>Số cặp</th>
        <th className="catalog-money">Doanh thu</th>
        {/* CEO 09/08: "tiêu đề hiển thị ĐỦ TÊN kèm với cột C bao nhiêu". Trước chỉ
            có mã trần "C43" — nhìn không biết là chi phí gì. */}
        {data.columns.map((column) => <th key={column.key} className={`catalog-money cost-breakdown-colhead${column.outsideC47 ? ' cost-breakdown-outside' : ''}`}
          title={column.outsideC47 ? `${column.label} — NGOÀI công thức C47` : column.label}>
          <b>{column.key.toUpperCase()}{column.outsideC47 ? '*' : ''}</b>
          <small>{column.label.replace(/^C\d+\s*/, '')}</small>
          <em>% của {column.pctBaseLabel}</em>
        </th>)}
        {/* ‼ HAI CỘT NÀY LÀ TỔNG CỦA C33–C46 BÊN TRÁI, KHÔNG PHẢI TIỀN C47.
            CEO hỏi 09/08: *"cột C47 sao có tiền ở đây là sao?"* — tên cũ "Trừ vào
            C47" khiến người đọc tưởng đây là tiền C47, trong khi CEO đã chốt tiền
            C47 nằm ở MENU RIÊNG. Bỏ chữ C47 khỏi tên cột; quan hệ với công thức
            C47 đưa xuống chú thích dưới bảng. */}
        <th className="catalog-money" title="Tổng tiền của TẤT CẢ cột C33–C46 bên trái, gồm cả C44">Tổng chi CÓ C44</th>
        <th className="catalog-money" title="Tổng tiền của 13 cột C33–C46 nhưng KHÔNG cộng C44. Đây chính là phần bị trừ trong công thức C47 — nhưng vẫn KHÔNG phải tiền C47.">Tổng chi KHÔNG C44</th>
        <th className="catalog-money" title="Chi bao nhiêu trên mỗi đồng doanh thu — chỉ số so sánh được giữa NV bán nhiều và NV bán ít">Chi/Doanh thu</th>
      </tr></thead><tbody>
        {data.rows.map((row) => <tr key={row.key}>
          <td><b>{row.key}</b></td>
          <td>{row.pairCount.toLocaleString('vi-VN')}</td>
          <td className="catalog-money" data-sensitive="">{money(withVat ? row.revenueWithVat : row.revenueNoVat)}</td>
          {data.columns.map((column) => {
            const cell = row.columns[column.key];
            return <td key={column.key} className="catalog-money cost-breakdown-cell" data-sensitive=""
              title={cell.missingPairs ? `${cell.missingPairs} cặp thiếu % cột này — số dưới là tổng THIẾU` : `${column.label} · % của ${column.pctBaseLabel}`}>
              <b>{money(v(row, column.key))}</b>
              <small>{pctText(row.pct?.[column.key])}</small>
              {cell.missingPairs ? <em className="cost-amounts-warn">⚠ {cell.missingPairs} cặp thiếu %</em> : null}
            </td>;
          })}
          <td className="catalog-money" data-sensitive=""><b>{money(withVat ? row.spentWithC44WithVat : row.spentWithC44NoVat)}</b></td>
          <td className="catalog-money" data-sensitive=""><b>{money(withVat ? row.spentTowardC47WithVat : row.spentTowardC47NoVat)}</b></td>
          <td className="catalog-money" data-sensitive="">{pctText(row.costRatio)}</td>
        </tr>)}
        <tr className="cost-amounts-grand">
          <td><b>TỔNG CỘNG</b></td>
          <td><b>{data.totals.pairCount.toLocaleString('vi-VN')}</b></td>
          <td className="catalog-money" data-sensitive=""><b>{money(withVat ? data.totals.revenueWithVat : data.totals.revenueNoVat)}</b></td>
          {data.columns.map((column) => <td key={column.key} className="catalog-money cost-breakdown-cell" data-sensitive="">
            <b>{money(totalsCell(column.key))}</b>
            <small>{pctText(data.totals.pct?.[column.key])}</small>
          </td>)}
          <td className="catalog-money" data-sensitive=""><b>{money(withVat ? data.totals.spentWithC44WithVat : data.totals.spentWithC44NoVat)}</b></td>
          <td className="catalog-money" data-sensitive=""><b>{money(withVat ? data.totals.spentTowardC47WithVat : data.totals.spentTowardC47NoVat)}</b></td>
          <td className="catalog-money" data-sensitive=""><b>{pctText(data.totals.costRatio)}</b></td>
        </tr>
        {/* Tỷ trọng: cột nào ăn phần lớn nhất trong tiền đã chi. */}
        <tr className="cost-breakdown-share">
          <td colSpan={3}><small>Tỷ trọng trên tổng chi</small></td>
          {data.columns.map((column) => <td key={column.key} className="catalog-money" data-sensitive="">
            <small>{pctText(data.totals.share?.[column.key])}</small>
          </td>)}
          <td colSpan={3}><small>100%</small></td>
        </tr>
      </tbody></table></div>
      <small className="muted cost-breakdown-note">* {data.c44Note}</small>
      <small className="muted cost-breakdown-note">
        <b>Hai cột tổng bên phải là TỔNG CỦA CÁC CỘT C33–C46 ở bên trái — KHÔNG phải tiền C47.</b>{' '}
        Tiền C47 (phần còn lại sau khi chi) nằm ở menu riêng <b>“Thành tiền C32 · C47”</b> đúng như đã chốt.
        Cột <b>“Tổng chi KHÔNG C44”</b> chỉ trùng với <i>phần bị trừ</i> trong công thức C47, nên để cạnh nhau cho dễ đối chiếu.
      </small>
      <small className="muted cost-breakdown-note">
        <b>Về dòng % dưới mỗi ô tiền:</b> đó là <b>bình quân có trọng số</b> của các cặp đang gộp, không phải tỷ lệ cố định của một cặp.
        Ví dụ C44 danh nghĩa 5% của tiền C43, nhưng nếu trong nhóm có cặp chưa được cấp % C44 thì số bình quân sẽ <b>thấp hơn 5%</b> — đó là số thật, không phải tính sai.
      </small>
    </div>}

    {/* SO VỚI KỲ TRƯỚC — xếp theo TIỀN TUYỆT ĐỐI, không theo %. Cột 2 tỷ tăng 12%
        đáng lo hơn cột 5 triệu tăng 200%; xếp theo % thì cái nhỏ luôn nhảy lên đầu. */}
    {data?.compare && <div className="card table-card">
      {!data.compare.comparable
        ? <div className="catalog-alert error" role="status">
          {data.compare.reason === 'KY_TRUOC_CHUA_DONG_BO'
            ? <>Chưa so được với kỳ trước — kỳ <b>{(data.compare.missingPeriods || []).map(hubToUi).join(' · ')}</b> chưa đồng bộ %.
              Đồng bộ kỳ đó rồi quay lại, <b>không</b> so nửa vời để khỏi ra con số chênh lệch vô nghĩa.</>
            : <>Chưa so được với kỳ trước{data.compare.message ? ` (${data.compare.message})` : ''}.</>}
        </div>
        : <>
          <div className="cost-amounts-identity">
            <b>So với kỳ trước</b> ({(data.compare.periods || []).map(hubToUi).join(' → ')})
            · tổng chi <b data-sensitive="">{signedMoney(data.compare.spentDelta)}</b>
            · doanh thu <b data-sensitive="">{signedMoney(data.compare.revenueDelta)}</b>
            · tỷ lệ chi <b data-sensitive="">{pctText(data.compare.costRatioBefore)} → {pctText(data.compare.costRatioNow)}</b>
          </div>
          <div className="table-scroll"><table className="catalog-table catalog-table-simple"><thead><tr>
            <th>Cột</th><th className="catalog-money">Kỳ trước</th><th className="catalog-money">Kỳ này</th>
            <th className="catalog-money">Chênh lệch</th><th className="catalog-money">%</th>
          </tr></thead><tbody>
            {data.compare.columns.map((item) => <tr key={item.key} className={item.delta > 0 ? 'cost-breakdown-up' : item.delta < 0 ? 'cost-breakdown-down' : ''}>
              <td><b>{item.key.toUpperCase()}</b> <small className="muted">{item.label}</small></td>
              <td className="catalog-money" data-sensitive="">{money(item.before)}</td>
              <td className="catalog-money" data-sensitive="">{money(item.now)}</td>
              <td className="catalog-money" data-sensitive=""><b>{signedMoney(item.delta)}</b></td>
              <td className="catalog-money" data-sensitive="">{item.deltaPct == null ? '—' : `${item.deltaPct > 0 ? '+' : ''}${pctText(item.deltaPct)}`}</td>
            </tr>)}
          </tbody></table></div>
          <small className="muted cost-breakdown-note">Xếp theo <b>tiền tuyệt đối</b>, không theo %. Cột lớn tăng ít vẫn đứng trên cột nhỏ tăng nhiều — vì đó mới là chỗ tiền thật sự đi.</small>
        </>}
    </div>}
  </div>;
}
