const crypto = require('crypto');
const persist = require('./persist');
const store = require('./store');

const VERIFY_URL = 'https://sale.donapharm.asia/api/internal/trusted-device/verify';
const CONSUME_URL = 'https://sale.donapharm.asia/api/internal/trusted-device/consume';
const PENDING_TTL_MS = 120_000;
const USED_RETENTION_MS = 5 * 60_000;
const RATE_WINDOW_MS = 60_000;
const RATE_BUCKET_LIMIT = 2_000;
const PENDING_LIMIT = 5_000;

function normalizePhone(value) {
  let phone = String(value || '').replace(/[^\d]/g, '');
  if (phone.startsWith('84')) phone = `0${phone.slice(2)}`;
  if (phone && !phone.startsWith('0')) phone = `0${phone}`;
  return phone;
}

function canonicalEmployeeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9._-]{2,64}$/.test(code) ? code : '';
}

function base64url(bytes, randomBytes = crypto.randomBytes) {
  return randomBytes(bytes).toString('base64url');
}

function statusError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function configuredToken(env) {
  const token = String(env.TRUSTED_DEVICE_REPORT_S2S_TOKEN || '').trim();
  return token.length >= 32 && token.length <= 512 ? token : '';
}

function configuredTimeout(env) {
  const value = Number(env.TRUSTED_DEVICE_REPORT_TIMEOUT_MS || 5000);
  return Number.isFinite(value) ? Math.min(10_000, Math.max(500, value)) : 5000;
}

function configuredRateLimit(env, name, fallback) {
  const value = Number(env[name] || fallback);
  return Number.isFinite(value) ? Math.min(120, Math.max(1, Math.floor(value))) : fallback;
}

function rateKey(parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part || '')).join('|')).digest('base64url');
}

