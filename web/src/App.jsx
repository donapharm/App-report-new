import React, { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { roleLabel } from './util.js';
import { useIsDesktop } from './hooks.js';
import { Spinner, ScrollTopButton, Clock, UpdateBanner, ZaloSidebar, ZaloMobileAccess } from './components.jsx';
import { NavCtx } from './drillNav.jsx';
import Logo from './logo.jsx';
import DormantGate from './DormantGate.jsx';
import CeoNotificationBell from './CeoNotificationBell.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Revenue from './pages/Revenue.jsx';
import RevenueFull from './pages/RevenueFull.jsx';
import Products from './pages/Products.jsx';
import Analysis from './pages/Analysis.jsx';
import DailySalesOrders from './pages/DailySalesOrders.jsx';
import TenderQuota from './pages/TenderQuota.jsx';
import Target from './pages/Target.jsx';
import CatalogManagement from './pages/CatalogManagement.jsx';
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
  { key: 'catalogManagement', label: 'Danh mục QL', full: 'Danh mục quản lý', ic: '🗂️', C: CatalogManagement },
  { key: 'dormantReports', label: 'B/c QLNB', full: 'Báo cáo QLNB', ic: '📑', C: DormantReports, ceoEmployeeOnly: true },
  { key: 'ai', label: 'Hỏi nhanh', ic: '🤖', C: AiChat },
  { key: 'upload', label: 'Upload', ic: '⬆️', C: Upload, adminOnly: true },
];

const HOME_URL = 'https://home.donapharm.asia';

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

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('rpt_tab') || 'overview'; } catch { return 'overview'; } });
  const [tabStack, setTabStack] = useState([]); // các tab đã đi qua, để nút "Quay lại" lùi về
  const desktop = useIsDesktop();

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.me().then(setMe).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!me) return;
    window.history.replaceState({ ...(window.history.state || {}), appTab: tab }, '', window.location.href);
    const onPop = (e) => { if (e.state?.appTab) { setTab(e.state.appTab); setTabStack((s) => s.slice(0, -1)); try { localStorage.setItem('rpt_tab', e.state.appTab); } catch { /* ignore */ } } };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // #6 Mini-header: cuộn xuống thì thu nhỏ banner (mobile). Desktop cuộn ở .main-desktop nên window.scrollY=0 -> không ảnh hưởng.
  useEffect(() => {
    if (!me) return;
    const onScroll = () => { document.documentElement.classList.toggle('hdr-mini', (window.scrollY || 0) > 48); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); document.documentElement.classList.remove('hdr-mini'); };
  }, [me]);

  useEffect(() => {
    document.documentElement.classList.toggle('products-mode', !!me && tab === 'products');
    return () => document.documentElement.classList.remove('products-mode');
  }, [me, tab]);

  useEffect(() => {
    document.documentElement.classList.toggle('catalog-mode', !!me && tab === 'catalogManagement');
    return () => document.documentElement.classList.remove('catalog-mode');
  }, [me, tab]);

  if (loading) return <Spinner />;
  if (!me) return <Login onLogin={setMe} />;

  const logout = () => { setToken(null); setMe(null); setTab('overview'); setTabStack([]); try { localStorage.removeItem('rpt_tab'); } catch { /* ignore */ } };
  const canonicalCeo = String(me.role || '').toLowerCase() === 'ceo' || String(me.emp_code || '').toUpperCase() === 'CEO';
  const tabs = TABS.filter((t) => (!t.adminOnly || me.isAdmin) && (!t.ceoEmployeeOnly || canonicalCeo || !me.isAdmin)).map((t) => (
    t.key === 'catalogManagement' && !me.isAdmin
      ? { ...t, label: 'Danh mục bán hàng của tôi', full: 'Danh mục bán hàng của tôi' }
      : t
  ));
  const Active = (tabs.find((t) => t.key === tab) || tabs[0]).C;
  const switchTab = (targetTab, payload = {}, mode = 'push') => {
    try { sessionStorage.setItem('app_nav_payload', JSON.stringify({ tab: targetTab, ...payload, ts: Date.now() })); } catch { /* ignore */ }
    try { localStorage.setItem('rpt_tab', targetTab); } catch { /* ignore */ }
    if (mode === 'push' && targetTab !== tab) setTabStack((s) => [...s, tab]);
    setTab(targetTab);
    if (mode === 'push') window.history.pushState({ appTab: targetTab, appPayload: payload }, '', window.location.href);
    else window.history.replaceState({ ...(window.history.state || {}), appTab: targetTab, appPayload: payload }, '', window.location.href);
  };
  const navigate = (targetTab, payload = {}) => switchTab(targetTab, payload, 'push');
  const navBack = { back: () => window.history.back(), canBack: tabStack.length > 0 };

  // ---------- Desktop: sidebar dashboard ----------
  if (desktop) {
    return (
      <div className="shell-desktop">
        <aside className="sidebar">
          <div className="side-logo"><Logo size={42} /></div>
          <nav className="side-nav">
            {tabs.filter((t) => !t.hidden).map((t) => (
              <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => switchTab(t.key)}>
                <span className="ic">{t.ic}</span> {t.label}
              </button>
            ))}
          </nav>
          <ZaloSidebar />
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
              <CeoNotificationBell me={me} />
              <HomeButton />
              <Clock />
            </div>
          </header>
          <main className={`page-desktop ${tab === 'catalogManagement' ? 'page-desktop-wide' : ''}`}>
            <NavCtx.Provider value={navBack}><Active me={me} desktop onNavigate={navigate} /></NavCtx.Provider>
          </main>
          <ScrollTopButton />
          <UpdateBanner />
          <DormantGate me={me} tab={tab} />
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
            <CeoNotificationBell me={me} />
          </div>
        </div>
        <div className="hdr-r2">
          <Clock />
          <div className="hdr-actions">
            <HomeButton />
            <button className="logout" onClick={logout}>Đăng xuất</button>
          </div>
        </div>
      </header>
      <main className="page">
        <NavCtx.Provider value={navBack}><Active me={me} onNavigate={navigate} /></NavCtx.Provider>
      </main>
      <ScrollTopButton />
      <UpdateBanner />
      <DormantGate me={me} tab={tab} />
      {!['catalogManagement', 'dailySales', 'products', 'dormantReports'].includes(tab) && <ZaloMobileAccess />}
      {tab !== 'dailySales' && <nav className="nav">
        {tabs.filter((t) => !t.hidden).map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => switchTab(t.key)}>
            <span className="ic">{t.ic}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>}
    </>
  );
}
