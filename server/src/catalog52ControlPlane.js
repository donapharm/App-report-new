'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const auth = require('./auth');
const { createStore, Catalog52Error, MAX_SOURCE_BYTES, MAX_ROWS, normalizedMappingContract } = require('./catalog52SnapshotStore');

const TRUST_WINDOW_MS = 12 * 60 * 60 * 1000;
const DEFAULT_STORE_ROOT = '/home/osboxes/app-report-custody/catalog52-v1';

function resolveStoreRoot(env = process.env) {
  const override = String(env.CATALOG52_STORE_ROOT || '').trim();
  return path.resolve(override || DEFAULT_STORE_ROOT);
}

// Never fall back into server/data or the immutable release. A missing or
// unwritable custody root makes the write fail closed in createStore().
const store = createStore({ root: resolveStoreRoot() });

function enabled() { return process.env.CATALOG52_CONTROL_PLANE_ENABLED === '1'; }

function requireCeoTrustedHuman(req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  const session = req.session;
  if (!auth.isCeoActor(session)) return res.status(403).json({ error: 'Chỉ CEO được truy cập kho 52 cột.', code: 'CATALOG52_CEO_REQUIRED' });
  if (session?.service || session?.method === 'service-token' || /^qa(?:-|$)/i.test(String(session?.method || ''))) {
    return res.status(403).json({ error: 'Kho 52 cột chỉ chấp nhận phiên người thật.', code: 'CATALOG52_HUMAN_SESSION_REQUIRED' });
  }
  if (typeof auth.trustedHumanDeviceForSession !== 'function') {
    return res.status(503).json({ error: 'Backend xác thực thiết bị chưa sẵn sàng.', code: 'control_plane_trust_unavailable' });
  }
  const device = auth.trustedHumanDeviceForSession(session, { maxAgeMs: TRUST_WINDOW_MS });
  if (!device) return res.status(403).json({ error: 'Thiết bị cần OTP xác minh lại trong 12 giờ gần nhất.', code: 'CATALOG52_TRUST_REVERIFY_REQUIRED' });
  req.catalog52TrustedDevice = device;
  next();
}

function assertEnabled() {
  if (!enabled()) throw new Catalog52Error('CATALOG52_CONTROL_PLANE_DISABLED', { status: 503 });
}

async function syncFromVault(period, actor) {
  assertEnabled();
  const root = String(process.env.CATALOG52_VAULT_URL || '').trim();
  const token = String(process.env.CATALOG52_VAULT_READ_TOKEN || '').trim();
  if (!root || !token) throw new Catalog52Error('CATALOG52_VAULT_CONTRACT_UNAVAILABLE', { status: 503 });
  let endpoint;
  try { endpoint = new URL(root); } catch { throw new Catalog52Error('CATALOG52_VAULT_URL_INVALID', { status: 503 }); }
  if (endpoint.protocol !== 'https:') throw new Catalog52Error('CATALOG52_VAULT_HTTPS_REQUIRED', { status: 503 });
  endpoint.searchParams.set('period', period);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response;
  try {
    response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: controller.signal });
  } catch { throw new Catalog52Error('CATALOG52_VAULT_UNAVAILABLE', { status: 503 }); }
  finally { clearTimeout(timeout); }
  if (!response.ok) throw new Catalog52Error('CATALOG52_VAULT_UPSTREAM_ERROR', { status: 502, upstreamStatus: response.status });
  const sourceIntegrityChecksum = response.headers.get('x-source-integrity-sha256');
  const sourceVersion = response.headers.get('x-source-version');
  const sourceVersionNo = Number(response.headers.get('x-source-version-no'));
  const rowCount = Number(response.headers.get('x-row-count'));
  const mappingContractHeaders = {
    unitCodeColumn: response.headers.get('x-catalog52-unit-code-column'),
    qlnbColumn: response.headers.get('x-catalog52-qlnb-column'),
    employeeColumn: response.headers.get('x-catalog52-employee-column'),
    uomColumn: response.headers.get('x-catalog52-uom-column'),
    uomMode: response.headers.get('x-catalog52-uom-mode'),
  };
  if (!/^sha256:[a-f0-9]{64}$/i.test(String(sourceIntegrityChecksum || '')) || !sourceVersion
    || !Number.isSafeInteger(sourceVersionNo) || !Number.isSafeInteger(rowCount) || rowCount < 1 || rowCount > MAX_ROWS) {
    throw new Catalog52Error('CATALOG52_VAULT_RECEIPT_INCOMPLETE', { status: 502 });
  }
  let mappingContract;
  try { mappingContract = normalizedMappingContract(mappingContractHeaders); }
  catch { throw new Catalog52Error('CATALOG52_VAULT_MAPPING_CONTRACT_INVALID', { status: 502 }); }
  const declaredBytes = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_BYTES) {
    throw new Catalog52Error('CATALOG52_SOURCE_TOO_LARGE', { status: 413 });
  }
  const inbox = path.join(store.root, 'inbox');
  fs.mkdirSync(inbox, { recursive: true, mode: 0o700 }); fs.chmodSync(inbox, 0o700);
  const sourceFile = path.join(inbox, `${period}-${process.pid}-${crypto.randomBytes(12).toString('hex')}.json`);
  const hash = crypto.createHash('sha256');
  let streamedBytes = 0;
  const hasher = new Transform({ transform(chunk, _encoding, done) {
    streamedBytes += chunk.length;
    if (streamedBytes > MAX_SOURCE_BYTES) return done(new Catalog52Error('CATALOG52_SOURCE_TOO_LARGE', { status: 413 }));
    hash.update(chunk); return done(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(response.body), hasher, fs.createWriteStream(sourceFile, { flags: 'wx', mode: 0o600 }));
    if (`sha256:${hash.digest('hex')}` !== sourceIntegrityChecksum.toLowerCase()) throw new Catalog52Error('CATALOG52_SOURCE_CHECKSUM_MISMATCH');
    const metadata = JSON.stringify({
      root: store.root, period, source: 'ceo-vault', sourceVersion, sourceVersionNo, rowCount,
      receivedAt: response.headers.get('x-received-at') || null, sourceIntegrityChecksum, mappingContract, sourceFile, actor,
    });
    const worker = path.join(__dirname, '..', 'scripts', 'catalog52_projection_worker.js');
    const childEnv = { ...process.env };
    delete childEnv.CATALOG52_VAULT_READ_TOKEN; delete childEnv.CATALOG52_VAULT_URL;
    const result = await promisify(execFile)(process.execPath, ['--max-old-space-size=640', worker, metadata], { env: childEnv, maxBuffer: 1024 * 1024, timeout: 10 * 60 * 1000 });
    return JSON.parse(result.stdout);
  } catch (error) {
    if (error instanceof Catalog52Error) throw error;
    throw new Catalog52Error('CATALOG52_PROJECTION_WORKER_FAILED', { status: 502 });
  } finally { try { fs.unlinkSync(sourceFile); } catch { /* best effort */ } }
}

function safeError(error) {
  const code = error?.code || 'CATALOG52_INTERNAL_ERROR';
  const status = Number(error?.status) || 500;
  // Deliberately omit values/rows/checksums from unexpected failures.
  return { status, body: { error: code, code } };
}

module.exports = {
  TRUST_WINDOW_MS, DEFAULT_STORE_ROOT, resolveStoreRoot,
  store, enabled, requireCeoTrustedHuman, assertEnabled, syncFromVault, safeError,
};
