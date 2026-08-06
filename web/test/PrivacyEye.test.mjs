import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MASK_TEXT, createAutoHide, isMasked, maskMoneyInText, maskNumberText, setMasked } from '../src/privacyMask.js';
import { money, num, pct, short, formatDate } from '../src/util.js';
import { formatEmployeeCostCell } from '../src/employeeCostModel.js';

const privacySource = fs.readFileSync(new URL('../src/privacy.jsx', import.meta.url), 'utf8');
const maskSource = fs.readFileSync(new URL('../src/privacyMask.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const employeeCostSource = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

test('mặc định ẨN và không nhớ trạng thái: không đọc/ghi localStorage', () => {
  // UI khởi động che sẵn; F5 quay về che vì không có chỗ nào lưu "đang hiện".
  assert.match(privacySource, /useState\(true\)/);
  // Cấm GỌI localStorage (nhắc trong chú thích thì được).
  assert.doesNotMatch(privacySource, /localStorage\s*[.[]/);
  assert.doesNotMatch(maskSource, /localStorage\s*[.[]/);
});

test('một công tắc cho CẢ APP: bọc ở main, nút mắt ở cả header desktop lẫn mobile', () => {
  assert.match(mainSource, /<PrivacyProvider><App \/><\/PrivacyProvider>/);
  const eyeButtons = appSource.match(/<PrivacyEyeButton \/>/g) || [];
  assert.equal(eyeButtons.length, 2, 'phải có nút mắt ở topbar desktop VÀ header mobile');
});

test('tự ẩn sau 60s không thao tác, và ẩn NGAY khi mất tiêu điểm', () => {
  const fired = [];
  const timers = [];
  const auto = createAutoHide({
    delayMs: 60_000,
    onHide: (cause) => fired.push(cause),
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
    cancel: (handle) => { timers[handle] = null; },
  });
  auto.activity();
  assert.equal(timers.filter(Boolean).length, 1);
  assert.equal(timers[0].ms, 60_000);
  timers[0].fn(); // hết 60 giây
  assert.deepEqual(fired, ['idle']);
  auto.activity();
  auto.hideNow(); // visibilitychange/blur — không chờ
  assert.deepEqual(fired, ['idle', 'visibility']);
  assert.equal(auto.pending, false, 'hideNow phải huỷ hẹn giờ đang chờ');
  // Provider phải nối đúng sự kiện visibilitychange mà chuông đang dùng.
  assert.match(privacySource, /visibilitychange/);
});

test('che SỐ giữ CẤU TRÚC: tiền/%/Xu bị che, ngày và đếm số lượng thì không', () => {
  assert.equal(isMasked(), false, 'tầng module mặc định trần để test/script ra số thật');
  try {
    setMasked(true);
    assert.equal(money(3995000), MASK_TEXT);
    assert.equal(short(1_250_000_000), MASK_TEXT);
    assert.equal(pct(87.5), MASK_TEXT);
    assert.equal(formatEmployeeCostCell(1200000, { kind: 'money' }), MASK_TEXT);
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
