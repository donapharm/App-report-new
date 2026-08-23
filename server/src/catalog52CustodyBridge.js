'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const zlib = require('node:zlib');
const { canonicalJwk, keyId, PAGE_SIZE, ViewerError } = require('./catalog52EncryptedViewer');

const SOURCE_CONTRACT = 'data-hub.app-report.full52-snapshot.v1';
const PACKAGE_KIND = 'catalog52-encrypted-pages';
const ALGORITHM = 'AES-256-GCM+RSA-OAEP-256';
const SHA256 = /^[a-f0-9]{64}$/;

function fail(code, status = 422) { throw new ViewerError(code, status); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function assertPeriod(value) {
  const period = String(value || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period === '2026-06') fail('CATALOG52_PERIOD_INVALID');
  return period;
}
function assertSourceManifest(manifest, requestedPeriod) {
  if (!manifest || manifest.contract !== SOURCE_CONTRACT || manifest.period !== requestedPeriod || manifest.immutable !== true
    || manifest.publication?.complete !== true || !SHA256.test(String(manifest.packageChecksum || ''))
    || !Number.isInteger(manifest.rowCount) || manifest.rowCount < 1 || !Number.isInteger(manifest.pageCount)
    || !Array.isArray(manifest.pages) || manifest.pages.length !== manifest.pageCount
    || !Array.isArray(manifest.columns) || manifest.columns.length !== 52
    || !manifest.columns.every((column, index) => column.key === `c${index + 1}`)
    || !manifest.pages.every((page, index) => page.page === index + 1 && Number.isInteger(page.rowCount) && page.rowCount > 0
      && Number.isInteger(page.bytes) && page.bytes > 0 && SHA256.test(String(page.rowsChecksum || ''))
      && SHA256.test(String(page.fileChecksum || '')))
    || manifest.pages.reduce((sum, page) => sum + Number(page.rowCount || 0), 0) !== manifest.rowCount) {
    fail('CATALOG52_SOURCE_MANIFEST_INVALID', 502);
  }
  return manifest;
}
function assertSourcePage(payload, descriptor, manifest) {
  if (!payload || payload.contract !== SOURCE_CONTRACT || payload.period !== manifest.period
    || payload.packageChecksum !== manifest.packageChecksum || payload.page !== descriptor.page
    || payload.pageRowsChecksum !== descriptor.rowsChecksum || !Array.isArray(payload.rows)
    || payload.rows.length !== descriptor.rowCount) fail('CATALOG52_SOURCE_PAGE_INVALID', 502);
  if (sha256(JSON.stringify(payload.rows)) !== descriptor.rowsChecksum) fail('CATALOG52_SOURCE_PAGE_CHECKSUM_INVALID', 502);
  for (const row of payload.rows) for (let index = 1; index <= 52; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(row, `c${index}`)) fail('CATALOG52_SOURCE_PAGE_INVALID', 502);
  }
  return payload.rows;
}
function readRegisteredKeys(root) {
  const deviceRoot = path.join(root, 'devices');
  let names;
  try { names = fs.readdirSync(deviceRoot).filter((name) => name.endsWith('.json')).sort(); }
  catch (error) { if (error.code === 'ENOENT') fail('CATALOG52_NO_REGISTERED_DEVICE', 409); throw error; }
  const unique = new Map();
  for (const name of names) {
    const value = JSON.parse(fs.readFileSync(path.join(deviceRoot, name), 'utf8'));
    const jwk = canonicalJwk(value.publicJwk); const id = keyId(jwk);
    if (value.keyId !== id) fail('CATALOG52_DEVICE_KEY_ID_INVALID', 409);
    unique.set(id, jwk);
  }
  if (!unique.size) fail('CATALOG52_NO_REGISTERED_DEVICE', 409);
  return [...unique].map(([id, jwk]) => ({ keyId: id, publicJwk: jwk }));
}
function fsyncDir(directory) { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function writeExclusive(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(file, 0o600);
}
function gmt7(iso) {
  const date = new Date(iso); if (!Number.isFinite(date.getTime())) fail('CATALOG52_SOURCE_TIME_INVALID', 502);
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().replace('Z', '+07:00');
  return shifted;
}

async function fetchSigned(baseUrl, client, secret, requestPath, fetchImpl = fetch) {
  const url = new URL(requestPath, `${String(baseUrl).replace(/\/$/, '')}/`);
  const signedPath = `${url.pathname}${url.search}`;
  const timestamp = String(Date.now()); const nonce = crypto.randomBytes(18).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`GET\n${signedPath}\n${timestamp}\n${nonce}`).digest('hex');
  const response = await fetchImpl(url, { headers: {
    'x-app-report-full52-client': client, 'x-app-report-full52-timestamp': timestamp,
    'x-app-report-full52-nonce': nonce, 'x-app-report-full52-signature': signature,
    accept: 'application/json',
  } });
  if (!response.ok) fail('CATALOG52_SOURCE_HTTP_ERROR', 502);
  return response;
}
function fetchRawSigned(baseUrl, client, secret, requestPath) {
  const url = new URL(requestPath, `${String(baseUrl).replace(/\/$/, '')}/`);
  const signedPath = `${url.pathname}${url.search}`;
  const timestamp = String(Date.now()); const nonce = crypto.randomBytes(18).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`GET\n${signedPath}\n${timestamp}\n${nonce}`).digest('hex');
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.get(url, { headers: {
      'x-app-report-full52-client': client, 'x-app-report-full52-timestamp': timestamp,
      'x-app-report-full52-nonce': nonce, 'x-app-report-full52-signature': signature,
      accept: 'application/json',
    } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
  });
}
async function pullSource({ period, baseUrl, client = 'app-report-ceo', secret, fetchImpl = fetch, rawFetchImpl = fetchRawSigned }) {
  if (!baseUrl || !secret || String(secret).length < 32) fail('CATALOG52_SOURCE_CREDENTIAL_INVALID', 503);
  const prefix = '/api/integrations/app-report/full52';
  const manifestResponse = await fetchSigned(baseUrl, client, secret, `${prefix}/snapshots/${period}`, fetchImpl);
  const manifest = assertSourceManifest(await manifestResponse.json(), period);
  const pages = [];
  for (const descriptor of manifest.pages) {
    const response = await rawFetchImpl(baseUrl, client, secret, `${prefix}/snapshots/${period}/pages/${descriptor.page}`);
    if (response.status < 200 || response.status >= 300) fail('CATALOG52_SOURCE_HTTP_ERROR', 502);
    if (response.headers['x-full52-package-checksum'] !== manifest.packageChecksum
      || response.headers['x-full52-page-checksum'] !== descriptor.rowsChecksum
      || response.headers['x-full52-final-page'] !== (descriptor.page === manifest.pageCount ? '1' : '0')
      || Number(response.headers['content-length']) !== descriptor.bytes
      || sha256(response.bytes) !== descriptor.fileChecksum) fail('CATALOG52_SOURCE_FILE_CHECKSUM_INVALID', 502);
    let bytes; try { bytes = zlib.gunzipSync(response.bytes); } catch { fail('CATALOG52_SOURCE_PAGE_INVALID', 502); }
    let payload; try { payload = JSON.parse(bytes.toString('utf8')); } catch { fail('CATALOG52_SOURCE_PAGE_INVALID', 502); }
    pages.push(assertSourcePage(payload, descriptor, manifest));
    bytes.fill(0);
  }
  return { manifest, rows: pages.flat() };
}

