const crypto = require('crypto');

function deviceHashSecret() {
  return process.env.SESSION_DEVICE_HASH_SECRET || process.env.SESSION_SECRET || 'app-report-device-id-v1';
}

function deviceIdHash(deviceId) {
  const raw = String(deviceId || '').trim();
  return raw ? crypto.createHmac('sha256', deviceHashSecret()).update(raw).digest('hex') : '';
}

// Hash từng được dùng để ẩn device ID trong audit trước khi kho thiết bị chuyển
// hoàn toàn sang HMAC. Chỉ dùng để đối chiếu migration lịch sử, không dùng auth mới.
function legacyAuditDeviceHash(deviceId) {
  const raw = String(deviceId || '').trim();
  return raw ? crypto.createHash('sha256').update(`device:${raw}`).digest('hex') : '';
}

// Fingerprint cố ý chỉ gồm OS + họ trình duyệt; version/build thay đổi không làm
// thiết bị mất tin cậy.
function deviceFingerprint(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (!ua) return '';
  const os = /iphone|ipad|ipod/.test(ua) ? 'ios'
    : /android/.test(ua) ? 'android'
      : /windows/.test(ua) ? 'windows'
        : /mac os x|macintosh/.test(ua) ? 'macos'
          : /linux|x11/.test(ua) ? 'linux' : 'other-os';
  const browser = /edg(?:a|ios)?\//.test(ua) ? 'edge'
    : /crios\//.test(ua) ? 'chrome-ios'
      : /chrome\//.test(ua) || /chromium\//.test(ua) ? 'chrome'
        : /firefox\//.test(ua) || /fxios\//.test(ua) ? 'firefox'
          : /safari\//.test(ua) ? 'safari' : 'other-browser';
  return `${os}:${browser}`;
}

module.exports = { deviceIdHash, legacyAuditDeviceHash, deviceFingerprint };