function createTrustedDeviceSsoBridge(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || global.fetch;
  const persistStore = options.persistStore || persist;
  const userStore = options.userStore || store;
  const now = options.now || (() => Date.now());
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const startRateBuckets = new Map();
  const consumeRateBuckets = new Map();
  let pending = persistStore.load('trusted_device_sso_pending', []);
  if (!Array.isArray(pending)) pending = [];

  function save() {
    persistStore.save('trusted_device_sso_pending', pending);
  }

  function prune() {
    const cutoff = now() - USED_RETENTION_MS;
    const before = pending.length;
    pending = pending.filter((entry) => (
      entry.status === 'pending' ? Number(entry.expiresAt || 0) > cutoff : Number(entry.usedAt || 0) > cutoff
    ));
    if (pending.length !== before) save();
  }

  function isConfigured() {
    return !!configuredToken(env) && typeof fetchImpl === 'function';
  }

  function enforceRateLimit(buckets, key, limit) {
    const at = now();
    if (buckets.size >= RATE_BUCKET_LIMIT) {
      for (const [entryKey, bucket] of buckets) if (bucket.resetAt <= at) buckets.delete(entryKey);
    }
    if (buckets.size >= RATE_BUCKET_LIMIT && !buckets.has(key)) {
      throw statusError('Vui lòng thử lại sau.', 429, 'TRUSTED_DEVICE_RATE_LIMITED');
    }
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= at
      ? { count: 1, resetAt: at + RATE_WINDOW_MS }
      : { count: current.count + 1, resetAt: current.resetAt };
    buckets.set(key, bucket);
    if (bucket.count > limit) throw statusError('Vui lòng thử lại sau.', 429, 'TRUSTED_DEVICE_RATE_LIMITED');
  }

  function start(phoneValue, context = {}) {
    const phone = normalizePhone(phoneValue);
    const ip = context.ip || 'unknown';
    const limit = configuredRateLimit(env, 'TRUSTED_DEVICE_REPORT_START_RATE_LIMIT_PER_MINUTE', 10);
    enforceRateLimit(startRateBuckets, rateKey(['start-ip', ip]), limit);
    enforceRateLimit(
      startRateBuckets,
      rateKey(['start-target', ip, phone]),
      limit,
    );
    if (!isConfigured()) throw statusError('Đăng nhập thiết bị tin cậy chưa được cấu hình.', 503, 'TRUSTED_DEVICE_NOT_CONFIGURED');
    prune();
    if (!/^0\d{8,10}$/.test(phone)) throw statusError('Số điện thoại không hợp lệ.', 400, 'TRUSTED_DEVICE_INVALID_PHONE');
    if (pending.length >= PENDING_LIMIT) {
      throw statusError('Vui lòng thử lại sau.', 429, 'TRUSTED_DEVICE_RATE_LIMITED');
    }
    const matches = userStore.listUsers().filter((user) => normalizePhone(user.phone) === phone);
    // Keep start non-enumerating: unknown/ambiguous accounts get the same pending
    // response and later fail closed. The canonical code never leaves this backend.
    const expectedEmployeeCode = matches.length === 1 ? canonicalEmployeeCode(matches[0].emp_code) : '';
    const createdAt = now();
    const entry = {
      id: base64url(24, randomBytes),
      nonce: base64url(24, randomBytes),
      reportDeviceId: base64url(24, randomBytes),
      expectedEmployeeCode,
      phone,
      createdAt,
      expiresAt: createdAt + PENDING_TTL_MS,
      status: 'pending',
    };
    pending.push(entry);
    save();
    return {
      attemptId: entry.id,
      nonce: entry.nonce,
      reportDeviceId: entry.reportDeviceId,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    };
  }

  async function consume(attemptIdValue, assertionValue, context = {}) {
    const attemptId = String(attemptIdValue || '').trim();
    const ip = context.ip || 'unknown';
    const limit = configuredRateLimit(env, 'TRUSTED_DEVICE_REPORT_CONSUME_RATE_LIMIT_PER_MINUTE', 10);
    enforceRateLimit(consumeRateBuckets, rateKey(['consume-ip', ip]), limit);
    enforceRateLimit(
      consumeRateBuckets,
      rateKey(['consume-target', ip, attemptId]),
      limit,
    );
    if (!isConfigured()) throw statusError('Đăng nhập thiết bị tin cậy chưa được cấu hình.', 503, 'TRUSTED_DEVICE_NOT_CONFIGURED');
    prune();
    const assertion = String(assertionValue || '').trim();
    const entry = pending.find((item) => item.id === attemptId);
    if (!entry) throw statusError('Phiên đăng nhập tin cậy không tồn tại.', 410, 'TRUSTED_DEVICE_PENDING_MISSING');
    if (entry.status !== 'pending') throw statusError('Phiên đăng nhập tin cậy đã được sử dụng.', 409, 'TRUSTED_DEVICE_PENDING_REUSED');
    if (entry.expiresAt <= now()) throw statusError('Phiên đăng nhập tin cậy đã hết hạn.', 410, 'TRUSTED_DEVICE_PENDING_EXPIRED');
    if (assertion.length < 100 || assertion.length > 4096) {
      throw statusError('Assertion không hợp lệ.', 400, 'TRUSTED_DEVICE_ASSERTION_INVALID');
    }
    // Unknown/ambiguous Report accounts follow the same S2S rejection path as
    // known accounts so consume latency does not become a phone-enumeration
    // oracle. The decoy is never accepted locally, even if upstream replies OK.
    const expectedForConsume = entry.expectedEmployeeCode
      || `NO_REPORT_${crypto.createHash('sha256').update(entry.id).digest('hex').slice(0, 16).toUpperCase()}`;

    let response;
    let data;
    try {
      response = await fetchImpl(CONSUME_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${configuredToken(env)}`,
        },
        body: JSON.stringify({
          assertion,
          nonce: entry.nonce,
          reportDeviceId: entry.reportDeviceId,
          expectedEmployeeCode: expectedForConsume,
        }),
        signal: AbortSignal.timeout(configuredTimeout(env)),
      });
      try { data = await response.json(); } catch { data = null; }
    } catch {
      throw statusError('Không xác nhận được thiết bị tin cậy; vui lòng dùng OTP.', 502, 'TRUSTED_DEVICE_CONSUME_UNAVAILABLE');
    }

    const employeeCode = canonicalEmployeeCode(data?.employeeCode);
    const expiresAt = Date.parse(String(data?.expiresAt || ''));
    if (!response.ok || data?.valid !== true || employeeCode !== entry.expectedEmployeeCode
      || data?.audience !== 'app-report' || !Number.isFinite(expiresAt) || expiresAt <= now()) {
      throw statusError('Thiết bị chưa được xác nhận; vui lòng dùng OTP.', 401, 'TRUSTED_DEVICE_CONSUME_REJECTED');
    }
    const user = userStore.findUserByCode(entry.expectedEmployeeCode);
    if (!user || normalizePhone(user.phone) !== entry.phone) {
      throw statusError('Tài khoản đã thay đổi; vui lòng dùng OTP.', 401, 'TRUSTED_DEVICE_ACCOUNT_MISMATCH');
    }

    // Synchronous read-check-write is the local one-time claim. It happens only
    // after App Sale validates the assertion, and strictly before auth issues a session.
    if (entry.status !== 'pending' || entry.expiresAt <= now()) {
      throw statusError('Phiên đăng nhập tin cậy đã được sử dụng hoặc hết hạn.', 409, 'TRUSTED_DEVICE_PENDING_REUSED');
    }
    entry.status = 'used';
    entry.usedAt = now();
    save();
    return user;
  }

  return { isConfigured, start, consume, verifyUrl: VERIFY_URL, consumeUrl: CONSUME_URL };
}

const bridge = createTrustedDeviceSsoBridge();

module.exports = {
  VERIFY_URL,
  CONSUME_URL,
  createTrustedDeviceSsoBridge,
  isConfigured: bridge.isConfigured,
  start: bridge.start,
  consume: bridge.consume,
};
