import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Kpi, Spinner } from '../components.jsx';
import { employeeCostViewModel, formatEmployeeCostCell } from '../employeeCostModel.js';

const EMPTY = { empCode: '', columns: [], rows: [], note: 'chưa có dữ liệu chi phí kỳ này' };

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

  return <section className="employee-cost-page">
    <div className="employee-cost-heading card">
      <div>
        <div className="section-head">Chi phí của tôi</div>
        <p>Số liệu do DataHub cung cấp theo từng dòng; App Report chỉ hiển thị, không tự tính. Các tỷ lệ không cộng hoặc tính trung bình.</p>
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
      <Kpi label="Cột chi phí được chia sẻ" value={model.dynamicCount.toLocaleString('vi-VN')} />
      <Kpi label="Dữ liệu hiện có" value={model.hasMoney ? 'Theo metadata nguồn' : 'Tỷ lệ từng dòng (%)'} />
    </div>

    <div className="card employee-cost-panel">
      <div className="section-head">Chi tiết theo danh mục</div>
      {loading ? <Spinner /> : !model.rows.length ? <div className="center">{model.note}</div> : <div className="employee-cost-table-wrap">
        <table className="employee-cost-table">
          <thead><tr>{model.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>{model.rows.map((row, rowIndex) => <tr key={rowIndex}>
            {model.columns.map((column) => <td key={column.key} className={column.kind !== 'dimension' ? 'employee-cost-number' : ''}>
              {formatEmployeeCostCell(row[column.key], column)}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>}
      {!!model.rows.length && !model.hasMoney && <div className="employee-cost-source-note">Nguồn hiện chỉ cung cấp tỷ lệ %. Không có số tiền trong hợp đồng dữ liệu hiện tại.</div>}
    </div>
  </section>;
}
