import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadCostAmounts } from '../api.js';
import { Spinner } from '../components.jsx';
import { bangkokToday } from '../revenueCoverage.js';
import { formatDateTime } from '../util.js';
// Bộ lọc nâng cao dùng CHUNG với menu Tổng hợp chi phí — một luật lọc cho cả hai màn.
import { CostFilterPanel, EMPTY_COST_FILTERS, costFilterParams, countCostFilters } from '../costFilterPanel.jsx';

/**
 * MENU RIÊNG "THÀNH TIỀN C32/C47" (Đợt 3 — SPEC_COST_RATES_LOCAL_SYNC · CEO chốt 08/08/2026).
 * CEO tách hai cột tiền tổng ra menu riêng để giảm rủi ro lộ lọt. Trang này CHỈ RENDER
 * những gì backend trả — backend tự chặn (mặc định chỉ CEO; NV cần công tắc riêng bật
 * và chỉ nhận đúng hàng của mình). Tab ẩn/hiện theo cờ `me.costAmountsEnabled` chỉ để
 * gọn mắt, KHÔNG phải hàng rào quyền.
 */

const hubToUi = (period) => { const m = String(period || '').match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}.${m[1]}` : period; };
const currentKy = () => { const [y, m] = bangkokToday().split('-'); return `${m}.${y}`; };
const PAGE_SIZE = 50; // CEO chốt 08/08/2026: tối đa 50 dòng/trang

const money = (value) => (value == null ? '—' : `${Number(value).toLocaleString('vi-VN')} đ`);

/** Ô tiền: đi qua rèm che ẩn số (data-sensitive); thiếu %/xung đột ⇒ '—' + lý do. */
function MoneyCell({ value, reason, missing, negative = false }) {
  if (value == null) {
    const title = reason === 'XUNG_DOT'
      ? 'Hai dòng cùng cặp trong kho % có tỷ lệ khác nhau — cần DataHub soát lại, không lấy bừa một bên'
      : `Thiếu % ở cột: ${(missing || []).map((k) => k.toUpperCase()).join(', ') || '—'} — bấm "Đồng bộ % chi phí" sau khi DataHub bổ sung`;
    return <td className="catalog-money is-missing" data-sensitive="" title={title}>—</td>;
  }
  return <td className={`catalog-money${negative ? ' is-negative' : ''}`} data-sensitive=""
    title={negative ? 'C47 ÂM — đã chi vượt quá số C32 được cấp cho cặp này' : undefined}>{money(value)}</td>;
}

/** Ô %. C47 âm nghĩa là chi vượt ngân sách C32 — phải NHÌN THẤY, không lẫn vào bảng. */
function PercentCell({ value, negative = false }) {
  if (value == null) return <td className="catalog-money is-missing" data-sensitive="" title="Chưa đủ % để tính">—</td>;
  return <td className={`catalog-money${negative ? ' is-negative' : ''}`} data-sensitive=""
    title={negative ? 'ÂM — đã chi vượt quá số C32 được cấp' : undefined}>
    {negative && '⚠ '}{Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 4 })}%
  </td>;
}

const EFFECTIVE_LABEL = (value) => (value === 'on' ? 'Đang BẬT' : 'Đang TẮT');

/** Ô chọn ba trạng thái — cùng kiểu công tắc "Chi phí của tôi"/"Thanh toán CP". */
function SwitchSelect({ value, onChange, inheritLabel, label }) {
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
    {inheritLabel && <option value="inherit">{inheritLabel}</option>}
    <option value="on">BẬT — được xem</option>
    <option value="off">TẮT</option>
  </select>;
}

/**
 * CÔNG TẮC MENU THÀNH TIỀN — CHỈ CEO (CEO chốt 08/08: *"tất cả các cột từ C32–C47
 * đều làm dạng chế độ tắt/mở… giống như ở hai tab Chi phí của tôi và Thanh toán CP"*).
 *
 * Vì thế dùng ĐÚNG bộ máy công tắc của hai tab đó, ba tầng:
 *   toàn phòng → nhóm → cá nhân, cá nhân đè nhóm, nhóm đè toàn phòng.
 * Khác một điểm: kho riêng (`cost_amounts_visibility`), mặc định TẮT toàn phòng ⇒
 * không NV nào thấy tiền tổng cho tới khi CEO tự tay bật. Backend chặn độc lập bằng
 * `requireCeo` — ẩn panel chỉ là cho gọn mắt, không phải hàng rào.
 */
function VisibilityPanel() {
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState({ department: null, groups: {}, employees: {} });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const reset = () => setPending({ department: null, groups: {}, employees: {} });
  const load = () => api.costAmountsVisibility().then((r) => { setPanel(r.panel); reset(); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { if (open && !panel) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = pending.department != null || Object.keys(pending.groups).length > 0 || Object.keys(pending.employees).length > 0;
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const patch = {};
      if (pending.department) patch.department = pending.department;
      if (Object.keys(pending.groups).length) patch.groups = pending.groups;
      if (Object.keys(pending.employees).length) patch.employees = pending.employees;
      const r = await api.costAmountsVisibilitySave(patch);
      setPanel(r.panel); reset();
      setMessage(r.panel?.changed === false ? 'Không có gì thay đổi.' : 'Đã lưu công tắc.');
    } catch (e) { setError(`${e.message} — thay đổi chưa lưu vẫn còn nguyên trên màn hình.`); }
    setBusy(false);
  }

  return <div className="card cost-amounts-visibility">
    <div className="cost-amounts-visibility-head">
      <div>
        <div className="section-head">🔐 Ai được xem menu Thành tiền</div>
        <p>Mặc định toàn phòng <b>TẮT</b> — chỉ CEO thấy. Bật cho ai thì người đó chỉ thấy <b>đúng hàng của chính mình</b>, không thấy tổng công ty hay số người khác.</p>
      </div>
      <button type="button" className="btn secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Thu gọn' : 'Mở công tắc'}
      </button>
    </div>
    {open && <div className="cost-amounts-visibility-body">
      {error && <div className="catalog-alert error" role="alert">⚠ {error}</div>}
      {message && <div className="catalog-alert ok" role="status">{message}</div>}
      {!panel ? <Spinner /> : <>
        <div className="cost-amounts-switch-row is-department">
          <div><b>Toàn phòng Kinh doanh</b><small>Mặc định an toàn là TẮT.</small></div>
          <SwitchSelect label="Công tắc toàn phòng" value={pending.department ?? panel.department.setting}
            onChange={(value) => setPending((p) => ({ ...p, department: value }))} />
          <span className={`cost-amounts-effective ${panel.department.effective}`}>{EFFECTIVE_LABEL(panel.department.effective)}</span>
        </div>
        {!!panel.groups.length && <div className="cost-amounts-switch-section">
          <h4>Theo nhóm</h4>
          {panel.groups.map((group) => <div key={group.key} className="cost-amounts-switch-row">
            <div><b>{group.label}</b><small>{group.employeeCount} nhân viên</small></div>
            <SwitchSelect label={`Công tắc nhóm ${group.label}`} inheritLabel="Theo toàn phòng"
              value={pending.groups[group.key] ?? group.setting}
              onChange={(value) => setPending((p) => ({ ...p, groups: { ...p.groups, [group.key]: value } }))} />
            <span className={`cost-amounts-effective ${group.effective}`}>{EFFECTIVE_LABEL(group.effective)}</span>
          </div>)}
        </div>}
        <div className="cost-amounts-switch-section">
          <h4>Theo từng nhân viên</h4>
          {panel.employees.map((emp) => <div key={emp.emp_code} className="cost-amounts-switch-row">
            <div><b>{emp.emp_code} · {emp.name}</b><small>{emp.group_label}</small></div>
            <SwitchSelect label={`Công tắc ${emp.emp_code}`} inheritLabel="Theo nhóm"
              value={pending.employees[emp.emp_code] ?? emp.setting}
              onChange={(value) => setPending((p) => ({ ...p, employees: { ...p.employees, [emp.emp_code]: value } }))} />
            <span className={`cost-amounts-effective ${emp.effective}`}>{EFFECTIVE_LABEL(emp.effective)}</span>
          </div>)}
        </div>
        <div className="cost-amounts-actions">
          <button className="btn" disabled={!dirty || busy} onClick={save}>{busy ? 'Đang lưu…' : dirty ? 'Lưu công tắc' : 'Chưa có thay đổi'}</button>
          <button className="btn ghost" disabled={!dirty || busy} onClick={load}>Huỷ thay đổi</button>
        </div>
      </>}
    </div>}
  </div>;
}

export default function CostAmounts({ me }) {
  // CEO xin "xuất từ kỳ đến kỳ" (09/08/2026): kỳ trở thành MỘT DẢI. Mặc định vẫn là
  // đúng một kỳ mới nhất — thêm tính năng không được đổi thói quen đang dùng.
  const [periodList, setPeriodList] = useState([]);
  const [from, setFrom] = useState(currentKy());
  const [to, setTo] = useState(currentKy());
  const [filters, setFilters] = useState({ ...EMPTY_COST_FILTERS });
  // CEO 09/08 chốt "cả hai": xem chi tiết từng dòng đơn hàng NGAY TRÊN MÀN, và file
  // Excel cũng có sheet đó. Mặc định mức cặp — bật mới kéo dòng gốc về.
  const [level, setLevel] = useState('pair');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const isCeo = !!me?.is_ceo;

  useEffect(() => {
    api.periods().then((p) => {
      const list = (p.periods || p || []).map((x) => x.ky || x).filter((x) => /^\d{2}\.\d{4}$/.test(x));
      setPeriodList(list);
      if (list.length) { setFrom(list.at(-1)); setTo(list.at(-1)); }
    }).catch(() => {});
  }, []);

  // Tham số gửi backend — DÙNG CHUNG cho cả xem màn lẫn xuất Excel, để file tải về
  // không bao giờ khác cái đang nhìn.
  const params = useMemo(() => ({ from, to, level, ...costFilterParams(filters) }), [from, to, level, filters]);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let alive = true;
    // Gõ ô tìm/nhóm mã thì đợi 300ms mới hỏi backend — mỗi phím một lượt gọi là
    // vừa nặng máy chủ vừa nhấp nháy bảng.
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      api.costAmounts(params)
        .then((r) => { if (alive) setData(r); })
        .catch((e) => { if (alive) { setData(null); setError(e.message); } })
        .finally(() => { if (alive) setLoading(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [paramsKey]);

  // ‼ KHÔNG lọc lại ở frontend. Backend đã lọc bằng luật dùng chung; lọc thêm một
  // lớp nữa ở đây là hai bộ luật, và bảng sẽ lệch với file Excel xuất ra.
  const rows = data?.rows || [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  async function exportXlsx() {
    setExporting(true); setError('');
    try { await downloadCostAmounts(params); } catch (e) { setError(e.message); }
    setExporting(false);
  }

  return <div className="cost-amounts-page">
    <div className="card catalog-help">
      <b>💼 Thành tiền C32 · C47 — chi ra bao nhiêu, còn lại bao nhiêu</b>
      <p><b>C32 là ĐẦU VÀO</b> — tổng % chi phí được cấp cho cặp đơn vị × mã hàng đó.
        <b>C47 là ĐẦU RA</b> — phần <b>CÒN LẠI</b> sau khi 13 cột chi phí (C33→C46, <b>trừ C44</b>) đã lấy đi.</p>
      <p className="cost-amounts-example">Ví dụ: doanh thu <b>100 triệu</b> (chưa VAT), C32 <b>10%</b> = 10 triệu được cấp;
        chi hết <b>8%</b> = 8 triệu ⇒ C47 còn <b>2%</b> = <b>2 triệu</b> thu về. Mỗi cột có bản chưa VAT và có VAT (÷1,05).</p>
      <p className="muted">Tiền do App Report tự nhân % × doanh thu — không kéo tiền tổng từ DataHub.
        Thiếu % của bất kỳ cột nào trong 14 cột ⇒ ô để <b>—</b> kèm tên cột thiếu, không suy 0 rồi trừ nửa vời.</p>
    </div>
    <div className="card cost-amounts-controls">
      <label><span>Từ kỳ</span><select value={from} onChange={(e) => setFrom(e.target.value)}>{(periodList.length ? periodList : [from]).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label><span>Đến kỳ</span><select value={to} onChange={(e) => setTo(e.target.value)}>{(periodList.length ? periodList : [to]).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      {/* Chi tiết từng đơn CHỈ CEO — backend chốt độc lập trong `buildAmounts`,
          ẩn công tắc ở đây chỉ để gọn mắt, không phải hàng rào quyền. */}
      {isCeo && <label className="cost-breakdown-vat" title="Mở thêm bảng từng dòng đơn hàng với đủ cột như tab Chi phí của tôi">
        <input type="checkbox" checked={level === 'order'} onChange={(e) => setLevel(e.target.checked ? 'order' : 'pair')} />
        Xem chi tiết từng đơn hàng
      </label>}
      {data?.available && <button className="btn" disabled={exporting} onClick={exportXlsx}>{exporting ? 'Đang xuất…' : '⬇ Xuất Excel (đúng bộ lọc đang chọn)'}</button>}
    </div>

    {/* CEO 09/08: "khi cần lọc thì mở bảng và chọn tính năng" — bộ lọc gọn sau MỘT
        nút, mở ra mới hiện. Giá trị chọn lấy từ chính dữ liệu đang xem. */}
    <CostFilterPanel options={data?.filterOptions} partnerGroups={data?.partnerGroups}
      value={filters} onChange={setFilters} note={data?.groupQueryNote} />

    {/* ‼ Kỳ nào chưa đồng bộ % thì NÓI RA — không lặng lẽ xuất thiếu tháng rồi để
        CEO tưởng tháng đó không tốn đồng nào. */}
    {!!data?.missingPeriods?.length && <div className="card catalog-alert error" role="alert">
      <b>‼ Kỳ {data.missingPeriods.map(hubToUi).join(' · ')} CHƯA đồng bộ % chi phí</b>
      {data.rows?.length ? <> — bảng dưới <b>KHÔNG</b> gồm các kỳ đó.</> : <> nên <b>bảng trống hoàn toàn</b>, không phải kỳ đó không tốn tiền.</>}
      <div className="cost-breakdown-todo">
        <b>Cần làm:</b> vào <b>Danh mục QL</b> → chọn kỳ <b>{data.missingPeriods.map(hubToUi).join(' / ')}</b>
        → bấm <b>"Đồng bộ % chi phí"</b> → quay lại đây. Mỗi kỳ phải đồng bộ một lần.
      </div>
    </div>}

    {loading && <Spinner />}
    {!loading && error && <div className="catalog-alert error" role="alert">⛔ {error}</div>}
    {!loading && !error && data && !data.available && <div className="card">
      {data.reason === 'CHUA_DONG_BO'
        ? <p>Kho % cục bộ <b>CHƯA có kỳ {from === to ? from : `${from} → ${to}`}</b> — {isCeo ? <>vào <b>Danh mục QL</b> bấm <b>"Đồng bộ % chi phí"</b> một lần khi DataHub đang sống, rồi quay lại đây.</> : 'chờ CEO bấm "Đồng bộ % chi phí" cho kỳ này.'}</p>
        : <p>Kỳ {from === to ? from : `${from} → ${to}`} không có dữ liệu của Anh/Chị trong kho % cục bộ.</p>}
    </div>}

    {/* ‼ PHÂN BIỆT HAI CẢNH GIỐNG HỆT NHAU TRÊN MÀN, XỬ LÝ NGƯỢC NHAU HOÀN TOÀN:
        · DataHub thiếu % thật  → đi đòi DataHub bổ sung số;
        · hai bên ghi mã đơn vị khác định dạng → lỗi ghép của App Report, đòi DataHub
          cũng vô ích. Cả hai đều hiện "—" kèm chữ "thiếu %", nên phải NÓI RA khi
          bằng chứng đã rõ: cả hai bên có số mà giao nhau BẰNG KHÔNG. */}
    {!loading && !error && data?.joinHealth?.keyFormatMismatch && <div className="card catalog-alert error" role="alert">
      <b>‼ KHÔNG khớp được cặp nào — đây KHÔNG phải "DataHub thiếu %"</b>
      <div>Kho % có <b>{Number(data.joinHealth.ratePairs).toLocaleString('vi-VN')}</b> cặp, doanh thu có <b>{Number(data.joinHealth.revenuePairs).toLocaleString('vi-VN')}</b> cặp,
        nhưng <b>không cặp nào ghép được</b>. Hai bên đang ghi <b>mã đơn vị / mã hàng khác định dạng</b> — đòi DataHub bổ sung % sẽ không giải quyết được gì.</div>
      <div className="cost-breakdown-todo">
        <b>Mã bên kho %:</b> {(data.joinHealth.sampleRateKeys || []).join(' · ') || '—'}<br />
        <b>Mã bên doanh thu:</b> {(data.joinHealth.sampleRevenueKeys || []).join(' · ') || '—'}<br />
        Gửi đúng hai dòng này cho Claude để sửa phép ghép.
      </div>
    </div>}
    {/* ‼ CỘT THIẾU Ở TOÀN BỘ CẶP = NGUỒN CHƯA MỞ CỘT ĐÓ, không phải vài dòng sót.
        Probe 09/08 22:30: DataHub trả đủ C33–C46 nhưng KHÔNG có C32 — mà thiếu một
        cột trong 14 cột là cả bảng C32/C47 thành "—". Nói "thiếu %" chung chung thì
        đi đòi cả 14 cột; nói đúng tên cột thì xin nguồn mở đúng một cột. */}
    {!loading && !error && data?.joinHealth?.columnsMissingEverywhere?.length > 0 && <div className="card catalog-alert error" role="alert">
      <b>‼ Nguồn CHƯA MỞ cột {data.joinHealth.columnsMissingEverywhere.map((k) => k.toUpperCase()).join(', ')}</b>
      <div>Thiếu ở <b>toàn bộ {Number(data.joinHealth.pairsWithRate).toLocaleString('vi-VN')} cặp</b> — đây là <b>nguồn chưa mở cột</b>,
        không phải vài dòng lẻ sót %. Công thức C47 cần đủ <b>14 cột (C32 + C33→C46 trừ C44)</b>, thiếu một cột là cả bảng để <b>—</b>.</div>
      <div className="cost-breakdown-todo">
        <b>Cần làm:</b> báo DataHub mở đúng cột <b>{data.joinHealth.columnsMissingEverywhere.map((k) => k.toUpperCase()).join(', ')}</b> trong cửa chi phí,
        rồi bấm <b>"Đồng bộ % chi phí"</b> lại. Menu <b>Tổng hợp C33–C46</b> KHÔNG cần cột này nên vẫn dùng được bình thường.
      </div>
    </div>}
    {/* Khớp được một phần cũng phải nói — tổng chỉ là tổng của phần ghép được. */}
    {!loading && !error && data?.available && !data.joinHealth?.keyFormatMismatch
      && data.joinHealth?.revenuePairs > 0 && data.joinHealth.matchedPairs < data.joinHealth.revenuePairs && <div className="card catalog-alert error" role="status">
      ⚠ Chỉ ghép được <b>{Number(data.joinHealth.matchedPairs).toLocaleString('vi-VN')}/{Number(data.joinHealth.revenuePairs).toLocaleString('vi-VN')}</b> cặp doanh thu với kho %.
      Các cặp còn lại hiện <b>—</b>; số tổng phía dưới là tổng của <b>phần ghép được</b>, không phải toàn bộ.
    </div>}

    {!loading && !error && data?.available && <>
      <div className="card table-card">
        <div className="cost-amounts-identity">
          Kỳ <b>{(data.availablePeriods || [data.period]).map(hubToUi).join(' → ')}</b>
          {' · '}bản % đồng bộ gần nhất <b>{formatDateTime(data.fetchedAt)}</b> bởi <b>{data.fetchedBy}</b>
          {' · '}{rows.length.toLocaleString('vi-VN')} dòng
          {countCostFilters(filters) ? <> · <b>đang lọc {countCostFilters(filters)} điều kiện</b></> : null}
          {rows.length > PAGE_SIZE && <> · Hiện trang {safePage}/{pageCount} ({PAGE_SIZE} dòng/trang)</>}
        </div>
        <div className="table-scroll"><table className="catalog-table catalog-table-simple"><thead><tr>
          <th>Kỳ</th><th>NV</th><th>Đơn vị</th><th>Mã hàng</th><th>Tên hàng</th>
          <th>Nhà thầu</th><th>Tuyến · Ưu tiên</th>
          <th className="catalog-money">Doanh thu chưa VAT</th>
          <th className="catalog-money">C32 %</th>
          {(data.columns || []).slice(0, 2).map((column) => <th key={column.key} className="catalog-money">{column.label}</th>)}
          <th className="catalog-money">C47 %</th>
          {(data.columns || []).slice(2).map((column) => <th key={column.key} className="catalog-money">{column.label}</th>)}
        </tr></thead><tbody>
          {visibleRows.map((r) => <tr key={`${r.period}-${r.empCode}-${r.unitCode}-${r.productCode}`}>
            <td>{hubToUi(r.period)}</td>
            <td><b>{r.empCode}</b></td>
            <td>{r.unitCode}</td>
            <td>{r.productCode}</td>
            <td>{r.productName}</td>
            {/* Hiện đúng ba chiều CEO xin lọc — nhìn là kiểm được bộ lọc có ăn không.
                Thiếu dữ liệu thì '—', không lấy mã thay tên. */}
            <td>{r.contractorCode || '—'}{r.contractorName ? <small className="muted"> · {r.contractorName}</small> : null}</td>
            <td>{r.route || '—'}{r.priority ? <small className="muted"> · {r.priority}</small> : null}</td>
            <td className="catalog-money" data-sensitive="">{money(r.revenueNoVat)}</td>
            <PercentCell value={r.c32Percent} />
            <MoneyCell value={r.c32NoVat} reason={r.c32Reason} missing={[]} />
            <MoneyCell value={r.c32WithVat} reason={r.c32Reason} missing={[]} />
            <PercentCell value={r.c47Percent} negative={r.c47Negative} />
            <MoneyCell value={r.c47NoVat} reason={r.c47Reason} missing={r.c47Missing} negative={r.c47Negative} />
            <MoneyCell value={r.c47WithVat} reason={r.c47Reason} missing={r.c47Missing} negative={r.c47Negative} />
          </tr>)}
        </tbody></table></div>
        {rows.length === 0 && <div className="muted catalog-empty">
          {countCostFilters(filters)
            ? <>Không cặp nào khớp <b>{countCostFilters(filters)} điều kiện lọc</b> đang bật — bấm <b>"Xoá hết bộ lọc"</b> ở bảng lọc để xem lại toàn bộ.</>
            : 'Không có cặp nào trong phạm vi được phép xem.'}
        </div>}
        {pageCount > 1 && <div className="cost-amounts-pager">
          <button className="btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹ Trước</button>
          <span>Trang {safePage}/{pageCount} · {rows.length.toLocaleString('vi-VN')} dòng</span>
          <button className="btn" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Sau ›</button>
        </div>}
      </div>

      {/* ‼ CHI TIẾT TỪNG DÒNG ĐƠN HÀNG — đủ cột như tab "Chi phí của tôi" (CEO xin
          09/08). Bảng này ADDITIVE: mọi con số tổng phía trên GIỮ NGUYÊN dù bật hay
          tắt chi tiết, nên không bao giờ có chuyện bật chi tiết ra số khác. */}
      {level === 'order' && <div className="card table-card">
        <div className="cost-amounts-identity">
          <b>Chi tiết từng dòng đơn hàng</b> — {Number(data.orderRowsTotal || 0).toLocaleString('vi-VN')} dòng
          {data.orderRowsTruncated && <> · <b className="cost-amounts-warn">đang hiện {Number(data.orderRows?.length || 0).toLocaleString('vi-VN')} dòng đầu</b></>}
        </div>
        {/* Cắt bớt thì NÓI TO kèm cách lấy đủ — bảng bị cắt lặng lẽ đọc y như bảng đủ. */}
        {data.orderRowsTruncated && <div className="catalog-alert error" role="alert">
          ‼ Quá nhiều dòng ({Number(data.orderRowsTotal).toLocaleString('vi-VN')}), màn chỉ hiện <b>{Number(data.orderRows.length).toLocaleString('vi-VN')}</b> dòng đầu.
          Lọc hẹp lại (một nhân viên · một kỳ · một nhóm mã) rồi xem lại, hoặc bấm <b>Xuất Excel</b> — file cũng theo trần này nên vẫn nên lọc hẹp.
        </div>}
        <div className="table-scroll"><table className="catalog-table catalog-table-simple"><thead><tr>
          <th>Kỳ</th><th>NV</th>
          {(data.detailColumns || []).map((column) => <th key={column.key} className={column.money || column.number ? 'catalog-money' : ''}>{column.label}</th>)}
          <th className="catalog-money">C32 %</th><th className="catalog-money">Thành tiền C32</th>
          <th className="catalog-money">C47 %</th><th className="catalog-money">Thành tiền C47</th>
        </tr></thead><tbody>
          {(data.orderRows || []).slice(0, PAGE_SIZE * 4).map((line, index) => <tr key={`${line.period}-${line.empCode}-${line.unitCode}-${line.productCode}-${line.orderCode}-${index}`}>
            <td>{hubToUi(line.period)}</td>
            <td><b>{line.empCode}</b></td>
            {(data.detailColumns || []).map((column) => (column.money
              // Tiền và giá là số nhạy cảm ⇒ phải nằm dưới con mắt che số.
              ? <td key={column.key} className="catalog-money" data-sensitive="">{money(line[column.key])}</td>
              : <td key={column.key} className={column.number ? 'catalog-money' : ''}>
                {line[column.key] == null || line[column.key] === '' ? '—' : (column.number ? Number(line[column.key]).toLocaleString('vi-VN') : line[column.key])}
              </td>))}
            <PercentCell value={line.c32Percent} />
            <MoneyCell value={line.c32NoVat} reason={line.c32Reason} missing={[]} />
            <PercentCell value={line.c47Percent} negative={line.c47Negative} />
            <MoneyCell value={line.c47NoVat} reason={line.c47Reason} missing={line.c47Missing} negative={line.c47Negative} />
          </tr>)}
        </tbody></table></div>
        {(data.orderRows || []).length > PAGE_SIZE * 4 && <small className="muted cost-breakdown-note">
          Màn hiện {(PAGE_SIZE * 4).toLocaleString('vi-VN')} dòng đầu cho nhẹ máy — bấm <b>Xuất Excel</b> để lấy trọn phần đang lọc.
        </small>}
      </div>}

      <div className="card table-card">
        <div className="cost-amounts-identity"><b>Tổng theo NV</b> — tổng C47 chỉ chốt khi đủ % mọi cặp; hụt cặp nào thì ghi rõ, không đưa "tổng thiếu" ra như tổng thật.</div>
        <div className="table-scroll"><table className="catalog-table catalog-table-simple"><thead><tr>
          <th>NV</th><th>Số kỳ</th><th>Số cặp</th><th>Cặp thiếu %</th><th>Cặp C47 âm</th>
          <th className="catalog-money">Doanh thu chưa VAT</th>
          {(data.columns || []).map((column) => <th key={column.key} className="catalog-money">{column.label}</th>)}
        </tr></thead><tbody>
          {(data.employees || []).map((item) => <tr key={item.empCode}>
            <td><b>{item.empCode}</b></td>
            <td>{item.periodCount}</td>
            <td>{item.pairCount}</td>
            <td>{item.missingPairs ? <b className="cost-amounts-warn">{item.missingPairs}</b> : 0}</td>
            <td title="Số cặp đã chi vượt quá C32 được cấp">{item.negativePairs ? <b className="cost-amounts-warn">{item.negativePairs}</b> : 0}</td>
            <td className="catalog-money" data-sensitive="">{money(item.revenueNoVat)}</td>
            <MoneyCell value={item.c32NoVat} reason="THIEU_PHAN_TRAM" missing={['C32']} />
            <MoneyCell value={item.c32WithVat} reason="THIEU_PHAN_TRAM" missing={['C32']} />
            <MoneyCell value={item.c47NoVat} reason="THIEU_PHAN_TRAM" missing={[]} />
            <MoneyCell value={item.c47WithVat} reason="THIEU_PHAN_TRAM" missing={[]} />
          </tr>)}
          {isCeo && data.grand && <tr className="cost-amounts-grand">
            <td><b>TỔNG CỘNG</b></td>
            <td>{(data.availablePeriods || []).length}</td>
            <td><b>{data.grand.pairCount}</b></td>
            <td>{data.grand.missingPairs ? <b className="cost-amounts-warn">{data.grand.missingPairs}</b> : 0}</td>
            <td>{data.grand.negativePairs ? <b className="cost-amounts-warn">{data.grand.negativePairs}</b> : 0}</td>
            <td className="catalog-money" data-sensitive=""><b>{money(data.grand.revenueNoVat)}</b></td>
            <MoneyCell value={data.grand.c32NoVat} reason="THIEU_PHAN_TRAM" missing={['C32']} />
            <MoneyCell value={data.grand.c32WithVat} reason="THIEU_PHAN_TRAM" missing={['C32']} />
            <MoneyCell value={data.grand.c47NoVat} reason="THIEU_PHAN_TRAM" missing={[]} />
            <MoneyCell value={data.grand.c47WithVat} reason="THIEU_PHAN_TRAM" missing={[]} />
          </tr>}
        </tbody></table></div>
      </div>
    </>}

    {isCeo && <VisibilityPanel />}
  </div>;
}
