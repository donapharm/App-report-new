import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Kpi, Spinner } from '../components.jsx';
import { currentMonthValueVN, lastEndedMonthVN, paymentStartMonth, writePaymentPrefs, quickMonths, employeeCostViewModel, formatEmployeeCostCell, formatMonthLabel } from '../employeeCostModel.js';
import { PaymentSchedulePanel, PaymentTeamPanel, employeeOptionLabel } from './EmployeeCost.jsx';

const moneyColumn = { kind: 'money' };

function paymentNavigationPayload() {
  try {
    const value = JSON.parse(sessionStorage.getItem('app_nav_payload') || '{}');
    return value?.tab === 'paymentSchedule' ? value : {};
  } catch { return {}; }
}

function paymentStartStorage(link) {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(link?.period || '')) {
    return { getItem: () => JSON.stringify({ month: link.period }) };
  }
  return typeof window === 'undefined' ? null : window.localStorage;
}

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
  // ‼ F5 thì quay lại ĐÚNG THÁNG ĐANG XEM; chưa xem gì thì lấy tháng liền trước.
  // Tuyệt đối không trỏ vào tháng đang chạy — nó không bao giờ có sổ.
  const initialLink = useMemo(() => paymentNavigationPayload(), []);
  const [month, setMonth] = useState(() => paymentStartMonth(paymentStartStorage(initialLink)));
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(admin && initialLink.emp_code ? String(initialLink.emp_code).toUpperCase() : admin ? 'ALL' : String(me?.emp_code || ''));
  const [focusKey, setFocusKey] = useState(String(initialLink.key || ''));
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  // CEO chốt 04/08: cả CEO lẫn NV được chọn TỪ THÁNG → TỚI THÁNG để biết tổng cả
  // khoảng: total bao nhiêu · đã ứng bao nhiêu · còn lại bao nhiêu.
  const [rangeOn, setRangeOn] = useState(false);
  // Mặc định lùi 3 tháng để bật lên là có ý nghĩa ngay, không phải "từ T08 tới T08".
  const [rangeFrom, setRangeFrom] = useState(() => quickMonths(5)[4] || quickMonths(4)[3] || month);
  const [rangeSummary, setRangeSummary] = useState(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState('');

  useEffect(() => {
    const navigate = (event) => {
      const detail = event.detail || {};
      if (detail.tab !== 'paymentSchedule') return;
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(detail.period || '')) setMonth(detail.period);
      if (admin && detail.emp_code) setSelectedEmp(String(detail.emp_code).toUpperCase());
      setFocusKey(String(detail.key || ''));
    };
    window.addEventListener('app:navigate', navigate);
    return () => window.removeEventListener('app:navigate', navigate);
  }, [admin]);

  useEffect(() => {
    if (!admin) return;
    api.employeeCostEmployees()
      .then((data) => setEmployees(Array.isArray(data?.employees) ? data.employees : []))
      .catch(() => setEmployees([]));
  }, [admin]);

  // ‼ KỲ ĐANG CHẠY THÌ KHÔNG GỌI GÌ CẢ (CEO chốt 04/08 22:40).
  // Tháng chưa hết thì chắc chắn chưa có ứng lần 1 ⇒ không có sổ để dựng. Gọi
  // `/employee-cost` lúc này là kéo cả 21 NV từ DataHub chỉ để kết luận "chưa tới
  // lúc" — tốn tài nguyên, chậm màn, mà kết quả biết trước.
  // Qua 00:01 ngày 01 tháng sau (giờ VN) là tự gọi được, không ai phải bật gì.
  const periodEnded = month < currentMonthValueVN();

  useEffect(() => {
    if (!periodEnded) { setPayload(null); setLoading(false); setError(''); return undefined; }
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
  }, [admin, selectedEmp, month, tick, periodEnded]);

  // Nhớ tháng đang xem để lần sau F5 quay lại đúng chỗ.
  useEffect(() => {
    if (typeof window !== 'undefined') writePaymentPrefs(window.localStorage, { month });
  }, [month]);

  const model = useMemo(() => employeeCostViewModel(payload || {}), [payload]);
  const allEmployees = admin && selectedEmp === 'ALL';
  useEffect(() => {
    if (!focusKey || loading) return;
    window.requestAnimationFrame(() => document.getElementById(`payment-${focusKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [focusKey, loading, payload]);

  // Gộp khoảng chỉ có nghĩa khi đã khoá đúng MỘT nhân viên (sổ là của từng người).
  useEffect(() => {
    if (!rangeOn || allEmployees) { setRangeSummary(null); return undefined; }
    const request = new AbortController();
    const [from, to] = rangeFrom <= month ? [rangeFrom, month] : [month, rangeFrom];
    setRangeLoading(true); setRangeError('');
    api.paymentRange({ emp: admin ? selectedEmp : undefined, from, to }, { signal: request.signal })
      .then((data) => { setRangeSummary(data?.range || null); setRangeLoading(false); })
      .catch((requestError) => {
        if (request.signal.aborted) return;
        setRangeSummary(null); setRangeError(requestError.message || 'Không gộp được khoảng kỳ'); setRangeLoading(false);
      });
    return () => request.abort();
  }, [rangeOn, allEmployees, admin, selectedEmp, rangeFrom, month, tick]);

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
          {/* Roster trả về trường `name`, KHÔNG phải `emp_name` — viết sai tên trường
              thì ô chọn chỉ hiện trơ mã NV. Dùng lại đúng helper của trang Chi phí. */}
          {employees.map((employee) => <option key={employee.emp_code} value={employee.emp_code}>
            {employeeOptionLabel(employee)}
          </option>)}
        </select>}
      </div>
      <div className="employee-cost-month-quick">
        <button type="button" aria-pressed={rangeOn}
          className={`employee-cost-advanced-toggle${rangeOn ? ' active' : ''}`}
          onClick={() => setRangeOn((on) => !on)}
          title="Cộng nhiều tháng để biết tổng · đã ứng · còn lại">
          {rangeOn ? '✓ Gộp nhiều tháng' : 'Σ Gộp nhiều tháng'}
        </button>
        {/* Hiện ĐÚNG khoảng thật sự đang cộng, đã sắp xuôi. Trước đây in thẳng hai ô
            nên ra "Từ Tháng Tám 2026 · tới 07/2026" — lộn ngược, nhìn không hiểu. */}
        {rangeOn && <label><span>Từ tháng</span>
          <input type="month" value={rangeFrom} max={month}
            onChange={(event) => event.target.value && setRangeFrom(event.target.value)} />
        </label>}
        {rangeOn && <span className="employee-cost-month-chip range">
          Đang cộng {formatMonthLabel(rangeFrom <= month ? rangeFrom : month)} → {formatMonthLabel(rangeFrom <= month ? month : rangeFrom)}
        </span>}
      </div>
      {error && <div className="employee-cost-match-warning" role="alert">⛔ {error}</div>}
      {loading && !error && <Spinner />}
    </div>

    {/* Kỳ đang chạy: nói MỘT câu, không liệt kê 21 lý do giống hệt nhau. */}
    {!periodEnded && <div className="card">
      <div className="section-head">Thanh toán CP · kỳ {formatMonthLabel(month)}</div>
      <div className="employee-cost-match-warning" role="status">
        <b>Tháng {formatMonthLabel(month)} chưa kết thúc — chưa có sổ thanh toán.</b>{' '}
        Ứng lần 1 do App Salary chốt vào <b>ngày cuối tháng</b>. Từ <b>00:01 ngày 01/{
          String(Number(month.slice(5)) % 12 + 1).padStart(2, '0')}/{
          Number(month.slice(5)) === 12 ? Number(month.slice(0, 4)) + 1 : month.slice(0, 4)} (giờ VN)</b>{' '}
        bấm <b>Làm mới</b> là sổ kỳ này mở ra. Không cần làm gì thêm.
      </div>
    </div>}

    {rangeOn && <div className="card">
      <div className="section-head">Gộp nhiều kỳ
        {rangeSummary && <small>· {rangeSummary.months} kỳ</small>}
      </div>
      {allEmployees && <div className="employee-cost-match-warning" role="status">
        Gộp nhiều kỳ là sổ của <b>từng người</b> — chọn 1 nhân viên ở ô trên.
      </div>}
      {rangeError && <div className="employee-cost-match-warning" role="alert">⛔ {rangeError}</div>}
      {rangeLoading && !rangeError && <Spinner />}
      {rangeSummary && !rangeLoading && <>
        {/* Bất biến gãy thì DỪNG, không hiện số chỏi. */}
        {!rangeSummary.invariantOk && <div className="employee-cost-match-warning" role="alert">
          <b>⛔ Tổng khoảng chưa cân.</b> Đã nhận + còn lại không bằng tổng — đã dừng.
        </div>}
        <div className="kpi-grid">
          <Kpi label="Tổng chi phí cả khoảng" value={formatEmployeeCostCell(rangeSummary.total, moneyColumn)}
            sub={`${rangeSummary.months} kỳ · sau phạt`} />
          <Kpi label="Đã ứng lần 1" value={formatEmployeeCostCell(rangeSummary.firstAdvance, moneyColumn)}
            sub={rangeSummary.employeesWithoutFirstAdvance
              ? `${rangeSummary.employeesWithoutFirstAdvance} kỳ không có ứng`
              : 'App Salary duyệt cuối tháng'} tone="employee-cost-tone-base" />
          <Kpi label="Còn lại chưa nhận" value={formatEmployeeCostCell(rangeSummary.outstanding, moneyColumn)}
            sub="Lần 2 + Lần 3 cộng dồn" />
          <Kpi label="C44 · tích luỹ" value={formatEmployeeCostCell(rangeSummary.c44, moneyColumn)}
            sub="CHI T12 · KHÔNG TRONG 3 LẦN" tone="employee-cost-tone-c44" />
        </div>
        {/* ‼ Kỳ thiếu nguồn KHÔNG được cộng 0 vào tổng — phải kể tên ra. */}
        {!!rangeSummary.skipped?.length && <div className="employee-cost-match-warning" role="status">
          <b>⚠ {rangeSummary.skipped.length} kỳ chưa dựng được sổ</b> (không nằm trong tổng trên):{' '}
          {rangeSummary.skipped.map((item) => `${formatMonthLabel(item.period)} (${item.reason})`).join(' · ')}
        </div>}
      </>}
    </div>}

    {periodEnded && <PaymentSchedulePanel schedule={model.paymentSchedule} allEmployees={allEmployees} loading={loading}
      canRecord={String(me?.role || '').toLowerCase() === 'ceo'}
      empCode={admin ? selectedEmp : String(me?.emp_code || '')}
      focusKey={focusKey}
      onChanged={() => setTick((current) => current + 1)} />}
    {periodEnded && <PaymentTeamPanel team={model.paymentTeam} allEmployees={allEmployees} loading={loading} />}
  </div>;
}
