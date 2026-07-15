import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadRevenueReport } from '../api.js';
import { formatDate, money, pairText } from '../util.js';
import { Spinner, Pager, SkeletonCards, UnitLabel } from '../components.jsx';
import { RevenueFilters, usePeriodsAndFilters } from './revenueFilters.jsx';
import { DrillNav, useReloadTick } from '../drillNav.jsx';
import { monthCoverage, nclRunRate } from '../revenueCoverage.js';
import ProductIdentity, { productQdClass } from '../ProductIdentity.jsx';

const pageSize = 50;
function contractorText(r) { return pairText(r.contractor_code, r.contractor_name); }
function isCl(r) { return String(r.route || '').trim().toUpperCase() === 'CL'; }
function isNclNt(r) { return ['NCL', 'NT'].includes(String(r.route || '').trim().toUpperCase()); }
function qty(v) { return Number(v || 0).toLocaleString('vi-VN'); }
function cstPct(v) { return Number.isFinite(Number(v)) ? Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : '—'; }
function cstBarPct(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }
function cstTone(v) {
  const pct = Number(v) || 0;
  if (pct >= 70) return 'critical';
  if (pct >= 50) return 'warning';
  if (pct >= 30) return 'purple';
  if (pct >= 10) return 'pink';
  if (pct >= 5) return 'sky';
  return 'pharma';
}
function coverageText(c) {
  const one = c?.segments?.length === 1 ? c.segments[0] : null;
  return one
    ? `${one.label} · ${one.selected}/${one.total} ngày bán hàng · ${cstPct(one.pct)}%`
    : `${c?.selected || 0}/${c?.total || 0} ngày bán hàng · ${cstPct(c?.pct)}%`;
}
function rateQty(v) {
  return Number.isFinite(Number(v)) ? Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : '—';
}

