import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Kpi, Spinner } from '../components.jsx';
import {
  currentMonthValue, employeeCostViewModel, formatEmployeeCostCell, formatMatchRate, formatMonthLabel,
} from '../employeeCostModel.js';
import {
  normalizeVisibilityPanel, updateVisibilitySetting, visibilityEffectiveLabel, visibilitySavePayload, visibilitySourceLabel,
} from '../employeeCostVisibilityModel.js';

const month = currentMonthValue();
const EMPTY = { empCode: '', from: month, to: month, periods: [], note: 'chưa có dữ liệu chi phí kỳ này' };
const moneyColumn = { kind: 'money' };
const employeeOptionLabel = (employee) => `${employee.emp_code} · ${employee.name}${employee.group_key && employee.group_key !== 'sale' ? ` · ${employee.group_label}` : ''}`;

function CostTable({ period, daily = false }) {
  const rows = daily ? period.daily.rows : period.rows;
  const columnCount = period.dimensionColumns.length + period.costColumns.length * 2;
  const totalsByDate = new Map((period.daily.totals || []).map((total) => [total.date, total]));
  return <div className="employee-cost-table-wrap">
    <table className="employee-cost-table">
      <thead>
        <tr>
          {period.dimensionColumns.map((column) => <th key={column.key} rowSpan="2">{column.label}</th>)}
          {period.costColumns.map((column) => <th key={column.key} colSpan="2" className={column.annual ? 'employee-cost-annual' : ''}>
            {column.label} {column.annual && <span className="employee-cost-annual-badge">⏳ cuối năm</span>}
          </th>)}
        </tr>
        <tr>
          {period.costColumns.flatMap((column) => [
            <th key={`${column.key}-percent`} className={column.annual ? 'employee-cost-annual' : ''}>Tỷ lệ (%)</th>,
            <th key={`${column.key}-amount`} className={column.annual ? 'employee-cost-annual' : ''}>Thành tiền</th>,
          ])}
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
          {period.dimensionColumns.map((column) => <td key={column.key}>{formatEmployeeCostCell(row[column.key], column)}</td>)}
          {period.costColumns.flatMap((column) => [
            <td key={`${column.key}-percent`} className={`employee-cost-number${column.annual ? ' employee-cost-annual' : ''}`}>
              {formatEmployeeCostCell(row[column.key], column)}
            </td>,
            <td key={`${column.key}-amount`} className={`employee-cost-number${column.annual ? ' employee-cost-annual' : ''}`}>
              {formatEmployeeCostCell(row[column.amountKey], moneyColumn)}
            </td>,
          ])}
        </tr>
      </React.Fragment>)}</tbody>
    </table>
  </div>;
}

