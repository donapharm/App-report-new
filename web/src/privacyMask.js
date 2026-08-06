// RÈM CHE SỐ TIỀN — KHÔNG PHẢI KHOÁ BẢO MẬT.
// Số vẫn nằm trong bộ nhớ trình duyệt và trong phản hồi mạng; mở F12 là đọc được.
// Khoá thật là `employeeCostVisibility` (backend, có audit) và `auth.scopeOf`.
// Xem SPEC_PRIVACY_EYE.md. Tách khỏi React để test được bằng node:test.

export const MASK_TEXT = '•••••••';
export const AUTO_HIDE_MS = 60_000;
export const AUTO_HIDE_NOTICE = 'Đã tự ẩn số sau 60 giây';

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

// Máy trạng thái tự ẩn: 60s không thao tác thì ẩn; tab/cửa sổ mất tiêu điểm thì ẩn NGAY.
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
    activity() {
      stop();
      handle = schedule(() => { handle = null; if (onHide) onHide('idle'); }, delayMs);
    },
    // Tab bị ẩn / cửa sổ mất tiêu điểm / máy ngủ — ẩn ngay, không chờ hết 60s.
    hideNow() {
      stop();
      if (onHide) onHide('visibility');
    },
    stop,
    get pending() { return handle !== null; },
  };
}
