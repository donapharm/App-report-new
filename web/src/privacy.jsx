import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AUTO_HIDE_MS, AUTO_HIDE_NOTICE, createAutoHide, setMasked } from './privacyMask.js';

// Một công tắc cho CẢ APP. Mặc định ẨN. KHÔNG ghi localStorage — F5 là về ẩn.
// Đây là rèm che, không phải khoá bảo mật (SPEC_PRIVACY_EYE.md).
export const EYE_TOOLTIP = 'Ẩn số trên màn hình — không phải khoá bảo mật.';
export const WRITE_BLOCKED_TOOLTIP = 'Bấm con mắt để xem số trước khi duyệt';
export const EXPORT_REAL_NUMBERS_NOTE = 'File xuất ra có số thật.';

const PrivacyCtx = createContext({ hidden: true, setHidden: () => {}, notice: '' });

export function usePrivacy() {
  return useContext(PrivacyCtx);
}

// Tiện cho chỗ chỉ cần khoá nút ghi tiền.
export function useMoneyWriteLock() {
  const { hidden } = usePrivacy();
  return { locked: hidden, lockTitle: hidden ? WRITE_BLOCKED_TOOLTIP : undefined };
}

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

export function PrivacyProvider({ children }) {
  const [hidden, setHiddenState] = useState(true);
  const [notice, setNotice] = useState('');
  const noticeTimerRef = useRef(null);

  // Đồng bộ ngay trong lúc render để con render ra đúng trạng thái che, không lệch một nhịp.
  setMasked(hidden);

  const setHidden = (next) => {
    setHiddenState((current) => {
      const value = typeof next === 'function' ? next(current) : !!next;
      if (!value) setNotice('');
      return value;
    });
  };

  useEffect(() => {
    if (hidden) return undefined;
    const autoHide = createAutoHide({
      delayMs: AUTO_HIDE_MS,
      onHide: (cause) => {
        setHiddenState(true);
        if (cause === 'idle') {
          setNotice(AUTO_HIDE_NOTICE);
          window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = window.setTimeout(() => setNotice(''), 8000);
        }
      },
    });
    autoHide.activity();
    const onActivity = () => autoHide.activity();
    // Dùng lại đúng sự kiện chuông thông báo đang dùng, không dựng cơ chế thứ hai.
    const onVisibility = () => { if (document.hidden) autoHide.hideNow(); };
    const onBlur = () => autoHide.hideNow();
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      autoHide.stop();
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, [hidden]);

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  const value = useMemo(() => ({ hidden, setHidden, notice }), [hidden, notice]);
  // cloneElement để mỗi lần bật/tắt là CẢ CÂY render lại (giữ nguyên state):
  // money()/short()/pct() đọc trạng thái che lúc render, không qua context từng chỗ.
  const content = React.isValidElement(children) ? React.cloneElement(children) : children;
  return <PrivacyCtx.Provider value={value}>{content}</PrivacyCtx.Provider>;
}

export function PrivacyEyeButton() {
  const { hidden, setHidden, notice } = usePrivacy();
  return (
    <div className="privacy-eye-wrap">
      <button
        type="button"
        className={`privacy-eye${hidden ? ' is-hidden' : ' is-shown'}`}
        aria-pressed={!hidden}
        aria-label={hidden ? 'Hiện số tiền trên màn hình' : 'Ẩn số tiền trên màn hình'}
        title={EYE_TOOLTIP}
        onClick={() => setHidden((current) => !current)}
      >
        <span className="privacy-eye-ic" aria-hidden="true">{hidden ? '🙈' : '👁'}</span>
        <span className="privacy-eye-label">{hidden ? 'Hiện số' : 'Ẩn số'}</span>
      </button>
      {!!notice && <span className="privacy-eye-notice" role="status">{notice}</span>}
    </div>
  );
}

// Dòng nhắc cạnh nút xuất: file đi qua backend nên luôn có số thật.
export function ExportRealNumbersNote() {
  const { hidden } = usePrivacy();
  if (!hidden) return null;
  return <span className="privacy-export-note">{EXPORT_REAL_NUMBERS_NOTE}</span>;
}
