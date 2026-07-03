import React, { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { roleLabel } from './util.js';
import { useIsDesktop } from './hooks.js';
import { Spinner, ScrollTopButton } from './components.jsx';
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
  { key: 'revenueFull', label: 'DT đầy đủ', ic: '📋', C: RevenueFull },
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
  const [tab, setTab] = useState('overview');
  const desktop = useIsDesktop();

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.me().then(setMe).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!me) return;
    window.history.replaceState({ ...(window.history.state || {}), appTab: tab }, '', window.location.href);
    const onPop = (e) => { if (e.state?.appTab) setTab(e.state.appTab); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />;
  if (!me) return <Login onLogin={setMe} />;

  const logout = () => { setToken(null); setMe(null); setTab('overview'); };
  const tabs = TABS.filter((t) => !t.adminOnly || me.isAdmin);
  const Active = (tabs.find((t) => t.key === tab) || tabs[0]).C;
  const switchTab = (targetTab, payload = {}, mode = 'push') => {
    try { sessionStorage.setItem('app_nav_payload', JSON.stringify({ tab: targetTab, ...payload, ts: Date.now() })); } catch { /* ignore */ }
    setTab(targetTab);
    if (mode === 'push') window.history.pushState({ appTab: targetTab, appPayload: payload }, '', window.location.href);
    else window.history.replaceState({ ...(window.history.state || {}), appTab: targetTab, appPayload: payload }, '', window.location.href);
  };
  const navigate = (targetTab, payload = {}) => switchTab(targetTab, payload, 'push');

  // ---------- Desktop: sidebar dashboard ----------
  if (desktop) {
    return (
      <div className="shell-desktop">
        <aside className="sidebar">
          <div className="side-logo"><Logo size={30} /></div>
          <nav className="side-nav">
            {tabs.map((t) => (
              <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => switchTab(t.key)}>
                <span className="ic">{t.ic}</span> {t.label}
              </button>
            ))}
          </nav>
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
              <h1>{tabs.find((t) => t.key === tab)?.label}</h1>
              <div className="sub">DNPHARMA · Báo cáo doanh thu thông minh</div>
            </div>
          </header>
          <main className="page-desktop">
            <Active me={me} desktop onNavigate={navigate} />
          </main>
          <ScrollTopButton />
        </div>
      </div>
    );
  }

  // ---------- Mobile: header + bottom nav ----------
  return (
    <>
      <header className="hdr">
        <Logo size={26} light />
        <div className="who">
          <div>{me.name}</div>
          <div style={{ opacity: .8 }}>{roleLabel(me.role)}</div>
          <button className="logout" onClick={logout}>Đăng xuất</button>
        </div>
      </header>
      <main className="page">
        <Active me={me} onNavigate={navigate} />
      </main>
      <ScrollTopButton />
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
