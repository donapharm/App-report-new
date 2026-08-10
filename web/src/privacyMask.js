// RÈM CHE SỐ TIỀN — KHÔNG PHẢI KHOÁ BẢO MẬT.
// Số vẫn nằm trong bộ nhớ trình duyệt và trong phản hồi mạng; mở F12 là đọc được.
// Khoá thật là `employeeCostVisibility` (backend, có audit) và `auth.scopeOf`.
// Xem SPEC_PRIVACY_EYE.md. Tách khỏi React để test được bằng node:test.

export const MASK_TEXT = '•••••••';
// CEO chốt 10/08/2026: 60 giây quá ngắn để đọc/đối chiếu một màn KPI. Nới lên 5 phút.
export const AUTO_HIDE_MS = 5 * 60_000;
export const AUTO_HIDE_NOTICE = 'Đã tự ẩn số sau 5 phút';

/* ── MỞ SỐ GẮN VỚI MÀN ĐANG XEM (CEO chốt 10/08/2026) ────────────────────────
 * CEO: *"tôi đang trình chiếu trên màn hình LED mà vô tình lọt các con số % và
 * tổng tiền các ô thì rất là lỗ hổng. Đặc biệt là khi F5 lại hoặc sang trang khác,
 * hoặc chuyển từ NV này qua NV khác, hoặc chuyển từ đơn vị này qua đơn vị khác."*
 *
 * Nguy hiểm KHÔNG nằm ở thời gian mà ở NỘI DUNG MÀN HÌNH ĐỔI. Số CEO chủ động mở
 * ra để đọc thì CEO biết nó đang hiện; nhưng đổi trang/NV/đơn vị/kỳ thì số MỚI tự
 * nhảy ra khi chưa ai quyết định — đó mới là lúc lọt lên màn LED.
 *
 * Nên lưu kèm MỐC HẾT HẠN một CHÌA KHOÁ NGỮ CẢNH (trang · NV · đơn vị · kỳ). Khoá
 * lệch ⇒ coi như chưa mở, ẩn ngay, không chờ hết giờ. Nhờ vậy F5 ĐÚNG màn cũ thì
 * vẫn giữ mở (CEO xin sáng nay), còn rời khỏi màn đó là ẩn tức thì.
 *
 * - sessionStorage chứ KHÔNG localStorage: đóng tab/đóng trình duyệt là mất sạch,
 *   không để lại vết trên máy dùng chung. Đây vẫn là rèm che, không phải khoá.
 * - Ghi mốc hết hạn nên F5 KHÔNG gia hạn: đồng hồ chạy tiếp từ lần thao tác cuối.
 * - Ẩn vì bất kỳ lý do gì đều XOÁ mốc ⇒ F5 sau đó là ẩn, không "hồi sinh".
 */
export const REVEAL_KEY = 'appReport.privacy.reveal';

// CHẾ ĐỘ TRÌNH CHIẾU: siết chặt khi cắm máy chiếu/màn LED.
// Bản thân CÔNG TẮC thì nhớ qua F5 (không lẽ tải lại trang là phải bật lại giữa buổi
// họp), nhưng TRẠNG THÁI MỞ SỐ thì tuyệt đối không nhớ — đó mới là thứ gây lọt số.
export const PRESENT_KEY = 'appReport.privacy.presenting';
export const PRESENT_HIDE_MS = 60_000;
export const PRESENT_HIDE_NOTICE = 'Trình chiếu — đã tự ẩn số sau 1 phút';
export const CONTEXT_HIDE_NOTICE = 'Đã ẩn số vì màn hình vừa đổi';

export function autoHideMsFor(presenting) {
  return presenting ? PRESENT_HIDE_MS : AUTO_HIDE_MS;
}

/**
 * Trả mốc hết hạn CÒN HIỆU LỰC cho đúng ngữ cảnh đang đứng, ngược lại trả 0.
 * Trần bằng đúng một chu kỳ: mốc rác hoặc đồng hồ máy bị chỉnh cũng không mở lâu hơn.
 */
