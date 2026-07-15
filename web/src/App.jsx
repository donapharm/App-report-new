import React, { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { roleLabel } from './util.js';
import { useIsDesktop } from './hooks.js';
import { Spinner, ScrollTopButton, Clock, UpdateBanner, ZaloSidebar, ZaloMobileAccess } from './components.jsx';
import { NavCtx } from './drillNav.jsx';
import Logo from './logo.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Revenue from './pages/Revenue.jsx';
import RevenueFull from './pages/RevenueFull.jsx';
import Products from './pages/Products.jsx';
import Analysis from './pages/Analysis.jsx';
import TenderQuota from './pages/TenderQuota.jsx';
import Target from './pages/Target.jsx';
import AiChat from './pages/AiChat.jsx';
import Upload from './pages/Upload.jsx';

const TABS = [
  { key: 'overview', label: 'Tổng quan', ic: '📊', C: Overview },
  { key: 'revenue', label: 'Doanh thu', ic: '💰', C: Revenue },
  { key: 'revenueFull', label: 'DT đầy đủ', full: 'Doanh thu đầy đủ', ic: '📋', C: RevenueFull },
  { key: 'products', label: 'Sản phẩm', ic: '💊', C: Products },
  { key: 'analysis', label: 'Phân tích', ic: '📈', C: Analysis },
  { key: 'cst', label: 'Cơ số thầu', ic: '📦', C: TenderQuota },
  { key: 'target', label: 'Target', ic: '🎯', C: Target },
  { key: 'ai', label: 'Hỏi nhanh', ic: '🤖', C: AiChat },
  { key: 'upload', label: 'Upload', ic: '⬆️', C: Upload, adminOnly: true },
];

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
    const onPop = (e) => { if (e.state?.appTab) { setTab(e.state.appTab); setTabStack((s) => s.slice(0, -1)); } };
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

  if (loading) return <Spinner />;
  if (!me) return <Login onLogin={setMe} />;

  const logout = () => { setToken(null); setMe(null); setTab('overview'); setTabStack([]); try { localStorage.removeItem('rpt_tab'); } catch { /* ignore */ } };
  const tabs = TABS.filter((t) => !t.adminOnly || me.isAdmin);
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
            {tabs.map((t) => (
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
            <Clock />
          </header>
          <main className="page-desktop">
            <NavCtx.Provider value={navBack}><Active me={me} desktop onNavigate={navigate} /></NavCtx.Provider>
          </main>
          <ScrollTopButton />
          <UpdateBanner />
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
          <div className="who">
            <div className="who-name">{me.name}</div>
            <div className="who-role">{roleLabel(me.role)}</div>
          </div>
        </div>
        <div className="hdr-r2">
          <Clock />
          <button className="logout" onClick={logout}>Đăng xuất</button>
        </div>
      </header>
      <main className="page">
        <NavCtx.Provider value={navBack}><Active me={me} onNavigate={navigate} /></NavCtx.Provider>
      </main>
      <ScrollTopButton />
      <UpdateBanner />
      <ZaloMobileAccess />
      <nav className="nav">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => switchTab(t.key)}>
            <span className="ic">{t.ic}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
