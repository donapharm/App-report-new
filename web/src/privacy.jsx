import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AUTO_HIDE_NOTICE, CONTEXT_HIDE_NOTICE, PRESENT_HIDE_NOTICE, autoHideMsFor, createAutoHide, setMasked,
  clearRevealDeadline, readPresenting, readRevealDeadline, writePresenting, writeRevealDeadline,
} from './privacyMask.js';

// Một công tắc cho CẢ APP. Mặc định ẨN, và không bao giờ ghi vào kho lâu dài của máy.
// Mở số GẮN VỚI MÀN ĐANG XEM: đổi trang/NV/đơn vị/kỳ là ẩn ngay. F5 mà vẫn đúng màn
// đó, còn trong hạn, thì giữ mở (mốc nằm ở sessionStorage — đóng tab là mất).
// Bật Trình chiếu thì F5 không nhớ gì và rút hạn còn 1 phút.
// Đây là rèm che, không phải khoá bảo mật (SPEC_PRIVACY_EYE.md).
export const EYE_TOOLTIP = 'Ẩn số trên màn hình — không phải khoá bảo mật.';
export const WRITE_BLOCKED_TOOLTIP = 'Bấm con mắt để xem số trước khi duyệt';
export const EXPORT_REAL_NUMBERS_NOTE = 'File xuất ra có số thật.';
export const PRESENT_TOOLTIP = 'Trình chiếu: tải lại trang không nhớ số đang mở, và tự ẩn sau 1 phút.';

const PrivacyCtx = createContext({
  hidden: true, setHidden: () => {}, notice: '',
  presenting: false, setPresenting: () => {},
  setRevealContext: () => {}, setRevealScope: () => {},
});

export function usePrivacy() {
  return useContext(PrivacyCtx);
}

/**
 * Trang khai báo "tôi đang cho xem thứ này" — chuỗi gộp trang · NV · đơn vị · kỳ.
 * Khoá đổi ⇒ số ẩn NGAY, không chờ hết giờ. Đây là lớp chặn chính cho tình huống
 * trình chiếu: số mới nhảy ra màn LED khi CEO chưa kịp quyết định.
 */
export function useRevealContext(key) {
  const { setRevealContext } = usePrivacy();
  useEffect(() => { setRevealContext(String(key ?? '')); }, [key, setRevealContext]);
}

