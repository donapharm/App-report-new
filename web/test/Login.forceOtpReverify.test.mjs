import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login = fs.readFileSync(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');
const cost = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

// CEO 23/08 14:58: bấm "Tạo bản tiền T07 đầu tiên" → 403
// EMPLOYEE_COST_SNAPSHOT_HUMAN_OTP_REQUIRED. Backend đòi OTP trong 12 giờ, nhưng cầu
// trustedDeviceSso nuốt bước OTP nên last_otp_at không bao giờ mới lại ⇒ vòng chết.

test('trusted-device bridge can be bypassed on purpose to refresh the 12h OTP mark', () => {
  assert.match(login, /const \[forceOtp, setForceOtp\] = useState\(\(\) => \{/);
  assert.match(login, /if \(mode\?\.trustedDeviceSso && !forceOtp\) \{/);
});

test('the bypass is offered only where the bridge exists, and is reachable by mouse, touch and keyboard', () => {
  assert.match(login, /\{mode\?\.trustedDeviceSso && \(/);
  // <label><input type="checkbox"> — bấm chuột, chạm vào chữ, và Space trên bàn phím
  // đều bật được vì nhãn bọc ô. Không dùng div onClick nên không mất đường bàn phím.
  assert.match(login, /<label style=\{\{ display: 'flex'/);
  assert.match(login, /<input type="checkbox" checked=\{forceOtp\} onChange=\{\(e\) => setForceOtp\(e\.target\.checked\)\}/);
  assert.match(login, /aria-label="Bắt buộc nhập lại mã OTP"/);
});

// CEO 23/08 15:5x: dang xuat vao lai lan 1 hoi OTP, lan 2 vao thang. Cau
// trusted-device-sso phat token method='trusted-device-sso' nen markOtpTrustedDevice
// KHONG chay: lan 2 khong cong bac nao. Bat nguoi dung tu nho tich o la sai —
// app phai tu tich.
test('the box is auto-ticked after a human-OTP refusal so the bridge cannot eat the next login', () => {
  assert.match(cost, /localStorage\.setItem\('rpt_force_otp_next_login', '1'\)/);
  assert.match(login, /localStorage\.getItem\('rpt_force_otp_next_login'\) === '1'/);
});

test('the flag is cleared once an OTP round actually starts, so it never sticks forever', () => {
  assert.match(login, /await api\.otpRequest\(p\);\s*\n\s*try \{ localStorage\.removeItem\('rpt_force_otp_next_login'\); \}/);
});

test('private mode or blocked storage must not break login', () => {
  const reads = login.match(/localStorage\.(get|set|remove)Item\('rpt_force_otp_next_login'[^\n]*/g) || [];
  assert.ok(reads.length >= 2);
  assert.match(login, /catch \{ return false; \}/);
});

test('default stays on the bridge when no refusal happened', () => {
  assert.doesNotMatch(login, /const \[forceOtp, setForceOtp\] = useState\(true\)/);
});

test('the 403 is translated into the exact steps out of the loop', () => {
  assert.match(cost, /EMPLOYEE_COST_SNAPSHOT_HUMAN_OTP_REQUIRED/);
  assert.match(cost, /bắt buộc nhập lại OTP/);
  assert.match(cost, /setSnapshotError\(snapshotErrorText\(requestError\)\)/);
});
