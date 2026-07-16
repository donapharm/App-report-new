// Thành phần dùng chung: loading, KPI, thanh bar, hàng danh sách.
import React from 'react';
import { formatDate, money, parseDisplayDate, pct, short, unitParts } from './util.js';

export const Spinner = () => <div className="spin" />;

// Mã/tên ngắn nổi bật; tên pháp lý đầy đủ sau dấu /, in nghiêng và không đậm.
export function UnitLabel({ code, name, className = '' }) {
  const p = unitParts(code, name);
  return (
    <span className={`unit-label${className ? ` ${className}` : ''}`}>
      <span className="unit-label-code">{p.code}</span>
      {p.name && <><span className="unit-label-sep"> / </span><span className="unit-label-full">{p.name}</span></>}
    </span>
  );
}

// Ô nhập ngày: mobile chỉ cần gõ liền 13072026, UI tự chèn thành 13/07/2026;
// dữ liệu gửi API vẫn luôn là ISO yyyy-mm-dd.
function dateInputText(value) {
  const iso = parseDisplayDate(value);
  if (!iso) return value ? formatDate(value) : '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function autoSlashDate(raw) {
  const source = String(raw || '').trim();
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const separated = source.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if (separated) {
    const [, d, m, y] = separated;
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }
  const digits = source.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
export function DateInput({ value, onChange, ariaLabel = 'Ngày', disabled = false, className = '', min = '', max = '' }) {
  const [text, setText] = React.useState(() => dateInputText(value));
  const [invalid, setInvalid] = React.useState(false);
  const pickerRef = React.useRef(null);
  const shortCommitRef = React.useRef(null);
  React.useEffect(() => { setText(dateInputText(value)); setInvalid(false); }, [value]);
  React.useEffect(() => () => clearTimeout(shortCommitRef.current), []);
  const read = (raw, commit = false) => {
    clearTimeout(shortCommitRef.current);
    const display = autoSlashDate(raw);
    setText(display);
    if (!display.trim()) { setInvalid(false); onChange(''); return; }
    const iso = parseDisplayDate(display);
    const shortYear = /^\d{2}\/\d{2}\/\d{2}$/.test(display);
    const outOfRange = !!iso && ((min && iso < min) || (max && iso > max));
    // Khi mới đủ 6 số (ddmmyy), chờ blur/Enter để người dùng vẫn có thể gõ tiếp năm 4 số.
    if (iso && !outOfRange && (!shortYear || commit)) { setInvalid(false); onChange(iso); }
    else if (iso && !outOfRange && shortYear) {
      setInvalid(false);
      // Bàn phím mobile thường chỉ nhập 6 số ddmmyy. Tự commit sau một nhịp ngắn;
      // nếu người dùng tiếp tục gõ năm 4 số thì lần gõ kế tiếp sẽ hủy timer này.
      shortCommitRef.current = setTimeout(() => onChange(iso), 900);
    }
    else if (outOfRange && (!shortYear || commit)) setInvalid(true);
    else if (commit) setInvalid(true);
  };
  const openPicker = () => {
    if (disabled) return;
    try { pickerRef.current?.showPicker?.(); } catch { pickerRef.current?.click?.(); }
  };
  return (
    <div className={`date-input-smart${invalid ? ' invalid' : ''}${className ? ` ${className}` : ''}`}>
      <input type="text" inputMode="numeric" value={text} disabled={disabled} aria-label={ariaLabel}
        placeholder="dd/mm/yyyy" pattern="[0-9/.-]*" maxLength={10} onChange={(e) => read(e.target.value)}
        onBlur={() => read(text, true)} onKeyDown={(e) => { if (e.key === 'Enter') { read(text, true); e.currentTarget.blur(); } }} />
      <button type="button" onClick={openPicker} disabled={disabled} aria-label={`Mở lịch ${ariaLabel}`} title="Chọn ngày">▣</button>
      <input ref={pickerRef} className="date-input-native" type="date" tabIndex={-1} aria-label={`Lịch ${ariaLabel}`}
        min={min || undefined} max={max || undefined} disabled={disabled}
        value={value || ''} onChange={(e) => { setInvalid(false); onChange(e.target.value); }} />
    </div>
  );
}

// Số tiền lớn: hiện GỌN to (4,76 tỷ) + số ĐẦY ĐỦ nhỏ ngay bên dưới (luôn thấy cả hai).
export function MoneyBig({ value, className }) {
  if (value == null || Number.isNaN(Number(value))) return <span>—</span>;
  return (
    <span className={'money-big' + (className ? ' ' + className : '')}>
      <b className="mb-s">{short(value)}</b>
      <span className="mb-f">{money(value)}</span>
    </span>
  );
}
export const Empty = ({ children }) => <div className="center">{children}</div>;

// Tự phát hiện "có bản mới" (server đã deploy bản khác bản đang mở) -> hiện nút cập nhật.
// Hỏi /version.json (no-cache) định kỳ + mỗi khi quay lại app. Bấm -> tải lại kèm chống cache iOS.
export function UpdateBanner() {
  const current = typeof __BUILD_VER__ !== 'undefined' ? __BUILD_VER__ : 'dev';
  const [newVer, setNewVer] = React.useState(null);
  React.useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch('/version.json?_=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (!stop && j && j.version && current !== 'dev' && j.version !== current) setNewVer(j.version);
      } catch { /* mất mạng: bỏ qua */ }
    };
    check();
    const id = setInterval(check, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [current]);
  if (!newVer) return null;
  const doUpdate = () => { try { window.location.replace(window.location.pathname + '?v=' + newVer); } catch { window.location.reload(); } };
  return (
    <button className="update-banner" onClick={doUpdate}>🔄 Có bản mới — bấm để cập nhật</button>
  );
}
/* globals __BUILD_VER__ */