function buildEncryptedPackage({ root, source, actor, now = new Date().toISOString(), randomBytes = crypto.randomBytes }) {
  const manifest = assertSourceManifest(source.manifest, assertPeriod(source.manifest?.period));
  const rows = source.rows;
  if (!Array.isArray(rows) || rows.length !== manifest.rowCount) fail('CATALOG52_SOURCE_ROW_COUNT_MISMATCH', 502);
  const actorName = String(actor || '').trim(); if (!actorName) fail('CATALOG52_ACTOR_REQUIRED', 403);
  const keys = readRegisteredKeys(root); const cek = randomBytes(32);
  const asOf = gmt7(manifest.publishedAt || now); const target = path.join(root, 'packages', manifest.period);
  const packagesRoot = path.dirname(target); fs.mkdirSync(packagesRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(root, 0o700); fs.chmodSync(packagesRoot, 0o700);
  if (fs.existsSync(target)) fail('CATALOG52_PACKAGE_ALREADY_EXISTS', 409);
  const publishClaim = path.join(packagesRoot, `.published-${manifest.period}.lock`);
  let claimed = false; let published = false;
  try { writeExclusive(publishClaim, `${JSON.stringify({ period: manifest.period })}\n`); claimed = true; }
  catch (error) { if (error.code === 'EEXIST') fail('CATALOG52_PACKAGE_ALREADY_EXISTS', 409); throw error; }
  const staging = path.join(packagesRoot, `.staging-${manifest.period}-${process.pid}-${crypto.randomBytes(10).toString('hex')}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    const wrappedKeys = keys.map(({ keyId: id, publicJwk }) => ({
      keyId: id,
      wrappedKey: crypto.publicEncrypt({ key: crypto.createPublicKey({ key: publicJwk, format: 'jwk' }), oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, cek).toString('base64url'),
    }));
    const pageDescriptors = [];
    for (let offset = 0; offset < rows.length; offset += PAGE_SIZE) {
      const page = pageDescriptors.length + 1; const iv = randomBytes(12);
      const payload = { period: manifest.period, asOf, page, rows: rows.slice(offset, offset + PAGE_SIZE) };
      const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv); cipher.setAAD(Buffer.from(`${manifest.period}|${asOf}`));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]);
      const file = `page-${String(page).padStart(5, '0')}.bin`; writeExclusive(path.join(staging, file), ciphertext);
      pageDescriptors.push({ page, file, iv: iv.toString('base64url'), sha256: sha256(ciphertext), bytes: ciphertext.length });
    }
    const identity = {
      schemaVersion: 1, kind: PACKAGE_KIND, period: manifest.period, asOf,
      sourceContract: SOURCE_CONTRACT, sourcePackageChecksum: manifest.packageChecksum,
      sourcePublishedAt: manifest.publishedAt, sourceRowCount: manifest.rowCount,
      sourcePageCount: manifest.pageCount, algorithm: ALGORITHM, pageSize: PAGE_SIZE,
      rowCount: rows.length, pageCount: pageDescriptors.length, actor: actorName, builtAt: gmt7(now),
      sparseCounts: manifest.sparseColumnPopulatedRowCounts || {}, wrappedKeys, pages: pageDescriptors,
    };
    identity.packageChecksum = sha256(canonical(identity));
    writeExclusive(path.join(staging, 'manifest.json'), `${JSON.stringify(identity)}\n`);
    fsyncDir(staging); fs.renameSync(staging, target); published = true; fsyncDir(packagesRoot);
    return identity;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (claimed && !published) try { fs.unlinkSync(publishClaim); } catch { /* preserve original failure */ }
    throw error;
  } finally { cek.fill(0); }
}

module.exports = { SOURCE_CONTRACT, canonical, sha256, assertSourceManifest, assertSourcePage, readRegisteredKeys, fetchSigned, fetchRawSigned, pullSource, buildEncryptedPackage };
