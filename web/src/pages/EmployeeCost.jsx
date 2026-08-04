import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, downloadEmployeeCostDataQuality, downloadEmployeeCostGaps, downloadEmployeeCostProvinceWorklist, downloadEmployeeCostReport } from '../api.js';
import { Kpi, Spinner } from '../components.jsx';
import {
  currentMonthValue, quickMonths, employeeCostColumnKpis, employeeCostGapConsistency, employeeCostHighlightParts, employeeCostKpiMatch, employeeCostNoMatch, employeeCostViewModel,
  employeeCostPageItems, formatEmployeeCostCell, formatMatchRate, formatMonthLabel,
} from '../employeeCostModel.js';
import {
  normalizeVisibilityPanel, readVisibilityCollapsed, updateVisibilitySetting, visibilityCollapseStorageKey,
  visibilityEffectiveLabel, visibilitySavePayload, visibilitySourceLabel, writeVisibilityCollapsed,
} from '../employeeCostVisibilityModel.js';
import { employeeCostGapView, gapReasonLabel } from '../employeeCostGapModel.js';
import { dataQualityTypeLabel, employeeCostDataQualityView } from '../employeeCostDataQualityModel.js';
import { employeeVatKhoanDeduction, employeeVatKhoanViewModel } from '../employeeVatKhoanModel.js';
import { createLatestRequestGate } from '../requestCoordinator.js';

const month = currentMonthValue();
const EMPTY = { empCode: '', from: month, to: month, periods: [], note: 'chưa có dữ liệu chi phí kỳ này' };
const moneyColumn = { kind: 'money' };
const EMPLOYEE_COST_PAGE_SIZES = [20, 50, 100];
// CEO duyệt 01/08/2026: bật Ứng lần 1 và Còn lại sau ứng theo đúng một NV.
// ALL không fan-out/tổng hợp; cả hai ô đều yêu cầu chọn một nhân viên.
const SALARY_ADVANCE_UI = true;
const employeeOptionLabel = (employee) => `${employee.emp_code} · ${employee.name}${employee.group_key && employee.group_key !== 'sale' ? ` · ${employee.group_label}` : ''}`;
const browserStorage = () => {
  try { return globalThis.localStorage; } catch { return null; }
};

