import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadEmployeeCostDataQuality, downloadEmployeeCostGaps, downloadEmployeeCostProvinceWorklist, downloadEmployeeCostReport } from '../api.js';
import { Kpi, Spinner } from '../components.jsx';
import {
  currentMonthValue, employeeCostColumnKpis, employeeCostHighlightParts, employeeCostViewModel,
  employeeCostPageItems, formatEmployeeCostCell, formatMatchRate, formatMonthLabel,
} from '../employeeCostModel.js';
import {
  normalizeVisibilityPanel, readVisibilityCollapsed, updateVisibilitySetting, visibilityCollapseStorageKey,
  visibilityEffectiveLabel, visibilitySavePayload, visibilitySourceLabel, writeVisibilityCollapsed,
} from '../employeeCostVisibilityModel.js';
import { employeeCostGapView, gapReasonLabel } from '../employeeCostGapModel.js';
import { dataQualityTypeLabel, employeeCostDataQualityView } from '../employeeCostDataQualityModel.js';

const month = currentMonthValue();
const EMPTY = { empCode: '', from: month, to: month, periods: [], note: 'chưa có dữ liệu chi phí kỳ này' };
const moneyColumn = { kind: 'money' };
const EMPLOYEE_COST_PAGE_SIZES = [20, 50, 100];
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

