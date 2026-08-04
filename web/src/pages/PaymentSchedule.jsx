import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Spinner } from '../components.jsx';
import { currentMonthValueVN, quickMonths, employeeCostViewModel, formatMonthLabel } from '../employeeCostModel.js';
import { PaymentSchedulePanel, PaymentTeamPanel } from './EmployeeCost.jsx';

/**
 * MENU RIÊNG "Thanh toán CP của tôi" — CEO báo 04/08: mở app không tìm thấy mục này.
 *
 * Lý do cũ: sổ thanh toán chỉ là một khối nằm lẫn trong trang "Chi phí của tôi", lại
 * còn tự ẩn khi đang ở chế độ "Tất cả NV" (chính là chế độ mặc định của CEO) ⇒ CEO
 * bấm khắp nơi không thấy đâu. Nay tách hẳn thành menu riêng, tìm là ra.
 *
 * Trang này KHÔNG tính lại gì cả — dùng đúng hai khối của trang Chi phí (một bản
 * dựng duy nhất), tránh vụ hai nơi hiển thị lệch nhau như KPI/badge hồi 03/08.
 */
export default function PaymentSchedule({ me, desktop }) {
  const admin = !!me?.isAdmin;
  const [month, setMonth] = useState(currentMonthValueVN());
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(admin ? 'ALL' : String(me?.emp_code || ''));
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!admin) return;
    api.employeeCostEmployees()
      .then((data) => setEmployees(Array.isArray(data?.employees) ? data.employees : []))
      .catch(() => setEmployees([]));
  }, [admin]);

  useEffect(() => {
    const request = new AbortController();
    setLoading(true); setError('');
    api.employeeCost(admin ? selectedEmp : undefined, { from: month, to: month }, { signal: request.signal })
      .then((data) => { setPayload(data); setLoading(false); })
      .catch((requestError) => {
        if (request.signal.aborted) return;
        // Hỏng nguồn thì NÓI HỎNG, không dựng sổ rỗng trông như đã trả hết tiền.
        setPayload(null); setError(requestError.message || 'Không lấy được sổ thanh toán'); setLoading(false);
      });
    return () => request.abort();
  }, [admin, selectedEmp, month, tick]);

  const model = useMemo(() => employeeCostViewModel(payload || {}), [payload]);
  const allEmployees = admin && selectedEmp === 'ALL';

  return <div className={desktop ? 'page-desktop' : ''}>
    <div className="card">
      <div className="section-head">Thanh toán CP của tôi <small>· kỳ {formatMonthLabel(month)}</small></div>
      <div className="employee-cost-month-quick" role="group" aria-label="Chọn tháng nhanh">
        {quickMonths(4).map((value) => <button key={value} type="button" aria-pressed={value === month}
          className={`employee-cost-month-chip${value === month ? ' active' : ''}`}
          onClick={() => setMonth(value)}>T{formatMonthLabel(value).replace('/', '.')}</button>)}
        <input type="month" value={month} aria-label="Chọn tháng khác"
          onChange={(event) => event.target.value && setMonth(event.target.value)} />
        {admin && <select value={selectedEmp} aria-label="Chọn nhân viên"
          onChange={(event) => setSelectedEmp(event.target.value)}>
          <option value="ALL">Tất cả NV</option>
          {employees.map((employee) => <option key={employee.emp_code} value={employee.emp_code}>
            {employee.emp_code} — {employee.emp_name || ''}
          </option>)}
        </select>}
      </div>
      {error && <div className="employee-cost-match-warning" role="alert">⛔ {error}</div>}
      {loading && !error && <Spinner />}
    </div>

    <PaymentSchedulePanel schedule={model.paymentSchedule} allEmployees={allEmployees} loading={loading}
      canRecord={String(me?.role || '').toLowerCase() === 'ceo'}
      empCode={admin ? selectedEmp : String(me?.emp_code || '')}
      onChanged={() => setTick((current) => current + 1)} />
    <PaymentTeamPanel team={model.paymentTeam} allEmployees={allEmployees} loading={loading} />
  </div>;
}