function EmployeeCostPager({ pagination, onPage, onPageSize, location = 'bottom', unit = 'dòng' }) {
  const [jump, setJump] = useState('');
  if (!pagination || !pagination.filteredRows || typeof onPage !== 'function') return null;
  const page = Number(pagination.page || 1);
  const pageCount = Number(pagination.pageCount || 1);
  const go = (value) => onPage(Math.min(Math.max(1, Number(value) || 1), pageCount));
  const submitJump = (event) => { event.preventDefault(); go(jump); setJump(''); };
  return <nav className={`employee-cost-pagination pager-capsule ${location === 'top' ? 'is-top' : 'is-bottom'}`} aria-label={`Phân trang chi phí phía ${location === 'top' ? 'trên' : 'dưới'}`}>
    <button type="button" className="employee-cost-page-nav prev" disabled={page <= 1} onClick={() => go(page - 1)}>‹ Trước</button>
    <div className="employee-cost-page-numbers" role="group" aria-label="Chọn trang">
      {employeeCostPageItems(page, pageCount).map((item, index) => item === '…'
        ? <span className="employee-cost-page-ellipsis" key={`ellipsis-${index}`}>…</span>
        : <button type="button" key={item} className={item === page ? 'active' : ''} aria-current={item === page ? 'page' : undefined} onClick={() => go(item)}>{item}</button>)}
    </div>
    <span className="employee-cost-page-info">Trang <b>{page}/{pageCount}</b> · {Number(pagination.filteredRows).toLocaleString('vi-VN')} {unit}</span>
    {pageCount > 10 && <form className="employee-cost-page-jump" onSubmit={submitJump}>
      <label><span className="sr-only">Tới trang</span><input type="number" min="1" max={pageCount} value={jump} onChange={(event) => setJump(event.target.value)} placeholder="Tới trang…" /></label>
    </form>}
    {typeof onPageSize === 'function' && <label className="employee-cost-page-size"><span>Số dòng</span><select value={pagination.pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{EMPLOYEE_COST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>}
    <button type="button" className="employee-cost-page-nav next" disabled={page >= pageCount} onClick={() => go(page + 1)}>Sau ›</button>
  </nav>;
}

function useEmployeeCostPage(rows = [], resetKey = '') {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(20);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  useEffect(() => { setPage(1); }, [resetKey]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const setPageSize = (value) => {
    const next = EMPLOYEE_COST_PAGE_SIZES.includes(Number(value)) ? Number(value) : 20;
    setPageSizeState(next);
    setPage(1);
  };
  const start = (currentPage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    start,
    pagination: { page: currentPage, pageSize, pageCount, filteredRows: total, totalRows: total },
    setPage,
    setPageSize,
  };
}

function Highlight({ value, query }) {
  return employeeCostHighlightParts(value, query).map((part, index) => part.match
    ? <mark key={`${part.text}-${index}`}>{part.text}</mark>
    : <React.Fragment key={`${part.text}-${index}`}>{part.text}</React.Fragment>);
}

function CostTable({ period, daily = false, query = '', sort = {}, onSort, allEmployees = false, onPage, onPageSize, c45Dropped = false }) {
  const [tooltip, setTooltip] = useState('');
  const sourceRows = daily ? period.daily.rows : period.rows;
  // Search/filter/sort/STT are resolved by the backend for both self and ALL
  // scopes so the table and exports always use one financial slice.
  const rows = sourceRows;
  const columnCount = period.columns.length + 1 + (allEmployees ? 1 : 0);
  const totalsByDate = new Map((period.daily.totals || []).map((total) => [total.date, total]));
  const renderCell = (row, column) => {
    const text = formatEmployeeCostCell(row[column.key], column);
    if (column.tooltip && text !== '—') return <button type="button" className="employee-cost-ellipsis" title={text} onClick={() => setTooltip(text)}>{text}</button>;
    if (column.key === 'c7' || column.key === 'contractorName') return <span className="employee-cost-clamp-2" title={text}><Highlight value={text} query={query} /></span>;
    return <Highlight value={text} query={query} />;
  };
  const sortHeader = (column) => {
    if (!onSort) return;
    onSort(column.key);
  };
  return <>
    {!daily && <EmployeeCostPager pagination={period.pagination} onPage={onPage} onPageSize={onPageSize} location="top" />}
    <div className="employee-cost-table-wrap">
      <table className={`employee-cost-table${allEmployees ? ' is-all-employees' : ''}`}>
      <thead>
        <tr>
          <th className="employee-cost-sticky-stt employee-cost-number">STT</th>
          {allEmployees && <th className="employee-cost-employee"><button type="button" onClick={() => sortHeader({ key: 'employeeCode' })}>Nhân viên{sort.key === 'employeeCode' ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</button></th>}
          {period.columns.map((column) => <th key={column.key} title={column.kind === 'percent' ? column.label : undefined} className={`${column.annual ? 'employee-cost-annual ' : ''}${column.kind === 'percent' ? 'employee-cost-percent ' : ''}${column.key === 'c16' ? 'employee-cost-sticky-product ' : ''}${column.key === 'c45' && c45Dropped ? 'employee-cost-c45-dropped ' : ''}employee-cost-col-${column.key}`}>
            <button type="button" onClick={() => sortHeader(column)}>{column.label}{sort.key === column.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</button>
            {column.annual && <span className="employee-cost-annual-badge">cuối năm</span>}
            {column.key === 'c45' && c45Dropped && <span className="employee-cost-annual-badge">không cộng sau phạt</span>}
          </th>)}
        </tr>
      </thead>
      <tbody>{rows.map((row, rowIndex) => <React.Fragment key={row.sourceLineId || rowIndex}>
        {daily && row.date !== rows[rowIndex - 1]?.date && <tr className="employee-cost-day-group">
          <td colSpan={columnCount}>
            <b>Ngày {formatEmployeeCostCell(row.date, { key: 'date', kind: 'dimension' })}</b>
            <span>Σ ngày: {formatEmployeeCostCell(totalsByDate.get(row.date)?.monthlyTotal, moneyColumn)} (chưa gồm cuối năm)</span>
            {totalsByDate.get(row.date)?.afterPenaltyTotal != null && <span>· sau phạt: {formatEmployeeCostCell(totalsByDate.get(row.date).afterPenaltyTotal, moneyColumn)}</span>}
          </td>
        </tr>}
        <tr>
          <td className="employee-cost-sticky-stt employee-cost-number">{row.stt || rowIndex + 1}</td>
          {allEmployees && <td className="employee-cost-employee"><b><Highlight value={row.employeeCode} query={query} /></b><small title={row.employeeName}><Highlight value={row.employeeName} query={query} /></small></td>}
          {period.columns.map((column) => <td key={column.key} className={`${column.kind === 'money' || column.kind === 'percent' || column.format === 'number' ? 'employee-cost-number' : ''}${column.annual ? ' employee-cost-annual' : ''}${column.kind === 'percent' ? ' employee-cost-percent' : ''}${column.key === 'c16' ? ' employee-cost-sticky-product' : ''} employee-cost-col-${column.key}`}>
            {renderCell(row, column)}
          </td>)}
        </tr>
      </React.Fragment>)}</tbody>
      </table>
    </div>
    {!daily && <EmployeeCostPager pagination={period.pagination} onPage={onPage} onPageSize={onPageSize} location="bottom" />}
    {!!tooltip && <div className="employee-cost-tooltip-backdrop" role="presentation" onClick={() => setTooltip('')}>
      <div className="employee-cost-tooltip" role="dialog" aria-modal="true" aria-label="Hàm lượng đầy đủ" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="employee-cost-tooltip-close" aria-label="Đóng" onClick={() => setTooltip('')}>×</button>
        {tooltip}
      </div>
    </div>}
  </>;
}

function PeriodBlock({ period, expanded, onToggle, query, sort, onSort, allEmployees, onPage, onPageSize, penalty }) {
  const annualNote = period.summary.annualLabels.join(', ');
  const filteredCount = period.search.filteredRows;
  const totalCount = period.search.totalRows;
  return <div className="card employee-cost-panel">
    <div className="employee-cost-period-head">
      <div>
        <div className="section-head">Tháng {formatMonthLabel(period.period)}</div>
        <div className="employee-cost-panel-meta">
          Mẫu {period.template.label || 'chi phí'} · {period.dynamicCount.toLocaleString('vi-VN')} cột tỷ lệ · khớp {formatMatchRate(period.match)} ({period.match.matchedRows}/{period.match.totalRows} cặp đơn vị×mặt hàng) · hiện {filteredCount.toLocaleString('vi-VN')}/{totalCount.toLocaleString('vi-VN')} dòng
        </div>
      </div>
      {!!period.rows.length && <button type="button" className="btn secondary" onClick={onToggle} aria-expanded={expanded}>
        {expanded ? 'Ẩn chi tiết ngày' : 'Xem theo ngày'}
      </button>}
    </div>

    {period.match.low && <div className="employee-cost-match-warning" role="alert">
      <b>⚠ Tỷ lệ ghép doanh thu dưới {period.match.threshold}%.</b>
      {' '}Chưa hiển thị tổng tháng/cuối năm để tránh số thiếu; dòng không khớp giữ “—”. Vui lòng báo CEO/Claude rà catalog.
    </div>}

    {!period.rows.length ? <div className="center">{period.note || 'Không có dòng phù hợp bộ lọc.'}</div> : <>
      {allEmployees && !!period.employeeSubtotals.length && <details className="employee-cost-subtotals">
        <summary>Tổng phụ theo nhân viên ({period.employeeSubtotals.length})</summary>
        <div>{period.employeeSubtotals.map((item) => <span key={item.employeeCode}><b>{item.employeeCode} · {item.employeeName}</b><small>{item.rowCount.toLocaleString('vi-VN')} dòng · {formatEmployeeCostCell(item.monthlyTotal, moneyColumn)}</small></span>)}</div>
      </details>}
      <CostTable period={period} query={query} sort={sort} onSort={onSort} allEmployees={allEmployees} onPage={onPage} onPageSize={onPageSize} c45Dropped={penalty?.c45Dropped} />
      <div className="employee-cost-summary-row">
        <span>{query ? 'Tổng các dòng đang lọc' : 'Tổng chi phí tháng'} (chưa gồm khoản cuối năm)</span>
        <b>{formatEmployeeCostCell(period.summary.monthlyTotal, moneyColumn)}</b>
      </div>
      {penalty?.afterPenaltyTotal != null && <div className="employee-cost-summary-row employee-cost-after-penalty-total">
        <span>Tổng chi phí tháng sau phạt <small>· {penalty?.label || 'Dự kiến/tham khảo — chưa trừ lương'}</small></span>
        <b>{formatEmployeeCostCell(penalty.afterPenaltyTotal, moneyColumn)}</b>
      </div>}
      {!!period.summary.annualLabels.length && <div className="employee-cost-summary-row employee-cost-annual-total">
        <span>Khoản cuối năm (tạm tính · chi trả T12)</span>
        <b>{formatEmployeeCostCell(period.summary.annualTotal, moneyColumn)}</b>
      </div>}
    </>}

    {expanded && <div className="employee-cost-daily">
      <div className="section-head">Chi tiết theo ngày · tháng {formatMonthLabel(period.period)}</div>
      {!period.daily.reliable
        ? <div className="employee-cost-match-warning" role="alert">Không thể tách theo ngày: {period.daily.reason || 'dữ liệu ngày chưa đủ để đối chiếu tổng tháng'}.</div>
        : !period.daily.rows.length ? <div className="center">Chưa có doanh thu theo ngày.</div>
          : <CostTable period={period} daily query={query} sort={sort} onSort={onSort} c45Dropped={penalty?.c45Dropped} />}
    </div>}

    {!!period.rows.length && <div className="employee-cost-source-note">
      Thành tiền tháng = doanh thu trước VAT × tỷ lệ ÷ 100 (không gồm C44); dòng/ngày không ghép đủ tỷ lệ hiển thị “—”.
      {annualNote && <> Cột {annualNote} thanh toán cuối năm (T12), không tính vào tổng tháng hoặc tổng kỳ.</>}
    </div>}
  </div>;
}

function VisibilitySelect({ value, onChange, allowInherit = true, inheritLabel = 'Theo cấp trên', label }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    {allowInherit && <option value="inherit">{inheritLabel}</option>}
    <option value="on">Bật</option>
    <option value="off">Tắt</option>
  </select>;
}

function CostColumnKpi({ item, coverageNote = '' }) {
  return <div className={`kpi employee-cost-column-kpi${item.annual ? ' employee-cost-kpi-annual' : ''}`}>
    <div className="label">
      <span>{item.label}</span>
      {item.annual && <span className="employee-cost-kpi-badge">cuối năm</span>}
      {item.provisional && <span className="employee-cost-kpi-badge">tạm tính</span>}
    </div>
    <div className="value small">{formatEmployeeCostCell(item.value, moneyColumn)}</div>
    <div className="delta muted">{item.provisional
      ? (coverageNote || 'Tổng phần đã khớp % · chưa gồm mã thiếu %')
      : (item.annual ? 'Khoản riêng · chi trả T12' : 'Tổng thành tiền theo cột')}</div>
  </div>;
}

// Tháng liền trước của 'YYYY-MM'. Chuỗi thuần, không đụng đồng hồ máy nên không
// dính lệch múi giờ.
function previousMonthValue(value) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value || ''));
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

function bonusPctLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%` : '0%';
}

function targetPctLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—';
}

// Target tổng đội (chế độ "Tất cả NV"): cộng target/đạt của từng NV từ dữ liệu thưởng
// dự kiến đã tải sẵn — display-only/tham khảo, KHÔNG phát sinh nguồn số mới.
function teamTargetSummary(subtotals = []) {
  const acc = { monthTarget: 0, monthAchieved: 0, quarterTarget: 0, assigned: 0, total: 0 };
  for (const item of Array.isArray(subtotals) ? subtotals : []) {
    acc.total += 1;
    if (Number.isFinite(item?.month?.target)) { acc.monthTarget += item.month.target; acc.assigned += 1; }
    if (Number.isFinite(item?.month?.achieved)) acc.monthAchieved += item.month.achieved;
    if (Number.isFinite(item?.quarter?.target)) acc.quarterTarget += item.quarter.target;
  }
  return {
    hasData: acc.monthTarget > 0,
    assigned: acc.assigned,
    total: acc.total,
    monthTarget: acc.monthTarget,
    monthPct: acc.monthTarget > 0 ? +(acc.monthAchieved / acc.monthTarget * 100).toFixed(1) : null,
    quarterTarget: acc.quarterTarget,
  };
}

function TargetKpi({ target, onOpen }) {
  if (!target.available) return <Kpi label="Target (tháng · quý)" value="Chọn 1 NV" sub="Chọn đúng một nhân viên để xem target và cách tính" tone="employee-cost-tone-target" />;
  const monthTarget = formatEmployeeCostCell(target.month.target, moneyColumn);
  const quarterTarget = formatEmployeeCostCell(target.quarter.target, moneyColumn);
  return <Kpi
    label="Target (tháng · quý)"
    value={`${monthTarget} · ${targetPctLabel(target.month.pct)}`}
    sub={`${target.month.label}: target · % đạt | ${target.quarter.label || 'Quý'}: ${quarterTarget} · ${targetPctLabel(target.quarter.pct)} · Bấm xem cách tính`}
    tone="employee-cost-tone-target"
    title="Mở chi tiết target, nguồn giao và doanh thu trước VAT do backend cung cấp."
    onClick={onOpen}
  />;
}

function targetSourceContext(period) {
  if (!period.assigned) return 'Chưa giao target';
  return `${period.sourceLabel || period.source || 'Nguồn chưa đặt tên'}${period.sourceKy ? ` · kỳ ${period.sourceKy}` : ''}${period.reference ? ' · tham khảo' : ''}`;
}

function TargetDetailModal({ target, employeeLabel, admin, onClose, onNavigate }) {
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    const keepFocusInside = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(modalRef.current?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', keepFocusInside);
    return () => {
      window.removeEventListener('keydown', keepFocusInside);
      previousFocus?.focus?.();
    };
  }, [onClose]);
  if (!target.available) return null;
  const openTarget = () => {
    onClose();
    onNavigate?.('target', { targetView: 'admin', ky: target.ky, emp: target.empCode });
  };
  return <div className="modal-backdrop employee-cost-target-modal-backdrop" role="presentation" onClick={onClose}>
    <div ref={modalRef} className="modal-card employee-cost-target-modal" role="dialog" aria-modal="true" aria-labelledby="employee-cost-target-modal-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head">
        <div>
          <b id="employee-cost-target-modal-title">Chi tiết cách tính target</b>
          <small>{employeeLabel} · kỳ {target.ky}</small>
        </div>
        <button ref={closeRef} type="button" className="employee-cost-target-modal-close" aria-label="Đóng chi tiết target" onClick={onClose}>×</button>
      </div>

      <section className="employee-cost-target-section">
        <h3>Tháng {target.month.label}</h3>
        <div className="employee-cost-target-equation">
          <span>Target {target.month.label}<small>{targetSourceContext(target.month)}</small></span>
          <b>{formatEmployeeCostCell(target.month.target, moneyColumn)}</b>
          <span>Doanh thu trước VAT {target.month.label}</span>
          <b>{formatEmployeeCostCell(target.month.achieved, moneyColumn)}</b>
          <span>% đạt tháng<small>Doanh thu trước VAT ÷ target × 100</small></span>
          <b>{targetPctLabel(target.month.pct)}</b>
        </div>
      </section>

      <section className="employee-cost-target-section">
        <h3>Quý {target.quarter.label}</h3>
        <div className="employee-cost-target-months">
          {target.quarter.months.map((item) => <div key={item.ky} className={!item.assigned ? 'is-unassigned' : ''}>
            <span><b>{item.label}</b><small>{targetSourceContext(item)}</small></span>
            <span><b>{formatEmployeeCostCell(item.target, moneyColumn)}</b><small>DT trước VAT: {formatEmployeeCostCell(item.achieved, moneyColumn)} · đạt {targetPctLabel(item.pct)}</small></span>
          </div>)}
        </div>
        <div className="employee-cost-target-equation employee-cost-target-quarter-summary">
          <span>Target quý<small>Target quý = trung bình các tháng đã giao</small></span>
          <b>{formatEmployeeCostCell(target.quarter.target, moneyColumn)}</b>
          <span>Doanh thu trước VAT quý</span>
          <b>{formatEmployeeCostCell(target.quarter.achieved, moneyColumn)}</b>
          <span>% đạt quý<small>Doanh thu trước VAT trung bình cùng các tháng đã giao ÷ target quý × 100</small></span>
          <b>{targetPctLabel(target.quarter.pct)}</b>
        </div>
      </section>

      <div className="employee-cost-target-note" role="note">
        <b>Lưu ý</b>
        <span>{target.quarter.clarification}</span>
        <span>{target.basisLabel || 'Target và doanh thu đều so trước VAT.'}</span>
      </div>
      <div className="employee-cost-target-modal-actions">
        {admin && <button type="button" className="btn" onClick={openTarget}>Chỉnh target</button>}
        <button type="button" className="btn secondary" onClick={onClose}>Đóng</button>
      </div>
    </div>
  </div>;
}

function BonusKpi({ bonus, onOpen }) {
  if (bonus.reason === 'employee_separate_formula_pending') return <Kpi label="Thưởng dự kiến" value="Chờ công thức riêng" sub={bonus.message || 'Nhân viên này chưa áp dụng công thức thưởng P1/P2 hiện tại'} title={bonus.message} tone="employee-cost-tone-reward" />;
  if (!bonus.configured) return <Kpi label="Thưởng dự kiến" value="Chưa cấu hình mức thưởng" sub="theo mức đạt target · tham khảo" title="App Report chỉ tính tham khảo; không gửi thưởng và không ghi payroll." tone="employee-cost-tone-reward" />;
  const month = bonus.month;
  const quarter = bonus.quarter;
  const monthAmount = month.amount == null ? '—' : formatEmployeeCostCell(month.amount, moneyColumn);
  const quarterAmount = quarter.amount == null ? '—' : formatEmployeeCostCell(quarter.amount, moneyColumn);
  const baseAmount = month.baseAmount == null ? '—' : formatEmployeeCostCell(month.baseAmount, moneyColumn);
  const priorityAmount = month.priorityAmount == null ? '—' : formatEmployeeCostCell(month.priorityAmount, moneyColumn);
  const c10Context = month.priorityStatus === 'source_unavailable'
    ? 'P2 chờ DataHub C10'
    : month.priorityStatus === 'below_threshold'
      ? `P2 chưa đạt ngưỡng ${targetPctLabel(month.priorityThresholdPct)}`
      // v3.2: cổng TỔNG target — chưa đạt tổng thì P2 = 0.
      : month.priorityStatus === 'total_below_target'
        ? 'P2 = 0 · tổng C10 chưa đạt tổng target'
        : month.priorityStatus === 'partially_ambiguous_rates'
          ? `P2 ${priorityAmount} · có nhóm chưa rõ mức thưởng`
          : `P2 ${priorityAmount} · chia phần vượt theo tỷ trọng C10`;
  const monthContext = bonus.aggregate
    ? (month.amount == null ? 'Tháng chưa có target' : `Tổng ${month.contributors || bonus.employeeSubtotals.length} NV · P1 ${baseAmount} · P2 ${priorityAmount}`)
    : month.amount == null
      ? 'Tháng chưa có target'
      : `đạt ${targetPctLabel(month.pct)} · P1 ${baseAmount} (${bonusPctLabel(month.baseBonusPct)}) · ${c10Context}`;
  const quarterContext = bonus.quarterLabel ? `lũy kế ${bonus.quarterLabel}: ${quarterAmount}` : `lũy kế quý: ${quarterAmount}`;
  const groupDetail = (month.priorityGroups || []).map((item) => {
    if (item.reason === 'ambiguous_scope') return `${item.group}: thiếu mapping tuyến/đơn vị duy nhất của NV → P2 = 0`;
    if (item.target == null) return `${item.group}: chưa có target (auto tắt hoặc chưa xác định) → P2 = 0`;
    const source = item.targetSource === 'manual' ? 'manual CEO nhập' : item.targetSource === 'auto' ? 'auto tự suy' : item.targetSource || 'chưa rõ nguồn';
    return `${item.group}: ${formatEmployeeCostCell(item.amount || 0, moneyColumn)} (${bonusPctLabel(item.ratePct)} × ${formatEmployeeCostCell(item.excess || 0, moneyColumn)} được chia từ phần vượt; doanh thu nhóm ${formatEmployeeCostCell(item.revenue || 0, moneyColumn)})`;
  }).join('; ') || 'không có nhóm C10';
  const title = bonus.aggregate
    ? `Tổng thưởng dự kiến cộng từ từng nhân viên: Phần 1 ${baseAmount}; Phần 2 ${priorityAmount}. ${quarterContext}. Không gửi thưởng/không ghi payroll.`
    : `Tháng: ${monthAmount} = Phần 1 ${baseAmount} + Phần 2 ${priorityAmount}. P2 = phần vượt TỔNG target, chia cho từng nhóm C10 theo tỷ trọng doanh thu thực (rà theo mã QLNB → cột C10), mỗi phần ăn rate nhóm đó: ${groupDetail}. Target quý = trung bình các tháng đã giao. Coverage C10: ${targetPctLabel(month.priorityCoverage?.coveragePct)}. Giai đoạn ${bonus.effectiveFrom || '—'} · version ${bonus.version || '—'}. Dự kiến/tham khảo, không phải payroll hay số chi chính thức.`;
  return <Kpi label="Thưởng dự kiến" value={monthAmount} sub={`${monthContext} · ${quarterContext} · dự kiến · Bấm xem cách tính`} title={title} tone="employee-cost-tone-reward" onClick={onOpen} />;
}

function penaltyNoAmountReason(penalty) {
  if (!penalty.available) return 'Chưa có dữ liệu phạt từ backend';
  if (penalty.penaltyStatus === 'missing_target') return 'Chưa giao target — không có căn cứ phạt';
  if (penalty.penaltyStatus === 'c45_unavailable') return 'C45 chưa đủ dữ liệu — fail-closed, không phạt';
  if (penalty.penaltyStatus === 'unconfigured') return 'Chưa cấu hình đủ bậc phạt — không phạt';
  if (penalty.mode === 'off' || penalty.penaltyStatus === 'disabled') return 'Chính sách chưa áp dụng cho kỳ này';
  if (penalty.targetPct != null && penalty.targetPct >= 90) return `Đạt ${targetPctLabel(penalty.targetPct)} — không bị phạt`;
  return penalty.formulaText || 'Không bị phạt';
}

function PenaltyKpi({ penalty, onOpen }) {
  const policyOff = penalty.aggregate && penalty.mode === 'off';
  const aggregateSubtotal = penalty.aggregate && penalty.contributors > 0 ? penalty.provisionalTotal : null;
  const displayTotal = penalty.total == null ? aggregateSubtotal : penalty.total;
  const hasPenalty = displayTotal != null && displayTotal > 0;
  const value = policyOff
    ? 'Chưa áp dụng'
    : displayTotal == null
    ? 'Chưa đủ dữ liệu phạt'
    : hasPenalty ? `−${formatEmployeeCostCell(displayTotal, moneyColumn)}${penalty.total == null ? ' · tạm tính' : ''}` : 'Không bị phạt';
  const warning = penalty.warning?.text || penaltyNoAmountReason(penalty);
  const mode = penalty.mode === 'warn_only' ? penalty.label : penalty.label || 'Dự kiến/tham khảo — chưa trừ lương';
  const aggregateNote = penalty.aggregate
    ? policyOff
      ? 'Chính sách phạt chưa áp dụng cho kỳ này · backend không suy số 0'
      : `${penalty.complete ? 'Đủ' : 'Tạm tính'} ${penalty.contributors}/${penalty.employeeCount} NV · backend cộng từ kết quả từng người · không đổi theo bộ lọc bảng`
    : `${mode} · ${warning}${penalty.available ? ' · Bấm xem cách tính' : ''}`;
  return <Kpi
    label="Phạt dự kiến"
    value={value}
    sub={aggregateNote}
    title={penalty.formulaText || warning}
    tone="employee-cost-tone-penalty"
    onClick={penalty.available && !penalty.aggregate ? onOpen : undefined}
  />;
}

function AfterPenaltyKpi({ penalty, baseTotal, multiple }) {
  // Fail-closed: tổng gốc null thì component không được gọi/render. Tuyệt đối
  // không biến null thành 0 rồi tạo một số âm giả.
  // Fail-closed NHƯNG KHÔNG ẨN Ô (CEO chốt 30/07: chọn 1 NV phải thấy đủ 4 ô).
  // Tổng gốc null = coverage chi phí chưa đủ. Tuyệt đối không biến null thành 0
  // rồi ra một số âm giả; nhưng ẩn ô đi thì người xem tưởng tính năng không có.
  // => Vẫn hiện ô, nói thẳng là chưa đủ dữ liệu.
  if (baseTotal == null) {
    return <Kpi label={multiple ? 'Tổng cả kỳ sau phạt' : 'Tổng chi phí tháng sau phạt'}
      value="Chưa đủ dữ liệu chi phí"
      sub={penalty.aggregate
        ? `Tổng toàn đội chưa đủ nguồn (${penalty.contributors}/${penalty.employeeCount} NV có số phạt) — không suy số sau phạt`
        : 'Tỷ lệ khớp doanh thu chưa đạt ngưỡng nên tổng gốc bị khoá — không suy ra số sau phạt từ số chưa chắc'}
      tone="employee-cost-tone-after-penalty" />;
  }
  if (penalty.aggregate && penalty.afterPenaltyTotal == null) {
    return <Kpi label={multiple ? 'Tổng cả kỳ sau phạt' : 'Tổng chi phí tháng sau phạt'}
      value="Chưa đủ dữ liệu phạt"
      sub={`Đã có tổng gốc toàn đội ${formatEmployeeCostCell(baseTotal, moneyColumn)}, nhưng số phạt áp dụng chưa đủ — không thay null bằng 0`}
      tone="employee-cost-tone-after-penalty" />;
  }
  const value = penalty.afterPenaltyTotal == null ? baseTotal : penalty.afterPenaltyTotal;
  return <Kpi
    label={multiple ? 'Tổng cả kỳ sau phạt' : 'Tổng chi phí tháng sau phạt'}
    value={formatEmployeeCostCell(value, moneyColumn)}
    sub={penalty.aggregate
      ? `${penalty.label} · Gốc toàn đội ${formatEmployeeCostCell(baseTotal, moneyColumn)} · không đổi theo bộ lọc bảng`
      : penalty.mode === 'warn_only' ? penalty.label : `${penalty.label || 'Dự kiến/tham khảo — chưa trừ lương'} · Gốc ${formatEmployeeCostCell(baseTotal, moneyColumn)}`}
    tone="employee-cost-tone-after-penalty"
  />;
}

function quarterEndMonth(period) {
  const monthNumber = Number(String(period || '').slice(5, 7));
  return Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12 ? Math.ceil(monthNumber / 3) * 3 : null;
}

function XuPenaltyKpi({ penalty, period }) {
  const endMonth = quarterEndMonth(period);
  const currentMonth = Number(String(period || '').slice(5, 7));
  if (endMonth && currentMonth !== endMonth) return <Kpi label="Phạt thiếu Xu cuối quý" value={`Chốt vào cuối quý (T${endMonth})`} sub={`${penalty.aggregate ? 'Toàn đội · ' : ''}tháng chỉ tạm tính · không phạt hai lần`} tone="employee-cost-tone-penalty-soft" />;
  const aggregateSubtotal = penalty.aggregate && penalty.xuContributors > 0 ? penalty.provisionalXuAmount : null;
  const displayXu = penalty.xuAmount == null ? aggregateSubtotal : penalty.xuAmount;
  const value = displayXu == null
    ? (penalty.xuStatus === 'disabled' ? 'Chưa bật' : ['xu_source_unavailable', 'partially_unavailable'].includes(penalty.xuStatus) ? 'Chưa đủ nguồn Xu' : 'Đang quyết toán')
    : displayXu > 0 ? `−${formatEmployeeCostCell(displayXu, moneyColumn)}${penalty.xuAmount == null ? ' · tạm tính' : ''}` : 'Không bị phạt';
  const coverage = penalty.aggregate ? ` · ${penalty.xuContributors}/${penalty.xuEmployeeCount} NV có số` : '';
  return <Kpi label="Phạt thiếu Xu cuối quý" value={value} sub={`${penalty.xuMissing == null ? 'Thiếu Xu: —' : `Thiếu ${diemXuNumber(penalty.xuMissing)} Xu`}${coverage} · dự kiến/tham khảo`} tone="employee-cost-tone-penalty-soft" />;
}

function SalaryAdvanceKpi({ salaryAdvance, loading, allEmployees, period }) {
  const periodText = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ''))
    ? `Kỳ ${String(period).slice(5, 7)}/${String(period).slice(0, 4)}`
    : 'Kỳ đang chọn';
  if (allEmployees) return <Kpi label="Ứng lần 1 tháng này" value="Chọn 1 NV" sub="Không tổng hợp hoặc gọi App Salary cho toàn đội" tone="employee-cost-tone-neutral" />;
  if (loading) return <Kpi label="Ứng lần 1 tháng này" value="Đang lấy…" sub={`${periodText} · Nguồn App Salary`} tone="employee-cost-tone-neutral" />;
  if (salaryAdvance?.available && salaryAdvance?.applicable === false) {
    return <Kpi label="Ứng lần 1 tháng này" value="Không áp dụng" sub={`${periodText} · Mã nhân viên không thuộc nhóm Sale trên App Salary`} tone="employee-cost-tone-neutral" />;
  }
  if (salaryAdvance?.available && salaryAdvance?.applicable === true && Number.isSafeInteger(salaryAdvance.amount)) {
    if (salaryAdvance.suspect === true) {
      const statusText = salaryAdvance.locked ? 'Đã chốt trên App Salary' : 'Dự kiến · chưa chốt trên App Salary';
      return <Kpi label="Ứng lần 1 tháng này" value={`⚠ ${salaryAdvance.amount.toLocaleString('vi-VN')} ₫`}
        sub={`${periodText} · ${statusText} · ${salaryAdvance.suspectMessage || 'Số ứng App Salary lớn hơn tổng nhận — nghi sai, đang đối chiếu'}`}
        title="Backend đã fail-closed: không dùng số này để tính còn lại."
        tone="employee-cost-tone-penalty" />;
    }
    return <Kpi label="Ứng lần 1 tháng này" value={`${salaryAdvance.amount.toLocaleString('vi-VN')} ₫`}
      sub={`${periodText} · ${salaryAdvance.locked ? 'Đã chốt trên App Salary' : 'Dự kiến · chưa chốt trên App Salary'}`} tone="employee-cost-tone-neutral" />;
  }
  // Nói ĐÚNG nguyên nhân + AI phải sửa. Trước đây mọi lỗi đều gộp thành một câu
  // chung "tạm thời chưa lấy được", CEO không biết chờ ai nên phải đi hỏi từng vòng.
  const reason = salaryAdvance?.reason;
  const REASONS = {
    duplicate_employee: ['Dữ liệu bị trùng mã', 'Đã fail-closed; cần App Salary xử lý mã trùng'],
    period_not_found: ['Chưa có dữ liệu kỳ này', 'Không suy đoán theo tên hoặc kỳ khác'],
    employee_not_found: ['Chưa có dữ liệu kỳ này', 'Không suy đoán theo tên hoặc kỳ khác'],
    contract_mismatch: ['App Salary đổi hợp đồng', 'App Salary trả trạng thái ngoài hợp đồng — cần hai bên chốt lại rồi App Report mới nhận'],
    unauthorized: ['Sai khoá kết nối App Salary', 'Cần cấp lại token cho App Report — không phải lỗi số liệu'],
    upstream_timeout: ['App Salary phản hồi chậm', 'Quá thời gian chờ — bấm Làm mới sau ít phút'],
    not_configured: ['Chưa cấu hình kết nối App Salary', 'Thiếu địa chỉ hoặc khoá kết nối phía máy chủ'],
  };
  const [value, why] = REASONS[reason] || ['Tạm thời chưa lấy được từ App Salary', 'Các KPI chi phí khác vẫn hoạt động bình thường'];
  const sub = `${periodText} · ${why}`;
  return <Kpi label="Ứng lần 1 tháng này" value={value} sub={sub} tone="employee-cost-tone-neutral" />;
}

// SỔ "THANH TOÁN CP CỦA TÔI" — GĐ1 (SPEC_THANH_TOAN_CP_SELFVIEW.md).
// Chỉ HIỂN THỊ. Mọi số do backend tính và đã kiểm bất biến; frontend không cộng trừ lại.
const PAYMENT_STATUS = {
  paid: { icon: '✓', label: 'đã trả', tone: 'ok' },
  plan: { icon: '○', label: 'kế hoạch · chưa trả', tone: '' },
  overdue: { icon: '🔴', label: 'quá hạn', tone: 'warn' },
};
const PAYMENT_REASON = {
  total_unavailable: 'Chưa có tổng chi phí kỳ này',
  first_advance_unavailable: 'Chưa lấy được số ứng lần 1 từ App Salary',
  first_advance_exceeds_total: 'Số ứng lớn hơn tổng chi phí — nghi sai nguồn, đã dừng',
  period_invalid: 'Kỳ không hợp lệ',
};

// BẢNG THANH TOÁN TOÀN ĐỘI — chế độ "Tất cả NV" (SPEC §7).
// CEO nhìn một bảng biết ai đã nhận · ai còn nợ · ai QUÁ HẠN.
function PaymentTeamPanel({ team, allEmployees, loading }) {
  if (!allEmployees) return null;
  if (loading) return <div className="card"><div className="section-head">Thanh toán CP toàn đội</div><Spinner /></div>;
  if (!team) return null;
  const { totals } = team;
  return <div className="card">
    <div className="section-head">Thanh toán CP toàn đội <small>· kỳ {formatMonthLabel(team.period)}</small></div>
    {!team.invariantOk && <div className="employee-cost-match-warning" role="alert">
      <b>⛔ Sổ toàn đội chưa cân.</b> Đã nhận + còn nợ không bằng tổng — đã dừng, không hiển thị số chỏi.
    </div>}
    <div className="kpi-grid">
      <Kpi label="Tổng chi phí toàn đội" value={formatEmployeeCostCell(totals.total, moneyColumn)} sub={`${totals.employees} nhân viên có sổ`} />
      <Kpi label="Đã nhận" value={formatEmployeeCostCell(totals.received, moneyColumn)} sub="Chỉ tính lần đã ghi nhận trả" tone="employee-cost-tone-base" />
      <Kpi label="Còn nợ" value={formatEmployeeCostCell(totals.outstanding, moneyColumn)} sub="Cộng dồn toàn đội" />
      <Kpi label="Quá hạn" value={`${totals.overdueEmployees} NV`}
        sub={totals.overdueAmount ? `${formatEmployeeCostCell(totals.overdueAmount, moneyColumn)} chưa chi` : 'Không ai quá hạn'}
        tone={totals.overdueEmployees ? 'employee-cost-tone-warn' : ''} />
    </div>
    {!!team.excluded.length && <div className="employee-cost-match-warning" role="status">
      {/* Thiếu nguồn thì TÁCH RIÊNG kèm lý do — không gộp thành 0 rồi kéo tổng đội xuống. */}
      <b>⚠ {team.excluded.length} NV chưa dựng được sổ</b> (không tính vào tổng trên):{' '}
      {team.excluded.map((item) => `${item.empCode} (${PAYMENT_REASON[item.reason] || item.reason})`).join(' · ')}
    </div>}
    <div className="employee-cost-table-wrap">
      <table className="employee-cost-gap-table admin">
        <thead><tr><th>NV</th><th>Tổng kỳ</th><th>Đã nhận</th><th>Còn nợ</th><th>Lần kế · hạn</th><th>Quá hạn</th></tr></thead>
        <tbody>{team.rows.map((row) => <tr key={row.empCode}>
          <td><b>{row.empCode}</b><small>{row.employeeName}</small></td>
          <td className="employee-cost-number">{formatEmployeeCostCell(row.total, moneyColumn)}</td>
          <td className="employee-cost-number">{formatEmployeeCostCell(row.received, moneyColumn)}</td>
          <td className="employee-cost-number"><b>{formatEmployeeCostCell(row.outstanding, moneyColumn)}</b></td>
          <td>{row.nextLabel || '—'}
            {row.nextDueDate && <small>{row.nextDueDate.split('-').reverse().join('/')}
              {row.nextDaysFromToday != null && (row.nextDaysFromToday >= 0 ? ` · còn ${row.nextDaysFromToday} ngày` : ` · quá ${Math.abs(row.nextDaysFromToday)} ngày`)}</small>}
          </td>
          <td>{row.overdueCount
            ? <span className="employee-cost-gap-reason warn">🔴 {row.overdueCount} lần · {formatEmployeeCostCell(row.overdueAmount, moneyColumn)}</span>
            : <span className="employee-cost-gap-reason ok">✓ đúng hạn</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function PaymentSchedulePanel({ schedule, allEmployees, loading }) {
  if (allEmployees) return null;
  if (loading) return <div className="card"><div className="section-head">Thanh toán CP của tôi</div><Spinner /></div>;
  if (!schedule) return null;
  if (!schedule.available) {
    return <div className="card">
      <div className="section-head">Thanh toán CP của tôi</div>
      {/* Thiếu nguồn thì nói rõ thiếu gì — KHÔNG dựng sổ rỗng trông như đã trả hết. */}
      <div className="employee-cost-match-warning" role="status">
        {PAYMENT_REASON[schedule.reason] || 'Chưa đủ dữ liệu để dựng sổ'} · chưa dựng được sổ thanh toán.
      </div>
    </div>;
  }
  return <div className="card">
    <div className="section-head">Thanh toán CP của tôi <small>· kỳ {formatMonthLabel(schedule.period)}</small></div>
    {!schedule.invariantOk && <div className="employee-cost-match-warning" role="alert">
      <b>⛔ Sổ chưa cân.</b> Tổng các lần không bằng tổng chi phí kỳ — đã dừng, không hiển thị số chỏi.
    </div>}
    <div className="kpi-grid">
      <Kpi label="Tổng chi phí kỳ (sau phạt)" value={formatEmployeeCostCell(schedule.total, moneyColumn)}
        sub={schedule.twoInstalmentsOnly ? 'Dưới ngưỡng · tất toán trong 2 lần' : 'Chia 3 lần'} />
      <Kpi label="Đã nhận (lũy kế)" value={formatEmployeeCostCell(schedule.received, moneyColumn)}
        sub="Chỉ tính lần đã chốt thật" tone="employee-cost-tone-base" />
      <Kpi label="Sổ còn nợ" value={formatEmployeeCostCell(schedule.outstanding, moneyColumn)}
        sub="Cộng dồn — lần chưa nhận không mất đi" />
      {schedule.c44 && <Kpi label="C44 · Lương cuối năm" value={formatEmployeeCostCell(schedule.c44.amount, moneyColumn)}
        sub={schedule.c44.note} />}
    </div>
    <div className="employee-cost-table-wrap">
      <table className="employee-cost-gap-table">
        <thead><tr><th>Lần</th><th>Số tiền</th><th>Hạn</th><th>Khoảng cách</th><th>Nguồn</th><th>Trạng thái</th></tr></thead>
        <tbody>{schedule.installments.map((item) => {
          const state = PAYMENT_STATUS[item.status] || PAYMENT_STATUS.plan;
          const days = item.daysFromToday;
          return <tr key={item.key}>
            <td><b>{item.label}</b></td>
            <td className="employee-cost-number"><b>{formatEmployeeCostCell(item.amount, moneyColumn)}</b></td>
            <td>{item.dueDate ? item.dueDate.split('-').reverse().join('/') : '—'}
              {/* Ghi rõ "còn N ngày" để NV khỏi tự nhẩm (CEO yêu cầu). */}
              {days != null && <small>{days > 0 ? `còn ${days} ngày` : days === 0 ? 'hôm nay' : `quá ${Math.abs(days)} ngày`}</small>}
            </td>
            <td><small>{item.gapNote || '—'}</small></td>
            <td><small>{item.source === 'app_salary' ? 'App Salary · chỉ đọc' : 'App Report tính'}</small></td>
            <td><span className={`employee-cost-gap-reason ${state.tone}`}>{state.icon} {state.label}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="meta muted">
      Lần 1 là số App Salary đã chi — App Report không sửa. Lần 2/Lần 3 là kế hoạch do App Report tính từ
      <b> tổng kỳ − lần 1</b>; <b>chưa ai ghi nhận đã trả thì vẫn là kế hoạch</b>, không phải đã nhận.
      C44 là khoản riêng, chi trả T12, không nằm trong 3 lần.
    </p>
  </div>;
}

function RemainingAfterAdvanceKpi({ remainingAfterAdvance, loading, allEmployees, period }) {
  const projection = remainingAfterAdvance || {};
  const periodText = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ''))
    ? `Kỳ ${String(period).slice(5, 7)}/${String(period).slice(0, 4)}`
    : 'Kỳ đang chọn';
  if (allEmployees) return <Kpi label="Còn lại sau ứng lần 1" value="Chọn 1 NV"
    sub="Không tổng hợp hoặc gọi App Salary cho toàn đội" tone="employee-cost-tone-after-penalty" />;
  if (loading) return <Kpi label="Còn lại sau ứng lần 1" value="Đang tính…"
    sub={`${periodText} · Tổng sau phạt − ứng lần 1`} tone="employee-cost-tone-after-penalty" />;
  if (projection.suspect || projection.reason === 'salary_advance_exceeds_after_penalty_total') {
    return <Kpi label="Còn lại sau ứng lần 1" value="DỪNG TÍNH · NGHI BẤT THƯỜNG"
      sub={`${periodText} · Số ứng App Salary lớn hơn tổng nhận — nghi sai, đang đối chiếu`}
      title="Không hiển thị số âm như số đúng khi nguồn ứng bất thường."
      tone="employee-cost-tone-penalty" />;
  }
  if (!projection.available || !Number.isSafeInteger(projection.amount)) {
    return <Kpi label="Còn lại sau ứng lần 1" value="—"
      sub={`${periodText} · Chưa đủ dữ liệu, không coi là 0`} tone="employee-cost-tone-after-penalty" />;
  }
  const statusText = projection.locked ? 'Đã chốt' : 'Dự kiến · chưa chốt';
  const formulaText = Number.isSafeInteger(projection.afterPenaltyTotal) && Number.isSafeInteger(projection.salaryAdvanceAmount)
    ? `${projection.afterPenaltyTotal.toLocaleString('vi-VN')} − ${projection.salaryAdvanceAmount.toLocaleString('vi-VN')} ₫`
    : 'Tổng sau phạt − ứng lần 1';
  return <Kpi label="Còn lại sau ứng lần 1" value={`${projection.amount.toLocaleString('vi-VN')} ₫`}
    sub={`${periodText} · ${statusText} · ${formulaText} · nguồn App Report + App Salary`}
    tone="employee-cost-tone-after-penalty" />;
}

function PenaltyDetailModal({ penalty, employeeLabel, onClose }) {
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(modalRef.current?.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previousFocus?.focus?.(); };
  }, [onClose]);
  const cell = (value) => value == null ? '—' : formatEmployeeCostCell(value, moneyColumn);
  // CEO chốt 30/07: NV không biết "C45" là cột gì ⇒ mọi chỗ nhắc C45 phải kèm tên
  // cột, nhãn lấy từ backend (penaltyDisplay.C45_LABEL) — một nguồn duy nhất.
  const c45Label = penalty.c45Label || 'C45 (Lương tăng thêm)';
  return <div className="modal-backdrop employee-cost-target-modal-backdrop" role="presentation" onClick={onClose}>
    <div ref={modalRef} className="modal-card employee-cost-target-modal employee-cost-penalty-modal" role="dialog" aria-modal="true" aria-labelledby="employee-cost-penalty-modal-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><b id="employee-cost-penalty-modal-title">Chi tiết cách tính phạt · {c45Label}</b><small>{employeeLabel}</small></div><button ref={closeRef} type="button" className="employee-cost-target-modal-close" aria-label="Đóng chi tiết phạt" onClick={onClose}>×</button></div>
      <div className="employee-cost-penalty-c45-note" role="note">
        <b>Phạt trừ ở đâu?</b>
        <span>Chỉ trừ tại <b>{c45Label}</b> — cột lương tăng thêm hằng tháng của bạn. Không trừ vào lương cơ bản, không trừ sang cột khác, và không bao giờ trừ quá số tiền C45 đang có.</span>
        {penalty.modeText && <span>{penalty.modeText}</span>}
      </div>
      <section className="employee-cost-target-section">
        <h3>Phạt theo target, trừ tại {c45Label}</h3>
        <div className="employee-cost-target-equation employee-cost-penalty-equation">
          <span>% đạt target</span><b>{targetPctLabel(penalty.targetPct)}</b>
          <span>{c45Label} gốc<small>Giữ nguyên số DataHub</small></span><b>{cell(penalty.c45Amount)}</b>
          <span>Phạt target<small>{penalty.cappedByC45 ? `Đã kẹp tối đa bằng ${c45Label}` : penalty.c45Dropped ? `Mất trắng ${c45Label}` : penalty.c45WouldDrop ? `Chạy thử: nếu áp dụng sẽ mất ${c45Label}` : `Không vượt quá ${c45Label}`}</small></span><b>{penalty.targetAmount > 0 ? `−${cell(penalty.targetAmount)}` : cell(penalty.targetAmount)}</b>
          <span className="employee-cost-bonus-total">Phạt áp dụng kỳ này<small>{penalty.mode === 'warn_only' ? 'Chạy thử — chưa trừ tiền' : penalty.label}</small></span><b className="employee-cost-bonus-total">{penalty.appliedAmount > 0 ? `−${cell(penalty.appliedAmount)}` : cell(penalty.appliedAmount)}</b>
        </div>
      </section>
      {/* Bảng ngữ cảnh: NV nhìn một lần là biết mình đang ở bậc nào và bậc kế tiếp
          mất/được gì. Mốc %, tỷ lệ và ví dụ tiền đều do backend sinh từ cấu hình
          phạt ĐANG áp dụng cho kỳ — CEO sửa bậc là chữ ở đây đổi theo. */}
      {!!penalty.tiers?.length && <section className="employee-cost-target-section employee-cost-penalty-tiers">
        <h3>Khi nào bị phạt? (4 ngữ cảnh)</h3>
        <div className="employee-cost-penalty-tier-list" role="list">
          {penalty.tiers.map((tier) => <div key={tier.tier} role="listitem"
            className={`employee-cost-penalty-tier${tier.active ? ' is-active' : ''}${tier.dropC45 ? ' is-drop' : ''}`}>
            <b>{tier.range}{tier.active ? ' · BẠN ĐANG Ở ĐÂY' : ''}</b>
            <span>{tier.effect}</span>
            {tier.example && <em>{tier.example}</em>}
          </div>)}
        </div>
      </section>}
      <div className="employee-cost-penalty-formula" role="note"><b>Công thức backend</b><span>{penalty.formulaText || penaltyNoAmountReason(penalty)}</span></div>
      {penalty.warning?.text && <div className={`employee-cost-penalty-warning${penalty.mode === 'warn_only' ? ' is-warn-only' : ''}`} role="alert"><b>{penalty.mode === 'warn_only' ? 'ℹ Cảnh báo chạy thử' : '⚠ Cảnh báo sớm'}</b><span>{penalty.warning.text}</span></div>}
      <div className="employee-cost-target-note" role="note"><b>Lưu ý</b><span>{penalty.label || 'Dự kiến/tham khảo — chưa trừ lương'}</span><span>Frontend chỉ hiển thị công thức và số do backend trả về; không tự tính, không ghi DataHub/payroll.</span></div>
      <div className="employee-cost-target-modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Đóng</button></div>
    </div>
  </div>;
}

// Diễn giải trạng thái Phần 2 (phần vượt nhóm C10) ở cấp tháng — nói rõ VÌ SAO
// P2 thấp/bằng 0, giữ minh bạch fail-closed (không giấu, không tự suy số).
function bonusMonthP2Status(month) {
  const money = (value) => formatEmployeeCostCell(value, moneyColumn);
  switch (month.priorityStatus) {
    case 'source_unavailable': return 'Phần 2 đang chờ dữ liệu nhóm C10 từ DataHub — tạm tính 0.';
    case 'below_threshold': return `Phần 2 chưa mở: % đạt chưa tới ngưỡng ${targetPctLabel(month.priorityThresholdPct)}.`;
    // v3.2: cổng TỔNG target — chưa đạt tổng thì P2 = 0, dù có nhóm lẻ vượt.
    case 'total_below_target': return `Phần 2 chưa mở: tổng doanh thu C10 ${money(month.totalC10Revenue)} CHƯA đạt tổng target ${money(month.totalTarget)}.`;
    case 'partially_ambiguous_rates': return 'Phần 2 tính một phần · còn nhóm chưa xác định được mức thưởng (fail-closed).';
    default: return `Phần 2 = phần vượt tổng target ${money(month.totalExcess)}, chia cho từng nhóm C10 theo đúng tỷ trọng doanh thu.`;
  }
}

// Modal "bấm bung" cách tính thưởng — song song ô Target nhưng giàu hơn: có bảng
// Phần 2 theo từng nhóm C10 + lý do fail-closed. Chỉ RENDER số backend đã tính sẵn
// trong payload (bonus.month/quarter); KHÔNG đẻ số mới, KHÔNG payroll, KHÔNG lộ NV khác
// (chế độ Tất cả NV chỉ hiện tổng P1/P2, chi tiết từng người ở danh sách bên dưới).
function BonusDetailModal({ bonus, employeeLabel, onClose }) {
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    const keepFocusInside = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(modalRef.current?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', keepFocusInside);
    return () => {
      window.removeEventListener('keydown', keepFocusInside);
      previousFocus?.focus?.();
    };
  }, [onClose]);
  if (!bonus.configured) return null;
  const month = bonus.month;
  const quarter = bonus.quarter;
  const cell = (value) => (value == null ? '—' : formatEmployeeCostCell(value, moneyColumn));
  const groups = Array.isArray(month.priorityGroups) ? month.priorityGroups : [];
  const contributors = month.contributors || bonus.employeeSubtotals.length;
  return <div className="modal-backdrop employee-cost-target-modal-backdrop" role="presentation" onClick={onClose}>
    <div ref={modalRef} className="modal-card employee-cost-target-modal employee-cost-bonus-modal" role="dialog" aria-modal="true" aria-labelledby="employee-cost-bonus-modal-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head">
        <div>
          <b id="employee-cost-bonus-modal-title">Chi tiết cách tính thưởng</b>
          <small>{employeeLabel}{bonus.quarterLabel ? ` · ${bonus.quarterLabel}` : ''}</small>
        </div>
        <button ref={closeRef} type="button" className="employee-cost-target-modal-close" aria-label="Đóng chi tiết thưởng" onClick={onClose}>×</button>
      </div>

      <section className="employee-cost-target-section">
        <h3>Thưởng tháng</h3>
        <div className="employee-cost-target-equation employee-cost-bonus-equation">
          <span>Phần 1 — theo bậc đạt target<small>{bonus.aggregate ? `Tổng ${contributors} NV` : (month.amount == null ? 'Chưa có target tháng' : `đạt ${targetPctLabel(month.pct)} → bậc thưởng ${bonusPctLabel(month.baseBonusPct)}`)}</small></span>
          <b>{cell(month.baseAmount)}</b>
          <span>Phần 2 — chia phần vượt theo tỷ trọng C10<small>{bonus.aggregate ? 'Tổng phần vượt các NV' : bonusMonthP2Status(month)}</small></span>
          <b>{cell(month.priorityAmount)}</b>
          <span className="employee-cost-bonus-total">Tổng thưởng tháng<small>Phần 1 + Phần 2</small></span>
          <b className="employee-cost-bonus-total">{cell(month.amount)}</b>
        </div>
      </section>

      {!bonus.aggregate && !!groups.length && <section className="employee-cost-target-section">
        <h3>Phần 2 — chia phần vượt theo TỶ TRỌNG từng nhóm C10</h3>
        {/* v3.2: KHÔNG còn target riêng từng nhóm, và KHÔNG dồn phần vượt vào hạng cao.
            Phần vượt tổng được chia theo ĐÚNG TỶ TRỌNG doanh thu thực của từng nhóm
            (rà theo mã QLNB → cột C10), mỗi phần ăn rate của nhóm đó. */}
        <div className="employee-cost-target-equation employee-cost-bonus-equation">
          <span>Tổng doanh thu C10<small>Cộng doanh thu mọi nhóm C10</small></span>
          <b>{cell(month.totalC10Revenue)}</b>
          <span>Tổng target phải đạt<small>Chưa đạt thì Phần 2 = 0</small></span>
          <b>{cell(month.totalTarget)}</b>
          <span className="employee-cost-bonus-total">Phần vượt đem chia<small>Tổng doanh thu C10 − Tổng target · chia theo tỷ trọng từng nhóm</small></span>
          <b className="employee-cost-bonus-total">{cell(month.totalExcess)}</b>
        </div>
        <table className="employee-cost-bonus-groups">
          <thead><tr><th>Nhóm</th><th>Cách tính (theo tỷ trọng doanh thu nhóm)</th><th>Thành tiền</th></tr></thead>
          <tbody>
            {groups.map((item) => {
              const allocated = item.allocated ?? item.excess ?? 0;
              let detail;
              if (item.reason === 'source_unavailable') detail = 'Chưa có dữ liệu C10 từ DataHub → tạm tính 0';
              else if (item.reason === 'below_threshold') detail = 'Chưa đạt ngưỡng % để mở Phần 2 → 0';
              else if (item.reason === 'total_below_target') detail = 'Tổng doanh thu C10 chưa đạt tổng target → 0';
              else if (item.reason === 'rate_ambiguous') detail = 'Chưa xác định được mức thưởng của nhóm (fail-closed) → 0';
              else if (item.reason === 'no_group_revenue') detail = 'Nhóm không có doanh thu trong kỳ → 0';
              else if (item.reason === 'legacy_pre_v3') detail = `${bonusPctLabel(item.ratePct)} × toàn bộ doanh thu ${cell(item.revenue)} (kỳ cũ trước T07/2026, giữ số đã chốt)`;
              else detail = `Doanh thu nhóm ${cell(item.revenue)} = ${targetPctLabel(item.sharePct)} tổng C10 → được chia ${cell(allocated)} từ phần vượt × ${bonusPctLabel(item.ratePct)}`;
              return <tr key={item.group} className={item.amount ? '' : 'is-zero'}>
                <td>{item.group}</td><td>{detail}</td><td>{cell(item.amount || 0)}</td>
              </tr>;
            })}
          </tbody>
        </table>
        <div className="employee-cost-bonus-coverage"><small>Coverage nhóm C10: {targetPctLabel(month.priorityCoverage?.coveragePct)} · nguồn phân nhóm: cột C10 của danh mục</small></div>
      </section>}

      {bonus.aggregate && <div className="employee-cost-target-note" role="note">
        <b>Chế độ Tất cả nhân viên</b>
        <span>Đang hiển thị TỔNG dự kiến cộng từ {contributors} nhân viên. Chi tiết từng người xem ở mục “Thưởng dự kiến theo nhân viên” bên dưới.</span>
      </div>}

      <section className="employee-cost-target-section">
        <h3>Lũy kế quý</h3>
        <div className="employee-cost-target-equation">
          <span>{bonus.quarterLabel || 'Quý'}<small>Cộng dồn thưởng các tháng trong quý</small></span>
          <b>{cell(quarter.amount)}</b>
        </div>
      </section>

      <div className="employee-cost-target-note" role="note">
        <b>Lưu ý</b>
        <span>Số dự kiến/tham khảo. App Report KHÔNG gửi thưởng và KHÔNG ghi payroll.</span>
        <span>Do backend tính · version {bonus.version || '—'} · hiệu lực từ {bonus.effectiveFrom || '—'}.</span>
      </div>
      <div className="employee-cost-target-modal-actions">
        <button type="button" className="btn secondary" onClick={onClose}>Đóng</button>
      </div>
    </div>
  </div>;
}

function diemXuNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : '—';
}

function KhoanPointKpi({ khoan, loading }) {
  const note = loading ? 'Đang tải điểm local + xu App VAT…' : khoan.note;
  const source = khoan.pointSource || 'App VAT';
  if (!khoan.available) return <Kpi label="Điểm (tháng · quý)" value="— · —" sub={`Nguồn: ${source} · ${note}`} tone="employee-cost-tone-point" />;
  const pointSource = `Nguồn: ${source}${khoan.pointRuleVersion ? ` · ${khoan.pointRuleVersion}` : ''}`;
  return <Kpi label="Điểm (tháng · quý)" value={`${diemXuNumber(khoan.diemThang)} · ${diemXuNumber(khoan.diemQuy)}`} sub={pointSource} tone="employee-cost-tone-point" />;
}

function KhoanWarning({ khoan }) {
  if (!khoan.available) return null;
  if (khoan.aggregate) {
    if (!khoan.employeeSubtotals.some((item) => Number(item.phatDuKien || 0) > 0)) return null;
    return <div className="employee-cost-khoan-warning" role="alert"><b>⚠ Cảnh báo sớm:</b> có nhân viên đang thiếu xu so với điểm quý; phạt chỉ ở trạng thái preview/display-only.</div>;
  }
  if (!(khoan.pctQuy < 90 && khoan.diemQuy > 0)) return null;
  return <div className="employee-cost-khoan-warning" role="alert" title={khoan.upstreamWarning}>
    <b>⚠ Cảnh báo nghiêm khắc · {khoan.quarterLabel || `Q${khoan.selected.quarter}/${khoan.selected.year}`}:</b>{' '}
    cần {diemXuNumber(khoan.diemQuy)} xu (= điểm doanh thu quý), bạn đạt {diemXuNumber(khoan.xuQuyTong)} xu
    {khoan.carry > 0 ? ` (gồm carry ${diemXuNumber(khoan.carry)})` : ''}, thiếu {diemXuNumber(khoan.thieuXu)} xu →
    {khoan.parity.available ? <>dự kiến phạt {formatEmployeeCostCell(khoan.phatDuKien, moneyColumn)}.</> : <>phạt chưa mở số.</>} Trạng thái: <b>{khoan.quarterStatus}</b>.<br />
    <b>Quy tắc điểm:</b> App Report tự tính Σ(doanh thu × hệ số ÷ 100.000.000), rule {khoan.pointRuleVersion}.<br />
    <b>Quy tắc xu:</b> App VAT cung cấp xu tháng/quý. <b>Công thức phạt:</b> floor(điểm thiếu quý ÷ 2) × 600.000đ. Nếu parity chưa exact-zero thì giữ trạng thái đang đối soát.
  </div>;
}

function KhoanDeduction({ khoan, baseCost, multiMonth, loading }) {
  const penaltyOpen = khoan.available && khoan.parity.available;
  const deductionOpen = penaltyOpen && !multiMonth;
  const display = employeeVatKhoanDeduction(baseCost, deductionOpen ? khoan.phatDuKien : null);
  const xuRule = khoan.xuRuleVersion ? ` · ${khoan.xuRuleVersion}` : '';
  const penaltyStatus = khoan.quarterStatus || 'đang đối soát';
  const penaltyNote = loading ? 'Đang tải điểm local + xu App VAT…' : khoan.note;
  return <div className="card employee-cost-khoan-deduction">
    <div className="section-head">Cấn trừ do thiếu xu chi tiêu (quý) · dự kiến</div>
    <div className="employee-cost-khoan-equation">
      <span className="xu"><small>Xu tích lũy (tháng · quý)</small><b>{khoan.available ? `${diemXuNumber(khoan.xuThang)} · ${diemXuNumber(khoan.xuQuyTong)}` : '— · —'}</b><em>Nguồn: App VAT{xuRule}</em></span>
      <span className="penalty"><small>Phạt dự kiến {penaltyOpen && khoan.phatDuKien > 0 && <span className="employee-cost-khoan-danger-badge">Cảnh báo</span>}</small><b>{penaltyOpen ? formatEmployeeCostCell(khoan.phatDuKien, moneyColumn) : 'đang đối soát'}</b><em>{khoan.available ? `${penaltyStatus} · App Report (điểm) + App VAT (xu) · không payroll` : penaltyNote}</em></span>
      <strong>−</strong>
      <span className="deduction"><small>Cấn trừ thiếu xu</small><b>{deductionOpen ? formatEmployeeCostCell(Math.abs(display.deduction), moneyColumn) : '—'}</b><em>{deductionOpen ? 'Parity exact-zero PASS' : 'đang đối soát'}</em></span>
      <strong>=</strong>
      <span><small>Còn lại (display-only)</small><b>{formatEmployeeCostCell(display.remaining, moneyColumn)}</b><em>Không ghi DataHub/payroll</em></span>
    </div>
    <p>{multiMonth && <><b>Chưa hiển thị phép cấn trừ cho kỳ nhiều tháng.</b> Chọn đúng một tháng để tránh ghép sai kỳ. </>}<b>Còn lại = chi phí gốc ở hàng KPI trên − cấn trừ thiếu xu.</b> Số cấn trừ chỉ mở khi parity exact-zero PASS; nếu chưa đạt thì giữ trạng thái <b>đang đối soát</b>. App Report không sửa chi phí gốc và không phát lệnh chi/trừ.</p>
  </div>;
}

function VisibilityPanel({ adminCode, panel, loading, saving, message, error, onChange, onSave }) {
  const storageKey = visibilityCollapseStorageKey(adminCode);
  const [collapsed, setCollapsed] = useState(() => readVisibilityCollapsed(browserStorage(), storageKey));
  useEffect(() => writeVisibilityCollapsed(browserStorage(), storageKey, collapsed), [collapsed, storageKey]);
  const summary = loading
    ? 'Đang tải cấu hình…'
    : panel
      ? `${panel.employees.length.toLocaleString('vi-VN')} NV · ${panel.groups.length.toLocaleString('vi-VN')} nhóm · Toàn phòng: ${panel.department.effective === 'on' ? 'Bật' : 'Tắt'}`
      : 'Chưa tải được cấu hình';
  const bodyId = 'employee-cost-visibility-controls';
  return <div className={`card employee-cost-visibility${collapsed ? ' is-collapsed' : ''}`}>
    <div className="employee-cost-visibility-head">
      <div>
        <div className="section-head">Quản trị quyền tự xem chi phí</div>
        <p>{summary}</p>
      </div>
      <button type="button" className="btn secondary employee-cost-visibility-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setCollapsed((current) => !current)}>
        {collapsed ? 'Mở quản trị' : 'Thu gọn'}
      </button>
    </div>
    {!collapsed && <div className="employee-cost-visibility-body" id={bodyId}>
      <div className="employee-cost-visibility-toolbar">
        <p>Cá nhân ưu tiên hơn nhóm; nhóm ưu tiên hơn toàn phòng. Quyền hiệu lực do backend quyết định.</p>
        <button type="button" className="btn" disabled={loading || saving || !panel} onClick={onSave}>
          {saving ? 'Đang lưu…' : 'Lưu công tắc'}
        </button>
      </div>
      {error && <div className="employee-cost-match-warning" role="alert">{error}</div>}
      {message && <div className="employee-cost-visibility-success" role="status">{message}</div>}
      {loading || !panel ? <Spinner /> : <>
        <div className="employee-cost-visibility-department">
          <div><b>Toàn phòng Kinh doanh</b><small>Mặc định an toàn là Tắt.</small></div>
          <VisibilitySelect
            label="Công tắc toàn phòng Kinh doanh"
            value={panel.department.setting}
            allowInherit={false}
            onChange={(value) => onChange('department', '', value)}
          />
        </div>
        <div className="employee-cost-visibility-section">
          <h4>Theo nhóm</h4>
          <div className="employee-cost-visibility-grid">
            {panel.groups.map((group) => <div className="employee-cost-visibility-item" key={group.key}>
              <div><b>{group.label}</b><small>{group.employeeCount.toLocaleString('vi-VN')} nhân viên</small></div>
              <VisibilitySelect label={`Công tắc nhóm ${group.label}`} inheritLabel="Theo toàn phòng" value={group.setting} onChange={(value) => onChange('groups', group.key, value)} />
              <span className={`employee-cost-effective ${group.effective}`}>{visibilityEffectiveLabel(group.effective)} · {group.source === 'group' ? 'Chính nhóm' : 'Toàn phòng'}</span>
            </div>)}
          </div>
        </div>
        <div className="employee-cost-visibility-section">
          <h4>Theo cá nhân</h4>
          <div className="employee-cost-visibility-employees">
            {panel.employees.map((employee) => <div className="employee-cost-visibility-employee" key={employee.emp_code}>
              <div><b>{employee.emp_code} · {employee.name}</b><small>{employee.group_label}</small></div>
              <VisibilitySelect label={`Công tắc nhân viên ${employee.emp_code}`} inheritLabel="Theo nhóm" value={employee.setting} onChange={(value) => onChange('employees', employee.emp_code, value)} />
              <span className={`employee-cost-effective ${employee.effective}`}>{visibilityEffectiveLabel(employee.effective)} · {visibilitySourceLabel(employee)}</span>
            </div>)}
          </div>
        </div>
      </>}
    </div>}
  </div>;
}

function GapCoverage({ coverage, remainingCodes, remainingPairs = 0 }) {
  const rate = Math.max(0, Math.min(100, Number(coverage.rate || 0)));
  const matched = Number(coverage.matchedPairs || 0);
  const total = Number(coverage.totalPairs || 0);
  // Ghi ĐỦ phép cộng để không còn "ẩn số": đã khớp + thiếu = tổng, rồi mới nói
  // số cặp thiếu đó gộp lại thành bao nhiêu mã (một mã có thể nằm ở nhiều
  // nhân viên/đơn vị nên số mã luôn nhỏ hơn số cặp).
  return <div className="employee-cost-gap-coverage">
    <div className="employee-cost-gap-coverage-head">
      <b>Coverage {rate.toLocaleString('vi-VN')}%</b>
      <span>{matched.toLocaleString('vi-VN')} đã khớp + {remainingPairs.toLocaleString('vi-VN')} thiếu % = {total.toLocaleString('vi-VN')} cặp · {remainingPairs.toLocaleString('vi-VN')} cặp thiếu gộp thành <b>{remainingCodes.toLocaleString('vi-VN')} mã</b> bên dưới</span>
    </div>
    <div className="employee-cost-gap-progress" role="progressbar" aria-label="Tỷ lệ mã đã có phần trăm chi phí" aria-valuemin="0" aria-valuemax="100" aria-valuenow={rate}>
      <span style={{ width: `${rate}%` }} />
    </div>
  </div>;
}

function GapPairTable({ pairs, resetKey = '' }) {
  const pager = useEmployeeCostPage(pairs, resetKey);
  return <>
    <EmployeeCostPager pagination={pager.pagination} onPage={pager.setPage} onPageSize={pager.setPageSize} location="top" unit="mặt hàng" />
    <div className="employee-cost-table-wrap">
    <table className="employee-cost-gap-table">
      <thead><tr><th>STT</th><th>Đơn vị</th><th>Mã QLNB · tên hàng</th><th>Doanh thu ảnh hưởng</th><th>Tình trạng</th></tr></thead>
      <tbody>{pager.rows.map((pair, index) => <tr key={`${pair.period}-${pair.employeeCode}-${pair.unitLabel}-${pair.productCode}`}>
        <td className="employee-cost-number">{pager.start + index + 1}</td>
        <td><b>{pair.unitLabel}</b></td>
        <td><b>{pair.productCode}</b><small>{pair.productName}</small></td>
        <td className="employee-cost-number">{formatEmployeeCostCell(pair.revenueAffected, moneyColumn)}</td>
        <td><span className={`employee-cost-gap-reason ${pair.reason}`}>{gapReasonLabel(pair.reason)}</span>
          {pair.suggestedCatalogCode && <small>Gợi ý catalog: {pair.suggestedCatalogCode}</small>}
        </td>
      </tr>)}</tbody>
    </table>
    </div>
    <EmployeeCostPager pagination={pager.pagination} onPage={pager.setPage} onPageSize={pager.setPageSize} location="bottom" unit="mặt hàng" />
  </>;
}

function EmployeeGapPanel({ payload, loading, error, range }) {
  const [expanded, setExpanded] = useState(false);
  const [exporting, setExporting] = useState('');
  const [exportError, setExportError] = useState('');
  const view = useMemo(() => employeeCostGapView(payload), [payload]);
  const exportFile = async (format) => {
    setExporting(format); setExportError('');
    try { await downloadEmployeeCostGaps(format, range); }
    catch (requestError) { setExportError(requestError.message || 'Không xuất được file'); }
    finally { setExporting(''); }
  };
  return <div className="card employee-cost-gap-employee">
    <div className="employee-cost-gap-title">
      <div><div className="section-head">{loading ? 'Mặt hàng chưa có % chi phí' : `${view.pairs.length.toLocaleString('vi-VN')} mặt hàng chưa có % chi phí`}</div>
        <p>{loading ? 'Đang kiểm tra catalog…' : view.pairs.length ? 'Đang chờ DataHub bổ sung; đây không phải lỗi doanh thu.' : 'Các cặp doanh thu trong kỳ đã có tỷ lệ chi phí.'}</p>
      </div>
      <div className="employee-cost-export-actions">
        {!!view.pairs.length && <button type="button" className="btn secondary" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? 'Ẩn danh sách' : 'Xem danh sách'}</button>}
        <button type="button" className="btn secondary" disabled={loading || !!exporting} onClick={() => exportFile('xlsx')}>{exporting === 'xlsx' ? 'Đang xuất…' : 'Excel'}</button>
        <button type="button" className="btn secondary" disabled={loading || !!exporting} onClick={() => exportFile('pdf')}>{exporting === 'pdf' ? 'Đang xuất…' : 'PDF'}</button>
      </div>
    </div>
    {!!view.unavailable?.count && <div className="employee-cost-match-warning" role="alert">
      <b>⚠ Danh sách chưa đủ.</b> {view.unavailable.note || `Chưa lấy được dữ liệu chi phí của ${view.unavailable.employees.join(', ')}.`}
    </div>}
    {(error || exportError) && <div className="employee-cost-match-warning" role="alert">{error || exportError}</div>}
    {loading ? <Spinner /> : expanded && <>
      <GapPairTable pairs={view.pairs} resetKey={`${payload.from || ''}|${payload.to || ''}|${view.pairs.length}`} />
      <p className="employee-cost-gap-note">Gợi ý lệch mã chỉ để DataHub đối chiếu, App Report không tự ánh xạ hoặc tự điền tỷ lệ.</p>
    </>}
  </div>;
}

function AdminGapPanel({ payload, loading, error, range }) {
  const [filters, setFilters] = useState({ q: '', employee: '', unit: '', reason: '' });
  const [exporting, setExporting] = useState('');
  const [exportError, setExportError] = useState('');
  const [syncing, setSyncing] = useState('');
  const [syncConfirm, setSyncConfirm] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const view = useMemo(() => employeeCostGapView(payload, filters), [payload, filters]);
  const pager = useEmployeeCostPage(view.items, JSON.stringify(filters));
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const exportFile = async (format) => {
    setExporting(format); setExportError('');
    try { await downloadEmployeeCostGaps(format, { ...range, ...filters }); }
    catch (requestError) { setExportError(requestError.message || 'Không xuất được file'); }
    finally { setExporting(''); }
  };
  const syncCodeCount = view.items.length;
  const syncRevenue = view.items.reduce((total, item) => total + (Number(item.revenueAffected) || 0), 0);
  // DataHub chưa cấu hình → khoá nút + tooltip (blocker 7). Chỉ khoá khi backend
  // báo rõ configured===false; lúc chưa biết (đang tải) thì không chặn nhầm.
  const dataHubUnconfigured = payload?.sync && payload.sync.configured === false;
  const syncBlockReason = dataHubUnconfigured ? 'Chưa cấu hình DataHub' : '';
  const runSync = async () => {
    setSyncing('send'); setSyncError(''); setSyncMessage('');
    try {
      const result = await api.employeeCostGapSyncDataHub({ ...range, ...filters }, { confirm: true, note: syncNote.trim() || undefined });
      // Hiện BIÊN NHẬN của DataHub, không chỉ nói "đã gửi": mã worklist + số mã
      // DataHub xác nhận nhận được + trạng thái mới/trùng + mã kiểm tra để đối
      // chiếu trực tiếp với màn DataHub. Có biên nhận mới coi là nhận thành công.
      const receipt = result.datahub || {};
      const confirmed = Number(receipt.received ?? result.sent ?? 0);
      setSyncMessage([
        `✅ DataHub ĐÃ XÁC NHẬN NHẬN ${confirmed.toLocaleString('vi-VN')}/${Number(result.sent || 0).toLocaleString('vi-VN')} mã`,
        receipt.worklist_id ? `Mã worklist DataHub: ${receipt.worklist_id}` : '',
        receipt.deduped === true ? 'Trạng thái: trùng với lần gửi trước (DataHub không tạo bản mới)' : 'Trạng thái: worklist mới',
        result.checksum ? `Mã kiểm tra: ${String(result.checksum).slice(0, 12)}… (đối chiếu với màn DataHub)` : '',
        'Vào DataHub để điền %.',
      ].filter(Boolean).join(' · '));
      setSyncConfirm(false); setSyncNote('');
    } catch (requestError) {
      setSyncError(requestError.message || 'Không đồng bộ được sang DataHub.');
    } finally { setSyncing(''); }
  };
  const saveNote = async () => {
    setSyncing('note'); setSyncError(''); setSyncMessage('');
    try {
      await api.employeeCostGapSyncDataHub({ ...range, ...filters }, { action: 'note', note: syncNote.trim() });
      setSyncMessage('Đã ghi ý kiến (chưa gửi DataHub).');
      setSyncConfirm(false); setSyncNote('');
    } catch (requestError) {
      setSyncError(requestError.message || 'Không ghi được ý kiến.');
    } finally { setSyncing(''); }
  };
  return <div className="card employee-cost-gap-admin">
    <div className="employee-cost-gap-title">
      <div><div className="section-head">Gộp theo mã QLNB</div><p>Ưu tiên từ trên xuống theo doanh thu bị ảnh hưởng. Tỷ lệ và ánh xạ vẫn do DataHub cập nhật.</p></div>
      <div className="employee-cost-export-actions">
        <button type="button" className="btn" title={syncBlockReason} disabled={loading || !!syncing || !syncCodeCount || !!syncBlockReason} onClick={() => { setSyncError(''); setSyncMessage(''); setSyncConfirm(true); }}>📤 Đồng bộ sang DataHub</button>
        <button type="button" className="btn secondary" disabled={loading || !!exporting} onClick={() => exportFile('xlsx')}>{exporting === 'xlsx' ? 'Đang xuất…' : 'Xuất Excel'}</button>
        <button type="button" className="btn secondary" disabled={loading || !!exporting} onClick={() => exportFile('pdf')}>{exporting === 'pdf' ? 'Đang xuất…' : 'Xuất PDF'}</button>
      </div>
    </div>
    {syncBlockReason && <p className="employee-cost-gap-note">DataHub chưa cấu hình — nút Đồng bộ tạm khoá; dùng Xuất Excel/PDF.</p>}
    {/* Trước đây 1 NV lỗi nguồn là cả tab báo lỗi trắng màn. Nay vẫn hiện danh
        sách + nói rõ thiếu ai, để người xem biết danh sách chưa đủ vì lý do gì. */}
    {!!view.unavailable?.count && <div className="employee-cost-match-warning" role="alert">
      <b>⚠ Danh sách chưa đủ.</b> {view.unavailable.note || `Chưa lấy được dữ liệu chi phí của ${view.unavailable.employees.join(', ')}.`} Đây là <b>lỗi nguồn DataHub</b>, không phải mã đủ %.
    </div>}
    {syncMessage && <div className="employee-cost-visibility-success" role="status">{syncMessage}</div>}
    {syncError && !syncConfirm && <div className="employee-cost-match-warning" role="alert">{syncError}</div>}
    {syncConfirm && <div className="modal-backdrop" role="presentation" onClick={() => !syncing && setSyncConfirm(false)}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="gap-sync-title" onClick={(event) => event.stopPropagation()}>
        <div className="section-head" id="gap-sync-title">Đồng bộ worklist thiếu % sang DataHub</div>
        <p>Gửi <b>{syncCodeCount.toLocaleString('vi-VN')} mã</b> (doanh thu ảnh hưởng <b>{syncRevenue.toLocaleString('vi-VN')}</b>, kỳ <b>{range.from === range.to ? range.from : `${range.from} → ${range.to}`}</b>) sang DataHub để điền %. App Report chỉ gửi danh sách mã; tỷ lệ do DataHub cập nhật.</p>
        <label className="employee-cost-gap-note-field"><span>Ý kiến (tuỳ chọn — dùng cho 📝 hoặc gửi kèm)</span>
          <textarea value={syncNote} onChange={(event) => setSyncNote(event.target.value)} rows={2} maxLength={500} placeholder="VD: cần rà mã QĐ… trước khi điền %" />
        </label>
        {syncError && <div className="employee-cost-match-warning" role="alert">{syncError}</div>}
        <div className="employee-cost-export-actions">
          <button type="button" className="btn" disabled={!!syncing} onClick={runSync}>{syncing === 'send' ? 'Đang gửi…' : '✅ Duyệt'}</button>
          <button type="button" className="btn secondary" disabled={!!syncing} onClick={() => { setSyncConfirm(false); setSyncError(''); }}>❌ Không duyệt</button>
          <button type="button" className="btn secondary" disabled={!!syncing || !syncNote.trim()} onClick={saveNote}>{syncing === 'note' ? 'Đang ghi…' : '📝 Ý kiến khác'}</button>
        </div>
      </div>
    </div>}
    <div className="employee-cost-gap-filters">
      <label><span>Tìm mã/tên/đơn vị</span><input value={filters.q} onChange={(event) => setFilter('q', event.target.value)} placeholder="VD: Valgesic, Vũng Tàu…" /></label>
      <label><span>Nhân viên</span><select value={filters.employee} onChange={(event) => setFilter('employee', event.target.value)}><option value="">Tất cả</option>{view.employeeOptions.map((employee) => <option key={employee.employeeCode} value={employee.employeeCode}>{employee.employeeCode} · {employee.employeeName}</option>)}</select></label>
      <label><span>Đơn vị</span><select value={filters.unit} onChange={(event) => setFilter('unit', event.target.value)}><option value="">Tất cả</option>{view.unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
      <label><span>Lý do</span><select value={filters.reason} onChange={(event) => setFilter('reason', event.target.value)}><option value="">Tất cả</option><option value="missing">Thiếu hẳn</option><option value="qd_mismatch">Lệch mã QĐ/QLNB</option></select></label>
    </div>
    <GapCoverage coverage={view.coverage} remainingCodes={view.remainingCodes} remainingPairs={view.remainingPairs} />
    {(error || exportError) && <div className="employee-cost-match-warning" role="alert">{error || exportError}</div>}
    {loading ? <Spinner /> : !view.items.length ? <div className="center">Không có mã thiếu phù hợp bộ lọc.</div> : <>
      <EmployeeCostPager pagination={pager.pagination} onPage={pager.setPage} onPageSize={pager.setPageSize} location="top" unit="mã" />
      <div className="employee-cost-table-wrap">
      <table className="employee-cost-gap-table admin">
        <thead><tr><th>STT</th><th>Mã QLNB · tên hàng</th><th>Đơn vị ảnh hưởng</th><th>NV</th><th>Số cặp thiếu</th><th>Doanh thu ảnh hưởng</th><th>Lý do/gợi ý</th></tr></thead>
        <tbody>{pager.rows.map((item, index) => <tr key={item.productCode}>
          <td className="employee-cost-number">{pager.start + index + 1}</td>
          <td><b>{item.productCode}</b><small>{item.productName}</small></td>
          <td><b>{item.unitCount.toLocaleString('vi-VN')} đơn vị</b><small>{item.unitLabels.join('; ')}</small></td>
          <td>{item.employeeCodes.join(', ')}</td>
          {/* Cộng cột này qua các mã = đúng số cặp thiếu ở KPI "Khớp doanh thu". */}
          <td className="employee-cost-number"><b>{item.pairCount.toLocaleString('vi-VN')}</b></td>
          <td className="employee-cost-number"><b>{formatEmployeeCostCell(item.revenueAffected, moneyColumn)}</b></td>
          <td><span className={`employee-cost-gap-reason ${item.reason}`}>{gapReasonLabel(item.reason)}</span>{!!item.suggestedCatalogCodes.length && <small>Gợi ý: {item.suggestedCatalogCodes.join('; ')}</small>}</td>
        </tr>)}</tbody>
      </table>
      </div>
      <EmployeeCostPager pagination={pager.pagination} onPage={pager.setPage} onPageSize={pager.setPageSize} location="bottom" unit="mã" />
    </>}
    <p className="employee-cost-gap-note">Excel để DataHub điền % hoặc xác nhận ánh xạ. App Report chỉ phát hiện/gợi ý, không tự áp mã catalog.</p>
  </div>;
}

function DataQualityPanel({ payload, loading, error, range, admin, onOpenRow }) {
  const [filters, setFilters] = useState({ q: '', type: '', severity: '', employee: '', unit: '', route: '', repairSource: '' });
  const [exporting, setExporting] = useState('');
  const [exportError, setExportError] = useState('');
  const view = useMemo(() => employeeCostDataQualityView(payload, filters), [payload, filters]);
  const pager = useEmployeeCostPage(view.items, JSON.stringify(filters));
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const exportFile = async (format) => {
    setExporting(format); setExportError('');
    try { await downloadEmployeeCostDataQuality(format, { ...range, ...filters }); }
    catch (requestError) { setExportError(requestError.message || 'Không xuất được danh sách kiểm soát dữ liệu'); }
    finally { setExporting(''); }
  };
  return <div className="card employee-cost-dq-panel">
    <div className="employee-cost-gap-title">
      <div><div className="section-head">Trung tâm Kiểm soát Dữ liệu</div><p>App Report chỉ phát hiện, giải thích và chỉ đúng nguồn sửa; không tự sửa hay tự đoán số.</p></div>
      <div className="employee-cost-export-actions">
        <button type="button" className="btn" disabled={loading || !!exporting} onClick={() => exportFile('xlsx')}>{exporting === 'xlsx' ? 'Đang xuất…' : 'Xuất Excel'}</button>
        <button type="button" className="btn secondary" disabled={loading || !!exporting} onClick={() => exportFile('pdf')}>{exporting === 'pdf' ? 'Đang xuất…' : 'Xuất PDF'}</button>
      </div>
    </div>
    <div className="kpi-grid employee-cost-dq-kpis">
      <Kpi label="Tổng exception" value={Number(view.summary.exceptionCount).toLocaleString('vi-VN')} sub="Gộp theo nguyên nhân gốc" />
      <Kpi label="🔴 Sai/nghi tiền" value={Number(view.summary.redCount).toLocaleString('vi-VN')} sub={formatEmployeeCostCell(view.summary.redRevenueAffected, moneyColumn)} />
      <Kpi label="🟡 Thiếu hiển thị" value={Number(view.summary.yellowCount).toLocaleString('vi-VN')} />
      <Kpi label="Doanh thu ảnh hưởng" value={formatEmployeeCostCell(view.summary.revenueAffected, moneyColumn)} sub="Không cộng dồn thành thiệt hại" />
    </div>
    {!loading && view.uomRuleUnavailable && <div className="employee-cost-match-warning" role="alert" data-source-status="source_unavailable">
      Quy tắc ĐVT tạm ngưng vì nguồn quy đổi sản phẩm App Sale không sẵn sàng. Các quy tắc kiểm soát dữ liệu khác vẫn hoạt động.
    </div>}
    <div className="employee-cost-dq-filters">
      <label><span>Tìm mã/tên/đơn vị</span><input type="search" value={filters.q} onChange={(event) => setFilter('q', event.target.value)} placeholder="Không dấu, hoa/thường…" /></label>
      <label><span>Loại lỗi</span><select value={filters.type} onChange={(event) => setFilter('type', event.target.value)}><option value="">Tất cả</option>{view.typeOptions.map((type) => <option key={type} value={type}>{dataQualityTypeLabel(type)}</option>)}</select></label>
      <label><span>Mức</span><select value={filters.severity} onChange={(event) => setFilter('severity', event.target.value)}><option value="">Tất cả</option><option value="red">🔴 Sai/nghi tiền</option><option value="yellow">🟡 Thiếu hiển thị</option></select></label>
      {admin && <label><span>Nhân viên</span><select value={filters.employee} onChange={(event) => setFilter('employee', event.target.value)}><option value="">Tất cả</option>{view.employeeOptions.map((employee) => <option key={employee} value={employee}>{employee}</option>)}</select></label>}
      <label><span>Đơn vị</span><select value={filters.unit} onChange={(event) => setFilter('unit', event.target.value)}><option value="">Tất cả</option>{view.unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
      <label><span>Tuyến</span><select value={filters.route} onChange={(event) => setFilter('route', event.target.value)}><option value="">Tất cả</option>{view.routeOptions.map((route) => <option key={route} value={route}>{route}</option>)}</select></label>
      <label><span>Nguồn sửa</span><select value={filters.repairSource} onChange={(event) => setFilter('repairSource', event.target.value)}><option value="">Tất cả</option>{view.repairSourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
    </div>
    {(error || exportError) && <div className="employee-cost-match-warning" role="alert">{error || exportError}</div>}
    {loading ? <Spinner /> : !view.items.length ? <div className="center">Không có exception phù hợp bộ lọc.</div> : <>
      <div className="employee-cost-dq-filter-result">Hiện {view.filteredSummary.exceptionCount.toLocaleString('vi-VN')} exception · {formatEmployeeCostCell(view.filteredSummary.revenueAffected, moneyColumn)} doanh thu ảnh hưởng</div>
      <EmployeeCostPager pagination={pager.pagination} onPage={pager.setPage} onPageSize={pager.setPageSize} location="top" unit="exception" />
      <div className="employee-cost-table-wrap"><table className="employee-cost-dq-table">
        <thead><tr><th>STT</th><th>Mức · loại</th><th>Mã gốc · phạm vi</th><th>Ảnh hưởng</th><th>Nguyên nhân</th><th>Hành động · nguồn sửa</th><th>Trạng thái</th></tr></thead>
        <tbody>{pager.rows.map((item, index) => <tr key={item.key} className={`dq-${item.severity}`}>
          <td className="employee-cost-number">{pager.start + index + 1}</td>
          <td><span className={`employee-cost-dq-severity ${item.severity}`}>{item.severity === 'red' ? '🔴 Sai/nghi tiền' : '🟡 Thiếu hiển thị'}</span><b>{dataQualityTypeLabel(item.type)}</b><small>{item.field}{item.invalidValue ? `: ${item.invalidValue}` : ''}</small></td>
          <td><button type="button" className="employee-cost-dq-link" onClick={() => onOpenRow?.(item)}>{item.productCode || item.unitCode}</button><small>{item.productName}</small><small>{item.unitLabels.join('; ') || item.unitCode}</small><small>{item.employeeCodes.join(', ')}{item.routes.length ? ` · tuyến ${item.routes.join(', ')}` : ''}</small></td>
          <td className="employee-cost-number"><b>{formatEmployeeCostCell(item.revenueAffected, moneyColumn)}</b><small>{item.lineCount.toLocaleString('vi-VN')} dòng</small></td>
          <td>{item.cause || '—'}{item.suggestedCatalogCodes.length > 0 && <small>Ứng viên: {item.suggestedCatalogCodes.join('; ')}</small>}</td>
          <td>{item.action || '—'}<small><b>{item.repairSource || '—'}</b></small></td>
          <td><span className="employee-cost-dq-status">{item.status === 'new' ? 'Mới' : item.status}</span></td>
        </tr>)}</tbody>
      </table></div>
      <EmployeeCostPager pagination={pager.pagination} onPage={pager.setPage} onPageSize={pager.setPageSize} location="bottom" unit="exception" />
    </>}
    <p className="employee-cost-gap-note">Đợt 1: 5 rule lõi. Trạng thái xử lý chi tiết và so sánh kỳ triển khai ở đợt 2.</p>
  </div>;
}

export default function EmployeeCost({ me, onNavigate }) {
  const admin = !!me?.isAdmin;
  const [view, setView] = useState(() => {
    if (!admin) return 'cost';
    try {
      const nav = JSON.parse(sessionStorage.getItem('app_nav_payload') || '{}');
      return nav.tab === 'employeeCost' && nav.view === 'dq' ? 'dq' : 'cost';
    } catch { return 'cost'; }
  });
  useEffect(() => {
    if (!admin) return undefined;
    const onAppNavigate = (event) => {
      if (event?.detail?.tab === 'employeeCost' && event.detail.view === 'dq') setView('dq');
    };
    window.addEventListener('app:navigate', onAppNavigate);
    return () => window.removeEventListener('app:navigate', onAppNavigate);
  }, [admin]);
  // Khôi phục đúng NV + kỳ CEO đang xem dở lần trước (CEO duyệt 03/08).
  const savedPrefs = useMemo(() => readEmployeeCostPrefs(typeof window === 'undefined' ? null : window.localStorage), []);
  const startRange = savedPrefs.range || { from: month, to: month };
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(admin ? (savedPrefs.emp || 'ALL') : String(me?.emp_code || ''));
  const [draftRange, setDraftRange] = useState(startRange);
  const [range, setRange] = useState(startRange);
  // So với kỳ liền trước. Là NÚT BẬT/TẮT, không tự tải: chế độ "Tất cả NV" mà tự
  // kéo thêm một kỳ nữa là nặng gấp đôi — đúng chỗ đang làm mất dữ liệu chi phí.
  const [compareOn, setCompareOn] = useState(savedPrefs.compare === true);
  const [comparePayload, setComparePayload] = useState(null);
  // Bộ lọc nâng cao mặc định ĐÓNG (CEO 03/08): màn hình đỡ rối, mở khi cần lọc sâu.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [payload, setPayload] = useState(EMPTY);
  const [khoanPayload, setKhoanPayload] = useState({});
  const [khoanLoading, setKhoanLoading] = useState(!admin);
  const [loading, setLoading] = useState(!admin);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const [visibilityPanel, setVisibilityPanel] = useState(null);
  const [visibilityLoading, setVisibilityLoading] = useState(admin);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityMessage, setVisibilityMessage] = useState('');
  const [visibilityError, setVisibilityError] = useState('');
  // Số đếm cho badge trên tab — tải nền, độc lập với tab đang mở, để CEO thấy
  // ngay còn bao nhiêu việc mà không phải bấm vào từng tab.
  const [gapBadge, setGapBadge] = useState({
    loaded: false, loading: true, from: '', to: '', codeCount: 0, pairCount: 0,
    revenueAffected: 0, unavailableEmployees: [],
  });
  const [dqBadge, setDqBadge] = useState({ loaded: false, loading: true, count: 0, revenueAffected: 0 });
  const [gapPayload, setGapPayload] = useState({ pairs: [], coverageByEmployee: [] });
  const [gapLoading, setGapLoading] = useState(!admin);
  const [gapError, setGapError] = useState('');
  const [dqPayload, setDqPayload] = useState({ items: [], summary: {} });
  const [dqLoading, setDqLoading] = useState(!admin);
  const [dqError, setDqError] = useState('');
  const [costExporting, setCostExporting] = useState('');
  const [costExportError, setCostExportError] = useState('');
  const [provinceWorklistExporting, setProvinceWorklistExporting] = useState(false);
  const [tableQuery, setTableQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [tableSort, setTableSort] = useState({ key: '', dir: 'asc' });
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(20);
  const [tableFilters, setTableFilters] = useState({ province: '', unitGroup: '', route: '', date: '' });
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [bonusModalOpen, setBonusModalOpen] = useState(false);
  const [penaltyModalOpen, setPenaltyModalOpen] = useState(false);
  const costRequestGate = useRef(createLatestRequestGate());
  const pointRequestGate = useRef(createLatestRequestGate());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(tableQuery), 180);
    return () => clearTimeout(timer);
  }, [tableQuery]);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    setVisibilityLoading(true);
    api.employeeCostVisibility().then((data) => {
      if (!alive) return;
      const panel = normalizeVisibilityPanel(data);
      setVisibilityPanel(panel);
      setEmployees(panel.employees);
      setSelectedEmp((current) => current || 'ALL');
    }).catch((requestError) => {
      if (!alive) return;
      setEmployees([]);
      setVisibilityError(requestError.message || 'Không thể tải cấu hình công tắc');
    }).finally(() => { if (alive) setVisibilityLoading(false); });
    return () => { alive = false; };
  }, [admin]);

  useEffect(() => {
    if (admin && view !== 'cost') return undefined;
    if (admin && !selectedEmp) { setPayload(EMPTY); setLoading(false); return; }
    const request = costRequestGate.current.next();
    setLoading(true);
    setError('');
    setExpanded({});
    const allEmployees = admin && selectedEmp === 'ALL';
    api.employeeCost(admin ? selectedEmp : undefined, {
      ...range,
      q: debouncedQuery,
      sortKey: tableSort.key,
      sortDir: tableSort.dir,
      ...tableFilters,
      page: tablePage,
      pageSize: tablePageSize,
    }, { signal: request.signal })
      .then((data) => { if (request.isLatest()) setPayload(data); })
      .catch((requestError) => {
        if (!request.isLatest() || requestError?.name === 'AbortError') return;
        setPayload({ ...EMPTY, ...range });
        setError(requestError.message || 'Không thể tải dữ liệu');
      })
      .finally(() => { if (request.isLatest()) setLoading(false); });
    return () => { if (request.isLatest()) costRequestGate.current.cancel(); };
  }, [admin, selectedEmp, range, view, debouncedQuery, tableSort, tablePage, tablePageSize, tableFilters]);

  useEffect(() => {
    if (admin && view !== 'cost') return undefined;
    if (admin && !selectedEmp) { setKhoanPayload({}); setKhoanLoading(false); return undefined; }
    // ALL chỉ tải bảng chi phí. Không fan-out App VAT cho toàn roster lúc mở trang;
    // điểm/xu/phạt được tải khi CEO chọn đúng một nhân viên.
    if (admin && selectedEmp === 'ALL') {
      setKhoanPayload({ note: 'Chọn một nhân viên để tải điểm/xu' });
      setKhoanLoading(false);
      return undefined;
    }
    let alive = true;
    let idleId;
    let timerId;
    setKhoanPayload({ note: 'chưa lấy được xu kỳ này' });
    setKhoanLoading(true);
    let request = null;
    const load = () => {
      request = pointRequestGate.current.next();
      return api.employeeCostDiemXu(admin ? selectedEmp : undefined, range, { signal: request.signal })
      .then((data) => {
        if (alive && request.isLatest()) setKhoanPayload(data);
      })
      .catch((error) => { if (alive && request.isLatest() && error?.name !== 'AbortError') setKhoanPayload({ note: 'chưa lấy được xu kỳ này' }); })
      .finally(() => { if (alive && request.isLatest()) setKhoanLoading(false); });
    };
    // Để request bảng chi phí được ưu tiên render trước; timeout giữ đường lui
    // cho browser không hỗ trợ requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') idleId = window.requestIdleCallback(load, { timeout: 1200 });
    else timerId = window.setTimeout(load, 150);
    return () => {
      alive = false;
      if (request?.isLatest()) pointRequestGate.current.cancel();
      if (idleId != null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId);
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, [admin, selectedEmp, range, view, me?.emp_code]);

  // Tải số đếm cho badge — CHẠY BẤT KỂ đang ở tab nào (chỉ admin), để con số
  // hiện sẵn trên tab. Lỗi thì im lặng ẩn badge, không làm phiền màn chính.
  // Badge là thông tin PHỤ — không được giành tài nguyên với bảng chính lúc mở trang.
  // Hoãn ~1,2s để bảng chính tải xong trước; đổi tab KHÔNG tải lại (bỏ 'view' khỏi
  // deps) vì số đếm không phụ thuộc tab đang mở.
  useEffect(() => {
    if (!admin) return undefined;
    let alive = true;
    setGapBadge((current) => ({ ...current, loading: true }));
    const timer = window.setTimeout(() => {
      if (!alive) return;
      api.employeeCostGapsSummary(range)
        .then((data) => { if (alive) setGapBadge(data?.disabled
          ? { loaded: false, loading: false, from: range.from, to: range.to, codeCount: 0, pairCount: 0, revenueAffected: 0, unavailableEmployees: [] }
          : {
            loaded: true, loading: false, from: String(data.from || range.from), to: String(data.to || range.to),
            codeCount: Number(data.codeCount || 0), pairCount: Number(data.pairCount || 0),
            revenueAffected: Number(data.revenueAffected || 0),
            unavailableEmployees: Array.isArray(data.unavailableEmployees) ? data.unavailableEmployees.map(String) : [],
          }); })
        .catch(() => { if (alive) setGapBadge((current) => ({ ...current, loading: false })); });
      api.employeeCostDataQualitySummary(range)
        .then((data) => { if (alive) setDqBadge({ loaded: true, loading: false, count: Number(data.exceptionCount ?? data.count ?? 0), revenueAffected: Number(data.revenueAffected || 0) }); })
        .catch(() => { if (alive) setDqBadge((current) => ({ ...current, loading: false })); });
    }, 1200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [admin, range]);

  useEffect(() => {
    if (admin && view !== 'gaps') return undefined;
    let alive = true;
    setGapLoading(true);
    setGapError('');
    api.employeeCostGaps(undefined, range)
      .then((data) => { if (alive) setGapPayload(data); })
      .catch((requestError) => {
        if (!alive) return;
        setGapPayload({ ...range, pairs: [], coverageByEmployee: [] });
        setGapError(requestError.message || 'Không thể tải danh sách thiếu % chi phí');
      })
      .finally(() => { if (alive) setGapLoading(false); });
    return () => { alive = false; };
  }, [admin, range, view]);

  useEffect(() => {
    if (admin && view !== 'dq') return undefined;
    let alive = true;
    setDqLoading(true);
    setDqError('');
    api.employeeCostDataQuality(range)
      .then((data) => { if (alive) setDqPayload(data); })
      .catch((requestError) => {
        if (!alive) return;
        setDqPayload({ ...range, items: [], summary: {} });
        setDqError(requestError.message || 'Không thể tải Trung tâm Kiểm soát Dữ liệu');
      })
      .finally(() => { if (alive) setDqLoading(false); });
    return () => { alive = false; };
  }, [admin, range, view]);

  const model = useMemo(() => employeeCostViewModel(payload), [payload]);
  const compareModel = useMemo(() => (comparePayload ? employeeCostViewModel(comparePayload) : null), [comparePayload]);
  const khoan = useMemo(() => employeeVatKhoanViewModel(khoanPayload), [khoanPayload]);
  const selected = employees.find((employee) => employee.emp_code === selectedEmp);
  const employeeLabel = admin
    ? (selectedEmp === 'ALL' ? 'Tất cả nhân viên' : (selected ? employeeOptionLabel(selected) : 'Chưa chọn nhân viên'))
    : String(me?.emp_code || model.empCode || '—');
  const rangeInvalid = !draftRange.from || !draftRange.to || draftRange.from > draftRange.to;
  const multiple = model.periods.length > 1;
  const columnKpis = employeeCostColumnKpis(model);
  const allEmployees = admin && selectedEmp === 'ALL';
  const kpiMatch = employeeCostKpiMatch(model);
  // Tổng bị khóa (coverage < ngưỡng) → hiện số tạm tính kèm ghi chú nêu ĐÚNG số
  // cặp còn thiếu, để đối chiếu thẳng với tab "Mặt hàng thiếu %".
  const provisionalTotals = model.summary.periodTotal == null && model.summary.provisionalPeriodTotal != null;
  const missingPairs = Math.max(0, Number(kpiMatch.totalRows || 0) - Number(kpiMatch.matchedRows || 0));
  const unavailablePairs = Number(kpiMatch.unavailablePairs || 0);
  const unavailableEmpCodes = Array.isArray(kpiMatch.unavailableEmployees) ? kpiMatch.unavailableEmployees : [];
  const unavailableEmps = Number(kpiMatch.unavailableEmployeeCount || 0);
  const unavailableEmpLabel = unavailableEmpCodes.length ? unavailableEmpCodes.join(', ') : `${unavailableEmps} NV`;
  const gapConsistency = employeeCostGapConsistency(model, gapBadge);
  const gapMismatch = allEmployees && !loading && gapConsistency.mismatch;
  const gapMismatchEmployees = [...new Set([
    ...gapConsistency.expectedUnavailable, ...gapConsistency.actualUnavailable,
  ])];
  const gapMismatchSource = gapMismatchEmployees.length
    ? `DataHub đang tạm thiếu nguồn của ${gapMismatchEmployees.join(', ')}.`
    : 'Hai request đang nhận hai snapshot DataHub khác nhau.';
  // Không khớp được dòng nào ⇒ hiện “—” và nói đúng trạng thái lookup policy,
  // không đổ lỗi rằng DataHub phải nạp lại riêng từng tháng.
  const noMatch = employeeCostNoMatch(model);
  const effectiveRateMonths = Array.isArray(model.rateEffectiveFroms) ? model.rateEffectiveFroms : [];
  const rateEffectiveNote = model.rateEffectiveFrom
    ? `Tỷ lệ % đang hiệu lực từ ${formatMonthLabel(model.rateEffectiveFrom)}`
    : effectiveRateMonths.length
      ? `Tỷ lệ % đang hiệu lực từ ${effectiveRateMonths.map(formatMonthLabel).join(', ')}`
      : '';
  const noMatchSourceNote = model.ratePolicy.state === 'unavailable'
    ? 'Chưa lấy được policy % hiện hành từ DataHub.'
    : model.ratePolicy.state === 'ambiguous'
      ? 'Policy % DataHub thiếu provenance kỳ hợp lệ nên App Report đã fail-closed.'
      : model.ratePolicy.state === 'not_applicable'
        ? 'Không hồi tố policy công bố sau kỳ đang xem.'
        : 'Chưa tìm thấy policy % đang hiệu lực từ DataHub.';
  const coverageNote = noMatch
    ? `${noMatchSourceNote} ${missingPairs.toLocaleString('vi-VN')}/${Number(kpiMatch.totalRows || 0).toLocaleString('vi-VN')} cặp chưa tính được (tab "Mặt hàng thiếu %").`
    : provisionalTotals
    ? [
      `Tạm tính trên ${formatMatchRate(kpiMatch)} đã khớp`,
      missingPairs ? `còn ${missingPairs.toLocaleString('vi-VN')} cặp thiếu % (tab "Mặt hàng thiếu %")` : '',
      unavailableEmps ? `chưa lấy được chi phí của ${unavailableEmpLabel} (${unavailablePairs.toLocaleString('vi-VN')} cặp)` : '',
    ].filter(Boolean).join(' · ')
    : '';
  const filteredCount = model.search.filteredRows;
  const totalTableRows = model.search.totalRows;
  const activeTableFilter = tableQuery || tableFilters.province || tableFilters.unitGroup || tableFilters.route || tableFilters.date || tableSort.key;

  useEffect(() => {
    if (!model.target.available) setTargetModalOpen(false);
  }, [model.target.available]);

  useEffect(() => {
    if (!model.bonus.configured) setBonusModalOpen(false);
  }, [model.bonus.configured]);

  useEffect(() => {
    if (!model.penalty.available) setPenaltyModalOpen(false);
  }, [model.penalty.available]);

  // Đang đóng mà vẫn có bộ lọc bật thì phải hiện số lên nút — nếu không, CEO xem
  // một bảng đã bị lọc mà không biết, tưởng mất dữ liệu.
  const advancedActiveCount = [
    tableFilters.province, tableFilters.unitGroup, tableFilters.route, tableFilters.date,
    range.from !== range.to ? 'range' : '',
  ].filter(Boolean).length;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    writeEmployeeCostPrefs(window.localStorage, {
      emp: admin ? selectedEmp : '', from: range.from, to: range.to, compare: compareOn,
    });
  }, [admin, selectedEmp, range.from, range.to, compareOn]);

  // Chỉ tải kỳ trước KHI CEO bật so sánh và đang xem đúng một tháng.
  useEffect(() => {
    if (!compareOn || range.from !== range.to || (admin && !selectedEmp)) { setComparePayload(null); return undefined; }
    let alive = true;
    const previous = previousMonthValue(range.from);
    if (!previous) { setComparePayload(null); return undefined; }
    api.employeeCost(admin ? selectedEmp : undefined, { from: previous, to: previous })
      .then((data) => { if (alive) setComparePayload({ ...data, period: previous }); })
      .catch(() => { if (alive) setComparePayload(null); });
    return () => { alive = false; };
  }, [compareOn, admin, selectedEmp, range.from, range.to]);

  const applyRange = (event) => {
    event.preventDefault();
    if (rangeInvalid) return;
    setTablePage(1);
    setTableFilters((current) => ({ ...current, date: '' }));
    setRange({ ...draftRange });
  };
  // Bấm một tháng là xem ngay tháng đó, không phải chỉnh hai ô rồi bấm Xem.
  const pickMonth = (value) => {
    setTablePage(1);
    setTableFilters((current) => ({ ...current, date: '' }));
    setDraftRange({ from: value, to: value });
    setRange({ from: value, to: value });
  };
  const changeVisibility = (layer, key, setting) => {
    setVisibilityMessage('');
    setVisibilityError('');
    setVisibilityPanel((current) => updateVisibilitySetting(current, layer, key, setting));
  };
  const saveVisibility = async () => {
    if (!visibilityPanel || visibilitySaving) return;
    setVisibilitySaving(true);
    setVisibilityMessage('');
    setVisibilityError('');
    try {
      const saved = normalizeVisibilityPanel(await api.employeeCostVisibilitySave(visibilitySavePayload(visibilityPanel)));
      setVisibilityPanel(saved);
      setEmployees(saved.employees);
      setVisibilityMessage('Đã lưu công tắc và ghi audit.');
    } catch (requestError) {
      setVisibilityError(requestError.message || 'Không thể lưu cấu hình công tắc');
    } finally {
      setVisibilitySaving(false);
    }
  };
  const exportCost = async (format) => {
    if (admin && !selectedEmp) return;
    setCostExporting(format); setCostExportError('');
    try {
      await downloadEmployeeCostReport(format, {
        ...range, ...(admin ? { emp: selectedEmp } : {}), q: tableQuery, sortKey: tableSort.key, sortDir: tableSort.dir, ...tableFilters,
      });
    }
    catch (requestError) { setCostExportError(requestError.message || 'Không xuất được báo cáo chi phí'); }
    finally { setCostExporting(''); }
  };
  const exportProvinceWorklist = async () => {
    setProvinceWorklistExporting(true); setCostExportError('');
    try { await downloadEmployeeCostProvinceWorklist(range); }
    catch (requestError) { setCostExportError(requestError.message || 'Không xuất được danh sách đơn vị chưa gán tỉnh'); }
    finally { setProvinceWorklistExporting(false); }
  };
  const changeEmployee = (value) => {
    setTargetModalOpen(false);
    setBonusModalOpen(false);
    setPenaltyModalOpen(false);
    setSelectedEmp(value); setTablePage(1); setTableQuery(''); setDebouncedQuery(''); setTableSort({ key: '', dir: 'asc' }); setTableFilters({ province: '', unitGroup: '', route: '', date: '' });
  };
  const changeTableFilter = (key, value) => {
    setTablePage(1);
    setTableFilters((current) => ({ ...current, [key]: value }));
  };
  const clearTableFilters = () => {
    setTableQuery(''); setDebouncedQuery(''); setTableSort({ key: '', dir: 'asc' }); setTableFilters({ province: '', unitGroup: '', route: '', date: '' }); setTablePage(1);
  };
  const changeSort = (key) => {
    setTablePage(1);
    setTableSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };
  const openDqRow = (item) => {
    if (admin) {
      const assignedEmployees = (item.employeeCodes || []).filter((code) => code && code !== 'UNALLOCATED');
      setSelectedEmp(assignedEmployees.length === 1 ? assignedEmployees[0] : 'ALL');
    }
    const query = item.productCode || item.unitCode || '';
    setTableQuery(query); setDebouncedQuery(query); setTablePage(1); setView('cost');
  };

  if (!admin && payload.disabled) return <section className="employee-cost-page">
    <div className="card center">{payload.note || 'Chức năng chi phí đang tắt cho bạn.'}</div>
  </section>;

  return <section className="employee-cost-page">
    <div className="employee-cost-heading card">
      <div>
        <div className="section-head">{admin && view === 'gaps' ? 'Mặt hàng thiếu % chi phí' : admin && view === 'dq' ? 'Kiểm soát dữ liệu' : 'Chi phí của tôi'}</div>
        <p>{admin && view === 'gaps' ? 'Danh sách chỉ phục vụ phát hiện và lập worklist cho DataHub; không tự ánh xạ mã hay tự điền tỷ lệ.' : admin && view === 'dq' ? 'Tự bắt lỗi, giải thích nguyên nhân và xếp ưu tiên theo doanh thu ảnh hưởng.' : 'Mỗi đơn × mỗi mặt hàng là một dòng. Chi phí được tính trên thành tiền xuất bán trước VAT và tra policy tỷ lệ đang hiệu lực theo mã hàng × đơn vị.'}</p>
      </div>
      <form className="employee-cost-filters" onSubmit={applyRange}>
        {admin && view === 'cost' && <label>
          <span>Nhân viên</span>
          <select value={selectedEmp} onChange={(event) => changeEmployee(event.target.value)}>
            <option value="ALL">Tất cả nhân viên</option>
            {!employees.length && <option value="">Chưa có nhân viên</option>}
            {employees.map((employee) => <option key={employee.emp_code} value={employee.emp_code}>
              {employeeOptionLabel(employee)}
            </option>)}
          </select>
        </label>}
        {advancedOpen && view === 'cost' && model.filterOptions.province.available && <label>
          <span>Vùng/Tỉnh</span>
          <select value={tableFilters.province} onChange={(event) => changeTableFilter('province', event.target.value)}>
            <option value="">Tất cả Vùng/Tỉnh</option>
            {model.filterOptions.province.options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count.toLocaleString('vi-VN')})</option>)}
          </select>
        </label>}
        {advancedOpen && view === 'cost' && <label>
          <span>Nhóm mã đơn vị</span>
          <select value={tableFilters.unitGroup} onChange={(event) => changeTableFilter('unitGroup', event.target.value)}>
            <option value="">Tất cả nhóm mã</option>
            {model.filterOptions.unitGroup.options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count.toLocaleString('vi-VN')})</option>)}
          </select>
        </label>}
        {advancedOpen && view === 'cost' && <label>
          <span>Tuyến</span>
          <select value={tableFilters.route} onChange={(event) => changeTableFilter('route', event.target.value)}>
            <option value="">Tất cả tuyến</option>
            {model.filterOptions.route.options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count.toLocaleString('vi-VN')})</option>)}
          </select>
        </label>}
        {advancedOpen && view === 'cost' && <label>
          <span>Ngày doanh thu</span>
          <select value={tableFilters.date} onChange={(event) => changeTableFilter('date', event.target.value)}>
            <option value="">Tất cả ngày</option>
            {model.filterOptions.date.options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count.toLocaleString('vi-VN')})</option>)}
          </select>
        </label>}
        {/* Chọn tháng bằng MỘT nút — việc hay làm nhất. Khoảng "từ tháng → đến
            tháng" là việc hiếm nên dời vào bộ lọc nâng cao (CEO chốt 03/08). */}
        <div className="employee-cost-month-quick" role="group" aria-label="Chọn tháng nhanh">
          {quickMonths(4).map((value) => {
            const active = range.from === value && range.to === value;
            return <button key={value} type="button" aria-pressed={active}
              className={`employee-cost-month-chip${active ? ' active' : ''}`}
              onClick={() => pickMonth(value)}>T{formatMonthLabel(value).replace('/', '.')}</button>;
          })}
          {range.from !== range.to && <span className="employee-cost-month-chip range" title="Đang xem một khoảng nhiều tháng">
            {formatMonthLabel(range.from)} → {formatMonthLabel(range.to)}
          </span>}
          {/* So kỳ trước: chỉ có nghĩa khi đang xem đúng MỘT tháng. */}
          {range.from === range.to && <button type="button"
            className={`employee-cost-advanced-toggle${compareOn ? ' active' : ''}`}
            aria-pressed={compareOn} onClick={() => setCompareOn((on) => !on)}
            title="Hiện chênh lệch so với tháng liền trước">
            {compareOn ? '✓ So kỳ trước' : '↕ So kỳ trước'}
          </button>}
          <button type="button" className={`employee-cost-advanced-toggle${advancedOpen ? ' active' : ''}`}
            aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>
            {advancedOpen ? '▲ Ẩn bộ lọc nâng cao' : '▼ Bộ lọc nâng cao'}
            {!advancedOpen && !!advancedActiveCount && <span className="employee-cost-tab-badge warn">{advancedActiveCount}</span>}
          </button>
        </div>
        {advancedOpen && <label><span>Từ tháng</span><input type="month" value={draftRange.from} onChange={(event) => setDraftRange((current) => ({ ...current, from: event.target.value }))} /></label>}
        {advancedOpen && <label><span>Đến tháng</span><input type="month" value={draftRange.to} onChange={(event) => setDraftRange((current) => ({ ...current, to: event.target.value }))} /></label>}
        {advancedOpen && <button type="submit" className="btn" disabled={rangeInvalid || (admin && view === 'gaps' ? gapLoading : admin && view === 'dq' ? dqLoading : loading)}>Xem</button>}
        {view === 'cost' && <div className="employee-cost-export-actions">
          <button type="button" className="btn secondary" disabled={loading || !!costExporting || (admin && !selectedEmp)} onClick={() => exportCost('xlsx')}>{costExporting === 'xlsx' ? 'Đang xuất…' : 'Xuất Excel'}</button>
          <button type="button" className="btn secondary" disabled={loading || !!costExporting || (admin && !selectedEmp)} onClick={() => exportCost('pdf')}>{costExporting === 'pdf' ? 'Đang xuất…' : 'Xuất PDF'}</button>
          {admin && <button type="button" className="btn secondary" disabled={loading || provinceWorklistExporting} onClick={exportProvinceWorklist}>{provinceWorklistExporting ? 'Đang xuất ĐV…' : 'Xuất ĐV chưa gán tỉnh'}</button>}
        </div>}
        {rangeInvalid && <small role="alert">Từ tháng không được sau Đến tháng.</small>}
      </form>
    </div>

    {costExportError && view === 'cost' && <div className="employee-cost-match-warning" role="alert">{costExportError}</div>}

    {admin && <div className="employee-cost-tabs" role="tablist" aria-label="Chế độ xem chi phí">
      <button type="button" role="tab" aria-selected={view === 'cost'} className={view === 'cost' ? 'active' : ''} onClick={() => setView('cost')}>Chi phí theo nhân viên</button>
      {/* Badge số ngay trên tab: CEO nhìn phát thấy còn bao nhiêu mã/dòng đang
          vướng, không phải bấm vào tab mới biết. */}
      <button type="button" role="tab" aria-selected={view === 'gaps'} className={view === 'gaps' ? 'active' : ''} onClick={() => setView('gaps')}>
        Mặt hàng thiếu %{!gapConsistency.ready && gapBadge.loading && <span className="employee-cost-tab-badge loading" title="Đang đếm…">…</span>}{gapConsistency.ready && <span
          className={`employee-cost-tab-badge${gapMismatch || gapBadge.codeCount ? ' warn' : ' ok'}`}
          title={gapMismatch ? `Dữ liệu KPI và tab chưa cùng snapshot. ${gapMismatchSource}` : gapBadge.codeCount ? `${gapBadge.codeCount} mã · ${gapBadge.pairCount} cặp · ${gapBadge.revenueAffected.toLocaleString('vi-VN')}đ doanh thu ảnh hưởng` : 'Không còn mã thiếu %'}>
          {gapMismatch ? '⚠ chưa đồng nhất' : gapBadge.codeCount ? `${gapBadge.codeCount} mã · ${gapBadge.pairCount} cặp` : '0'}
        </span>}
      </button>
      <button type="button" role="tab" aria-selected={view === 'dq'} className={view === 'dq' ? 'active' : ''} onClick={() => setView('dq')}>
        Kiểm soát dữ liệu{!dqBadge.loaded && dqBadge.loading && <span className="employee-cost-tab-badge loading" title="Đang đếm…">…</span>}{dqBadge.loaded && <span className={`employee-cost-tab-badge${dqBadge.count ? ' warn' : ' ok'}`} title={dqBadge.count ? `${dqBadge.count} exception · ${dqBadge.revenueAffected.toLocaleString('vi-VN')}đ doanh thu ảnh hưởng` : 'Không có exception'}>{dqBadge.count ? `${dqBadge.count} exception` : '0'}</span>}
      </button>
    </div>}

    {view === 'cost' && gapMismatch && <div className="employee-cost-match-warning employee-cost-data-mismatch" role="alert">
      <b>⛔ Dữ liệu chưa đồng nhất.</b> KPI và tab "Mặt hàng thiếu %" chưa cùng một snapshot. {gapMismatchSource} Số badge chỏi đã được ẩn; hãy làm mới sau khi nguồn phục hồi.
    </div>}

    {admin && view === 'dq' ? <DataQualityPanel payload={dqPayload} loading={dqLoading} error={dqError} range={range} admin onOpenRow={openDqRow} /> : admin && view === 'gaps' ? <AdminGapPanel payload={gapPayload} loading={gapLoading} error={gapError} range={range} /> : <>
    {admin && <VisibilityPanel
      adminCode={me?.emp_code || me?.username || 'admin'}
      panel={visibilityPanel}
      loading={visibilityLoading}
      saving={visibilitySaving}
      message={visibilityMessage}
      error={visibilityError}
      onChange={changeVisibility}
      onSave={saveVisibility}
    />}

    {/* Sổ thanh toán đặt NGAY DƯỚI khối KPI: NV nhìn xong các ô tiền là thấy luôn
        lịch nhận tiền của mình, không phải cuộn xuống bảng chi tiết. */}
    <PaymentSchedulePanel schedule={model.paymentSchedule} allEmployees={allEmployees} loading={loading} />
    <PaymentTeamPanel team={model.paymentTeam} allEmployees={allEmployees} loading={loading} />

    {!admin && <EmployeeGapPanel payload={gapPayload} loading={gapLoading} error={gapError} range={range} />}
    {!admin && <DataQualityPanel payload={dqPayload} loading={dqLoading} error={dqError} range={range} admin={false} onOpenRow={openDqRow} />}

    {/* Hệ thống TỰ BÁO khi thiếu dữ liệu, nêu đích danh NV — không để người dùng
        phải tự phát hiện số sai rồi đi truy nguồn. */}
    {!!unavailableEmps && <div className="employee-cost-match-warning" role="alert">
      <b>⚠ Dữ liệu chưa đầy đủ — số đang là TẠM TÍNH.</b> Chưa lấy được dữ liệu chi phí của <b>{unavailableEmpLabel}</b> ({unavailablePairs.toLocaleString('vi-VN')} cặp, kỳ {formatMonthLabel(model.from)}{model.from === model.to ? '' : ` → ${formatMonthLabel(model.to)}`}).
      Phần này <b>không</b> phải "thiếu % catalog" mà là <b>nguồn chi phí DataHub chưa trả dữ liệu</b> — báo DataHub kiểm tra. Tỷ lệ khớp phía dưới đã loại phần này ra để không báo sai.
    </div>}

    <div className="kpi-grid employee-cost-kpis">
      <Kpi label="Nhân viên" value={employeeLabel} sub={`Hiện ${filteredCount.toLocaleString('vi-VN')}/${totalTableRows.toLocaleString('vi-VN')} dòng`} />
      {/* Chi phí tính trên số TRƯỚC VAT nên số đó đứng trên, to. Số ĐÃ gồm VAT đặt
          ngay dưới, nhỏ hơn, để đối chiếu nhanh với App Sale mà không phải đổi màn. */}
      <Kpi label="Doanh thu chưa VAT · đã phân bổ"
        value={formatEmployeeCostCell(model.summary.revenueBeforeVatTotal, moneyColumn)}
        sub={[
          model.summary.revenueTotal == null ? '' : `Đã gồm VAT: ${formatEmployeeCostCell(model.summary.revenueTotal, moneyColumn)}`,
          // ‼ Dòng chưa gán được NV KHÔNG nằm trong tổng ở đây nhưng VẪN nằm trong
          // doanh thu App Sale — đó là lý do hai app lệch (CEO bắt được 23:21, lệch
          // 1.795.600đ). Nhan đề ô đã ghi "đã phân bổ" nên câu này chỉ chỉ đường,
          // KHÔNG nêu số: `dqBadge.count` là TỔNG mọi loại exception, không riêng
          // dòng cách ly — nêu số ở đây là báo sai (bot chặn đúng 04/08).
          allEmployees ? 'dòng chưa gán được NV nằm ở tab "Kiểm soát dữ liệu"' : '',
          'số tổng hợp từ backend',
        ].filter(Boolean).join(' · ')} />
      {/* Điểm/Target/Xu/Cấn trừ là chỉ số TỪNG NGƯỜI — không gộp được qua nhiều NV.
          Ở "Tất cả NV" ẩn hẳn (thay vì hiện ô trống trông như lỗi) + 1 thẻ gợi ý. */}
      {!allEmployees && <KhoanPointKpi khoan={khoan} loading={khoanLoading} />}
      {!allEmployees && <TargetKpi target={model.target} onOpen={model.target.available ? () => setTargetModalOpen(true) : undefined} />}
      {allEmployees && (() => {
        const team = teamTargetSummary(model.bonus.employeeSubtotals);
        return team.hasData
          ? <Kpi label="Target tổng đội (tham khảo)" value={`${formatEmployeeCostCell(team.monthTarget, moneyColumn)} · ${targetPctLabel(team.monthPct)}`} sub={`Tháng: Σ target · % đạt toàn đội (${team.assigned}/${team.total} NV có target) | Quý: ${formatEmployeeCostCell(team.quarterTarget, moneyColumn)} · từ thưởng dự kiến`} tone="employee-cost-tone-target" />
          : <Kpi label="Target tổng đội" value="—" sub="Chưa đủ target giao cho đội trong kỳ này" tone="employee-cost-tone-target" />;
      })()}
      {allEmployees && <Kpi label="Điểm · Xu · Cấn trừ" value="Chọn 1 NV" sub="Các mục tính theo từng người — chọn đúng một nhân viên để xem" />}
      {/* Coverage dưới ngưỡng thì tổng bị khóa null (fail-closed) → trước đây ô trống
          trơn, nhìn như hỏng. Nay hiện tổng PHẦN ĐÃ KHỚP + nhãn "tạm tính" nói rõ
          còn thiếu bao nhiêu, để CEO vẫn có số mà không hiểu nhầm là số cuối. */}
      {/* HAI NHÃN KHÁC NHAU, KHÔNG GỘP (CEO chốt 30/07):
          · "DỰ KIẾN"  = kỳ chưa khoá sổ, doanh thu còn về đến hết ngày 8 tháng sau
                         → chờ đến ngày đó, không ai phải làm gì.
          · "tạm tính" = danh mục còn mã chưa gán % → DataHub quản lý policy tỷ lệ.
          Một kỳ có thể vừa dự kiến vừa tạm tính; gộp một từ là mất thông tin. */}
      <Kpi
        label={`${multiple ? 'Tổng cả kỳ (chi phí gốc)' : 'Tổng chi phí tháng (chi phí gốc)'}${model.periodClose.closed ? '' : ' · dự kiến'}${noMatch ? ' · chưa có nguồn % hợp lệ' : (provisionalTotals ? ' · tạm tính' : '')}`}
        value={formatEmployeeCostCell(noMatch ? null : (provisionalTotals ? model.summary.provisionalPeriodTotal : model.summary.periodTotal), moneyColumn)}
        sub={[
          `${formatMonthLabel(model.from)} → ${formatMonthLabel(model.to)}`,
          noMatch ? '' : model.periodClose.note,
          // Chênh lệch so kỳ trước — chỉ hiện khi CEO bật VÀ cả hai kỳ đều có số.
          // Thiếu một đầu thì im lặng, không hiện "0%" giả.
          compareOn ? formatDeltaLabel(employeeCostDelta(
            noMatch ? null : (provisionalTotals ? model.summary.provisionalPeriodTotal : model.summary.periodTotal),
            compareModel?.summary?.periodTotal ?? compareModel?.summary?.provisionalPeriodTotal ?? null,
          )) : '',
          rateEffectiveNote,
          noMatch || provisionalTotals ? coverageNote : 'chưa gồm khoản cuối năm',
        ].filter(Boolean).join(' · ')}
        title={model.periodClose.label}
        tone="employee-cost-tone-base" />
      {/* Bốn ô luôn hiện ở cả chế độ từng NV và "Tất cả NV". Payload ALL đã có
          penalty tổng đội do backend cộng từ kết quả self-scoped của từng người;
          frontend chỉ hiển thị, tuyệt đối không reduce/tính lại từ subtotals. */}
      <AfterPenaltyKpi
        penalty={model.penalty}
        baseTotal={allEmployees ? model.penalty.baseTotal : model.summary.periodTotal}
        multiple={multiple} />
      {SALARY_ADVANCE_UI && <SalaryAdvanceKpi salaryAdvance={model.salaryAdvance} loading={loading}
        allEmployees={allEmployees} period={range.to} />}
      {SALARY_ADVANCE_UI && <RemainingAfterAdvanceKpi remainingAfterAdvance={model.remainingAfterAdvance}
        loading={loading} allEmployees={allEmployees} period={range.to} />}
      <BonusKpi bonus={model.bonus} onOpen={model.bonus.configured ? () => setBonusModalOpen(true) : undefined} />
      <PenaltyKpi penalty={model.penalty} onOpen={() => setPenaltyModalOpen(true)} />
      <XuPenaltyKpi penalty={model.penalty} period={model.to} />
      {columnKpis.map((item) => <CostColumnKpi key={item.key} item={item} coverageNote={coverageNote} />)}
      {/* Mẫu số ghi TRUNG THỰC theo grain: ALL cộng dồn theo từng NV (cặp NV×đơn vị×mặt
          hàng), 1 NV thì là cặp đơn vị×mặt hàng. Tab "Mặt hàng thiếu %" gộp về mã riêng
          biệt nên số nhỏ hơn — không mâu thuẫn, khác thước đo. */}
      <Kpi label="Khớp doanh thu" value={formatMatchRate(kpiMatch)} sub={allEmployees
        ? [
          `${kpiMatch.matchedRows.toLocaleString('vi-VN')} khớp + ${missingPairs.toLocaleString('vi-VN')} thiếu % = ${kpiMatch.totalRows.toLocaleString('vi-VN')} cặp (nhân viên×đơn vị×mặt hàng)`,
          `ngưỡng ${kpiMatch.threshold}% · khớp số ở tab "Mặt hàng thiếu %"`,
          unavailableEmps ? `⚠ chưa lấy được dữ liệu chi phí của ${unavailableEmpLabel} (${unavailablePairs.toLocaleString('vi-VN')} cặp) — KHÔNG tính vào tỷ lệ này` : '',
        ].filter(Boolean).join(' · ')
        : `${kpiMatch.matchedRows.toLocaleString('vi-VN')} khớp + ${missingPairs.toLocaleString('vi-VN')} thiếu % = ${kpiMatch.totalRows.toLocaleString('vi-VN')} cặp (đơn vị×mặt hàng) · ngưỡng ${kpiMatch.threshold}%`} />
    </div>

    {targetModalOpen && <TargetDetailModal
      target={model.target}
      employeeLabel={employeeLabel}
      admin={admin}
      onClose={() => setTargetModalOpen(false)}
      onNavigate={onNavigate}
    />}

    {bonusModalOpen && <BonusDetailModal
      bonus={model.bonus}
      employeeLabel={allEmployees ? 'Tất cả nhân viên' : employeeLabel}
      onClose={() => setBonusModalOpen(false)}
    />}

    {penaltyModalOpen && <PenaltyDetailModal
      penalty={model.penalty}
      employeeLabel={employeeLabel}
      onClose={() => setPenaltyModalOpen(false)}
    />}

    {/* Cảnh báo xu + phép cấn trừ thiếu xu là theo TỪNG NGƯỜI — ẩn ở "Tất cả NV". */}
    {!allEmployees && <KhoanWarning khoan={khoan} />}
    {!allEmployees && <KhoanDeduction khoan={khoan} baseCost={model.summary.periodTotal} multiMonth={multiple} loading={khoanLoading} />}

    {allEmployees && model.bonus.configured && !!model.bonus.employeeSubtotals.length && <details className="employee-cost-subtotals employee-cost-bonus-subtotals">
      <summary>Thưởng dự kiến theo nhân viên ({model.bonus.employeeSubtotals.length}) · tham khảo</summary>
      <div className="employee-cost-bonus-penalty-table" role="table" aria-label="Thưởng và phạt dự kiến theo nhân viên">
        <span className="employee-cost-bonus-penalty-head" role="row"><b role="columnheader">Nhân viên</b><b role="columnheader">Thưởng dự kiến</b><b role="columnheader">Phạt dự kiến</b><b role="columnheader">Tổng sau phạt</b></span>
        {model.bonus.employeeSubtotals.map((item) => <span key={item.empCode} role="row">
          <b role="cell">{item.empCode} · {item.employeeName}</b>
          <small role="cell">{formatEmployeeCostCell(item.month.amount, moneyColumn)} · đạt {targetPctLabel(item.month.pct)}</small>
          <small role="cell">{item.penalty?.total > 0 ? `−${formatEmployeeCostCell(item.penalty.total, moneyColumn)}` : item.penalty ? 'Không bị phạt' : 'Chưa có dữ liệu'}</small>
          <small role="cell">{item.penalty?.afterPenaltyTotal == null ? '—' : formatEmployeeCostCell(item.penalty.afterPenaltyTotal, moneyColumn)}</small>
        </span>)}
      </div>
    </details>}

    <div className="card employee-cost-table-toolbar">
      <label><span>Tìm trong toàn bảng</span><input type="search" value={tableQuery} onChange={(event) => { setTableQuery(event.target.value); setTablePage(1); }} placeholder="Không dấu, nhiều từ khóa (AND)…" /></label>
      <div className="employee-cost-filter-chip">
        Đang lọc: <b>{allEmployees ? 'Tất cả NV' : (model.empCode || me?.emp_code || '—')}</b>
        {tableFilters.province && <> · {tableFilters.province}</>}
        {tableFilters.unitGroup && <> · nhóm {tableFilters.unitGroup}</>}
        {tableFilters.route && <> · tuyến {tableFilters.route}</>}
        {tableFilters.date && <> · ngày {formatEmployeeCostCell(tableFilters.date, { key: 'date' })}</>}
        {tableQuery && <> · từ khóa “{tableQuery}”</>} · {filteredCount.toLocaleString('vi-VN')}/{totalTableRows.toLocaleString('vi-VN')} dòng
        {activeTableFilter && <button type="button" onClick={clearTableFilters}>× Xóa lọc</button>}
      </div>
    </div>

    {error && <div className="employee-cost-match-warning" role="alert">{error}</div>}
    {loading ? <div className="card"><Spinner /></div> : !model.periods.length ? <div className="card center">{model.note}</div> : <>
      {model.periods.map((period) => <PeriodBlock
        key={period.period}
        period={period}
        expanded={!!expanded[period.period]}
        onToggle={() => setExpanded((current) => ({ ...current, [period.period]: !current[period.period] }))}
        query={tableQuery}
        sort={tableSort}
        onSort={changeSort}
        allEmployees={allEmployees}
        penalty={!allEmployees && period.period === model.to ? model.penalty : null}
        onPage={setTablePage}
        onPageSize={(value) => { setTablePageSize(value); setTablePage(1); }}
      />)}
      {multiple && <div className="card employee-cost-range-total">
        <span>Tổng cả kỳ (chưa gồm khoản cuối năm)</span>
        <b>{formatEmployeeCostCell(model.summary.periodTotal, moneyColumn)}</b>
      </div>}
    </>}
    </>}
  </section>;
}