function CostTable({ period, daily = false, query = '', sort = {}, onSort, allEmployees = false, onPage, onPageSize }) {
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
          {period.columns.map((column) => <th key={column.key} title={column.kind === 'percent' ? column.label : undefined} className={`${column.annual ? 'employee-cost-annual ' : ''}${column.kind === 'percent' ? 'employee-cost-percent ' : ''}${column.key === 'c16' ? 'employee-cost-sticky-product ' : ''}employee-cost-col-${column.key}`}>
            <button type="button" onClick={() => sortHeader(column)}>{column.label}{sort.key === column.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</button>
            {column.annual && <span className="employee-cost-annual-badge">cuối năm</span>}
          </th>)}
        </tr>
      </thead>
      <tbody>{rows.map((row, rowIndex) => <React.Fragment key={row.sourceLineId || rowIndex}>
        {daily && row.date !== rows[rowIndex - 1]?.date && <tr className="employee-cost-day-group">
          <td colSpan={columnCount}>
            <b>Ngày {formatEmployeeCostCell(row.date, { key: 'date', kind: 'dimension' })}</b>
            <span>Σ ngày: {formatEmployeeCostCell(totalsByDate.get(row.date)?.monthlyTotal, moneyColumn)} (chưa gồm cuối năm)</span>
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

function PeriodBlock({ period, expanded, onToggle, query, sort, onSort, allEmployees, onPage, onPageSize }) {
  const annualNote = period.summary.annualLabels.join(', ');
  const filteredCount = period.search.filteredRows;
  const totalCount = period.search.totalRows;
  return <div className="card employee-cost-panel">
    <div className="employee-cost-period-head">
      <div>
        <div className="section-head">Tháng {formatMonthLabel(period.period)}</div>
        <div className="employee-cost-panel-meta">
          Mẫu {period.template.label || 'chi phí'} · {period.dynamicCount.toLocaleString('vi-VN')} cột tỷ lệ · khớp {formatMatchRate(period.match)} ({period.match.matchedRows}/{period.match.totalRows} mã đơn vị×mặt hàng) · hiện {filteredCount.toLocaleString('vi-VN')}/{totalCount.toLocaleString('vi-VN')} dòng
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
      <CostTable period={period} query={query} sort={sort} onSort={onSort} allEmployees={allEmployees} onPage={onPage} onPageSize={onPageSize} />
      <div className="employee-cost-summary-row">
        <span>{query ? 'Tổng các dòng đang lọc' : 'Tổng chi phí tháng'} (chưa gồm khoản cuối năm)</span>
        <b>{formatEmployeeCostCell(period.summary.monthlyTotal, moneyColumn)}</b>
      </div>
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
          : <CostTable period={period} daily query={query} sort={sort} onSort={onSort} />}
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

function CostColumnKpi({ item }) {
  return <div className={`kpi employee-cost-column-kpi${item.annual ? ' employee-cost-kpi-annual' : ''}`}>
    <div className="label">
      <span>{item.label}</span>
      {item.annual && <span className="employee-cost-kpi-badge">cuối năm</span>}
    </div>
    <div className="value small">{formatEmployeeCostCell(item.value, moneyColumn)}</div>
    <div className="delta muted">{item.annual ? 'Khoản riêng · chi trả T12' : 'Tổng thành tiền theo cột'}</div>
  </div>;
}

function bonusPctLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%` : '0%';
}

function targetPctLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—';
}

function BonusKpi({ bonus }) {
  if (!bonus.configured) return <Kpi label="Thưởng dự kiến" value="Chưa cấu hình mức thưởng" sub="theo mức đạt target · tham khảo" title="App Report chỉ tính tham khảo; không gửi thưởng và không ghi payroll." />;
  const month = bonus.month;
  const quarter = bonus.quarter;
  const monthAmount = month.amount == null ? '—' : formatEmployeeCostCell(month.amount, moneyColumn);
  const quarterAmount = quarter.amount == null ? '—' : formatEmployeeCostCell(quarter.amount, moneyColumn);
  const monthContext = bonus.aggregate
    ? (month.amount == null ? 'Tháng chưa có target' : `Tổng ${month.contributors || bonus.employeeSubtotals.length} NV`)
    : month.status === 'below_tier'
      ? `đạt ${targetPctLabel(month.pct)} target · không đạt bậc · thưởng 0`
      : month.amount == null
        ? 'Tháng chưa có target'
        : `đạt ${targetPctLabel(month.pct)} target · bậc ${bonusPctLabel(month.bonusPct)}`;
  const quarterContext = bonus.quarterLabel ? `lũy kế ${bonus.quarterLabel}: ${quarterAmount}` : `lũy kế quý: ${quarterAmount}`;
  const title = bonus.aggregate
    ? `Tổng thưởng dự kiến được cộng từ từng nhân viên theo đúng bậc cá nhân. ${quarterContext}. App Report không gửi thưởng/không ghi payroll.`
    : `Tháng: ${monthAmount}; đạt ${targetPctLabel(month.pct)} target${month.tier ? ` · bậc ${bonusPctLabel(month.bonusPct)}` : ''}. Quý: ${quarterAmount}; đạt ${targetPctLabel(quarter.pct)}${quarter.tier ? ` · bậc ${bonusPctLabel(quarter.bonusPct)}` : ''}. Chỉ tham khảo, không phải số chi chính thức.`;
  return <Kpi label="Thưởng dự kiến" value={monthAmount} sub={`${monthContext} · ${quarterContext} · tham khảo`} title={title} />;
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

function GapCoverage({ coverage, remainingCodes }) {
  const rate = Math.max(0, Math.min(100, Number(coverage.rate || 0)));
  return <div className="employee-cost-gap-coverage">
    <div className="employee-cost-gap-coverage-head">
      <b>Coverage {rate.toLocaleString('vi-VN')}%</b>
      <span>{Number(coverage.matchedPairs || 0).toLocaleString('vi-VN')}/{Number(coverage.totalPairs || 0).toLocaleString('vi-VN')} cặp đã khớp · còn {remainingCodes.toLocaleString('vi-VN')} mã</span>
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
  const view = useMemo(() => employeeCostGapView(payload, filters), [payload, filters]);
  const pager = useEmployeeCostPage(view.items, JSON.stringify(filters));
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const exportFile = async (format) => {
    setExporting(format); setExportError('');
    try { await downloadEmployeeCostGaps(format, { ...range, ...filters }); }
    catch (requestError) { setExportError(requestError.message || 'Không xuất được file'); }
    finally { setExporting(''); }
  };
  return <div className="card employee-cost-gap-admin">
    <div className="employee-cost-gap-title">
      <div><div className="section-head">Gộp theo mã QLNB</div><p>Ưu tiên từ trên xuống theo doanh thu bị ảnh hưởng. Tỷ lệ và ánh xạ vẫn do DataHub cập nhật.</p></div>
      <div className="employee-cost-export-actions">
        <button type="button" className="btn" disabled={loading || !!exporting} onClick={() => exportFile('xlsx')}>{exporting === 'xlsx' ? 'Đang xuất…' : 'Xuất Excel'}</button>
        <button type="button" className="btn secondary" disabled={loading || !!exporting} onClick={() => exportFile('pdf')}>{exporting === 'pdf' ? 'Đang xuất…' : 'Xuất PDF'}</button>
      </div>
    </div>
    <div className="employee-cost-gap-filters">
      <label><span>Tìm mã/tên/đơn vị</span><input value={filters.q} onChange={(event) => setFilter('q', event.target.value)} placeholder="VD: Valgesic, Vũng Tàu…" /></label>
      <label><span>Nhân viên</span><select value={filters.employee} onChange={(event) => setFilter('employee', event.target.value)}><option value="">Tất cả</option>{view.employeeOptions.map((employee) => <option key={employee.employeeCode} value={employee.employeeCode}>{employee.employeeCode} · {employee.employeeName}</option>)}</select></label>
      <label><span>Đơn vị</span><select value={filters.unit} onChange={(event) => setFilter('unit', event.target.value)}><option value="">Tất cả</option>{view.unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
      <label><span>Lý do</span><select value={filters.reason} onChange={(event) => setFilter('reason', event.target.value)}><option value="">Tất cả</option><option value="missing">Thiếu hẳn</option><option value="qd_mismatch">Lệch mã QĐ/QLNB</option></select></label>
    </div>
    <GapCoverage coverage={view.coverage} remainingCodes={view.remainingCodes} />
    {(error || exportError) && <div className="employee-cost-match-warning" role="alert">{error || exportError}</div>}
    {loading ? <Spinner /> : !view.items.length ? <div className="center">Không có mã thiếu phù hợp bộ lọc.</div> : <>
      <EmployeeCostPager pagination={pager.pagination} onPage={pager.setPage} onPageSize={pager.setPageSize} location="top" unit="mã" />
      <div className="employee-cost-table-wrap">
      <table className="employee-cost-gap-table admin">
        <thead><tr><th>STT</th><th>Mã QLNB · tên hàng</th><th>Đơn vị ảnh hưởng</th><th>NV</th><th>Doanh thu ảnh hưởng</th><th>Lý do/gợi ý</th></tr></thead>
        <tbody>{pager.rows.map((item, index) => <tr key={item.productCode}>
          <td className="employee-cost-number">{pager.start + index + 1}</td>
          <td><b>{item.productCode}</b><small>{item.productName}</small></td>
          <td><b>{item.unitCount.toLocaleString('vi-VN')} đơn vị</b><small>{item.unitLabels.join('; ')}</small></td>
          <td>{item.employeeCodes.join(', ')}</td>
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

export default function EmployeeCost({ me }) {
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
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(admin ? 'ALL' : String(me?.emp_code || ''));
  const [draftRange, setDraftRange] = useState({ from: month, to: month });
  const [range, setRange] = useState({ from: month, to: month });
  const [payload, setPayload] = useState(EMPTY);
  const [loading, setLoading] = useState(!admin);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const [visibilityPanel, setVisibilityPanel] = useState(null);
  const [visibilityLoading, setVisibilityLoading] = useState(admin);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityMessage, setVisibilityMessage] = useState('');
  const [visibilityError, setVisibilityError] = useState('');
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
    let alive = true;
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
    })
      .then((data) => { if (alive) setPayload(data); })
      .catch((requestError) => {
        if (!alive) return;
        setPayload({ ...EMPTY, ...range });
        setError(requestError.message || 'Không thể tải dữ liệu');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [admin, selectedEmp, range, view, debouncedQuery, tableSort, tablePage, tablePageSize, tableFilters]);

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
  const selected = employees.find((employee) => employee.emp_code === selectedEmp);
  const employeeLabel = admin
    ? (selectedEmp === 'ALL' ? 'Tất cả nhân viên' : (selected ? employeeOptionLabel(selected) : 'Chưa chọn nhân viên'))
    : String(me?.emp_code || model.empCode || '—');
  const rangeInvalid = !draftRange.from || !draftRange.to || draftRange.from > draftRange.to;
  const multiple = model.periods.length > 1;
  const columnKpis = employeeCostColumnKpis(model);
  const allEmployees = admin && selectedEmp === 'ALL';
  const filteredCount = model.search.filteredRows;
  const totalTableRows = model.search.totalRows;
  const activeTableFilter = tableQuery || tableFilters.province || tableFilters.unitGroup || tableFilters.route || tableFilters.date || tableSort.key;

  const applyRange = (event) => {
    event.preventDefault();
    if (rangeInvalid) return;
    setTablePage(1);
    setTableFilters((current) => ({ ...current, date: '' }));
    setRange({ ...draftRange });
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
        <p>{admin && view === 'gaps' ? 'Danh sách chỉ phục vụ phát hiện và lập worklist cho DataHub; không tự ánh xạ mã hay tự điền tỷ lệ.' : admin && view === 'dq' ? 'Tự bắt lỗi, giải thích nguyên nhân và xếp ưu tiên theo doanh thu ảnh hưởng.' : 'Mỗi đơn × mỗi mặt hàng là một dòng. Chi phí được tính trên thành tiền xuất bán trước VAT và tra tỷ lệ theo mã hàng × tháng.'}</p>
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
        {view === 'cost' && model.filterOptions.province.available && <label>
          <span>Vùng/Tỉnh</span>
          <select value={tableFilters.province} onChange={(event) => changeTableFilter('province', event.target.value)}>
            <option value="">Tất cả Vùng/Tỉnh</option>
            {model.filterOptions.province.options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count.toLocaleString('vi-VN')})</option>)}
          </select>
        </label>}
        {view === 'cost' && <label>
          <span>Nhóm mã đơn vị</span>
          <select value={tableFilters.unitGroup} onChange={(event) => changeTableFilter('unitGroup', event.target.value)}>
            <option value="">Tất cả nhóm mã</option>
            {model.filterOptions.unitGroup.options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count.toLocaleString('vi-VN')})</option>)}
          </select>
        </label>}
        {view === 'cost' && <label>
          <span>Tuyến</span>
          <select value={tableFilters.route} onChange={(event) => changeTableFilter('route', event.target.value)}>
            <option value="">Tất cả tuyến</option>
            {model.filterOptions.route.options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count.toLocaleString('vi-VN')})</option>)}
          </select>
        </label>}
        {view === 'cost' && <label>
          <span>Ngày doanh thu</span>
          <select value={tableFilters.date} onChange={(event) => changeTableFilter('date', event.target.value)}>
            <option value="">Tất cả ngày</option>
            {model.filterOptions.date.options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count.toLocaleString('vi-VN')})</option>)}
          </select>
        </label>}
        <label><span>Từ tháng</span><input type="month" value={draftRange.from} onChange={(event) => setDraftRange((current) => ({ ...current, from: event.target.value }))} /></label>
        <label><span>Đến tháng</span><input type="month" value={draftRange.to} onChange={(event) => setDraftRange((current) => ({ ...current, to: event.target.value }))} /></label>
        <button type="submit" className="btn" disabled={rangeInvalid || (admin && view === 'gaps' ? gapLoading : admin && view === 'dq' ? dqLoading : loading)}>Xem</button>
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
      <button type="button" role="tab" aria-selected={view === 'gaps'} className={view === 'gaps' ? 'active' : ''} onClick={() => setView('gaps')}>Mặt hàng thiếu %</button>
      <button type="button" role="tab" aria-selected={view === 'dq'} className={view === 'dq' ? 'active' : ''} onClick={() => setView('dq')}>Kiểm soát dữ liệu</button>
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

    {!admin && <EmployeeGapPanel payload={gapPayload} loading={gapLoading} error={gapError} range={range} />}
    {!admin && <DataQualityPanel payload={dqPayload} loading={dqLoading} error={dqError} range={range} admin={false} onOpenRow={openDqRow} />}

    <div className="kpi-grid employee-cost-kpis">
      <Kpi label="Nhân viên" value={employeeLabel} />
      <Kpi label="Số dòng đơn hàng" value={filteredCount.toLocaleString('vi-VN')} sub={`Hiện ${filteredCount.toLocaleString('vi-VN')}/${totalTableRows.toLocaleString('vi-VN')} dòng`} />
      <Kpi label="Khớp doanh thu" value={formatMatchRate(model.match)} sub={`${model.match.matchedRows}/${model.match.totalRows} mã (đơn vị×mặt hàng) · ngưỡng ${model.match.threshold}%`} />
      <Kpi label={multiple ? 'Tổng cả kỳ (chưa gồm khoản cuối năm)' : 'Tổng chi phí tháng (chưa gồm khoản cuối năm)'} value={formatEmployeeCostCell(model.summary.periodTotal, moneyColumn)} sub={`${formatMonthLabel(model.from)} → ${formatMonthLabel(model.to)}`} />
      <Kpi label="Doanh thu chưa VAT" value={formatEmployeeCostCell(model.summary.revenueBeforeVatTotal, moneyColumn)} sub="Số tổng hợp từ backend" />
      <BonusKpi bonus={model.bonus} />
      {columnKpis.map((item) => <CostColumnKpi key={item.key} item={item} />)}
    </div>

    {allEmployees && model.bonus.configured && !!model.bonus.employeeSubtotals.length && <details className="employee-cost-subtotals employee-cost-bonus-subtotals">
      <summary>Thưởng dự kiến theo nhân viên ({model.bonus.employeeSubtotals.length}) · tham khảo</summary>
      <div>{model.bonus.employeeSubtotals.map((item) => <span key={item.empCode}>
        <b>{item.empCode} · {item.employeeName}</b>
        <small>Tháng: {formatEmployeeCostCell(item.month.amount, moneyColumn)} · đạt {targetPctLabel(item.month.pct)}{item.month.tier ? ` · bậc ${bonusPctLabel(item.month.bonusPct)}` : ' · không đạt bậc'}</small>
        <small>{model.bonus.quarterLabel || 'Quý'}: {formatEmployeeCostCell(item.quarter.amount, moneyColumn)} · đạt {targetPctLabel(item.quarter.pct)}</small>
      </span>)}</div>
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
