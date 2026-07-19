import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api.js';
import DormantPlanMetrics from './DormantPlanMetrics.jsx';

const TYPE_LABEL = {
  dormant_detected: 'QLNB mới cần xử lý', plan_batch: 'Đã lập kế hoạch', ceo_feedback: 'CEO vừa phản hồi',
  review_upcoming: 'Sắp đến hạn review', review_due: 'Đến hạn review', review_overdue: 'Quá hạn review', reactivated: 'Có đơn trở lại',
};
const ACTION_LABEL = {
  contacted: 'Đã liên hệ đơn vị', scheduled: 'Đã lên lịch liên hệ', waiting_forecast: 'Đơn vị đang chờ dự trù',
  expected_order: 'Đơn vị dự kiến có đơn', blocked: 'Vướng thầu, cơ số hoặc hàng hóa',
  national_tender_forecast: 'Vướng thầu QG, sẽ xin dự trù', debt_blocked: 'Vướng công nợ, không giao hàng',
  insurance_mapping_blocked: 'Vướng ánh xạ BHYT', no_demand: 'Đơn vị đã ngưng nhu cầu',
  inactive_assignment: 'Không còn đúng người phụ trách', other: 'Lý do khác',
};
const REVIEW_LABEL = { unplanned: 'Chưa lập kế hoạch', in_progress: 'Đang triển khai', upcoming: 'Sắp đến hạn', due: 'Đến hạn', overdue: 'Quá hạn' };
const FEEDBACK_OPTIONS = [
  ['approved', 'Duyệt kế hoạch'], ['revise', 'Yêu cầu điều chỉnh'], ['priority', 'Ưu tiên xử lý'],
  ['continue_follow_up', 'Tiếp tục theo dõi'], ['close_tracking', 'Đóng theo dõi'], ['other', 'Ý kiến khác'],
];
const dateTime = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }) : '—';
};
const dateVi = (v) => {
  const match = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
};
const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const requestId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const iconFor = (event) => event.type === 'reactivated' ? '✅' : event.type === 'ceo_feedback' ? '💬' : event.type === 'review_overdue' ? '🚨' : event.type === 'review_due' ? '⏰' : event.type === 'review_upcoming' ? '🕒' : '📋';