// Ô xương (skeleton) khi đang tải — cảm giác nhanh hơn, không nhảy layout.
export function Skeleton({ w = '100%', h = 14, r = 6, style }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}
export function SkeletonCards({ count = 6, kpi = false }) {
  return (
    <div className={kpi ? 'kpi-grid' : 'list-grid'} aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div className="card skeleton-card" key={i}>
          <Skeleton w="55%" h={12} />
          <Skeleton w="80%" h={20} style={{ marginTop: 8 }} />
          {!kpi && <Skeleton w="100%" h={7} style={{ marginTop: 10 }} />}
        </div>
      ))}
    </div>
  );
}

// Nút "Lên đầu trang" nổi khi cuộn xuống — hoạt động cả mobile (window) lẫn desktop (.main-desktop).
export function ScrollTopButton() {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const scroller = document.querySelector('.main-desktop') || window;
    const readTop = () => (scroller === window ? window.scrollY : scroller.scrollTop);
    const onScroll = () => setShow(readTop() > 400);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  const toTop = () => {
    const scroller = document.querySelector('.main-desktop') || window;
    scroller.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return <button className="scroll-top-btn" onClick={toTop} aria-label="Lên đầu trang" title="Lên đầu trang">⬆</button>;
}

// Đồng hồ chạy giây (giờ VN) + NGÀY hiện tại — hiện ở header như bản chuẩn CEO.
export function Clock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const tz = { timeZone: 'Asia/Bangkok' };
  const time = now.toLocaleTimeString('vi-VN', { ...tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const date = formatDate(now);
  return (
    <span className="clock-pill" aria-label="Ngày giờ hiện tại">
      🕐 <span className="clock-dt"><b>{time}</b><i>{date}</i></span>
    </span>
  );
}

export function Kpi({ label, value, sub, delta, tone, variant, icon, onClick }) {
  return (
    <div className={'kpi' + (variant ? ' k-' + variant : '') + (tone ? ' ' + tone : '') + (onClick ? ' clickable' : '')} onClick={onClick}>
      {icon && <span className="kpi-ic" aria-hidden="true">{icon}</span>}
      <div className="label">{label}</div>
      <div className={'value' + (typeof value === 'string' && value.length > 12 ? ' small' : '')}>{value}</div>
      {delta != null && (
        <div className={'delta ' + (delta >= 0 ? 'up' : 'down')}>
          {delta >= 0 ? '▲' : '▼'} {pct(Math.abs(delta))} so kỳ trước
        </div>
      )}
      {sub && <div className="delta muted">{sub}</div>}
    </div>
  );
}

function dailyUpdatedLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric', hour12: false,
  });
}

