import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api.js';

const fmt = (value, digits = 2) => value == null || value === '' ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits });
const dateVi = (value) => {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
};
const text = (value, fallback = '—') => value == null || value === '' ? fallback : String(value);
const REVIEW_LABEL = { unplanned: 'Chưa lập kế hoạch', in_progress: 'Đang triển khai', upcoming: 'Sắp đến hạn', due: 'Đến hạn', overdue: 'Quá hạn', completed: 'Đã hoàn tất' };
const RESULT_LABEL = {
  contacted: 'Đã liên hệ đơn vị', scheduled: 'Đã lên lịch liên hệ', waiting_forecast: 'Đơn vị đang chờ dự trù',
  expected_order: 'Đơn vị dự kiến có đơn', blocked: 'Vướng thầu, cơ số hoặc hàng hóa', national_tender_forecast: 'Vướng thầu QG, sẽ xin dự trù',
  debt_blocked: 'Vướng công nợ, không giao hàng', insurance_mapping_blocked: 'Vướng ánh xạ BHYT', no_demand: 'Đơn vị đã ngưng nhu cầu',
  inactive_assignment: 'Không còn đúng người phụ trách', other: 'Lý do khác',
};

function tone(item, metric) {
  const status = String(item?.review_status || item?.action?.review_status || item?.attention?.status || '').toLowerCase();
  if (status === 'overdue' || Number(item?.days_overdue || 0) > 0) return 'danger';
  if (status === 'due' || status === 'upcoming') return 'warn';
  if (metric === 'dormant' && Number(item?.days_idle || 0) >= 60) return 'danger';
  return 'normal';
}
function metricValue(item, metric) {
  const action = item?.action || item?.current_action || {};
  if (metric === 'dormant') return `${fmt(item?.days_idle, 0)} ngày`;
  if (metric === 'cst') return fmt(item?.remain_qty, 2);
  if (metric === 'review') return REVIEW_LABEL[item?.review_status || item?.attention?.status] || dateVi(action.next_follow_up);
  return `Chu kỳ ${fmt(action.action_cycle ?? action.cycle ?? item?.action_cycle ?? 0, 0)}`;
}

function Row({ label, value }) { return <div className="dpm-detail-row"><span>{label}</span><b>{text(value)}</b></div>; }
function DetailBody({ metric, detail, item }) {
  const data = detail || item || {};
  const action = data.action || data.current_action || item?.action || {};
  if (metric === 'dormant') return <>
    <Row label="Đơn dương gần nhất" value={dateVi(data.last_positive_order_date || data.last_order_date || data.last_activity_date || data.last_activity_at)} />
    <Row label="Ngày phát hiện ngủ" value={dateVi(data.detected_date || data.dormant_detected_date || data.first_detected_at)} />
    <Row label="Ngày dữ liệu" value={dateVi(data.data_date || data.as_of || data.generated_on)} />
    <Row label="Độ chính xác" value={data.date_precision === 'month' ? 'Theo tháng tổng hợp' : data.date_precision === 'day' ? 'Theo ngày' : data.date_precision} />
  </>;
  if (metric === 'cst') return <>
    <Row label="Cơ số ban đầu" value={fmt(data.initial_qty ?? data.cst_initial_qty)} />
    <Row label="Cơ số còn lại" value={fmt(data.remain_qty ?? data.cst_remaining_qty)} />
    <Row label="Tỷ lệ còn lại" value={(data.remain_percent ?? data.remaining_percent) == null ? '—' : `${fmt(data.remain_percent ?? data.remaining_percent)}%`} />
    <Row label="Trạng thái C30" value={data.c30_status || (data.c30_available === true ? 'Có dữ liệu C30' : data.c30_available === false ? 'Chưa có dữ liệu C30' : null)} />
    {(data.c30_qty != null || data.c30_remaining_qty != null) && <Row label="Số lượng C30" value={fmt(data.c30_qty ?? data.c30_remaining_qty)} />}
  </>;
  if (metric === 'review') return <>
    <Row label="Trạng thái" value={REVIEW_LABEL[data.review_status || action.review_status || data.attention?.status] || data.review_status || action.review_status || data.attention?.status} />
    <Row label="Kết quả xử lý" value={RESULT_LABEL[action.status || data.result] || action.status || data.result} />
    <Row label="Ngày review lại" value={dateVi(action.next_follow_up || data.next_follow_up)} />
    <Row label="Số ngày đến/quá hạn" value={(data.days_overdue ?? data.attention?.days_overdue) > 0 ? `Quá hạn ${fmt(data.days_overdue ?? data.attention?.days_overdue, 0)} ngày` : (data.days_due ?? data.attention?.days_until) != null ? `${fmt(data.days_due ?? data.attention?.days_until, 0)} ngày` : '—'} />
    <Row label="Ghi chú" value={action.note || data.note} />
  </>;
  const timeline = data.audit_timeline || data.timeline || data.audit || [];
  return <>
    <Row label="Chu kỳ hành động" value={action.action_cycle ?? action.cycle ?? data.action_cycle} />
    <Row label="Chu kỳ ngủ" value={data.dormant_cycle} />
    <div className="dpm-timeline"><h4>Dòng thời gian kiểm soát</h4>{timeline.length ? timeline.map((entry, index) => <div key={entry.id || index}><time>{dateVi(entry.at || entry.date || entry.created_at)}</time><span>{text(entry.label || entry.action || entry.event || entry.type || entry.note)}</span></div>) : <p>Chưa có lịch sử kiểm soát.</p>}</div>
  </>;
}

