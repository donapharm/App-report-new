import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Kpi, Spinner } from '../components.jsx';
import {
  currentMonthValue, employeeCostViewModel, formatEmployeeCostCell, formatMatchRate, formatMonthLabel,
} from '../employeeCostModel.js';

const month = currentMonthValue();
const EMPTY = { empCode: '', from: month, to: month, periods: [], note: 'chưa có dữ liệu chi phí kỳ này' };
const moneyColumn = { kind: 'money' };
const dateLabel = (value) => String(value || '').split('-').reverse().join('/');

function CostTable({ period, daily = false }) {
  const rows = daily ? period.daily.rows : period.rows;
  return <div className="employee-cost-table-wrap">
    <table className="employee-cost-table">
      <thead>
        <tr>
          {daily && <th rowSpan="2">Ngày</th>}
          {period.dimensionColumns.map((column) => <th key={column.key} rowSpan="2">{column.label}</th>)}
          {period.costColumns.map((column) => <th key={column.key} colSpan="2" className={column.annual ? 'employee-cost-annual' : ''}>
            {column.label} {column.annual && <span className="employee-cost-annual-badge">⏳ cuối năm</span>}
          </th>)}
          {daily && <th rowSpan="2">Tổng ngày<br /><small>chưa gồm cuối năm</small></th>}
        </tr>
        <tr>
          {period.costColumns.flatMap((column) => [
            <th key={`${column.key}-percent`} className={column.annual ? 'employee-cost-annual' : ''}>Tỷ lệ (%)</th>,
            <th key={`${column.key}-amount`} className={column.annual ? 'employee-cost-annual' : ''}>Thành tiền</th>,
          ])}
        </tr>
      </thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={daily ? `${row.date}-${row.rowIndex}` : rowIndex}>
        {daily && <td className="employee-cost-date">{dateLabel(row.date)}</td>}
        {period.dimensionColumns.map((column) => <td key={column.key}>{formatEmployeeCostCell(row[column.key], column)}</td>)}
        {period.costColumns.flatMap((column) => [
          <td key={`${column.key}-percent`} className={`employee-cost-number${column.annual ? ' employee-cost-annual' : ''}`}>
            {formatEmployeeCostCell(row[column.key], column)}
          </td>,
          <td key={`${column.key}-amount`} className={`employee-cost-number${column.annual ? ' employee-cost-annual' : ''}`}>
            {formatEmployeeCostCell(row[column.amountKey], moneyColumn)}
          </td>,
        ])}
        {daily && <td className="employee-cost-number"><b>{formatEmployeeCostCell(row.monthlyTotal, moneyColumn)}</b></td>}
      </tr>)}</tbody>
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

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    api.employeeCostEmployees().then(({ employees: list = [] }) => {
      if (!alive) return;
      setEmployees(list);
      setSelectedEmp((current) => current || list[0]?.emp_code || '');
    }).catch(() => { if (alive) setEmployees([]); });
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
    ? (selected ? `${selected.emp_code} · ${selected.name}` : 'Chưa chọn nhân viên')
    : String(me?.emp_code || model.empCode || '—');
  const rangeInvalid = !draftRange.from || !draftRange.to || draftRange.from > draftRange.to;
  const multiple = model.periods.length > 1;

  const applyRange = (event) => {
    event.preventDefault();
    if (rangeInvalid) return;
    setRange({ ...draftRange });
  };

  return <section className="employee-cost-page">
    <div className="employee-cost-heading card">
      <div>
        <div className="section-head">Chi phí của tôi</div>
        <p>App Report ghép doanh thu đúng từng kỳ, đơn vị và mã sản phẩm. Tỷ lệ từng dòng không cộng dồn.</p>
      </div>
      <form className="employee-cost-filters" onSubmit={applyRange}>
        {admin && <label>
          <span>Nhân viên</span>
          <select value={selectedEmp} onChange={(event) => setSelectedEmp(event.target.value)}>
            {!employees.length && <option value="">Chưa có nhân viên</option>}
            {employees.map((employee) => <option key={employee.emp_code} value={employee.emp_code}>
              {employee.emp_code} · {employee.name}
            </option>)}
          </select>
        </label>}
        <label><span>Từ tháng</span><input type="month" value={draftRange.from} onChange={(event) => setDraftRange((current) => ({ ...current, from: event.target.value }))} /></label>
        <label><span>Đến tháng</span><input type="month" value={draftRange.to} onChange={(event) => setDraftRange((current) => ({ ...current, to: event.target.value }))} /></label>
        <button type="submit" className="btn" disabled={rangeInvalid || loading}>Xem</button>
        {rangeInvalid && <small role="alert">Từ tháng không được sau Đến tháng.</small>}
      </form>
    </div>

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
