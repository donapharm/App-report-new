import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  AUTO_HIDE_MS, MASK_TEXT, clearRevealDeadline, createAutoHide, isMasked,
  maskMoneyInText, maskNumberText, readRevealDeadline, setMasked, writeRevealDeadline,
} from '../src/privacyMask.js';

// sessionStorage giả — đủ đúng hợp đồng getItem/setItem/removeItem để test không cần DOM.
function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}
import { money, num, pct, short, formatDate } from '../src/util.js';
import { formatEmployeeCostCell } from '../src/employeeCostModel.js';

const privacySource = fs.readFileSync(new URL('../src/privacy.jsx', import.meta.url), 'utf8');
const maskSource = fs.readFileSync(new URL('../src/privacyMask.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const employeeCostSource = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

test('mặc định ẨN, và chỉ nhớ trong TAB — cấm localStorage', () => {
  // Khởi động che sẵn khi không có mốc còn hạn (F5 quá 5 phút, hoặc mở tab mới).
  assert.equal(readRevealDeadline(null), 0, 'không có kho thì coi như không có mốc');
  assert.match(privacySource, /readRevealDeadline\(revealStore\(\)\) <= 0/);
  // Cấm GỌI localStorage (nhắc trong chú thích thì được): đóng trình duyệt phải mất sạch.
  assert.doesNotMatch(privacySource, /localStorage\s*[.[]/);
  assert.doesNotMatch(maskSource, /localStorage\s*[.[]/);
  assert.match(privacySource, /sessionStorage/);
});

// CEO 10/08/2026: "F5 lại thì chưa ẩn vội con mắt."
test('F5 giữ mắt mở trong hạn — nhưng KHÔNG gia hạn thêm', () => {
  const store = memoryStore();
  const now = 1_000_000;
  writeRevealDeadline(store, now + 120_000); // còn 2 phút
  assert.equal(readRevealDeadline(store, now), now + 120_000, 'còn hạn ⇒ F5 mở lại');

  // Tải lại 10 lần cũng không dài thêm: mốc là thời điểm cố định, không phải "cộng 5 phút".
  for (let i = 0; i < 10; i += 1) assert.equal(readRevealDeadline(store, now), now + 120_000);

  // Quá hạn ⇒ ẩn.
  assert.equal(readRevealDeadline(store, now + 120_001), 0, 'hết hạn ⇒ F5 ra ẩn');

  // Mốc rác / đồng hồ máy bị chỉnh vẫn không mở quá một chu kỳ.
  writeRevealDeadline(store, now + 999 * 60_000);
  assert.equal(readRevealDeadline(store, now), now + AUTO_HIDE_MS, 'trần đúng bằng AUTO_HIDE_MS');

  // Ẩn (hết giờ / chuyển tab / tự bấm) thì xoá mốc ⇒ F5 sau đó ra ẩn.
  clearRevealDeadline(store);
  assert.equal(readRevealDeadline(store, now), 0);
  assert.match(privacySource, /if \(hidden\) \{ clearRevealDeadline/);
});

test('kho hỏng (chặn cookie / hết quota) thì rèm vẫn chạy, chỉ mất phần nhớ qua F5', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(readRevealDeadline(broken, 1_000), 0);
  assert.doesNotThrow(() => writeRevealDeadline(broken, 2_000));
  assert.doesNotThrow(() => clearRevealDeadline(broken));
});

test('một công tắc cho CẢ APP: bọc ở main, nút mắt ở cả header desktop lẫn mobile', () => {
  assert.match(mainSource, /<PrivacyProvider><App \/><\/PrivacyProvider>/);
  const eyeButtons = appSource.match(/<PrivacyEyeButton \/>/g) || [];
  assert.equal(eyeButtons.length, 2, 'phải có nút mắt ở topbar desktop VÀ header mobile');
});

test('tự ẩn sau 5 phút không thao tác, và ẩn NGAY khi chuyển hẳn sang tab khác', () => {
  assert.equal(AUTO_HIDE_MS, 300_000, 'CEO chốt 5 phút, không phải 60 giây');
  const fired = [];
  const timers = [];
  const auto = createAutoHide({
    delayMs: AUTO_HIDE_MS,
    onHide: (cause) => fired.push(cause),
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
    cancel: (handle) => { timers[handle] = null; },
  });
  auto.activity();
  assert.equal(timers.filter(Boolean).length, 1);
  assert.equal(timers[0].ms, AUTO_HIDE_MS);
  timers[0].fn(); // hết 5 phút
  assert.deepEqual(fired, ['idle']);

  // Nhịp đầu sau F5 đếm nốt phần CÒN LẠI, không cấp chu kỳ mới.
  auto.activity(90_000);
  assert.equal(timers.at(-1).ms, 90_000);
  // Thao tác tiếp thì mới về đủ 5 phút (đúng nghĩa "5 phút không thao tác").
  auto.activity();
  assert.equal(timers.at(-1).ms, AUTO_HIDE_MS);

  auto.hideNow(); // chuyển tab — không chờ
  assert.deepEqual(fired, ['idle', 'visibility']);
  assert.equal(auto.pending, false, 'hideNow phải huỷ hẹn giờ đang chờ');
  // Provider phải nối đúng sự kiện visibilitychange mà chuông đang dùng.
  assert.match(privacySource, /visibilitychange/);
});

// CEO 10/08/2026: bấm công cụ cắt màn hình của Windows là cướp tiêu điểm khỏi trình
// duyệt ⇒ `blur` bắn ⇒ số bị che đúng lúc chụp. Cấm nối lại sự kiện này.
test('KHÔNG ẩn khi cửa sổ chỉ mất tiêu điểm — nếu không thì chụp màn hình luôn ra dấu chấm', () => {
  assert.doesNotMatch(privacySource, /addEventListener\(\s*['"]blur['"]/);
  assert.doesNotMatch(privacySource, /onBlur\s*=\s*\(\)\s*=>\s*autoHide\.hideNow/);
});

test('che SỐ giữ CẤU TRÚC: tiền/%/Xu bị che, ngày và đếm số lượng thì không', () => {
  assert.equal(isMasked(), false, 'tầng module mặc định trần để test/script ra số thật');
  try {
    setMasked(true);
    assert.equal(money(3995000), MASK_TEXT);
    assert.equal(short(1_250_000_000), MASK_TEXT);
    assert.equal(pct(87.5), MASK_TEXT);
    assert.equal(formatEmployeeCostCell(1200000, { kind: 'money' }), MASK_TEXT);
    // CEO chốt 06/08: % chi phí là công thức hoa hồng ⇒ che như tiền.
    assert.equal(formatEmployeeCostCell(13, { key: 'c43', kind: 'percent' }), MASK_TEXT);
    // Ngoại lệ CEO 06/08: giá trúng thầu (công khai) + thành tiền xuất bán KHÔNG che.
    assert.equal(formatEmployeeCostCell(150000, { key: 'bidPrice', kind: 'money' }), '150.000đ');
    assert.equal(formatEmployeeCostCell(2500000, { key: 'revenueBeforeVat', kind: 'money' }), '2.500.000đ');
    // Thiếu dữ liệu vẫn phải là '—' — không được lẫn "che" với "không có số".
    assert.equal(money(null), '—');
    assert.equal(pct(undefined), '—');
    assert.equal(maskNumberText('—'), '—');
    // Không che: ngày, và num() dùng cho số lượng dòng/đơn.
    assert.equal(formatDate('2026-08-06'), '06/08/26');
    assert.equal(num(2016), '2.016');
    // Chuỗi backend format sẵn: che tiền/%/Xu, GIỮ số đếm dòng.
    assert.equal(maskMoneyInText('158,2 tr · 2.016 dòng'), `${MASK_TEXT} · 2.016 dòng`);
    assert.equal(maskMoneyInText('30.917.892.673đ · đạt 87,5% · thiếu 12 Xu'), `${MASK_TEXT} · đạt ${MASK_TEXT} · thiếu ${MASK_TEXT}`);
    setMasked(false);
    assert.equal(money(3995000), '3.995.000đ');
  } finally { setMasked(false); }
});

test('policy cột Chi phí: mở đúng 2 cột làm việc, che toàn bộ % C33–C46 theo nút mắt', () => {
  try {
    setMasked(true);
    for (let index = 33; index <= 46; index += 1) {
      assert.equal(
        formatEmployeeCostCell(0.5, { key: `c${index}`, kind: 'percent' }),
        MASK_TEXT,
        `C${index} phải bị che khi nút mắt đang ẩn`,
      );
    }
    assert.equal(formatEmployeeCostCell(150000, { key: 'bidPrice', kind: 'money' }), '150.000đ');
    assert.equal(formatEmployeeCostCell(2500000, { key: 'revenueBeforeVat', kind: 'money' }), '2.500.000đ');
    assert.equal(formatEmployeeCostCell(2500000, { key: 'rowMonthlyTotal', kind: 'money' }), MASK_TEXT);
    assert.equal(formatEmployeeCostCell(150000, { key: 'BidPrice', kind: 'money' }), MASK_TEXT, 'ngoại lệ phải khớp exact key');

    setMasked(false);
    assert.equal(formatEmployeeCostCell(0.5, { key: 'c36', kind: 'percent' }), '0.5');
    assert.equal(formatEmployeeCostCell(2500000, { key: 'rowMonthlyTotal', kind: 'money' }), '2.500.000đ');
  } finally { setMasked(false); }
});

test('đang ẩn thì KHOÁ đủ 5 nút ghi tiền: Duyệt · Từ chối · Mở khoá · Ghi đã trả · Gỡ ghi nhận', () => {
  const lockedButtons = employeeCostSource.match(/disabled=\{!!busy(?: \|\| moneyLocked)[^}]*\}/g) || [];
  assert.ok(
    (employeeCostSource.match(/moneyLocked/g) || []).length >= 6,
    'PaymentSchedulePanel phải lấy moneyLocked và gắn vào từng nút ghi tiền',
  );
  for (const label of ['Mở khoá', 'Duyệt', 'Từ chối', 'Ghi nhận đã trả', 'Gỡ ghi nhận']) {
    // Nhãn có thể xuất hiện ở chỗ khác (tiêu đề hộp thoại…): chỉ cần MỘT nút thật
    // mang nhãn này có moneyLocked ngay trước đó là đạt.
    let found = false;
    for (let at = employeeCostSource.indexOf(label); at >= 0; at = employeeCostSource.indexOf(label, at + 1)) {
      const before = employeeCostSource.slice(Math.max(0, at - 600), at);
      if (/moneyLocked/.test(before) && /<button/.test(before)) { found = true; break; }
    }
    assert.ok(found, `nút ${label} phải disabled khi đang che số`);
  }
  assert.ok(lockedButtons.length >= 3);
  // Nút bị khoá phải nói lý do đúng một kiểu: mở mắt ra rồi hãy duyệt.
  assert.match(privacySource, /Bấm con mắt để xem số trước khi duyệt/);
});

test('tooltip nói thẳng đây KHÔNG phải khoá bảo mật; cấm mô tả tính năng là bảo mật/an toàn', () => {
  assert.match(privacySource, /Ẩn số trên màn hình — không phải khoá bảo mật\./);
  // Ngoài câu phủ định bắt buộc ở tooltip, không dòng nào được quảng cáo "bảo mật"/"an toàn".
  const stripped = privacySource
    .replace(/không phải khoá bảo mật/g, '')
    .replace(/rèm che, không phải khoá bảo mật/g, '');
  assert.doesNotMatch(stripped, /bảo mật|an toàn/, 'privacy.jsx không được mô tả tính năng là bảo mật');
  const maskStripped = maskSource.replace(/KHÔNG PHẢI KHOÁ BẢO MẬT|khoá bảo mật/gi, '');
  assert.doesNotMatch(maskStripped, /bảo mật|an toàn/);
  // Xuất file vẫn ra số thật và phải nói rõ.
  assert.match(privacySource, /File xuất ra có số thật\./);
  assert.match(employeeCostSource, /<ExportRealNumbersNote \/>/);
});