// App khai tab đang đứng. Tách khỏi `useRevealContext` để cha không ghi đè con.
export function useRevealScope(key) {
  const { setRevealScope } = usePrivacy();
  useEffect(() => { setRevealScope(String(key ?? '')); }, [key, setRevealScope]);
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
  // LUÔN khởi động ở trạng thái ẨN. Việc khôi phục sau F5 để lớp dưới quyết định,
  // sau khi trang đã khai báo mình đang xem gì — sai về phía AN TOÀN, thà loé chậm
  // một nhịp còn hơn loé số của màn cũ lên máy chiếu.
  const [hidden, setHiddenState] = useState(true);
  const [notice, setNotice] = useState('');
  const [presenting, setPresentingState] = useState(() => readPresenting(revealStore()));
  // Ngữ cảnh gồm HAI tầng để cha/con không giẫm chân nhau:
  //   scope  — App khai, là tab đang đứng (null = app chưa khai, chưa xét gì cả)
  //   detail — trang khai, là NV · đơn vị · kỳ bên trong tab đó
  // Effect của con chạy TRƯỚC cha, nên nếu dùng chung một ô thì cha luôn ghi đè con.
  const [scope, setScopeState] = useState(null);
  const [detail, setDetailState] = useState('');
  const contextKey = scope === null ? null : `${scope}|${detail}`;
  const noticeTimerRef = useRef(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  // Đồng bộ ngay trong lúc render để con render ra đúng trạng thái che, không lệch một nhịp.
  setMasked(hidden);

  const flashNotice = useCallback((text) => {
    setNotice(text);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 8000);
  }, []);

  const setHidden = (next) => {
    setHiddenState((current) => {
      const value = typeof next === 'function' ? next(current) : !!next;
      if (!value) setNotice('');
      return value;
    });
  };

  const setRevealContext = useCallback((key) => {
    setDetailState((prev) => (prev === key ? prev : key));
  }, []);

  const setRevealScope = useCallback((key) => {
    setScopeState((prev) => (prev === key ? prev : key));
  }, []);

  const setPresenting = useCallback((on) => {
    const value = !!on;
    setPresentingState(value);
    writePresenting(revealStore(), value);
    // Bật Trình chiếu giữa chừng phải ẩn NGAY: chính lúc cắm máy chiếu là lúc số
    // đang hiện dễ lọt nhất. Tắt thì không tự mở lại — vẫn phải bấm con mắt.
    if (value) {
      clearRevealDeadline(revealStore());
      setHiddenState(true);
    }
  }, []);

  // Ngữ cảnh đổi: F5 đúng màn cũ và còn hạn thì mở lại; mọi trường hợp khác thì ẩn.
  useEffect(() => {
    if (contextKey === null) return;
    const store = revealStore();
    const carried = readRevealDeadline(store, { contextKey, presenting });
    if (carried > 0) { setHiddenState(false); return; }
    if (!hiddenRef.current) flashNotice(CONTEXT_HIDE_NOTICE);
    clearRevealDeadline(store);
    setHiddenState(true);
  }, [contextKey, presenting, flashNotice]);

  useEffect(() => {
    // Ẩn vì bất kỳ lý do gì cũng xoá mốc ⇒ F5 sau đó ra ẩn, không hồi sinh trạng thái mở.
    if (hidden) { clearRevealDeadline(revealStore()); return undefined; }

    const cycleMs = autoHideMsFor(presenting);
    const startedAt = Date.now();
    const carriedDeadline = readRevealDeadline(revealStore(), { contextKey, nowTs: startedAt, presenting });
    const autoHide = createAutoHide({
      delayMs: cycleMs,
      onHide: (cause) => {
        clearRevealDeadline(revealStore());
        setHiddenState(true);
        if (cause === 'idle') flashNotice(presenting ? PRESENT_HIDE_NOTICE : AUTO_HIDE_NOTICE);
      },
    });

    // Ghi mốc theo nhịp thưa: mousemove bắn liên tục, không việc gì phải chạm
    // sessionStorage mỗi lần — chỉ ghi khi mốc mới xa hơn mốc đã ghi quá 5 giây.
    // Trình chiếu thì KHÔNG ghi gì cả: không có mốc ⇒ F5 chắc chắn ra ẩn.
    let lastWritten = 0;
    const touch = (overrideMs) => {
      const span = Number.isFinite(overrideMs) && overrideMs > 0 ? overrideMs : cycleMs;
      autoHide.activity(span);
      if (presenting) return;
      const deadline = Date.now() + span;
      if (deadline - lastWritten > 5_000) {
        writeRevealDeadline(revealStore(), deadline, contextKey ?? '');
        lastWritten = deadline;
      }
    };
    // Nhịp đầu: nếu vừa F5 thì đếm nốt phần còn lại của mốc cũ, không cấp chu kỳ mới.
    touch(carriedDeadline > 0 ? carriedDeadline - startedAt : cycleMs);

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
  }, [hidden, presenting, contextKey, flashNotice]);

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  const value = useMemo(
    () => ({ hidden, setHidden, notice, presenting, setPresenting, setRevealContext, setRevealScope }),
    [hidden, notice, presenting, setPresenting, setRevealContext, setRevealScope],
  );
  // cloneElement để mỗi lần bật/tắt là CẢ CÂY render lại (giữ nguyên state):
  // money()/short()/pct() đọc trạng thái che lúc render, không qua context từng chỗ.
  const content = React.isValidElement(children) ? React.cloneElement(children) : children;
  return <PrivacyCtx.Provider value={value}>{content}</PrivacyCtx.Provider>;
}

export function PrivacyEyeButton() {
  const { hidden, setHidden, notice, presenting, setPresenting } = usePrivacy();
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
      <button
        type="button"
        className={`privacy-present${presenting ? ' is-on' : ''}`}
        aria-pressed={presenting}
        aria-label={presenting ? 'Tắt chế độ trình chiếu' : 'Bật chế độ trình chiếu'}
        title={PRESENT_TOOLTIP}
        onClick={() => setPresenting(!presenting)}
      >
        <span className="privacy-present-ic" aria-hidden="true">📽</span>
        <span className="privacy-present-label">Trình chiếu{presenting ? ' · BẬT' : ''}</span>
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
