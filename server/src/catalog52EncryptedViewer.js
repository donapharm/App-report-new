'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = '/home/osboxes/app-report-custody/catalog52-v1';
const PAGE_SIZE = 50;
const MAX_PAGES = 5000;

class ViewerError extends Error {
  constructor(code, status = 422) { super(code); this.code = code; this.status = status; }
}

function safeSegment(value, code) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(text) || text === '.' || text === '..') throw new ViewerError(code);
  return text;
}
function period(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) throw new ViewerError('CATALOG52_PERIOD_INVALID');
  return text;
}
function b64url(value) { return Buffer.from(value).toString('base64url'); }
function canonicalJwk(value) {
  if (!value || value.kty !== 'RSA' || value.alg !== 'RSA-OAEP-256' || value.ext !== true
    || !Array.isArray(value.key_ops) || !value.key_ops.includes('encrypt')
    || !/^[A-Za-z0-9_-]{300,}$/.test(String(value.n || '')) || value.e !== 'AQAB') {
    throw new ViewerError('CATALOG52_PUBLIC_KEY_INVALID');
  }
  return { kty: 'RSA', alg: 'RSA-OAEP-256', ext: true, key_ops: ['encrypt'], n: value.n, e: 'AQAB' };
}
function keyId(jwk) {
  return b64url(crypto.createHash('sha256').update(JSON.stringify(canonicalJwk(jwk))).digest()).slice(0, 43);
}
function ensureRoot(root) { fs.mkdirSync(root, { recursive: true, mode: 0o700 }); fs.chmodSync(root, 0o700); }
function atomicJson(file, value) {
  ensureRoot(path.dirname(file));
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file); fs.chmodSync(file, 0o600);
  } finally { try { fs.unlinkSync(temp); } catch { /* already renamed */ } }
}
function validAsOf(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
    || !Number.isFinite(Date.parse(text))) throw new ViewerError('CATALOG52_AS_OF_REQUIRED', 503);
  return text;
}
function validateManifest(value, requestedPeriod) {
  if (!value || value.schemaVersion !== 1 || value.kind !== 'catalog52-encrypted-pages'
    || value.period !== requestedPeriod || value.algorithm !== 'AES-256-GCM+RSA-OAEP-256'
    || value.pageSize !== PAGE_SIZE || !Number.isInteger(value.rowCount) || value.rowCount < 0
    || !Number.isInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > MAX_PAGES
    || !Array.isArray(value.wrappedKeys) || !Array.isArray(value.pages)) {
    throw new ViewerError('CATALOG52_ENCRYPTED_MANIFEST_INVALID', 503);
  }
  validAsOf(value.asOf);
  if (value.pages.length !== value.pageCount) throw new ViewerError('CATALOG52_ENCRYPTED_MANIFEST_INVALID', 503);
  for (let index = 0; index < value.pages.length; index += 1) {
    const item = value.pages[index];
    if (item.page !== index + 1 || !/^[a-f0-9]{64}$/.test(String(item.sha256 || ''))
      || !/^[A-Za-z0-9_-]{16,}$/.test(String(item.iv || '')) || item.file !== `page-${String(index + 1).padStart(5, '0')}.bin`) {
      throw new ViewerError('CATALOG52_ENCRYPTED_MANIFEST_INVALID', 503);
    }
  }
  return value;
}

function createViewer({ root = process.env.CATALOG52_STORE_ROOT || DEFAULT_ROOT } = {}) {
  const custody = path.resolve(root);
  const deviceFile = (deviceId) => path.join(custody, 'devices', `${safeSegment(deviceId, 'CATALOG52_DEVICE_INVALID')}.json`);
  function registerDevice(deviceId, publicJwk, actor) {
    const jwk = canonicalJwk(publicJwk); const id = keyId(jwk);
    atomicJson(deviceFile(deviceId), { schemaVersion: 1, deviceId, keyId: id, publicJwk: jwk, actor: String(actor || ''), registeredAt: new Date().toISOString() });
    return { registered: true, keyId: id };
  }
  function forgetDevice(deviceId) {
    try { fs.unlinkSync(deviceFile(deviceId)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { registered: false };
  }
  function device(deviceId) {
    try { const value = JSON.parse(fs.readFileSync(deviceFile(deviceId), 'utf8')); return { registered: true, keyId: value.keyId }; }
    catch { return { registered: false, keyId: null }; }
  }
  function manifest(requestedPeriod, deviceId) {
    const p = period(requestedPeriod); const current = device(deviceId);
    if (!current.registered) throw new ViewerError('CATALOG52_DEVICE_NOT_REGISTERED', 409);
    const file = path.join(custody, 'packages', p, 'manifest.json');
    let value; try { value = validateManifest(JSON.parse(fs.readFileSync(file, 'utf8')), p); }
    catch (error) { if (error instanceof ViewerError) throw error; throw new ViewerError('CATALOG52_PACKAGE_UNAVAILABLE', 503); }
    const wrapped = value.wrappedKeys.find((item) => item.keyId === current.keyId);
    if (!wrapped || !/^[A-Za-z0-9_-]{100,}$/.test(String(wrapped.wrappedKey || ''))) throw new ViewerError('CATALOG52_DEVICE_PACKAGE_KEY_MISSING', 409);
    return { ...value, wrappedKeys: undefined, wrappedKey: wrapped.wrappedKey, deviceKeyId: current.keyId };
  }
  function page(requestedPeriod, pageNo) {
    const p = period(requestedPeriod); const number = Number(pageNo);
    if (!Number.isInteger(number) || number < 1 || number > MAX_PAGES) throw new ViewerError('CATALOG52_PAGE_INVALID');
    const meta = validateManifest(JSON.parse(fs.readFileSync(path.join(custody, 'packages', p, 'manifest.json'), 'utf8')), p);
    const item = meta.pages[number - 1]; if (!item) throw new ViewerError('CATALOG52_PAGE_INVALID');
    const file = path.join(custody, 'packages', p, item.file); const bytes = fs.readFileSync(file);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new ViewerError('CATALOG52_CIPHERTEXT_CHECKSUM_INVALID', 503);
    return { bytes, item, asOf: meta.asOf };
  }
  return { root: custody, registerDevice, forgetDevice, device, manifest, page };
}

module.exports = { DEFAULT_ROOT, PAGE_SIZE, ViewerError, canonicalJwk, keyId, validateManifest, createViewer };
