import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api.js';

const TYPE_LABEL = {
  plan_batch: 'Đã lập kế hoạch', review_upcoming: 'Sắp đến hạn review', review_due: 'Đến hạn review',
  review_overdue: 'Quá hạn review', reactivated: 'Có đơn trở lại',
};
const ACTION_LABEL = {
  contacted: 'Đã liên hệ đơn vị', scheduled: 'Đã lên lịch liên hệ', waiting_forecast: 'Đơn vị đang chờ dự trù',
  expected_order: 'Đơn vị dự kiến có đơn', blocked: 'Vướng thầu, cơ số hoặc hàng hóa',
  national_tender_forecast: 'Vướng thầu QG, sẽ xin dự trù', debt_blocked: 'Vướng công nợ, không giao hàng',
  insurance_mapping_blocked: 'Vướng ánh xạ BHYT', no_demand: 'Đơn vị đã ngưng nhu cầu',
  inactive_assignment: 'Không còn đúng người phụ trách', other: 'Lý do khác',
};
const REVIEW_LABEL = { unplanned: 'Chưa lập kế hoạch', in_progress: 'Đang triển khai', upcoming: 'Sắp đến hạn', due: 'Đến hạn', overdue: 'Quá hạn' };
const dateTime = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }) : '—';
};
const dateVi = (v) => {
  const match = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
};
const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

