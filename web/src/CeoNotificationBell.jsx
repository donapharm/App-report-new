import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api.js';

const TYPE_LABEL = {
  plan_batch: 'Đã lập kế hoạch',
  review_upcoming: 'Sắp đến hạn review',
  review_due: 'Đến hạn review',
  review_overdue: 'Quá hạn review',
  reactivated: 'Có đơn trở lại',
};
const dateTime = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }) : '—';
};

export default function CeoNotificationBell({ me }) {
  const [feed, setFeed] = useState({ unread_count: 0, events: [] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
  if (!isAdmin) return null;

  async function markAll() {
    setBusy(true);
    try { await api.dormantNotificationsRead({ all: true }); await refresh(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }

  return <>
    <button type="button" className={`ceo-bell${counts.danger ? ' danger' : ''}`} title="Thông báo QLNB cho CEO" aria-label={`Thông báo QLNB, ${feed.unread_count || 0} chưa đọc`} onClick={() => { setOpen(true); refresh(); }}>
      <span>🔔</span>{feed.unread_count > 0 && <b>{feed.unread_count > 99 ? '99+' : feed.unread_count}</b>}
    </button>
    {open && createPortal(<div className="ceo-notif-backdrop" role="dialog" aria-modal="true" aria-label="Thông báo QLNB cho CEO" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="ceo-notif-panel">
        <header>
          <div><span>AI QLNB · CEO</span><h2>Thông báo cần chú ý</h2></div>
          <button type="button" className="ceo-notif-close" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="ceo-notif-summary">
          <span><em>Chưa đọc</em><b>{feed.unread_count || 0}</b></span>
          <span className="warn"><em>Đến hạn</em><b>{counts.due}</b></span>
          <span className="danger"><em>Quá hạn</em><b>{counts.danger}</b></span>
        </div>
        <div className="ceo-notif-tools"><small>Cập nhật tự động mỗi phút · chỉ trong App Report</small><button type="button" disabled={busy || !feed.unread_count} onClick={markAll}>{busy ? 'Đang lưu…' : 'Đánh dấu đã đọc'}</button></div>
        {error && <div className="dormant-error">{error}</div>}
        <div className="ceo-notif-list">
          {(feed.events || []).length === 0 && <div className="empty">Chưa có thông báo QLNB.</div>}
          {(feed.events || []).map((event) => <article key={event.id} className={`${event.severity || 'info'}${event.read_at ? ' read' : ''}`}>
            <i>{event.type === 'reactivated' ? '✅' : event.type === 'review_overdue' ? '🚨' : event.type === 'review_due' ? '⏰' : event.type === 'review_upcoming' ? '🕒' : '📋'}</i>
            <div><div className="ceo-notif-meta"><b>{TYPE_LABEL[event.type] || 'Thông báo'}</b><time>{dateTime(event.at)}</time></div><strong>{event.title}</strong><p>{event.message}</p><small>{event.emp_code || '—'} · Mã đơn vị {event.unit_code || '—'}{event.qlnb_codes?.length ? ` · ${event.qlnb_codes.length} QLNB` : ''}{event.cycle ? ` · Chu kỳ ${event.cycle}` : ''}</small></div>
          </article>)}
        </div>
      </section>
    </div>, document.body)}
  </>;
}