function FeedbackComposer({ item, onSaved }) {
  const [type, setType] = useState('approved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const cycle = Number(item.action?.action_cycle ?? item.action?.cycle ?? 0);
  const canReply = !!item.action?.status && cycle > 0;

  async function submit() {
    if (!canReply || busy) return;
    setBusy(true); setError(''); setPreview(null);
    try {
      const feedback = await api.dormantFeedbackCreate({ key: item.key, action_cycle: cycle, type, note: note.trim(), request_id: requestId('ceo-feedback') });
      const telegram = await api.dormantFeedbackTelegramPreview(feedback.id);
      setPreview(telegram); setNote('');
      await onSaved?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <div className="ceo-feedback-box">
    <div className="ceo-feedback-head"><b>Phản hồi đúng Chu kỳ xử lý {cycle || '—'}</b><small>Lịch sử bất biến · không phải chat</small></div>
    {!canReply ? <p className="ceo-feedback-disabled">Nhân viên chưa gửi kế hoạch nên CEO chưa thể phản hồi.</p> : <div className="ceo-feedback-form">
      <select aria-label="Loại phản hồi CEO" value={type} onChange={(e) => setType(e.target.value)}>{FEEDBACK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <textarea rows="2" maxLength="240" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ý kiến ngắn, không nhập số hoặc thông tin tài chính nhạy cảm" />
      <button type="button" className="primary" disabled={busy} onClick={submit}>{busy ? 'Đang lưu…' : 'Lưu phản hồi'}</button>
    </div>}
    {error && <div className="dormant-error">{error}</div>}
    {preview && <div className={`telegram-preview-state ${preview.status}`}><b>Telegram chỉ preview · gửi thật đang tắt</b><span>{preview.status === 'blocked' ? `Đã chặn: ${preview.blocked_reason}` : `Người nhận ${preview.recipient_masked}`}</span><code>{String(preview.manifest_digest || '').slice(0, 16)}…</code></div>}
    {!!item.ceo_feedback?.length && <div className="ceo-feedback-history">{item.ceo_feedback.slice().reverse().map((feedback) => <div key={feedback.id}><b>{feedback.label}</b><span>{dateTime(feedback.created_at)}</span>{feedback.note && <p>{feedback.note}</p>}<small>Chu kỳ xử lý {feedback.action_cycle} · {feedback.acknowledgements?.some((ack) => ack.kind === 'updated') ? 'NV đã cập nhật' : feedback.acknowledgements?.length ? 'NV đã đọc' : 'Chưa xác nhận'}</small></div>)}</div>}
  </div>;
}

export default function CeoNotificationBell({ me, onNavigate }) {
  const [feed, setFeed] = useState({ unread_count: 0, events: [] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plans, setPlans] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planFilter, setPlanFilter] = useState({ status: 'all', query: '' });
  const planRequestRef = useRef(0);
  const bellRef = useRef(null);
  const panelRef = useRef(null);
  const isCeo = String(me?.role || '').toLowerCase() === 'ceo' || String(me?.emp_code || '').toUpperCase() === 'CEO';
  const isEmployee = !me?.isAdmin && !!String(me?.emp_code || '').trim() && !isCeo;
  const eligible = isCeo || isEmployee;

  const refresh = async () => {
    if (!eligible) return;
    try { setFeed(await (isCeo ? api.dormantNotifications() : api.dormantEmployeeNotifications())); setError(''); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => {
    if (!eligible) return undefined;
    refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => window.clearInterval(timer);
  }, [eligible, isCeo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const focusable = () => [...(panelRef.current?.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') || [])]
      .filter((element) => element.getClientRects().length > 0);
    window.requestAnimationFrame(() => (focusable()[0] || panelRef.current)?.focus());
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); panelRef.current?.focus(); return; }
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener?.isConnected) opener.focus();
      else bellRef.current?.focus();
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const events = feed.events || [];
    return {
      danger: events.filter((x) => !x.read_at && x.severity === 'danger').length,
      due: events.filter((x) => !x.read_at && x.type === 'review_due').length,
      feedback: events.filter((x) => !x.read_at && x.type === 'ceo_feedback').length,
    };
  }, [feed]);
  const groupedEvents = useMemo(() => {
    const groups = new Map();
    for (const event of feed.events || []) {
      const key = event.unit_code || 'unknown';
      if (!groups.has(key)) groups.set(key, { unit_code: key, unit_name: event.unit_name || key, events: [] });
      groups.get(key).events.push(event);
    }
    return [...groups.values()];
  }, [feed]);
  const visiblePlanItems = useMemo(() => (plans?.items || []).filter((item) => {
    if (planFilter.status !== 'all' && item.review_status !== planFilter.status) return false;
    const q = norm(planFilter.query).trim();
    return !q || norm([item.iit_code, item.product_name, item.action?.note, ACTION_LABEL[item.action?.status]].join(' ')).includes(q);
  }), [plans, planFilter]);
  if (!eligible) return null;

  async function markAll() {
    setBusy(true);
    try {
      await (isCeo ? api.dormantNotificationsRead({ all: true }) : api.dormantEmployeeNotificationsRead({ all: true }));
      await refresh();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function openEvent(event) {
    if (!isCeo) {
      try { await api.dormantEmployeeNotificationsRead({ ids: [event.id] }); } catch { /* navigation must still work */ }
      const payload = { focus_key: event.target?.item_key || event.item_keys?.[0], unit_code: event.target?.unit_code || event.unit_code };
      setOpen(false); await refresh();
      if (onNavigate) onNavigate('dormantReports', payload);
      else {
        const url = new URL(window.location.href); url.searchParams.set('tab', 'dormantReports'); url.searchParams.set('focus_key', payload.focus_key || ''); window.location.assign(url.toString());
      }
    } else openPlans({ empCode: event.emp_code, unitCode: event.unit_code });
  }
  function showFeed() { planRequestRef.current += 1; setPlanBusy(false); setOpen(true); setPlans(null); refresh(); }
  function closePanel() { planRequestRef.current += 1; setPlanBusy(false); setOpen(false); }
  async function openPlans({ empCode, unitCode } = {}) {
    if (!isCeo) return;
    const id = ++planRequestRef.current;
    setOpen(true); setPlanBusy(true); setError('');
    try {
      const result = await api.dormantAdminPlans({ ...(empCode ? { emp_code: empCode } : {}), ...(unitCode ? { unit_code: unitCode } : {}) });
      if (id !== planRequestRef.current) return;
      setPlans(result); setPlanFilter({ status: 'all', query: '' });
    } catch (e) { if (id === planRequestRef.current) setError(e.message); }
    finally { if (id === planRequestRef.current) setPlanBusy(false); }
  }

  return <>
    <button ref={bellRef} type="button" className={`ceo-bell${counts.danger ? ' danger' : ''}`} title={isCeo ? 'Thông báo QLNB cho CEO' : 'Thông báo QLNB của tôi'} aria-label={`Thông báo QLNB, ${feed.unread_count || 0} chưa đọc`} onClick={showFeed}>
      <span>🔔</span>{feed.unread_count > 0 && <b>{feed.unread_count > 99 ? '99+' : feed.unread_count}</b>}
    </button>
    {open && createPortal(<div className="ceo-notif-backdrop" role="dialog" aria-modal="true" aria-labelledby="qlnb-notification-title" onMouseDown={(e) => { if (e.target === e.currentTarget) closePanel(); }}>
      <section ref={panelRef} tabIndex={-1} className={`ceo-notif-panel${plans ? ' plan-detail' : ''}`}>
        <header><div><span>AI QLNB · {isCeo ? 'CEO' : me.emp_code}</span><h2 id="qlnb-notification-title">{plans ? 'Kế hoạch chi tiết nhân viên' : isCeo ? 'Thông báo cần chú ý' : 'Việc QLNB của tôi'}</h2></div><button type="button" className="ceo-notif-close" aria-label="Đóng thông báo QLNB" onClick={closePanel}>×</button></header>
        {!plans ? <>
          <div className="ceo-notif-summary"><span><em>Chưa đọc</em><b>{feed.unread_count || 0}</b></span><span className="warn"><em>{isCeo ? 'Đến hạn' : 'CEO phản hồi'}</em><b>{isCeo ? counts.due : counts.feedback}</b></span><span className="danger"><em>Khẩn / quá hạn</em><b>{counts.danger}</b></span></div>
          <div className="ceo-notif-tools"><small>Cập nhật mỗi phút · server tự ép đúng phạm vi</small><div>{isCeo && <button type="button" className="primary" onClick={() => openPlans({})}>Xem toàn bộ kế hoạch</button>}<button type="button" disabled={busy || !feed.unread_count} onClick={markAll}>{busy ? 'Đang lưu…' : 'Đánh dấu đã đọc'}</button></div></div>
          {error && <div className="dormant-error">{error}</div>}
          <div className="ceo-notif-list grouped">
            {!groupedEvents.length && <div className="empty">Chưa có thông báo QLNB.</div>}
            {groupedEvents.map((group) => <section className="ceo-notif-unit" key={group.unit_code}><h3>{group.unit_code} · {group.unit_name}<span>{group.events.length}</span></h3>{group.events.map((event) => <article key={event.id} className={`${event.severity || 'info'}${event.read_at ? ' read' : ''}`}>
              <i>{iconFor(event)}</i><div><div className="ceo-notif-meta"><b>{TYPE_LABEL[event.type] || 'Thông báo'}</b><time>{dateTime(event.at)}</time></div><strong>{event.title}</strong><p>{event.message}</p><small>{event.emp_code || '—'} · {event.qlnb_codes?.[0] || 'QLNB'}{event.action_cycle ? ` · Chu kỳ xử lý ${event.action_cycle}` : ''}</small>{event.escalation?.preview_only && <span className="notif-escalation">Chỉ preview · {event.escalation.unresolved_3_business_days ? 'chưa xử lý sau ba ngày làm việc' : 'chưa đọc sau một ngày'}</span>}<button type="button" className="ceo-plan-open" onClick={() => openEvent(event)}>{isCeo ? 'Xem kế hoạch chi tiết →' : 'Mở đúng QLNB →'}</button></div>
            </article>)}</section>)}
          </div>
        </> : <>
          <div className="ceo-plan-nav"><button type="button" onClick={showFeed}>← Thông báo</button><small>Dữ liệu đến {dateVi(plans.as_of)} · CEO phản hồi có cấu trúc, nhân viên xác nhận đã đọc/đã cập nhật</small></div>
          <div className="ceo-plan-filters">
            <label><span>Nhân viên</span><select value={plans.selected_emp_code || ''} onChange={(e) => openPlans({ empCode: e.target.value })}>{(plans.employees || []).map((item) => <option key={item.emp_code} value={item.emp_code}>{item.emp_code} · {item.employee_name} · {item.total} QLNB</option>)}</select></label>
            <label><span>Mã đơn vị</span><select value={plans.selected_unit_code || ''} onChange={(e) => openPlans({ empCode: plans.selected_emp_code, unitCode: e.target.value })}>{(plans.units || []).map((item) => <option key={item.unit_code} value={item.unit_code}>{item.unit_code} · {item.unit_name} · {item.total}</option>)}</select></label>
            <label><span>Trạng thái review</span><select value={planFilter.status} onChange={(e) => setPlanFilter((value) => ({ ...value, status: e.target.value }))}><option value="all">Tất cả</option>{Object.entries(REVIEW_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Tìm QLNB/thuốc/ghi chú</span><input value={planFilter.query} onChange={(e) => setPlanFilter((value) => ({ ...value, query: e.target.value }))} placeholder="Nhập từ khóa…" /></label>
          </div>
          <div className="ceo-plan-kpis"><span><em>Tổng QLNB</em><b>{plans.selected_summary?.total || 0}</b></span><span><em>Chưa kế hoạch</em><b>{plans.selected_summary?.unplanned || 0}</b></span><span className="warn"><em>Đến hạn</em><b>{plans.selected_summary?.due || 0}</b></span><span className="danger"><em>Quá hạn</em><b>{plans.selected_summary?.overdue || 0}</b></span></div>
          {error && <div className="dormant-error">{error}</div>}
          {planBusy ? <div className="empty">Đang tải kế hoạch…</div> : <div className="ceo-plan-list">
            {!visiblePlanItems.length && <div className="empty">Không có QLNB phù hợp bộ lọc.</div>}
            {visiblePlanItems.map((item) => <article key={item.key} className={item.review_status}>
              <div className="ceo-plan-item-head"><div><b>{item.product_name || item.iit_code}</b><code>{item.iit_code}</code></div><strong>{REVIEW_LABEL[item.review_status] || item.review_status}</strong></div>
              <DormantPlanMetrics item={item} />
              <p><b>Kết quả:</b> {ACTION_LABEL[item.action?.status] || 'Chưa lập kế hoạch'}</p><p><b>Ghi chú:</b> {item.action?.note || '—'}</p>
              <FeedbackComposer item={item} onSaved={() => openPlans({ empCode: plans.selected_emp_code, unitCode: plans.selected_unit_code })} />
            </article>)}
          </div>}
        </>}
      </section>
    </div>, document.body)}
  </>;
}