// Dùng chung ở Phân tích và Tổng quan để hai màn hình luôn cùng số liệu/cách cảnh báo.
export function DailySalesKpi({ data, onClick }) {
  if (!data) return <Kpi label="Doanh số trong ngày" value="—" sub="Đang tải dữ liệu…" />;
  const tone = data.stale ? 'daily-stale' : (data.status === 'day_off' ? 'daily-day-off' : 'daily-ready');
  const updated = dailyUpdatedLabel(data.sourceUpdatedAt);
  const activate = (event) => {
    if (!onClick || (event.type === 'keydown' && !['Enter', ' '].includes(event.key))) return;
    if (event.type === 'keydown') event.preventDefault();
    onClick();
  };
  return (
    <div className={`kpi daily-sales-kpi ${tone}${onClick ? ' clickable' : ''}`} onClick={onClick ? activate : undefined} onKeyDown={onClick ? activate : undefined} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} aria-label={onClick ? 'Mở chi tiết đơn hàng của doanh số trong ngày' : undefined}>
      <span className="kpi-ic" aria-hidden="true">🗓️</span>
      <div className="label">Doanh số trong ngày</div>
      <div className="value small">{money(data.revenue || 0)}</div>
      <div className="daily-sales-date">Ngày {String(data.date || '').split('-').reverse().join('/')}</div>
      {!!data.note && <div className="daily-sales-note">{data.note}</div>}
      {!!updated && <div className="daily-sales-updated">Cập nhật lúc {updated}</div>}
      {onClick && <div className="daily-sales-open">Xem từng đơn hàng ›</div>}
    </div>
  );
}

const OFFICIAL_ZALO_QR = '/zalo-oa-qr.png';

// Nguồn QR duy nhất đã được CEO duyệt. Không sinh QR, không thay bằng mã khác.
export function OfficialZaloQr({ size = 104, className = '' }) {
  const [ok, setOk] = React.useState(true);
  const height = Math.round(size * 418 / 420);
  return ok ? (
    <img className={className} src={OFFICIAL_ZALO_QR} alt="QR chính thức Zalo OA DNPHARMA" width={size} height={height}
      style={{ width: size, height: 'auto' }} onError={() => setOk(false)} />
  ) : (
    <div className={`zalo-qr-missing${className ? ` ${className}` : ''}`} role="alert" style={{ width: size, height: size }}>
      Không tải được QR Zalo OA chính thức
    </div>
  );
}

function ZaloQrModal({ open, onClose }) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="zalo-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="zalo-modal" role="dialog" aria-modal="true" aria-label="QR Zalo OA DONAPHARM">
        <button type="button" className="zalo-modal-close" onClick={onClose} aria-label="Đóng">×</button>
        <b>Zalo OA DONAPHARM</b>
        <span>Quét mã chính thức để theo dõi và nhận hỗ trợ.</span>
        <div className="zalo-qr"><OfficialZaloQr size={220} /></div>
      </section>
    </div>
  );
}

// Thẻ QR dùng trong nội dung trang Tổng quan.
export function ZaloCard() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="card zalo-card">
        <div className="zalo-info">
          <b>Zalo OA DONAPHARM</b>
          <span>Quét mã để theo dõi Official Account — nhận thông báo &amp; hỗ trợ nhanh.</span>
        </div>
        <button type="button" className="zalo-qr zalo-card-qr" onClick={() => setOpen(true)} aria-label="Mở QR Zalo OA kích thước lớn" title="Bấm để mở QR lớn">
          <OfficialZaloQr size={64} />
        </button>
      </div>
      <ZaloQrModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Desktop: QR thật luôn hiện trong sidebar, nên tab nào cũng có.
export function ZaloSidebar() {
  return (
    <div className="side-zalo" aria-label="Zalo OA DONAPHARM">
      <b>Zalo OA DONAPHARM</b>
      <span>Quét để theo dõi</span>
      <div className="zalo-qr"><OfficialZaloQr size={74} /></div>
    </div>
  );
}

// Mobile: nút cố định dùng ảnh QR thật; mở ra mã đủ lớn để quét.
export function ZaloMobileAccess() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" className="zalo-mobile-button" onClick={() => setOpen(true)} aria-label="Mở QR Zalo OA DONAPHARM">
        <OfficialZaloQr size={32} /><span>Zalo OA</span>
      </button>
      <ZaloQrModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Dải KPI target dùng chung (Quản target · Kỳ này · Phân tích): tháng+quý+tiến độ thời gian.