export default function DormantPlanMetrics({ item }) {
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const closeRef = useRef(null);
  const drawerRef = useRef(null);
  const backdropRef = useRef(null);
  const openerRef = useRef(null);
  const key = item?.key || item?.id || [item?.emp_code, item?.unit_code, item?.iit_code].filter(Boolean).join('|');
  const metrics = [
    ['dormant', 'Số ngày ngủ'], ['cst', 'CST còn lại'], ['review', 'Review'], ['cycle', 'Chu kỳ xử lý'],
  ];

  async function open(metric, event) {
    openerRef.current = event.currentTarget;
    const requestId = ++requestRef.current;
    setSelected(metric); setDetail(null); setError(''); setBusy(true);
    try {
      const result = await api.dormantItemDetail(key);
      if (requestId === requestRef.current) setDetail(result?.item ? { ...result, ...result.item } : result?.detail || result);
    } catch (e) { if (requestId === requestRef.current) setError(e.message); }
    finally { if (requestId === requestRef.current) setBusy(false); }
  }
  const close = useCallback(() => {
    requestRef.current += 1; setSelected(''); setDetail(null); setBusy(false); setError('');
  }, []);
  useEffect(() => {
    if (!selected) return undefined;
    const backdrop = backdropRef.current;
    const background = [...document.body.children].filter((node) => node !== backdrop).map((node) => ({
      node,
      inert: !!node.inert,
      ariaHidden: node.getAttribute('aria-hidden'),
    }));
    background.forEach(({ node }) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });
    const focusable = () => [...(drawerRef.current?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
      .filter((node) => node.getAttribute('aria-hidden') !== 'true' && !node.closest('[inert]'));
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (!nodes.length) { event.preventDefault(); drawerRef.current?.focus(); return; }
      const first = nodes[0]; const last = nodes[nodes.length - 1]; const active = document.activeElement;
      if (event.shiftKey && (active === first || !drawerRef.current?.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !drawerRef.current?.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKey, true);
      background.forEach(({ node, inert, ariaHidden }) => {
        node.inert = inert;
        if (ariaHidden == null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', ariaHidden);
      });
      const opener = openerRef.current;
      requestAnimationFrame(() => { if (opener?.isConnected) opener.focus(); });
    };
  }, [selected, close]);

  return <>
    <div className="dpm-grid" aria-label="Chỉ số kế hoạch QLNB">
      {metrics.map(([metric, label]) => <button type="button" key={metric} className={`dpm-tile ${tone(item, metric)}`} aria-label={`${label}: ${metricValue(item, metric)}. Xem chi tiết`} onClick={(event) => open(metric, event)}><span>{label}</span><b>{metricValue(item, metric)}</b><small>Xem chi tiết</small></button>)}
    </div>
    {selected && createPortal(<div ref={backdropRef} className="dpm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={drawerRef} className="dpm-drawer" role="dialog" aria-modal="true" aria-labelledby="dpm-title" tabIndex={-1}>
        <header><div><small>CHI TIẾT QLNB</small><h3 id="dpm-title">{metrics.find(([metric]) => metric === selected)?.[1]}</h3></div><button ref={closeRef} type="button" onClick={close} aria-label="Đóng chi tiết">×</button></header>
        <div className="dpm-context"><b>{item?.product_name || item?.iit_code || 'QLNB'}</b><span>{item?.iit_code || '—'} · {item?.unit_name || item?.unit_code || '—'}</span></div>
        <div className="dpm-detail">{busy ? <p>Đang tải chi tiết…</p> : error ? <div className="dormant-error">{error}</div> : <DetailBody metric={selected} detail={detail} item={item} />}</div>
      </section>
    </div>, document.body)}
  </>;
}