function PeriodBlock({ period, expanded, onToggle }) {
  const annualNote = period.summary.annualLabels.join(', ');
  return <div className="card employee-cost-panel">
    <div className="employee-cost-period-head">
      <div>
        <div className="section-head">Tháng {formatMonthLabel(period.period)}</div>
        <div className="employee-cost-panel-meta">
          {period.dynamicCount.toLocaleString('vi-VN')} cột tỷ lệ · khớp {formatMatchRate(period.match)} ({period.match.matchedRows}/{period.match.totalRows} dòng)
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

    {!period.rows.length ? <div className="center">{period.note}</div> : <>
      <CostTable period={period} />
      <div className="employee-cost-summary-row">
        <span>Tổng chi phí tháng (chưa gồm khoản cuối năm)</span>
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
          : <CostTable period={period} daily />}
    </div>}

    {!!period.rows.length && <div className="employee-cost-source-note">
      Thành tiền = doanh thu dòng × tỷ lệ ÷ 100; dòng/ngày không ghép được doanh thu hiển thị “—”.
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

function VisibilityPanel({ panel, loading, saving, message, error, onChange, onSave }) {
  return <div className="card employee-cost-visibility">
    <div className="employee-cost-visibility-head">
      <div>
        <div className="section-head">Quản trị quyền tự xem chi phí</div>
        <p>Cá nhân ưu tiên hơn nhóm; nhóm ưu tiên hơn toàn phòng. Quyền hiệu lực do backend quyết định.</p>
      </div>
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
  </div>;
}

export default function EmployeeCost({ me }) {
  const admin = !!me?.isAdmin;
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(admin ? '' : String(me?.emp_code || ''));
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

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    setVisibilityLoading(true);
    api.employeeCostVisibility().then((data) => {
      if (!alive) return;
      const panel = normalizeVisibilityPanel(data);
      setVisibilityPanel(panel);
      setEmployees(panel.employees);
      setSelectedEmp((current) => current || panel.employees[0]?.emp_code || '');
    }).catch((requestError) => {
      if (!alive) return;
      setEmployees([]);
      setVisibilityError(requestError.message || 'Không thể tải cấu hình công tắc');
    }).finally(() => { if (alive) setVisibilityLoading(false); });
    return () => { alive = false; };
  }, [admin]);

  useEffect(() => {
    if (admin && !selectedEmp) { setPayload(EMPTY); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    setError('');
    setExpanded({});
    api.employeeCost(admin ? selectedEmp : undefined, range)
      .then((data) => { if (alive) setPayload(data); })
      .catch((requestError) => {
        if (!alive) return;
        setPayload({ ...EMPTY, ...range });
        setError(requestError.message || 'Không thể tải dữ liệu');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [admin, selectedEmp, range]);

  const model = useMemo(() => employeeCostViewModel(payload), [payload]);
  const selected = employees.find((employee) => employee.emp_code === selectedEmp);
  const employeeLabel = admin
    ? (selected ? employeeOptionLabel(selected) : 'Chưa chọn nhân viên')
    : String(me?.emp_code || model.empCode || '—');
  const rangeInvalid = !draftRange.from || !draftRange.to || draftRange.from > draftRange.to;
  const multiple = model.periods.length > 1;

  const applyRange = (event) => {
    event.preventDefault();
    if (rangeInvalid) return;
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

  if (!admin && payload.disabled) return <section className="employee-cost-page">
    <div className="card center">{payload.note || 'Chức năng chi phí đang tắt cho bạn.'}</div>
  </section>;

  return <section className="employee-cost-page">
    <div className="employee-cost-heading card">
      <div>
        <div className="section-head">Chi phí của tôi</div>
        <p>Mỗi đơn × mỗi mặt hàng là một dòng. App Report giữ nguyên doanh thu giao dịch và tra tỷ lệ theo mã hàng × tháng.</p>
      </div>
      <form className="employee-cost-filters" onSubmit={applyRange}>
        {admin && <label>
          <span>Nhân viên</span>
          <select value={selectedEmp} onChange={(event) => setSelectedEmp(event.target.value)}>
            {!employees.length && <option value="">Chưa có nhân viên</option>}
            {employees.map((employee) => <option key={employee.emp_code} value={employee.emp_code}>
              {employeeOptionLabel(employee)}
            </option>)}
          </select>
        </label>}
        <label><span>Từ tháng</span><input type="month" value={draftRange.from} onChange={(event) => setDraftRange((current) => ({ ...current, from: event.target.value }))} /></label>
        <label><span>Đến tháng</span><input type="month" value={draftRange.to} onChange={(event) => setDraftRange((current) => ({ ...current, to: event.target.value }))} /></label>
        <button type="submit" className="btn" disabled={rangeInvalid || loading}>Xem</button>
        {rangeInvalid && <small role="alert">Từ tháng không được sau Đến tháng.</small>}
      </form>
    </div>

    {admin && <VisibilityPanel
      panel={visibilityPanel}
      loading={visibilityLoading}
      saving={visibilitySaving}
      message={visibilityMessage}
      error={visibilityError}
      onChange={changeVisibility}
      onSave={saveVisibility}
    />}

    <div className="kpi-grid employee-cost-kpis">
      <Kpi label="Nhân viên" value={employeeLabel} />
      <Kpi label="Số dòng" value={model.rows.length.toLocaleString('vi-VN')} />
      <Kpi label="Khớp doanh thu" value={formatMatchRate(model.match)} sub={`${model.match.matchedRows}/${model.match.totalRows} dòng · ngưỡng ${model.match.threshold}%`} />
      <Kpi label={multiple ? 'Tổng cả kỳ (chưa gồm khoản cuối năm)' : 'Tổng chi phí tháng (chưa gồm khoản cuối năm)'} value={formatEmployeeCostCell(model.summary.periodTotal, moneyColumn)} sub={`${formatMonthLabel(model.from)} → ${formatMonthLabel(model.to)}`} />
    </div>

    {error && <div className="employee-cost-match-warning" role="alert">{error}</div>}
    {loading ? <div className="card"><Spinner /></div> : !model.periods.length ? <div className="card center">{model.note}</div> : <>
      {model.periods.map((period) => <PeriodBlock
        key={period.period}
        period={period}
        expanded={!!expanded[period.period]}
        onToggle={() => setExpanded((current) => ({ ...current, [period.period]: !current[period.period] }))}
      />)}
      {multiple && <div className="card employee-cost-range-total">
        <span>Tổng cả kỳ (chưa gồm khoản cuối năm)</span>
        <b>{formatEmployeeCostCell(model.summary.periodTotal, moneyColumn)}</b>
      </div>}
    </>}
  </section>;
}
