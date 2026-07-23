const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deviceIdHash, legacyAuditDeviceHash, deviceFingerprint } = require('../src/trustedDevice');
const { buildBackfill, main } = require('../scripts/backfill_trusted_device_history');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
function otpEvents(emp, raw, count) {
  return Array.from({ length: count }, (_, index) => ({
    at: new Date(Date.UTC(2026, 6, 20 + index, 1)).toISOString(),
    event: 'login', method: 'otp', emp_code: emp, device: legacyAuditDeviceHash(raw),
  }));
}
function fixture({ count = 3, currentCount = 0, duplicate = false } = {}) {
  const raw = 'legacy-device-one';
  const current = {
    id: deviceIdHash(raw), device_id_hash: deviceIdHash(raw), emp_code: 'DN016', ua: UA,
    trusted_login_count: currentCount, is_trusted: false, last_otp_at: currentCount ? Date.UTC(2026, 6, 23) : null,
  };
  return {
    raw,
    input: {
      legacyDevices: [{ id: raw, emp_code: 'DN016', ua: UA }],
      legacyAudit: [
        ...otpEvents('DN016', raw, count),
        { at: new Date().toISOString(), event: 'login', method: 'telegram', emp_code: 'DN016', device: legacyAuditDeviceHash(raw) },
      ],
      currentDevices: duplicate ? [current, { ...current }] : [current],
      users: [{ emp_code: 'DN016', phone: '0867409960' }],
      threshold: 3,
    },
  };
}

test('backfill trusts a device only from 3 audited successful OTP logins', () => {
  const { input } = fixture({ count: 3 });
  const result = buildBackfill(input);
  assert.equal(result.summary.updatedDevices, 1);
  assert.equal(result.summary.newlyTrusted, 1);
  assert.equal(result.summary.historicalOtpEvents, 3);
  const device = result.devices[0];
  assert.equal(device.trusted_login_count, 3);
  assert.equal(device.history_backfilled_otp_count, 3);
  assert.equal(device.is_trusted, true);
  assert.equal(device.phone, '0867409960');
  assert.equal(device.trusted_fingerprint, deviceFingerprint(UA));
  assert.ok(device.last_otp_at);
  assert.ok(device.trusted_at);
});

test('historical OTP count adds to post-deploy OTP count and is idempotent', () => {
  const { input } = fixture({ count: 2, currentCount: 1 });
  const first = buildBackfill(input);
  assert.equal(first.devices[0].trusted_login_count, 3);
  assert.equal(first.devices[0].is_trusted, true);
  const second = buildBackfill({ ...input, currentDevices: first.devices });
  assert.equal(second.summary.updatedDevices, 0);
  assert.equal(second.devices[0].trusted_login_count, 3);
});

test('ambiguous current-device mapping fails closed', () => {
  const { input } = fixture({ count: 3, duplicate: true });
  const result = buildBackfill(input);
  assert.equal(result.summary.ambiguousDevices, 1);
  assert.equal(result.summary.updatedDevices, 0);
  assert.equal(result.summary.newlyTrusted, 0);
});

test('non-OTP audit events never contribute trust', () => {
  const { input } = fixture({ count: 0 });
  const result = buildBackfill(input);
  assert.equal(result.summary.historicalOtpEvents, 0);
  assert.equal(result.summary.updatedDevices, 0);
  assert.equal(result.devices[0].trusted_login_count, 0);
});

test('missing current user fails closed even when device has a stale phone', () => {
  const { input } = fixture({ count: 3 });
  input.users = [];
  input.currentDevices[0].phone = '0999999999';
  const result = buildBackfill(input);
  assert.equal(result.summary.incompleteIdentity, 1);
  assert.equal(result.summary.updatedDevices, 0);
  assert.equal(result.summary.newlyTrusted, 0);
});

test('duplicate current employee codes fail closed', () => {
  const { input } = fixture({ count: 3 });
  input.users.push({ emp_code: 'DN016', phone: '0999999999' });
  const result = buildBackfill(input);
  assert.equal(result.summary.incompleteIdentity, 1);
  assert.equal(result.summary.updatedDevices, 0);
  assert.equal(result.summary.newlyTrusted, 0);
});

test('apply validates audit before writing devices', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-backfill-transaction-'));
  const legacyDir = path.join(root, 'legacy');
  const currentDir = path.join(root, 'current');
  fs.mkdirSync(legacyDir);
  fs.mkdirSync(currentDir);
  const raw = 'legacy-device-one';
  fs.writeFileSync(path.join(legacyDir, 'devices.json'), JSON.stringify([{ id: raw, emp_code: 'DN016', ua: UA }]));
  fs.writeFileSync(path.join(legacyDir, 'audit_auth.json'), JSON.stringify(otpEvents('DN016', raw, 3)));
  const devicesPath = path.join(currentDir, 'devices.json');
  const original = JSON.stringify([{
    id: deviceIdHash(raw), device_id_hash: deviceIdHash(raw), emp_code: 'DN016', ua: UA,
    trusted_login_count: 0, is_trusted: false,
  }]);
  fs.writeFileSync(devicesPath, original);
  try {
    assert.throws(() => main([
      '--legacy-auth-dir', legacyDir,
      '--current-auth-dir', currentDir,
      '--apply',
    ]), /REQUIRED_FILE_MISSING:.*audit_auth\.json/);
    assert.equal(fs.readFileSync(devicesPath, 'utf8'), original, 'devices phải giữ nguyên khi audit thiếu');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
