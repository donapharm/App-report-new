import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login = fs.readFileSync(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');
const cost = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

// CEO 23/08 14:58: bấm "Tạo bản tiền T07 đầu tiên" → 403
// EMPLOYEE_COST_SNAPSHOT_HUMAN_OTP_REQUIRED. Backend đòi OTP trong 12 giờ, nhưng cầu
// trustedDeviceSso nuốt bước OTP nên last_otp_at không bao giờ mới lại ⇒ vòng chết.

test('trusted-device bridge can be bypassed on purpose to refresh the 12h OTP mark', () => {
  assert.match(login, /const \[forceOtp, setForceOtp\] = useState\(false\);/);
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

test('default stays on the bridge so ordinary logins are not slowed down', () => {
  assert.match(login, /useState\(false\);\s*$/m);
  assert.doesNotMatch(login, /const \[forceOtp, setForceOtp\] = useState\(true\)/);
});

test('the 403 is translated into the exact steps out of the loop', () => {
  assert.match(cost, /EMPLOYEE_COST_SNAPSHOT_HUMAN_OTP_REQUIRED/);
  assert.match(cost, /bắt buộc nhập lại OTP/);
  assert.match(cost, /setSnapshotError\(snapshotErrorText\(requestError\)\)/);
});
