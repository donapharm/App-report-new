import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Kpi, Spinner } from '../components.jsx';
import { employeeCostViewModel, formatEmployeeCostCell, formatMatchRate } from '../employeeCostModel.js';

const EMPTY = { empCode: '', columns: [], rows: [], note: 'chưa có dữ liệu chi phí kỳ này' };
const moneyColumn = { kind: 'money' };

export default function EmployeeCost({ me }) {
  const admin = !!me?.isAdmin;
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(admin ? '' : String(me?.emp_code || ''));
  const [payload, setPayload] = useState(EMPTY);
  const [loading, setLoading] = useState(!admin);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    api.employeeCostEmployees().then(({ employees: list = [] }) => {
      if (!alive) return;
      setEmployees(list);
      setSelectedEmp((current) => current || list[0]?.emp_code || '');
    }).catch(() => {
      if (alive) setEmployees([]);
    });
    return () => { alive = false; };
  }, [admin]);

  useEffect(() => {
    if (admin && !selectedEmp) { setPayload(EMPTY); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api.employeeCost(admin ? selectedEmp : undefined)
      .then((data) => { if (alive) setPayload(data); })
      .catch(() => { if (alive) setPayload(EMPTY); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [admin, selectedEmp]);

  const model = useMemo(() => employeeCostViewModel(payload), [payload]);
  const selected = employees.find((employee) => employee.emp_code === selectedEmp);
  const employeeLabel = admin
    ? (selected ? `${selected.emp_code} · ${selected.name}` : 'Chưa chọn nhân viên')
    : String(me?.emp_code || model.empCode || '—');
  const annualNote = model.summary.annualLabels.join(', ');

  return <section className="employee-cost-page">
    <div className="employee-cost-heading card">
      <div>
        <div className="section-head">Chi phí của tôi</div>
        <p>App Report ghép doanh thu đúng đơn vị và mã sản phẩm để tính Thành tiền. Tỷ lệ từng dòng không cộng dồn.</p>
      </div>
      {admin && <label>
        <span>Nhân viên</span>
        <select value={selectedEmp} onChange={(event) => setSelectedEmp(event.target.value)}>
          {!employees.length && <option value="">Chưa có nhân viên</option>}
          {employees.map((employee) => <option key={employee.emp_code} value={employee.emp_code}>
            {employee.emp_code} · {employee.name}
          </option>)}
        </select>
      </label>}
    </div>

    <div className="kpi-grid employee-cost-kpis">
      <Kpi label="Nhân viên" value={employeeLabel} />
      <Kpi label="Số dòng" value={model.rows.length.toLocaleString('vi-VN')} />
      <Kpi label="Khớp doanh thu" value={formatMatchRate(model.match)} sub={`${model.match.matchedRows}/${model.match.totalRows} dòng · ngưỡng ${model.match.threshold}%`} />
      <Kpi label="Tổng chi phí tháng (chưa gồm khoản cuối năm)" value={formatEmployeeCostCell(model.summary.monthlyTotal, moneyColumn)} sub={model.period || undefined} />
    </div>

    {model.match.low && <div className="employee-cost-match-warning" role="alert">
      <b>⚠ Tỷ lệ ghép doanh thu dưới {model.match.threshold}%.</b>
      {' '}Chưa hiển thị tổng tháng/cuối năm để tránh số thiếu; các dòng không khớp giữ dấu “—”. Vui lòng báo CEO/Claude rà catalog.
    </div>}

    <div className="card employee-cost-panel">
      <div className="section-head">Chi tiết theo danh mục</div>
      <div className="employee-cost-panel-meta">{model.dynamicCount.toLocaleString('vi-VN')} cột tỷ lệ đang được chia sẻ · kỳ {model.period || '—'}</div>
      {loading ? <Spinner /> : !model.rows.length ? <div className="center">{model.note}</div> : <>
        <div className="employee-cost-table-wrap">
          <table className="employee-cost-table">
            <thead>
              <tr>
                {model.dimensionColumns.map((column) => <th key={column.key} rowSpan="2">{column.label}</th>)}
                {model.costColumns.map((column) => <th key={column.key} colSpan="2" className={column.annual ? 'employee-cost-annual' : ''}>
                  {column.label} {column.annual && <span className="employee-cost-annual-badge">⏳ cuối năm</span>}
                </th>)}
              </tr>
              <tr>
                {model.costColumns.flatMap((column) => [
                  <th key={`${column.key}-percent`} className={column.annual ? 'employee-cost-annual' : ''}>Tỷ lệ (%)</th>,
                  <th key={`${column.key}-amount`} className={column.annual ? 'employee-cost-annual' : ''}>Thành tiền</th>,
                ])}
              </tr>
            </thead>
            <tbody>{model.rows.map((row, rowIndex) => <tr key={rowIndex}>
              {model.dimensionColumns.map((column) => <td key={column.key}>{formatEmployeeCostCell(row[column.key], column)}</td>)}
              {model.costColumns.flatMap((column) => [
                <td key={`${column.key}-percent`} className={`employee-cost-number${column.annual ? ' employee-cost-annual' : ''}`}>
                  {formatEmployeeCostCell(row[column.key], column)}
                </td>,
                <td key={`${column.key}-amount`} className={`employee-cost-number${column.annual ? ' employee-cost-annual' : ''}`}>
                  {formatEmployeeCostCell(row[column.amountKey], moneyColumn)}
                </td>,
              ])}
            </tr>)}</tbody>
          </table>
        </div>
        <div className="employee-cost-summary-row">
          <span>Tổng chi phí tháng (chưa gồm khoản cuối năm)</span>
          <b>{formatEmployeeCostCell(model.summary.monthlyTotal, moneyColumn)}</b>
        </div>
        {!!model.summary.annualLabels.length && <div className="employee-cost-summary-row employee-cost-annual-total">
          <span>Khoản cuối năm (tạm tính · chi trả T12)</span>
          <b>{formatEmployeeCostCell(model.summary.annualTotal, moneyColumn)}</b>
        </div>}
      </>}
      {!!model.rows.length && <div className="employee-cost-source-note">
        Thành tiền = doanh thu dòng × tỷ lệ ÷ 100; dòng không ghép được doanh thu hiển thị “—”.
        {annualNote && <> Cột {annualNote} thanh toán vào cuối năm (tháng 12), không tính vào chi phí hàng tháng.</>}
      </div>}
    </div>
  </section>;
}
