import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadCostAmounts } from '../api.js';
import { Spinner } from '../components.jsx';
import { bangkokToday } from '../revenueCoverage.js';
import { formatDateTime } from '../util.js';

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
  const [period, setPeriod] = useState(currentKy());
  const [periods, setPeriods] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const isCeo = !!me?.is_ceo;

  useEffect(() => { api.periods().then((p) => { const list = (p.periods || p || []).map((x) => x.ky || x).filter((x) => /^\d{2}\.\d{4}$/.test(x)); setPeriods(list); if (list.length && !list.includes(period)) setPeriod(list.at(-1)); }).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    api.costAmounts({ period })
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) { setData(null); setError(e.message); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);
  useEffect(() => { setPage(1); }, [period, query]);

  const rows = useMemo(() => {
    const all = data?.rows || [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => `${r.empCode} ${r.unitCode} ${r.productCode} ${r.productName}`.toLowerCase().includes(q));
  }, [data, query]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  async function exportXlsx() {
    setExporting(true); setError('');
    try { await downloadCostAmounts({ period }); } catch (e) { setError(e.message); }
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
      <label><span>Kỳ</span><select value={period} onChange={(e) => setPeriod(e.target.value)}>{(periods.length ? periods : [period]).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label><span>Tìm nhanh</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="NV, đơn vị, mã hàng, tên hàng…" /></label>
      {data?.available && <button className="btn" disabled={exporting} onClick={exportXlsx}>{exporting ? 'Đang xuất…' : '⬇ Xuất Excel'}</button>}
    </div>

    {loading && <Spinner />}
    {!loading && error && <div className="catalog-alert error" role="alert">⛔ {error}</div>}
    {!loading && !error && data && !data.available && <div className="card">
      {data.reason === 'CHUA_DONG_BO'
        ? <p>Kho % cục bộ <b>CHƯA có kỳ {period}</b> — {isCeo ? <>vào <b>Danh mục QL</b> bấm <b>"Đồng bộ % chi phí"</b> một lần khi DataHub đang sống, rồi quay lại đây.</> : 'chờ CEO bấm "Đồng bộ % chi phí" cho kỳ này.'}</p>
        : <p>Kỳ {period} không có dữ liệu của Anh/Chị trong kho % cục bộ.</p>}
    </div>}

    {!loading && !error && data?.available && <>
      <div className="card table-card">
        <div className="cost-amounts-identity">Bản % đồng bộ <b>{formatDateTime(data.fetchedAt)}</b> bởi <b>{data.fetchedBy}</b> · doanh thu slot kỳ <b>{hubToUi(data.period)}</b> · {rows.length.toLocaleString('vi-VN')} cặp{rows.length > PAGE_SIZE && <> · Hiện trang {safePage}/{pageCount} ({PAGE_SIZE} dòng/trang)</>}</div>
        <div className="table-scroll"><table className="catalog-table catalog-table-simple"><thead><tr>
          <th>NV</th><th>Đơn vị</th><th>Mã hàng</th><th>Tên hàng</th>
          <th className="catalog-money">Doanh thu chưa VAT</th>
          <th className="catalog-money">C32 %</th>
          {(data.columns || []).slice(0, 2).map((column) => <th key={column.key} className="catalog-money">{column.label}</th>)}
          <th className="catalog-money">C47 %</th>
          {(data.columns || []).slice(2).map((column) => <th key={column.key} className="catalog-money">{column.label}</th>)}
        </tr></thead><tbody>
          {visibleRows.map((r) => <tr key={`${r.empCode}-${r.unitCode}-${r.productCode}`}>
            <td><b>{r.empCode}</b></td>
            <td>{r.unitCode}</td>
            <td>{r.productCode}</td>
            <td>{r.productName}</td>
            <td className="catalog-money" data-sensitive="">{money(r.revenueNoVat)}</td>
            <PercentCell value={r.c32Percent} />
            <MoneyCell value={r.c32NoVat} reason={r.c32Reason} missing={[]} />
            <MoneyCell value={r.c32WithVat} reason={r.c32Reason} missing={[]} />
            <PercentCell value={r.c47Percent} negative={r.c47Negative} />
            <MoneyCell value={r.c47NoVat} reason={r.c47Reason} missing={r.c47Missing} negative={r.c47Negative} />
            <MoneyCell value={r.c47WithVat} reason={r.c47Reason} missing={r.c47Missing} negative={r.c47Negative} />
          </tr>)}
        </tbody></table></div>
        {rows.length === 0 && <div className="muted catalog-empty">Không có cặp nào trong phạm vi đang lọc.</div>}
        {pageCount > 1 && <div className="cost-amounts-pager">
          <button className="btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹ Trước</button>
          <span>Trang {safePage}/{pageCount} · {rows.length.toLocaleString('vi-VN')} dòng</span>
          <button className="btn" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Sau ›</button>
        </div>}
      </div>

      <div className="card table-card">
        <div className="cost-amounts-identity"><b>Tổng theo NV</b> — tổng C47 chỉ chốt khi đủ % mọi cặp; hụt cặp nào thì ghi rõ, không đưa "tổng thiếu" ra như tổng thật.</div>
        <div className="table-scroll"><table className="catalog-table catalog-table-simple"><thead><tr>
          <th>NV</th><th>Số cặp</th><th>Cặp thiếu %</th><th>Cặp C47 âm</th>
          <th className="catalog-money">Doanh thu chưa VAT</th>
          {(data.columns || []).map((column) => <th key={column.key} className="catalog-money">{column.label}</th>)}
        </tr></thead><tbody>
          {(data.employees || []).map((item) => <tr key={item.empCode}>
            <td><b>{item.empCode}</b></td>
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