export default function RevenueFull({ me }) {
  const { periods, ky, setKy, filters, setFilters, options, queryFilters, filterBusy, filterNotice, filtersReady } = usePeriodsAndFilters(api);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exportFormat, setExportFormat] = useState('xlsx');
  const [sendOpen, setSendOpen] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [sendMsg, setSendMsg] = useState('');
  const [sendData, setSendData] = useState(null);
  const [sendPreview, setSendPreview] = useState(null);
  const [sendMode, setSendMode] = useState('all');
  const [sendGroup, setSendGroup] = useState('sale');
  const [sendCodes, setSendCodes] = useState([]);
  const [sendChannels, setSendChannels] = useState({ telegram: true, email: true });
  const { reloadTick, reload } = useReloadTick();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('app_nav_payload');
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.tab === 'revenueFull' && p.product) {
        setFilters((f) => ({ ...f, product: p.product }));
        sessionStorage.removeItem('app_nav_payload');
      }
    } catch { /* payload điều hướng không hợp lệ: bỏ qua */ }
  }, [setFilters]);

  useEffect(() => { setPage(1); }, [ky, filters]);
  useEffect(() => {
    if (!ky || !filtersReady) return;
    let cancelled = false;
    setData(null);
    api.revenueFull({ ky, page, pageSize, ...queryFilters }).then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [ky, page, queryFilters, filtersReady, reloadTick]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const duplicateProducts = new Set(Object.entries((data?.rows || []).reduce((m, r) => { const k = r.product_name || ''; if (k) m[k] = (m[k] || 0) + 1; return m; }, {})).filter(([, c]) => c > 1).map(([k]) => k));
  const coverage = useMemo(() => monthCoverage(data?.kys || (ky ? [ky] : []), queryFilters, periods), [data?.kys, ky, queryFilters, periods]);
  async function doExport() {
    setBusy(true);
    try { await downloadRevenueReport(exportFormat, { ky, ...queryFilters }); }
    catch (e) { alert(e.message); }
    setBusy(false);
  }
  async function openSendModal() {
    setSendOpen(true); setSendErr(''); setSendMsg(''); setSendPreview(null);
    if (!sendData) {
      setSendBusy(true);
      try {
        const d = await api.revenueSendRecipients();
        setSendData(d);
        setSendCodes((d.recipients || []).slice(0, 1).map((r) => r.emp_code));
      } catch (e) { setSendErr(e.message); }
      setSendBusy(false);
    }
  }
  const sendPayload = (confirmText = '') => ({
    recipientMode: sendMode,
    group: sendGroup,
    empCodes: sendCodes,
    channels: sendChannels,
    format: exportFormat,
    params: { ky, ...queryFilters },
    ...(confirmText ? { confirmText } : {}),
  });
  async function doSendPreview() {
    setSendBusy(true); setSendErr(''); setSendMsg(''); setSendPreview(null);
    try { setSendPreview(await api.revenueSendPreview(sendPayload())); }
    catch (e) { setSendErr(e.message); }
    setSendBusy(false);
  }
  async function doSendNow() {
    if (!sendPreview) { setSendErr('Sếp cần bấm Preview người nhận trước khi gửi thật.'); return; }
    if (!window.confirm(`Gửi báo cáo ${exportFormat.toUpperCase()} cho ${sendPreview.summary?.total || 0} người nhận?`)) return;
    setSendBusy(true); setSendErr(''); setSendMsg('');
    try {
      const r = await api.revenueSendNow(sendPayload('GUI_BAO_CAO'));
      setSendMsg(`Đã gửi: ${r.okCount}/${r.total} người nhận. Lỗi/thiếu kênh: ${r.failCount}.`);
      setSendPreview((p) => ({ ...(p || {}), sent: r }));
    } catch (e) { setSendErr(e.message); }
    setSendBusy(false);
  }

  return (
    <>
      <DrillNav crumbs={[{ label: 'Doanh thu đầy đủ' }]} onReload={reload} busy={!data} />
      <RevenueFilters me={me} ky={ky} periods={periods} options={options} filters={filters} setKy={setKy} setFilters={setFilters} filterBusy={filterBusy} filterNotice={filterNotice} />
      <div className="card revenue-summary-compact">
        <div className="revenue-summary-main">
          <div className="meta muted">Doanh thu đầy đủ · {filters.dateFrom || filters.dateTo ? `${formatDate(filters.dateFrom) || 'đầu dữ liệu'} → ${formatDate(filters.dateTo) || 'hiện tại'}` : `kỳ ${ky}`}</div>
          <div className="revenue-summary-value">{money(data?.totalRevenue || 0)}</div>
        </div>
        <div className="revenue-summary-stats" aria-label="Quy mô báo cáo">
          <span><b>{data?.sourceTotal?.toLocaleString('vi-VN') || 0}</b><em>Dòng nguồn</em></span>
          <span><b>{data?.total?.toLocaleString('vi-VN') || 0}</b><em>Thẻ tổng hợp</em></span>
          <span><b>{(data?.totalQuantity || 0).toLocaleString('vi-VN')}</b><em>Tổng số lượng</em></span>
        </div>
        <div className="revenue-summary-tools">
          <div className="revenue-export-tools">
            <select className="input revenue-export-format" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} aria-label="Định dạng báo cáo">
              <option value="xlsx">Excel đầy đủ (.xlsx)</option>
              <option value="csv">CSV dữ liệu thô (.csv)</option>
              <option value="pdf">PDF quản trị (.pdf)</option>
              <option value="pptx">PowerPoint (.pptx)</option>
            </select>
            <button className="btn ghost" disabled={busy} onClick={doExport}>{busy ? 'Đang tạo…' : '⬇ Xuất báo cáo'}</button>
            {me.isAdmin && <button className="btn" disabled={busy || sendBusy} onClick={openSendModal}>📤 Gửi Telegram/Email</button>}
          </div>
          <details className="revenue-summary-note">
            <summary>ⓘ Xem ghi chú</summary>
            <div className="revenue-summary-note-popover">
              {me.isAdmin && <p>Chọn <b>1 hoặc nhiều NV</b> ở bộ lọc; để trống là toàn công ty. KPI được đặt ở đầu file xuất.</p>}
              <p><b>Màu % CST còn lại:</b> đỏ ≥70%; vàng 50–&lt;70%; tím 30–&lt;50%; hồng 10–&lt;30%; xanh da trời 5–&lt;10%; xanh dược phẩm &lt;5%.</p>
            </div>
          </details>
        </div>
      </div>
      {!data ? <SkeletonCards count={6} /> : data.rows.length === 0 ? <div className="center">Không có dữ liệu.</div> : (
        <div className="detail-list-wrap">
          <Pager page={page} totalPages={pages} total={data.total} onPage={setPage} unit="dòng" />
          <div className="list-grid">
            {data.rows.map((r, i) => (
              <div className={`card detail-card table-detail-card full-revenue-card ${productQdClass(r)}`} key={`${r.emp_code}-${r.unit_code}-${r.iit_code}-${i}`}>
                <div className="detail-head">
                  <div className="detail-title-wrap">
                    <span className="rank">{(page - 1) * pageSize + i + 1}</span>
                    <div className="product-identity-wrap">
                      <ProductIdentity
                        row={r}
                        duplicateName={duplicateProducts.has(r.product_name)}
                        headingAside={<div className="detail-money">{money(r.revenue)}<em>Doanh thu</em></div>}
                      />
                      <div className="detail-sub source-rollup">{r.source_rows || 1} dòng phát sinh{r.source_date_from ? ` · ${formatDate(r.source_date_from)}${r.source_date_to && r.source_date_to !== r.source_date_from ? `–${formatDate(r.source_date_to)}` : ''}` : ''}</div>
                    </div>
                  </div>
                </div>
                <div className="detail-entity"><UnitLabel code={r.unit_code} name={r.unit_name} /></div>
                <div className="detail-facts">
                  <span><b>{r.emp_code || '—'}</b><em>{r.emp_name || 'Nhân viên'}</em></span>
                  <span><b>{r.route || '—'}</b><em>Tuyến</em></span>
                  <span><b>{(r.quantity || 0).toLocaleString('vi-VN')}</b><em>{isNclNt(r) ? 'SL đã bán trong khoảng chọn' : 'Số lượng'}</em></span>
                  <span><b>{contractorText(r)}</b><em>Nhà thầu</em></span>
                  <span><b>{r.bid_price != null ? money(r.bid_price) : 'Thiếu nguồn giá'}</b><em>Giá trúng thầu</em></span>
                  <span><b>{r.priority || 'Thiếu nguồn UT'}</b><em>Ưu tiên</em></span>
                  {isNclNt(r) && <span><b>{r.c14 || 'Chưa có dữ liệu'}</b><em>Phân nhóm chỉ định (C14)</em></span>}
                </div>
                {isNclNt(r) && coverage.segments.length > 0 && (
                  <div className="ncl-time-coverage" aria-label="Tiến độ ngày bán hàng theo tháng">
                    <div className="ncl-time-head"><span>Tiến độ ngày bán hàng · không tính Chủ nhật</span><b>{coverageText(coverage)}</b></div>
                    <div className="ncl-time-segments">
                      {coverage.segments.map((s) => <span key={s.ky}>
                        <em>{s.label} · {s.selected}/{s.total}</em><i><b style={{ width: `${s.pct}%` }} /></i>
                      </span>)}
                    </div>
                    <div className="ncl-runrate">
                      <span><b>{rateQty(nclRunRate(r.quantity, coverage).averagePerDataDay)}</b><em>Bình quân/ngày bán hàng có dữ liệu</em></span>
                      {nclRunRate(r.quantity, coverage).projectedMonth != null && <span><b>{rateQty(nclRunRate(r.quantity, coverage).projectedMonth)}</b><em>Ước số lượng cuối {coverage.segments[0].label}</em></span>}
                    </div>
                    <div className="meta muted ncl-time-note">
                      Ngày bán hàng không tính Chủ nhật; không phải % hoàn thành doanh số.
                      {coverage.dataAsOf ? ` Dữ liệu đến ${formatDate(coverage.dataAsOf)}.` : ''}
                    </div>
                  </div>
                )}
                {isCl(r) && (r.cst_available ? (
                  <div className={`revenue-cst cst-tone-${cstTone(r.cst_remaining_pct)}`} aria-label="Cơ số thầu tuyến CL">
                    <div className="revenue-cst-metrics">
                      <span><b>{qty(r.cst_initial)}</b><em>CST ban đầu</em></span>
                      <span className="cst-remaining-metric"><b>{qty(r.cst_remaining)}</b><em>CST còn lại</em></span>
                    </div>
                    <div className="revenue-cst-progress-head">
                      <span>CST còn lại</span><b>{cstPct(r.cst_remaining_pct)}%</b>
                    </div>
                    <div className="revenue-cst-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={cstBarPct(r.cst_remaining_pct)}>
                      <i style={{ width: `${cstBarPct(r.cst_remaining_pct)}%` }} />
                    </div>
                    <div className="meta muted revenue-cst-source" title={`Nguồn CST: App Sale New · Theo dõi HĐ${r.cst_as_of ? ` · cập nhật ${formatDate(r.cst_as_of)}` : ''}`}>
                      CST App Sale{r.cst_as_of ? ` · cập nhật ${formatDate(r.cst_as_of)}` : ''}
                    </div>
                  </div>
                ) : (
                  <div className="revenue-cst revenue-cst-missing">{r.cst_unavailable_reason || 'Chưa có dữ liệu CST'}</div>
                ))}
              </div>
            ))}
          </div>
          <Pager page={page} totalPages={pages} total={data.total} onPage={setPage} unit="dòng" />
        </div>
      )}
      {sendOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setSendOpen(false); }}>
          <div className="modal-card revenue-send-modal">
            <div className="modal-head"><b>📤 Gửi báo cáo doanh thu</b><button className="btn ghost" onClick={() => setSendOpen(false)}>Đóng</button></div>
            <div className="revenue-send-grid">
              <label><span>Phạm vi gửi</span><select className="input" value={sendMode} onChange={(e) => { setSendMode(e.target.value); setSendPreview(null); }}>
                <option value="all">Toàn phòng Sale</option>
                <option value="group">Theo nhóm</option>
                <option value="individual">Cá nhân từng NV</option>
              </select></label>
              <label><span>Định dạng file</span><select className="input" value={exportFormat} onChange={(e) => { setExportFormat(e.target.value); setSendPreview(null); }}>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV (.csv)</option>
                <option value="pdf">PDF (.pdf)</option>
                <option value="pptx">PowerPoint (.pptx)</option>
              </select></label>
              <div className="revenue-send-channels"><span>Kênh gửi</span><label><input type="checkbox" checked={sendChannels.telegram} onChange={(e) => { setSendChannels((x) => ({ ...x, telegram: e.target.checked })); setSendPreview(null); }} /> Telegram</label><label><input type="checkbox" checked={sendChannels.email} onChange={(e) => { setSendChannels((x) => ({ ...x, email: e.target.checked })); setSendPreview(null); }} /> Email</label></div>
              {sendMode === 'group' && <label><span>Nhóm</span><select className="input" value={sendGroup} onChange={(e) => { setSendGroup(e.target.value); setSendPreview(null); }}>
                {(sendData?.groups || []).filter((g) => g.key !== 'all').map((g) => <option key={g.key} value={g.key}>{g.label} ({g.empCodes?.length || 0})</option>)}
              </select></label>}
              {sendMode === 'individual' && <label className="revenue-send-select"><span>Chọn NV</span><select className="input" multiple size="8" value={sendCodes} onChange={(e) => { setSendCodes([...e.target.selectedOptions].map((o) => o.value)); setSendPreview(null); }}>
                {(sendData?.recipients || []).map((r) => <option key={r.emp_code} value={r.emp_code}>{r.emp_code} — {r.name}</option>)}
              </select></label>}
            </div>
            <div className="meta muted revenue-send-note">Mặc định mỗi nhân viên nhận <b>báo cáo cá nhân theo đúng mã NV của mình</b>; không gửi báo cáo toàn công ty cho nhân viên.</div>
            {sendErr && <div className="alert high"><span className="dot" /><div><div className="t">Lỗi</div><div className="d">{sendErr}</div></div></div>}
            {sendMsg && <div className="alert low"><span className="dot" /><div><div className="t">Kết quả</div><div className="d">{sendMsg}</div></div></div>}
            <div className="smart-toolbar"><button className="btn ghost" disabled={sendBusy} onClick={doSendPreview}>{sendBusy ? 'Đang xử lý…' : 'Preview người nhận'}</button><button className="btn" disabled={sendBusy || !sendPreview} onClick={doSendNow}>Gửi thật</button></div>
            {sendPreview && <div className="revenue-send-preview">
              <div className="section-head">Preview: {sendPreview.summary.total} người · Telegram gửi được {sendPreview.summary.sendableTelegram} · Email gửi được {sendPreview.summary.sendableEmail}</div>
              <div className="revenue-send-list">
                {sendPreview.recipients.map((r) => <div key={r.emp_code} className="revenue-send-row"><b>{r.emp_code}</b><span>{r.name}</span><em>{r.hasTelegram ? 'TG ✓' : 'TG thiếu'} · {r.hasEmail ? 'Email ✓' : 'Email thiếu'}</em></div>)}
              </div>
              {sendPreview.sent && <div className="revenue-send-list">
                {sendPreview.sent.results.map((r) => <div key={`sent-${r.emp_code}`} className="revenue-send-row"><b>{r.emp_code}</b><span>{r.ok ? 'Đã gửi ít nhất 1 kênh' : (r.error || 'Chưa gửi được')}</span><em>{Object.entries(r.channels || {}).map(([k, v]) => `${k}: ${v.ok ? 'OK' : (v.description || 'lỗi')}`).join(' · ')}</em></div>)}
              </div>}
            </div>}
          </div>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Bảng chi tiết lấy dữ liệu backend theo quyền; NV thường chỉ thấy dòng của chính mình.</p>
    </>
  );
}
