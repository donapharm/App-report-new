// RÈM CHE SỐ TIỀN — KHÔNG PHẢI KHOÁ BẢO MẬT.
// Số vẫn nằm trong bộ nhớ trình duyệt và trong phản hồi mạng; mở F12 là đọc được.
// Khoá thật là `employeeCostVisibility` (backend, có audit) và `auth.scopeOf`.
// Xem SPEC_PRIVACY_EYE.md. Tách khỏi React để test được bằng node:test.

export const MASK_TEXT = '•••••••';
// CEO chốt 10/08/2026: 60 giây quá ngắn để đọc/đối chiếu một màn KPI. Nới lên 5 phút.
export const AUTO_HIDE_MS = 5 * 60_000;
export const AUTO_HIDE_NOTICE = 'Đã tự ẩn số sau 5 phút';

/* ── GIỮ MẮT MỞ QUA F5 (CEO chốt 10/08/2026) ─────────────────────────────────
 * CEO: *"tao vẫn muốn khi F5 lại thì chưa ẩn vội con mắt."*
 *
 * Ghi MỐC HẾT HẠN (không ghi cờ "đang mở") vào sessionStorage:
 * - sessionStorage chứ KHÔNG localStorage: đóng tab/đóng trình duyệt là mất sạch,
 *   không để lại vết trên máy dùng chung. Đây vẫn là rèm che, không phải khoá.
 * - Ghi mốc hết hạn nên F5 KHÔNG gia hạn thêm: đồng hồ 5 phút chạy tiếp từ lần
 *   thao tác cuối, tải lại 10 lần cũng không kéo dài thêm được phút nào.
 * - Ẩn vì bất kỳ lý do gì (hết giờ, chuyển tab, tự bấm) đều XOÁ mốc ⇒ F5 sau đó
 *   là ẩn, không "hồi sinh" trạng thái mở.
 */
export const REVEAL_DEADLINE_KEY = 'appReport.privacy.revealUntil';

// Trần bằng đúng AUTO_HIDE_MS: mốc rác hoặc đồng hồ máy bị chỉnh cũng không mở lâu hơn một chu kỳ.
export function readRevealDeadline(storage, nowTs = Date.now()) {
  if (!storage) return 0;
  let raw = null;
  try { raw = storage.getItem(REVEAL_DEADLINE_KEY); } catch { return 0; }
  const deadline = Number(raw);
  if (!Number.isFinite(deadline) || deadline <= nowTs) return 0;
  return Math.min(deadline, nowTs + AUTO_HIDE_MS);
}

export function writeRevealDeadline(storage, deadlineTs) {
  if (!storage || !Number.isFinite(deadlineTs)) return;
  try { storage.setItem(REVEAL_DEADLINE_KEY, String(Math.round(deadlineTs))); } catch { /* hết quota/chặn cookie: rèm vẫn chạy, chỉ mất phần nhớ qua F5 */ }
}

export function clearRevealDeadline(storage) {
  if (!storage) return;
  try { storage.removeItem(REVEAL_DEADLINE_KEY); } catch { /* như trên */ }
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
