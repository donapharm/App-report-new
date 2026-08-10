import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AUTO_HIDE_MS, AUTO_HIDE_NOTICE, createAutoHide, setMasked,
  clearRevealDeadline, readRevealDeadline, writeRevealDeadline,
} from './privacyMask.js';

// Một công tắc cho CẢ APP. Mặc định ẨN, và không bao giờ ghi vào kho lâu dài của máy.
// F5 trong vòng 5 phút kể từ thao tác cuối thì GIỮ MỞ (mốc hết hạn nằm ở
// sessionStorage — đóng tab là mất); quá hạn hoặc đã ẩn thì F5 ra ẩn.
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

// Tách ra để test được và để chỗ nào cũng lấy đúng một kho (không đụng localStorage).
export function revealStore() {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

export function PrivacyProvider({ children }) {
  // Khởi tạo từ mốc còn hạn ⇒ F5 giữ mở. Tính NGAY trong lần render đầu để không
  // loé một nhịp "ẩn rồi hiện" — `setMasked` bên dưới đọc đúng giá trị này.
  const [hidden, setHiddenState] = useState(() => readRevealDeadline(revealStore()) <= 0);
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
    // Ẩn vì bất kỳ lý do gì cũng xoá mốc ⇒ F5 sau đó ra ẩn, không hồi sinh trạng thái mở.
    if (hidden) { clearRevealDeadline(revealStore()); return undefined; }

    const startedAt = Date.now();
    const carriedDeadline = readRevealDeadline(revealStore(), startedAt);
    const autoHide = createAutoHide({
      delayMs: AUTO_HIDE_MS,
      onHide: (cause) => {
        clearRevealDeadline(revealStore());
        setHiddenState(true);
        if (cause === 'idle') {
          setNotice(AUTO_HIDE_NOTICE);
          window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = window.setTimeout(() => setNotice(''), 8000);
        }
      },
    });

    // Ghi mốc theo nhịp thưa: mousemove bắn liên tục, không việc gì phải chạm
    // sessionStorage mỗi lần — chỉ ghi khi mốc mới xa hơn mốc đã ghi quá 5 giây.
    let lastWritten = 0;
    const touch = (overrideMs) => {
      const span = Number.isFinite(overrideMs) && overrideMs > 0 ? overrideMs : AUTO_HIDE_MS;
      autoHide.activity(span);
      const deadline = Date.now() + span;
      if (deadline - lastWritten > 5_000) {
        writeRevealDeadline(revealStore(), deadline);
        lastWritten = deadline;
      }
    };
    // Nhịp đầu: nếu vừa F5 thì đếm nốt phần còn lại của mốc cũ, không cấp chu kỳ mới.
    touch(carriedDeadline > 0 ? carriedDeadline - startedAt : AUTO_HIDE_MS);

    const onActivity = () => touch();
    // Dùng lại đúng sự kiện chuông thông báo đang dùng, không dựng cơ chế thứ hai.
    // CHỈ `visibilitychange` — tức là CHUYỂN HẲN sang tab khác / thu nhỏ cửa sổ.
    // ‼ KHÔNG bắt `blur` nữa (CEO báo 10/08/2026): công cụ cắt màn hình của Windows
    // cướp tiêu điểm khỏi trình duyệt ⇒ `blur` bắn ⇒ số bị che ĐÚNG lúc bấm chụp,
    // nên ảnh chụp màn hình luôn ra "•••••••" và CEO phải chụp lại bằng điện thoại.
    const onVisibility = () => { if (document.hidden) autoHide.hideNow(); };
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      autoHide.stop();
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
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