export default function CeoNotificationBell({ me }) {
  const [feed, setFeed] = useState({ unread_count: 0, events: [] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plans, setPlans] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planFilter, setPlanFilter] = useState({ status: 'all', query: '' });
  const planRequestRef = useRef(0);
  const isAdmin = !!me?.isAdmin;

  const refresh = async () => {
    if (!isAdmin) return;
    try { setFeed(await api.dormantNotifications()); setError(''); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => {
    if (!isAdmin) return undefined;
    refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => window.clearInterval(timer);
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const events = feed.events || [];
    return {
      danger: events.filter((x) => !x.read_at && x.severity === 'danger').length,
      due: events.filter((x) => !x.read_at && x.type === 'review_due').length,
    };
  }, [feed]);
  const visiblePlanItems = useMemo(() => (plans?.items || []).filter((item) => {
    if (planFilter.status !== 'all' && item.review_status !== planFilter.status) return false;
    const q = norm(planFilter.query).trim();
    return !q || norm([item.iit_code, item.product_name, item.action?.note, ACTION_LABEL[item.action?.status]].join(' ')).includes(q);
  }), [plans, planFilter]);
  if (!isAdmin) return null;

  async function markAll() {
    setBusy(true);
    try { await api.dormantNotificationsRead({ all: true }); await refresh(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }
  function showFeed() {
    planRequestRef.current += 1; setPlanBusy(false); setOpen(true); setPlans(null); refresh();
  }
  function closePanel() {
    planRequestRef.current += 1; setPlanBusy(false); setOpen(false);
  }
  async function openPlans({ empCode, unitCode } = {}) {
    const requestId = ++planRequestRef.current;
    setOpen(true); setPlanBusy(true); setError('');
    try {
      const result = await api.dormantAdminPlans({ ...(empCode ? { emp_code: empCode } : {}), ...(unitCode ? { unit_code: unitCode } : {}) });
      if (requestId !== planRequestRef.current) return;
      setPlans(result); setPlanFilter({ status: 'all', query: '' });
    } catch (e) {
      if (requestId === planRequestRef.current) setError(e.message);
    } finally {
      if (requestId === planRequestRef.current) setPlanBusy(false);
    }
  }

  return <>
    <button type="button" className={`ceo-bell${counts.danger ? ' danger' : ''}`} title="Thông báo QLNB cho CEO" aria-label={`Thông báo QLNB, ${feed.unread_count || 0} chưa đọc`} onClick={showFeed}>
      <span>🔔</span>{feed.unread_count > 0 && <b>{feed.unread_count > 99 ? '99+' : feed.unread_count}</b>}
    </button>
    {open && createPortal(<div className="ceo-notif-backdrop" role="dialog" aria-modal="true" aria-label="Quản lý QLNB cho CEO" onMouseDown={(e) => { if (e.target === e.currentTarget) closePanel(); }}>
      <section className={`ceo-notif-panel${plans ? ' plan-detail' : ''}`}>
        <header>
          <div><span>AI QLNB · CEO</span><h2>{plans ? 'Kế hoạch chi tiết nhân viên' : 'Thông báo cần chú ý'}</h2></div>
          <button type="button" className="ceo-notif-close" onClick={closePanel}>×</button>
        </header>
        {!plans ? <>
          <div className="ceo-notif-summary">
            <span><em>Chưa đọc</em><b>{feed.unread_count || 0}</b></span>
            <span className="warn"><em>Đến hạn</em><b>{counts.due}</b></span>
            <span className="danger"><em>Quá hạn</em><b>{counts.danger}</b></span>
          </div>
          <div className="ceo-notif-tools"><small>Cập nhật tự động mỗi phút · chỉ trong App Report</small><div><button type="button" className="primary" onClick={() => openPlans({})}>Xem toàn bộ kế hoạch</button><button type="button" disabled={busy || !feed.unread_count} onClick={markAll}>{busy ? 'Đang lưu…' : 'Đánh dấu đã đọc'}</button></div></div>
          {error && <div className="dormant-error">{error}</div>}
          <div className="ceo-notif-list">
            {(feed.events || []).length === 0 && <div className="empty">Chưa có thông báo QLNB.</div>}
            {(feed.events || []).map((event) => <article key={event.id} className={`${event.severity || 'info'}${event.read_at ? ' read' : ''}`}>
              <i>{event.type === 'reactivated' ? '✅' : event.type === 'review_overdue' ? '🚨' : event.type === 'review_due' ? '⏰' : event.type === 'review_upcoming' ? '🕒' : '📋'}</i>
              <div><div className="ceo-notif-meta"><b>{TYPE_LABEL[event.type] || 'Thông báo'}</b><time>{dateTime(event.at)}</time></div><strong>{event.title}</strong><p>{event.message}</p><small>{event.emp_code || '—'} · Mã đơn vị {event.unit_code || '—'}{event.qlnb_codes?.length ? ` · ${event.qlnb_codes.length} QLNB` : ''}{event.cycle ? ` · Chu kỳ ${event.cycle}` : ''}</small>{event.emp_code && event.unit_code && <button type="button" className="ceo-plan-open" onClick={() => openPlans({ empCode: event.emp_code, unitCode: event.unit_code })}>Xem kế hoạch chi tiết →</button>}</div>
            </article>)}
          </div>
        </> : <>
          <div className="ceo-plan-nav"><button type="button" onClick={showFeed}>← Thông báo</button><small>Dữ liệu đến {dateVi(plans.as_of)} · CEO xem toàn bộ, nhân viên chịu trách nhiệm cập nhật</small></div>
          <div className="ceo-plan-filters">
            <label><span>Nhân viên</span><select value={plans.selected_emp_code || ''} onChange={(e) => openPlans({ empCode: e.target.value })}>{(plans.employees || []).map((item) => <option key={item.emp_code} value={item.emp_code}>{item.emp_code} · {item.employee_name} · {item.total} QLNB</option>)}</select></label>
            <label><span>Mã đơn vị</span><select value={plans.selected_unit_code || ''} onChange={(e) => openPlans({ empCode: plans.selected_emp_code, unitCode: e.target.value })}>{(plans.units || []).map((item) => <option key={item.unit_code} value={item.unit_code}>{item.unit_code} · {item.unit_name} · {item.total}</option>)}</select></label>
            <label><span>Trạng thái review</span><select value={planFilter.status} onChange={(e) => setPlanFilter((value) => ({ ...value, status: e.target.value }))}><option value="all">Tất cả</option>{Object.entries(REVIEW_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Tìm QLNB/thuốc/ghi chú</span><input value={planFilter.query} onChange={(e) => setPlanFilter((value) => ({ ...value, query: e.target.value }))} placeholder="Nhập từ khóa…" /></label>
          </div>
          <div className="ceo-plan-kpis">
            <span><em>Tổng QLNB</em><b>{plans.selected_summary?.total || 0}</b></span><span><em>Chưa kế hoạch</em><b>{plans.selected_summary?.unplanned || 0}</b></span><span className="warn"><em>Đến hạn</em><b>{plans.selected_summary?.due || 0}</b></span><span className="danger"><em>Quá hạn</em><b>{plans.selected_summary?.overdue || 0}</b></span>
          </div>
          {error && <div className="dormant-error">{error}</div>}
          {planBusy ? <div className="empty">Đang tải kế hoạch…</div> : <div className="ceo-plan-list">
            {!visiblePlanItems.length && <div className="empty">Không có QLNB phù hợp bộ lọc.</div>}
            {visiblePlanItems.map((item) => <article key={item.key} className={item.review_status}>
              <div className="ceo-plan-item-head"><div><b>{item.product_name || item.iit_code}</b><code>{item.iit_code}</code></div><strong>{REVIEW_LABEL[item.review_status] || item.review_status}</strong></div>
              <div className="ceo-plan-item-facts"><span>Ngủ <b>{item.days_idle || 0} ngày</b></span><span>CST còn <b>{item.remain_qty == null ? '—' : Number(item.remain_qty).toLocaleString('vi-VN')}</b></span><span>Review <b>{dateVi(item.action?.next_follow_up)}</b></span><span>Chu kỳ <b>{item.action?.cycle || 0}</b></span></div>
              <p><b>Kết quả:</b> {ACTION_LABEL[item.action?.status] || 'Chưa lập kế hoạch'}</p><p><b>Ghi chú:</b> {item.action?.note || '—'}</p>
            </article>)}
          </div>}
        </>}
      </section>
    </div>, document.body)}
  </>;
}
