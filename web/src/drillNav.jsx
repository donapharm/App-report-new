import React, { useEffect, useRef, useState } from 'react';

export function DrillNav({ crumbs = [], onBack, onCrumb, onReload, busy = false }) {
  const items = crumbs.filter(Boolean);
  const canBack = !!onBack && items.length > 1;
  return (
    <div className="drill-nav card">
      <button className="btn ghost" disabled={!canBack} onClick={onBack}>← Quay lại</button>
      <div className="drill-crumbs" aria-label="Breadcrumb">
        {items.map((c, i) => (
          <React.Fragment key={`${c.label}-${i}`}>
            {i > 0 && <span className="sep">›</span>}
            <button className={i === items.length - 1 ? 'active' : ''} disabled={!onCrumb || i === items.length - 1} onClick={() => onCrumb?.(i)}>{c.label}</button>
          </React.Fragment>
        ))}
      </div>
      <button className="btn ghost reload" disabled={busy || !onReload} onClick={onReload}>{busy ? 'Đang tải…' : '↻ Tải lại'}</button>
    </div>
  );
}

export function useReloadTick() {
  const [reloadTick, setReloadTick] = useState(0);
  return { reloadTick, reload: () => setReloadTick((x) => x + 1) };
}

export function useDrillStack({ key, root, apply }) {
  const [stack, setStack] = useState([root]);
  const applyingPop = useRef(false);
  const current = stack[stack.length - 1] || root;

  function writeHistory(nextStack, mode = 'push') {
    if (typeof window === 'undefined') return;
    const payload = { appDrillKey: key, stack: nextStack };
    if (mode === 'replace') window.history.replaceState({ ...(window.history.state || {}), ...payload }, '', window.location.href);
    else window.history.pushState(payload, '', window.location.href);
  }

  useEffect(() => { writeHistory([root], 'replace'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPop = (e) => {
      if (e.state?.appDrillKey !== key || !Array.isArray(e.state.stack)) return;
      applyingPop.current = true;
      const next = e.state.stack.length ? e.state.stack : [root];
      setStack(next);
      apply?.(next[next.length - 1]);
      setTimeout(() => { applyingPop.current = false; }, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [key, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  function setRoot(nextRoot) {
    const next = [nextRoot];
    setStack(next);
    apply?.(nextRoot);
    writeHistory(next, 'replace');
  }
  function push(item) {
    const next = [...stack, item];
    setStack(next);
    apply?.(item);
    if (!applyingPop.current) writeHistory(next, 'push');
  }
  function back() {
    if (stack.length <= 1) return;
    if (typeof window !== 'undefined') window.history.back();
    else jump(stack.length - 2);
  }
  function jump(index) {
    const next = stack.slice(0, index + 1);
    setStack(next);
    apply?.(next[next.length - 1]);
    writeHistory(next, 'push');
  }
  return { stack, current, setRoot, push, back, jump, crumbs: stack.map((x) => ({ label: x.label })) };
}