export function readRevealDeadline(storage, { contextKey = '', nowTs = Date.now(), presenting = false } = {}) {
  // Trình chiếu: KHÔNG khôi phục qua F5, bất kể mốc còn hạn hay không.
  if (!storage || presenting) return 0;
  let raw = null;
  try { raw = storage.getItem(REVEAL_KEY); } catch { return 0; }
  let saved = null;
  try { saved = JSON.parse(raw); } catch { return 0; }
  if (!saved || typeof saved !== 'object') return 0;
  const deadline = Number(saved.until);
  if (!Number.isFinite(deadline) || deadline <= nowTs) return 0;
  // Khoá ngữ cảnh lệch = đang nhìn thứ KHÁC lúc bấm mở ⇒ không được hiện.
  if (String(saved.ctx ?? '') !== String(contextKey ?? '')) return 0;
  return Math.min(deadline, nowTs + AUTO_HIDE_MS);
}

export function writeRevealDeadline(storage, deadlineTs, contextKey = '') {
  if (!storage || !Number.isFinite(deadlineTs)) return;
  try {
    storage.setItem(REVEAL_KEY, JSON.stringify({ until: Math.round(deadlineTs), ctx: String(contextKey ?? '') }));
  } catch { /* hết quota/chặn cookie: rèm vẫn chạy, chỉ mất phần nhớ qua F5 */ }
}

export function clearRevealDeadline(storage) {
  if (!storage) return;
  try { storage.removeItem(REVEAL_KEY); } catch { /* như trên */ }
}

export function readPresenting(storage) {
  if (!storage) return false;
  try { return storage.getItem(PRESENT_KEY) === '1'; } catch { return false; }
}

export function writePresenting(storage, on) {
  if (!storage) return;
  try {
    if (on) storage.setItem(PRESENT_KEY, '1');
    else storage.removeItem(PRESENT_KEY);
  } catch { /* như trên */ }
}

// Trạng thái mức module. Mặc định KHÔNG che ở tầng module để formatter chạy trần
// (test node, script) ra số thật; còn TRONG APP thì PrivacyProvider khởi động với
// hidden=true và gọi setMasked NGAY TRONG render — trước khi bất kỳ trang nào render —
// nên màn hình vẫn mặc định ẨN đúng spec. Không đọc/ghi localStorage ở bất kỳ đâu.
let masked = false;

export function isMasked() {
  return masked;
}

export function setMasked(next) {
  masked = !!next;
  return masked;
}

// Chỉ che khi ĐANG có số. Thiếu dữ liệu vẫn phải ra '—' để không lẫn "che" với "không có".
export function maskNumberText(text) {
  if (text == null || text === '' || text === '—') return text;
  return masked ? MASK_TEXT : text;
}

// Cho chuỗi backend đã format sẵn (vd "158,2 tr · 2.016 dòng"): chỉ che phần TIỀN/%/Xu,
// giữ nguyên số đếm ("2.016 dòng"), mã, ngày — đúng luật "che số, giữ cấu trúc".
// `\b` của regex JS không hiểu chữ có dấu (đ, ỷ) nên dùng lookahead unicode thay thế.
const MONEY_IN_TEXT = /\d[\d.,]*\s*(?:đ|tỷ|tr|nghìn|%|[xX]u)(?!\p{L})/gu;
export function maskMoneyInText(text) {
  if (!masked || text == null || text === '') return text;
  return String(text).replace(MONEY_IN_TEXT, MASK_TEXT);
}

// Máy trạng thái tự ẩn: 5 phút không thao tác thì ẩn; CHUYỂN HẲN sang tab khác thì ẩn NGAY.
// (Trước 10/08/2026 còn ẩn khi cửa sổ mất tiêu điểm — xem ghi chú `onBlur` trong privacy.jsx.)
export function createAutoHide({
  delayMs = AUTO_HIDE_MS,
  onHide,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let handle = null;
  const stop = () => {
    if (handle !== null) { cancel(handle); handle = null; }
  };
  return {
    // Gọi mỗi lần người dùng thao tác — đếm lại từ đầu.
    // `overrideMs` chỉ dùng cho nhịp đầu sau khi F5: đếm nốt phần thời gian CÒN LẠI
    // của mốc cũ, để tải lại trang không tự thưởng thêm một chu kỳ mới.
    activity(overrideMs) {
      stop();
      const span = Number.isFinite(overrideMs) && overrideMs > 0 ? overrideMs : delayMs;
      handle = schedule(() => { handle = null; if (onHide) onHide('idle'); }, span);
    },
    // Tab bị ẩn / máy ngủ — ẩn ngay, không chờ hết giờ.
    hideNow() {
      stop();
      if (onHide) onHide('visibility');
    },
    stop,
    get pending() { return handle !== null; },
  };
}
