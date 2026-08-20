const crypto = require('crypto');
const persist = require('./persist');

const RP_ID = String(process.env.PASSKEY_RP_ID || 'report.donapharm.asia').trim();
const RP_NAME = String(process.env.PASSKEY_RP_NAME || 'DONAPHARM App Report').trim();
const ORIGIN = String(process.env.PASSKEY_ORIGIN || 'https://report.donapharm.asia').trim();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CREDENTIALS = 5;
const MAX_PENDING_CHALLENGES = 256;

const registrationChallenges = new Map();
const authenticationChallenges = new Map();
let webauthnModule;

function normalizedHostname(value) {
  try {
    return new URL(`http://${String(value || '').trim()}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function requestContextAllowed(req) {
  const requestHost = normalizedHostname(req?.get?.('host') || req?.headers?.host);
  const requestOrigin = String(req?.get?.('origin') || req?.headers?.origin || '').trim();
  return requestHost === RP_ID.toLowerCase() && requestOrigin === ORIGIN;
}

function requireTrustedRequestContext(req, res, next) {
  if (requestContextAllowed(req)) return next();
  return res.status(403).json({
    error: 'Nguồn yêu cầu Passkey không hợp lệ.',
    code: 'PASSKEY_REQUEST_ORIGIN_REJECTED',
  });
}

function rpDomain() {
  try {
    return new URL(ORIGIN).hostname.toLowerCase();
  } catch {
    return RP_ID.toLowerCase();
  }
}

function startupLogLine() {
  return `[passkey] RP domain: ${rpDomain()}`;
}

function webauthn() {
  if (!webauthnModule) webauthnModule = import('@simplewebauthn/server');
  return webauthnModule;
}

function loadCredentials() {
  const rows = persist.load('passkey_credentials', []);
  return Array.isArray(rows) ? rows.filter((row) => row && row.emp_code === 'CEO' && row.id && row.public_key) : [];
}

function saveCredentials(rows) {
  persist.save('passkey_credentials', rows.slice(-MAX_CREDENTIALS));
}

function pruneChallenges() {
  const cutoff = Date.now() - CHALLENGE_TTL_MS;
  for (const [key, value] of registrationChallenges) if (value.created_at < cutoff) registrationChallenges.delete(key);
  for (const [key, value] of authenticationChallenges) if (value.created_at < cutoff) authenticationChallenges.delete(key);
}

function rememberChallenge(store, key, value) {
  store.set(key, value);
  while (store.size > MAX_PENDING_CHALLENGES) store.delete(store.keys().next().value);
}

function registrationKey(session, deviceId) {
  return `${String(session?.emp_code || '').toUpperCase()}:${crypto.createHash('sha256').update(String(deviceId || '')).digest('hex')}`;
}

async function registrationOptions(session, { deviceId } = {}) {
  pruneChallenges();
  const existing = loadCredentials();
  const { generateRegistrationOptions } = await webauthn();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: 'CEO',
    userDisplayName: session?.name || 'CEO DONAPHARM',
    userID: Buffer.from('APP_REPORT_CEO', 'utf8'),
    timeout: 60_000,
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({ id: row.id, transports: row.transports || [] })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    preferredAuthenticatorType: 'localDevice',
  });
  rememberChallenge(registrationChallenges, registrationKey(session, deviceId), { challenge: options.challenge, created_at: Date.now() });
  return options;
}

async function verifyRegistration(session, response, { deviceId } = {}) {
  pruneChallenges();
  const key = registrationKey(session, deviceId);
  const pending = registrationChallenges.get(key);
  registrationChallenges.delete(key);
  if (!pending) throw Object.assign(new Error('Yêu cầu đăng ký Passkey đã hết hạn.'), { status: 400, code: 'PASSKEY_CHALLENGE_EXPIRED' });

  const { verifyRegistrationResponse } = await webauthn();
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo) {
    throw Object.assign(new Error('Không xác minh được Passkey.'), { status: 401, code: 'PASSKEY_REGISTRATION_REJECTED' });
  }
  const info = result.registrationInfo;
  const credential = info.credential;
  const rows = loadCredentials().filter((row) => row.id !== credential.id);
  rows.push({
    id: credential.id,
    emp_code: 'CEO',
    public_key: Buffer.from(credential.publicKey).toString('base64'),
    counter: Number(credential.counter || 0),
    transports: credential.transports || response?.response?.transports || [],
    device_type: info.credentialDeviceType,
    backed_up: info.credentialBackedUp === true,
    created_at: new Date().toISOString(),
    last_used_at: null,
  });
  saveCredentials(rows);
  return { ok: true, credentials: rows.length };
}

async function authenticationOptions() {
  pruneChallenges();
  const rows = loadCredentials();
  if (!rows.length) throw Object.assign(new Error('CEO chưa đăng ký Passkey.'), { status: 404, code: 'PASSKEY_NOT_ENROLLED' });
  const { generateAuthenticationOptions } = await webauthn();
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: rows.map((row) => ({ id: row.id, transports: row.transports || [] })),
    timeout: 60_000,
    userVerification: 'required',
  });
  const attemptId = crypto.randomBytes(24).toString('hex');
  rememberChallenge(authenticationChallenges, attemptId, { challenge: options.challenge, created_at: Date.now() });
  return { attemptId, options };
}

async function verifyAuthentication(attemptId, response) {
  pruneChallenges();
  const pending = authenticationChallenges.get(String(attemptId || ''));
  authenticationChallenges.delete(String(attemptId || ''));
  if (!pending) throw Object.assign(new Error('Yêu cầu Passkey đã hết hạn.'), { status: 400, code: 'PASSKEY_CHALLENGE_EXPIRED' });
  const rows = loadCredentials();
  const row = rows.find((candidate) => candidate.id === response?.id);
  if (!row) throw Object.assign(new Error('Passkey không thuộc CEO App Report.'), { status: 401, code: 'PASSKEY_UNKNOWN' });

  const { verifyAuthenticationResponse } = await webauthn();
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: row.id,
      publicKey: Buffer.from(row.public_key, 'base64'),
      counter: Number(row.counter || 0),
      transports: row.transports || [],
    },
    requireUserVerification: true,
  });
  if (!result.verified || result.authenticationInfo.userVerified !== true) {
    throw Object.assign(new Error('Không xác minh được Face ID/Passkey.'), { status: 401, code: 'PASSKEY_AUTH_REJECTED' });
  }
  row.counter = Number(result.authenticationInfo.newCounter || 0);
  row.last_used_at = new Date().toISOString();
  saveCredentials(rows);
  return { emp_code: 'CEO' };
}

function status() {
  return { available: loadCredentials().length > 0, credentials: loadCredentials().length };
}

module.exports = {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  status,
  requestContextAllowed,
  requireTrustedRequestContext,
  startupLogLine,
};
