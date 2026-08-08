import React, { useEffect, useRef, useState } from 'react';
import { api, forgetLastPhone, getLastPhone, getToken, rememberLastPhone, setToken } from './api.js';
import { roleLabel } from './util.js';
import { isTabAllowed, resolveAllowedTab } from './tabAccess.js';
import { useIsDesktop } from './hooks.js';
import { Spinner, ScrollTopButton, Clock, UpdateBanner, ZaloSidebar, ZaloMobileAccess } from './components.jsx';
import { NavCtx } from './drillNav.jsx';
import Logo from './logo.jsx';
import DormantGate from './DormantGate.jsx';
import CeoNotificationBell from './CeoNotificationBell.jsx';
import { PrivacyEyeButton } from './privacy.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Revenue from './pages/Revenue.jsx';
import RevenueFull from './pages/RevenueFull.jsx';
import Products from './pages/Products.jsx';
import Analysis from './pages/Analysis.jsx';
import DailySalesOrders from './pages/DailySalesOrders.jsx';
import TenderQuota from './pages/TenderQuota.jsx';
import Target from './pages/Target.jsx';
import EmployeeCost from './pages/EmployeeCost.jsx';
import PaymentSchedule from './pages/PaymentSchedule.jsx';
import CatalogManagement from './pages/CatalogManagement.jsx';
import SyncExceptions from './pages/SyncExceptions.jsx';
import DormantReports from './pages/DormantReports.jsx';
import AiChat from './pages/AiChat.jsx';
import Upload from './pages/Upload.jsx';

const TABS = [
  { key: 'overview', label: 'Tổng quan', ic: '📊', C: Overview },
  { key: 'revenue', label: 'Doanh thu', ic: '💰', C: Revenue },
  { key: 'revenueFull', label: 'DT đầy đủ', full: 'Doanh thu đầy đủ', ic: '📋', C: RevenueFull },
  { key: 'products', label: 'Sản phẩm', ic: '💊', C: Products },
  { key: 'analysis', label: 'Phân tích', ic: '📈', C: Analysis },
  { key: 'dailySales', label: 'Doanh số ngày', full: 'Chi tiết doanh số trong ngày', ic: '🗓️', C: DailySalesOrders, hidden: true },
  { key: 'cst', label: 'Cơ số thầu', ic: '📦', C: TenderQuota },
  { key: 'target', label: 'Target', ic: '🎯', C: Target },
  { key: 'employeeCost', label: 'Chi phí của tôi', ic: '🧾', C: EmployeeCost, employeeCostControlled: true },
  { key: 'paymentSchedule', label: 'Thanh toán CP', full: 'Thanh toán CP của tôi', ic: '💵', C: PaymentSchedule, employeeCostControlled: true },
  { key: 'catalogManagement', label: 'Danh mục QL', full: 'Danh mục quản lý', ic: '🗂️', C: CatalogManagement },
  { key: 'syncExceptions', label: 'Chưa đồng bộ', full: 'Dòng doanh thu chưa đồng bộ', ic: '↔️', C: SyncExceptions, adminOnly: true },
  { key: 'dormantReports', label: 'B/c QLNB', full: 'Báo cáo QLNB', ic: '📑', C: DormantReports, ceoEmployeeOnly: true },
  { key: 'ai', label: 'Hỏi nhanh', ic: '🤖', C: AiChat },
  { key: 'upload', label: 'Upload', ic: '⬆️', C: Upload, adminOnly: true },
];

const HOME_URL = 'https://home.donapharm.asia';
const MOBILE_PRIMARY_TAB_KEYS = ['overview', 'revenue', 'employeeCost', 'target'];
const RELOAD_TICK_TAB_KEYS = new Set(['overview', 'revenue', 'revenueFull', 'products', 'analysis', 'dailySales', 'cst', 'target']);

function normalizeMenuSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function HomeButton() {
  return (
    <button
      type="button"
      className="home-button"
      aria-label="Trở về Home DONAPHARM"
      title="Trở về Home DONAPHARM"
      onClick={() => window.location.assign(HOME_URL)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 10.8 12 3l9 7.8" />
        <path d="M5.4 9.8V21h13.2V9.8" />
        <path d="M9.3 21v-6.5h5.4V21" />
      </svg>
    </button>
  );
}

function RefreshButton({ loading, onClick }) {
  return (
    <button
      type="button"
      className={`refresh-button${loading ? ' is-loading' : ''}`}
      aria-label={loading ? 'Đang tải lại dữ liệu trang hiện tại' : 'Tải lại dữ liệu trang hiện tại'}
      aria-busy={loading}
      disabled={loading}
      onClick={onClick}
    >
      <span className="refresh-button-ic" aria-hidden="true">↻</span>
      <span>{loading ? 'Đang tải…' : 'Làm mới'}</span>
    </button>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState('');
  const [tab, setTab] = useState(() => {
    try {
      const linked = new URLSearchParams(window.location.search).get('tab');
      if (TABS.some((item) => item.key === linked)) return linked;
      const stored = localStorage.getItem('rpt_tab');
      return TABS.some((item) => item.key === stored) ? stored : 'overview';
    } catch { return 'overview'; }
  });
  const [tabStack, setTabStack] = useState([]); // các tab đã đi qua, để nút "Quay lại" lùi về
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileMenuQuery, setMobileMenuQuery] = useState('');
  const [headerReloadBusy, setHeaderReloadBusy] = useState(false);
  const [fallbackReloadTick, setFallbackReloadTick] = useState(0);
  const desktop = useIsDesktop();
  const reloadNoRequestRef = useRef(null);
  const reloadMaxRef = useRef(null);
  const headerReloadBusyRef = useRef(false);
  const headerReloadStartedRef = useRef(false);
  const mobileMenuSearchRef = useRef(null);

  useEffect(() => {
    let alive = true;
    async function restoreTrustedDevice() {
      const phone = getLastPhone();
      if (!phone) return false;
      try {
        const result = await api.trustedDeviceLogin(phone);
        setToken(result.token);
        const current = await api.me();
        if (alive) setMe(current);
        return true;
      } catch (error) {
        // App Sale không tin cậy, bridge thiếu config hoặc upstream lỗi: rơi về OTP bình thường.
        // Nếu phiên mới đã cấp nhưng /me gặp lỗi mạng/5xx thì giữ token và hiện
        // trạng thái kết nối lại, không mở màn OTP gây hiểu nhầm.
        if (alive && getToken() && error?.status !== 401 && error?.status !== 403) {
          setBootError('App Report đang kết nối lại máy chủ. Phiên đăng nhập vẫn được giữ.');
        }
        return false;
      }
    }
    async function bootstrap() {
      try {
        if (!getToken()) {
          await restoreTrustedDevice();
          return;
        }
        try {
          const current = await api.me();
          // Migration thiết bị cũ: phiên OTP còn hợp lệ đã chứng minh đúng số điện
          // thoại. Ghi nhớ số để lần mở kế tiếp có thể thử device-login trước OTP.
          if (current?.method === 'otp' && current?.phone) rememberLastPhone(current.phone);
          if (alive) setMe(current);
        } catch (error) {
          if (error?.status === 401 || error?.status === 403) {
            setToken(null);
            await restoreTrustedDevice();
          } else if (alive && getToken()) {
            // Lỗi mạng/5xx không được phá phiên rolling rồi ép người dùng nhập OTP.
            setBootError('App Report đang kết nối lại máy chủ. Phiên đăng nhập vẫn được giữ.');
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    bootstrap();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!me) return;
    const initialTab = resolveAllowedTab(TABS, tab, me);
    window.history.replaceState({ ...(window.history.state || {}), appTab: initialTab }, '', window.location.href);
    const onPop = (event) => {
      if (!event.state?.appTab) return;
      const targetTab = resolveAllowedTab(TABS, event.state.appTab, me);
      setTab(targetTab);
      setTabStack((stack) => stack.slice(0, -1));
      try { localStorage.setItem('rpt_tab', targetTab); } catch { /* ignore */ }
      if (targetTab !== event.state.appTab) {
        window.history.replaceState({ ...(event.state || {}), appTab: targetTab }, '', window.location.href);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!me) return;
    const allowedTab = resolveAllowedTab(TABS, tab, me);
    if (allowedTab === tab) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === tab) url.searchParams.delete('tab');
    try { localStorage.setItem('rpt_tab', allowedTab); } catch { /* ignore */ }
    setTabStack([]);
    setTab(allowedTab);
    window.history.replaceState({ ...(window.history.state || {}), appTab: allowedTab }, '', url);
  }, [me, tab]);

  useEffect(() => {
    if (!me) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') !== 'dormantReports' || !params.get('focus_key')) return;
    if (!isTabAllowed(TABS.find((item) => item.key === 'dormantReports'), me)) return;
    const payload = { tab: 'dormantReports', focus_key: params.get('focus_key'), unit_code: params.get('unit_code') || '', ts: Date.now() };
    try { sessionStorage.setItem('app_nav_payload', JSON.stringify(payload)); localStorage.setItem('rpt_tab', 'dormantReports'); } catch { /* ignore */ }
    setTab('dormantReports');
  }, [me]);

  // #6 Mini-header: cuộn xuống thì thu nhỏ banner (mobile). Desktop cuộn ở .main-desktop nên window.scrollY=0 -> không ảnh hưởng.
  useEffect(() => {
    if (!me) return;
    const onScroll = () => { document.documentElement.classList.toggle('hdr-mini', (window.scrollY || 0) > 48); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); document.documentElement.classList.remove('hdr-mini'); };
  }, [me]);

  useEffect(() => {
    if (!me || me.isAdmin || !me.employeeCostDisabled || tab !== 'employeeCost') return;
    try { localStorage.setItem('rpt_tab', 'overview'); } catch { /* ignore */ }
    setTab('overview');
  }, [me, tab]);

  useEffect(() => {
    document.documentElement.classList.toggle('products-mode', !!me && tab === 'products');
    return () => document.documentElement.classList.remove('products-mode');
  }, [me, tab]);

  useEffect(() => {
    document.documentElement.classList.toggle('catalog-mode', !!me && tab === 'catalogManagement');
    return () => document.documentElement.classList.remove('catalog-mode');
  }, [me, tab]);

  useEffect(() => {
    const finishHeaderReload = () => {
      headerReloadBusyRef.current = false;
      headerReloadStartedRef.current = false;
      window.clearTimeout(reloadNoRequestRef.current);
      window.clearTimeout(reloadMaxRef.current);
      setHeaderReloadBusy(false);
    };
    const onRequestState = (event) => {
      if (!headerReloadBusyRef.current) return;
      const detail = event?.detail || {};
      if (detail.phase === 'start') {
        headerReloadStartedRef.current = true;
        window.clearTimeout(reloadNoRequestRef.current);
      }
      if (detail.phase === 'end' && headerReloadStartedRef.current && Number(detail.active || 0) === 0) finishHeaderReload();
    };
    window.addEventListener('app:request-state', onRequestState);
    return () => window.removeEventListener('app:request-state', onRequestState);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(reloadNoRequestRef.current);
    window.clearTimeout(reloadMaxRef.current);
  }, []);

  useEffect(() => {
    if (desktop && mobileMenuOpen) {
      setMobileMenuOpen(false);
      setMobileMenuQuery('');
    }
  }, [desktop, mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
      setMobileMenuQuery('');
    }
  }, [tab]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        setMobileMenuQuery('');
      }
    };
    document.body.classList.add('nav-sheet-open');
    const rafId = window.requestAnimationFrame(() => mobileMenuSearchRef.current?.focus());
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('nav-sheet-open');
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileMenuOpen]);

  if (loading) return <Spinner />;
  if (!me && bootError && getToken()) return (
    <div className="login">
      <div className="card" style={{ maxWidth: 460, margin: '12vh auto 0' }}>
        <h2>Đang kết nối lại App Report</h2>
        <p>{bootError}</p>
        <button className="btn" onClick={() => window.location.reload()}>Thử lại</button>
      </div>
    </div>
  );
  if (!me) return <Login onLogin={setMe} />;

  const logout = () => { setToken(null); forgetLastPhone(); setMe(null); setTab('overview'); setTabStack([]); try { localStorage.removeItem('rpt_tab'); } catch { /* ignore */ } };
  // Backend chốt ai là CEO (`/me` trả `is_ceo`). Frontend KHÔNG tự đoán từ chuỗi role:
  // tài khoản CEO thật trên PROD có role 'admin', đoán bằng role là giấu mất chức năng.
  const tabs = TABS.filter((item) => isTabAllowed(item, me)).map((t) => (
    t.key === 'catalogManagement' && !me.isAdmin
      ? { ...t, label: 'Danh mục bán hàng của tôi', full: 'Danh mục bán hàng của tôi' }
      : t
  ));
  const revenueOnly = me.access_profile === 'revenue_only';
  const visibleTabs = tabs.filter((t) => !t.hidden);
  const mobilePrimaryTabs = MOBILE_PRIMARY_TAB_KEYS.map((key) => visibleTabs.find((t) => t.key === key)).filter(Boolean);
  const normalizedMenuQuery = normalizeMenuSearch(mobileMenuQuery);
  const mobileMenuTabs = visibleTabs.filter((t) => {
    if (!normalizedMenuQuery) return true;
    return normalizeMenuSearch(`${t.label} ${t.full || ''} ${t.key}`).includes(normalizedMenuQuery);
  });
  const Active = (tabs.find((t) => t.key === tab) || tabs[0]).C;
  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    setMobileMenuQuery('');
  };
  const switchTab = (targetTab, payload = {}, mode = 'push') => {
    const allowedTarget = resolveAllowedTab(TABS, targetTab, me, revenueOnly ? 'revenue' : 'overview');
    const allowedPayload = allowedTarget === targetTab ? payload : {};
    try { sessionStorage.setItem('app_nav_payload', JSON.stringify({ tab: allowedTarget, ...allowedPayload, ts: Date.now() })); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tab: allowedTarget, ...allowedPayload } }));
    try { localStorage.setItem('rpt_tab', allowedTarget); } catch { /* ignore */ }
    if (mode === 'push' && allowedTarget !== tab) setTabStack((s) => [...s, tab]);
    setTab(allowedTarget);
    if (mode === 'push') window.history.pushState({ appTab: allowedTarget, appPayload: allowedPayload }, '', window.location.href);
    else window.history.replaceState({ ...(window.history.state || {}), appTab: allowedTarget, appPayload: allowedPayload }, '', window.location.href);
  };
  const navigate = (targetTab, payload = {}) => switchTab(targetTab, payload, 'push');
  const navBack = { back: () => window.history.back(), canBack: tabStack.length > 0 };
  const triggerHeaderReload = () => {
    headerReloadBusyRef.current = true;
    headerReloadStartedRef.current = false;
    setHeaderReloadBusy(true);
    window.clearTimeout(reloadNoRequestRef.current);
    window.clearTimeout(reloadMaxRef.current);
    reloadNoRequestRef.current = window.setTimeout(() => {
      if (!headerReloadStartedRef.current) {
        headerReloadBusyRef.current = false;
        window.clearTimeout(reloadMaxRef.current);
        setHeaderReloadBusy(false);
      }
    }, 800);
    reloadMaxRef.current = window.setTimeout(() => {
      headerReloadBusyRef.current = false;
      headerReloadStartedRef.current = false;
      setHeaderReloadBusy(false);
    }, 15_000);
    if (RELOAD_TICK_TAB_KEYS.has(tab)) {
      window.dispatchEvent(new CustomEvent('app:reload-active-tab', { detail: { tab, ts: Date.now() } }));
    } else {
      setFallbackReloadTick((tick) => tick + 1);
    }
  };

  // ---------- Desktop: sidebar dashboard ----------
  if (desktop) {
    return (
      <div className="shell-desktop">
        <aside className="sidebar">
          <div className="side-logo"><Logo size={42} /></div>
          <nav className="side-nav">
            {visibleTabs.map((t) => (
              <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => switchTab(t.key)}>
                <span className="ic">{t.ic}</span> {t.label}
              </button>
            ))}
          </nav>
          {!revenueOnly && <ZaloSidebar />}
          <div className="side-user">
            <div className="avatar">{me.name?.[0] || '?'}</div>
            <div style={{ minWidth: 0 }}>
              <div className="nm">{me.name}</div>
              <div className="rl">{roleLabel(me.role)}</div>
            </div>
            <button className="logout" onClick={logout}>Thoát</button>
          </div>
        </aside>
        <div className="main-desktop">
          <header className="topbar">
            <div>
              <h1>{(() => { const t = tabs.find((x) => x.key === tab); return t?.full || t?.label; })()}</h1>
              <div className="sub">DONAPHARM · Báo cáo doanh thu thông minh</div>
            </div>
            <div className="topbar-actions">
              {!revenueOnly && <CeoNotificationBell me={me} onNavigate={navigate} />}
              <PrivacyEyeButton />
              <RefreshButton loading={headerReloadBusy} onClick={triggerHeaderReload} />
              <HomeButton />
              <Clock />
            </div>
          </header>
          <main className={`page-desktop ${tab === 'catalogManagement' ? 'page-desktop-wide' : ''}`}>
            <NavCtx.Provider value={navBack}><Active key={RELOAD_TICK_TAB_KEYS.has(tab) ? tab : `${tab}:${fallbackReloadTick}`} me={me} desktop onNavigate={navigate} /></NavCtx.Provider>
          </main>
          <ScrollTopButton />
          <UpdateBanner />
          {!revenueOnly && <DormantGate me={me} tab={tab} />}
        </div>
      </div>
    );
  }

  // ---------- Mobile: header + bottom nav ----------
  return (
    <>
      <header className="hdr">
        <div className="hdr-r1">
          <Logo size={24} />
          <div className="hdr-who-actions">
            <div className="who">
              <div className="who-name">{me.name}</div>
              <div className="who-role">{roleLabel(me.role)}</div>
            </div>
            {!revenueOnly && <CeoNotificationBell me={me} onNavigate={navigate} />}
          </div>
        </div>
        <div className="hdr-r2">
          <Clock />
          <div className="hdr-actions">
            <PrivacyEyeButton />
            <RefreshButton loading={headerReloadBusy} onClick={triggerHeaderReload} />
            <HomeButton />
            <button className="logout" onClick={logout}>Đăng xuất</button>
          </div>
        </div>
      </header>
      <main className="page">
        <NavCtx.Provider value={navBack}><Active key={RELOAD_TICK_TAB_KEYS.has(tab) ? tab : `${tab}:${fallbackReloadTick}`} me={me} onNavigate={navigate} /></NavCtx.Provider>
      </main>
      <ScrollTopButton />
      <UpdateBanner />
      {!revenueOnly && <DormantGate me={me} tab={tab} />}
      {!revenueOnly && !['catalogManagement', 'dailySales', 'products', 'dormantReports', 'employeeCost'].includes(tab) && <ZaloMobileAccess />}
      {mobileMenuOpen && <div
        className="mobile-nav-sheet-backdrop"
        onClick={(event) => { if (event.target === event.currentTarget) closeMobileMenu(); }}
      >
        <section id="mobile-nav-sheet" className="mobile-nav-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-nav-sheet-title">
          <header className="mobile-nav-sheet-head">
            <div>
              <span>Đi đến nhanh</span>
              <h2 id="mobile-nav-sheet-title">Toàn bộ menu App Report</h2>
            </div>
            <button type="button" className="mobile-nav-sheet-close" aria-label="Đóng menu" onClick={closeMobileMenu}>×</button>
          </header>
          <div className="mobile-nav-sheet-body">
            <label className="mobile-nav-search">
              <span className="sr-only">Tìm mục trong menu App Report</span>
              <input
                ref={mobileMenuSearchRef}
                type="search"
                value={mobileMenuQuery}
                onChange={(event) => setMobileMenuQuery(event.target.value)}
                placeholder="Tìm mục báo cáo..."
                aria-label="Tìm mục trong menu App Report"
              />
            </label>
            <div className="mobile-nav-grid">
              {mobileMenuTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`mobile-nav-tile${tab === t.key ? ' active' : ''}`}
                  aria-current={tab === t.key ? 'page' : undefined}
                  onClick={() => { switchTab(t.key); closeMobileMenu(); }}
                >
                  <span className="ic" aria-hidden="true">{t.ic}</span>
                  <span className="mobile-nav-tile-label">{t.full || t.label}</span>
                  <span className="mobile-nav-tile-state">{tab === t.key ? 'Đang mở' : 'Mở tab'}</span>
                </button>
              ))}
            </div>
            {!mobileMenuTabs.length && <div className="mobile-nav-empty">Không tìm thấy mục phù hợp.</div>}
          </div>
        </section>
      </div>}
      <nav className="nav nav-mobile-primary" aria-label="Điều hướng nhanh App Report">
        {mobilePrimaryTabs.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} aria-current={tab === t.key ? 'page' : undefined} onClick={() => switchTab(t.key)}>
            <span className="ic">{t.ic}</span>
            <span>{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={mobileMenuOpen || !mobilePrimaryTabs.some((t) => t.key === tab) ? 'active' : ''}
          aria-haspopup="dialog"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-nav-sheet"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <span className="ic" aria-hidden="true">☰</span>
          <span>Menu</span>
        </button>
      </nav>
    </>
  );
}