export function TargetKpiStrip({ kpi }) {
  if (!kpi) return null;
  const p = kpi.pacing || {};
  const tone = (v) => (v == null ? '' : (v >= (p.time_pct || 0) ? 'ok' : 'warn'));
  return (
    <div className="kpi-grid target-kpi-row">
      <Kpi variant="blue" icon="🎯" label={`Target giao tháng ${kpi.ky}`} value={money(kpi.month.target)} sub={`${kpi.assigned_count}/${kpi.total_nv} NV đã giao`} />
      <Kpi variant="green" icon="✅" tone={tone(kpi.month.pct)} label="Đã đạt trong tháng" value={money(kpi.month.achieved)} sub={`${kpi.month.pct != null ? kpi.month.pct + '% target' : '—'} · thời gian ${p.time_pct ?? '—'}% (${p.days_elapsed}/${p.days_in_month} ngày)`} />
      <Kpi variant="purple" icon="📅" label={`Target giao quý ${kpi.quarter_label || ''}`} value={money(kpi.quarter.target)} sub={`Gồm ${(kpi.quarter_kys || []).join(', ')}`} />
      <Kpi variant="amber" icon="📈" tone={tone(kpi.quarter.pct)} label="Đã đạt trong quý" value={money(kpi.quarter.achieved)} sub={kpi.quarter.pct != null ? `${kpi.quarter.pct}% target quý` : '—'} />
    </div>
  );
}

export function Bar({ value, max, tone }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar-wrap">
      <div className={'bar-fill ' + (tone || '')} style={{ width: w + '%' }} />
    </div>
  );
}

// Đóng/mở khối lọc, nhớ lựa chọn (dùng chung 1 key -> đồng bộ mọi trang).
export function useCollapse() {
  // Mặc định ẨN bộ lọc (CEO chốt) — nhấn để mở, nhấn lại thu gọn.
  const [open, setOpen] = React.useState(false);
  const toggle = () => setOpen((v) => !v);
  return { open, toggle };
}

// Phân trang phía client cho danh sách dài. resetKey đổi -> tự về trang 1.
export function usePager(items, pageSize = 20, resetKey = '') {
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { setPage(1); }, [resetKey]);
  const total = items?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), totalPages);
  const pageItems = (items || []).slice((cur - 1) * pageSize, cur * pageSize);
  return { page: cur, setPage, totalPages, total, pageItems, startIndex: (cur - 1) * pageSize };
}

// Thanh phân trang: ‹ Trước · Trang X/Y · N mục · Sau ›
export function Pager({ page, totalPages, total, onPage, unit = 'mục', capsule = false, className = '' }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className={`pager${capsule ? ' pager-capsule' : ''}${className ? ` ${className}` : ''}`}>
      <button className="btn ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Trước</button>
      <span className="pager-info">
        {capsule && (
          <svg className="pager-capsule-mark" viewBox="0 0 42 22" aria-hidden="true">
            <path d="M11 1h10v20H11A10 10 0 0 1 11 1Z" fill="#1676bd"/>
            <path d="M21 1h10a10 10 0 0 1 0 20H21Z" fill="#f29313"/>
            <path d="M8 5c6-4 20-4 27 0" fill="none" stroke="#fff" strokeOpacity=".62" strokeWidth="2" strokeLinecap="round"/>
            <path d="M21 1v20" stroke="#fff" strokeOpacity=".82"/>
          </svg>
        )}
        <span>Trang <b>{page}</b>/{totalPages}{total != null ? ` · ${Number(total).toLocaleString('vi-VN')} ${unit}` : ''}</span>
      </span>
      <button className="btn ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Sau ›</button>
    </div>
  );
}

// Hàng xếp hạng doanh thu, có mini-bar và có thể bấm để drill-down.
export function RankRow({ i, name, meta, amount, max, onClick }) {
  return (
    <div className="row" onClick={onClick} style={onClick ? { cursor: 'pointer' } : null}>
      <div className="main">
        <div className="name"><span className="rank">{i}</span>{name}</div>
        {meta && <div className="meta">{meta}</div>}
        {max != null && <Bar value={amount} max={max} />}
      </div>
      <div className="amt">{money(amount)}{onClick ? ' ›' : ''}</div>
    </div>
  );
}
