'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createViewer } = require('../src/catalog52EncryptedViewer');
const bridge = require('../src/catalog52CustodyBridge');

function keyPair() {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 0x10001 });
  const raw = pair.publicKey.export({ format: 'jwk' });
  return { pair, publicJwk: { kty: 'RSA', n: raw.n, e: raw.e, alg: 'RSA-OAEP-256', ext: true, key_ops: ['encrypt'] } };
}
function source(count = 101) {
  const rows = Array.from({ length: count }, (_, row) => {
    const value = Object.fromEntries([['sourceLineId', `L${row + 1}`], ...Array.from({ length: 52 }, (_v, index) => [`c${index + 1}`, index > 46 && row % 3 ? null : `${row + 1}:${index + 1}`])]);
    value.c6 = `DN${String((row % 21) + 1).padStart(3, '0')}`;
    for (let position = 33; position <= 46; position += 1) value[`c${position}`] = position;
    return value;
  });
  const manifest = { contract: bridge.SOURCE_CONTRACT, period: '2026-08', immutable: true, packageChecksum: 'a'.repeat(64), rowCount: count, pageCount: 1,
    pages: [{ page: 1, rowCount: count, rowsChecksum: bridge.sha256(JSON.stringify(rows)), fileChecksum: 'b'.repeat(64), bytes: 1 }], columns: Array.from({ length: 52 }, (_v, index) => ({ key: `c${index + 1}` })),
    publication: { complete: true, finalPage: 1 }, publishedAt: '2026-08-22T09:32:29.906Z', sparseColumnPopulatedRowCounts: { c48: 34, c49: 34, c50: 34, c51: 34 } };
  return { manifest, rows };
}
function decrypt(root, privateKey) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages', '2026-08', 'manifest.json'), 'utf8'));
  const cek = crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(manifest.wrappedKeys[0].wrappedKey, 'base64url'));
  const output = [];
  for (const page of manifest.pages) {
    const bytes = fs.readFileSync(path.join(root, 'packages', '2026-08', page.file)); const tag = bytes.subarray(bytes.length - 16); const body = bytes.subarray(0, -16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', cek, Buffer.from(page.iv, 'base64url')); decipher.setAAD(Buffer.from(`${manifest.period}|${manifest.asOf}`)); decipher.setAuthTag(tag);
    output.push(...JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')).rows);
  }
  cek.fill(0); return { manifest, rows: output };
}

test('isolated bridge encrypts 28,006 rows roundtrip, binds source and never writes plaintext', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog52-bridge-')); const keys = keyPair();
  createViewer({ root }).registerDevice('device-1', keys.publicJwk, 'CEO'); const input = source(28_006);
  const manifest = bridge.buildEncryptedPackage({ root, source: input, actor: 'CEO', now: '2026-08-23T02:00:00.000Z' });
  const decoded = decrypt(root, keys.pair.privateKey);
  assert.equal(bridge.sha256(bridge.canonical(decoded.rows)), bridge.sha256(bridge.canonical(input.rows)));
  assert.deepEqual(decoded.rows, input.rows); assert.equal(manifest.rowCount, 28_006); assert.equal(manifest.pageCount, 561);
  assert.equal(manifest.sourcePackageChecksum, input.manifest.packageChecksum);
  const corpus = fs.readdirSync(path.join(root, 'packages', '2026-08')).map((name) => fs.readFileSync(path.join(root, 'packages', '2026-08', name)));
  assert.equal(corpus.some((bytes) => bytes.includes(Buffer.from('"sourceLineId":"L1"'))), false);
  assert.throws(() => bridge.buildEncryptedPackage({ root, source: input, actor: 'CEO' }), { code: 'CATALOG52_PACKAGE_ALREADY_EXISTS' });
});

test('unregistered device cannot unwrap and package contains no private key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog52-bridge-')); const first = keyPair(); const other = keyPair();
  createViewer({ root }).registerDevice('device-1', first.publicJwk, 'CEO'); bridge.buildEncryptedPackage({ root, source: source(21), actor: 'CEO' });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages', '2026-08', 'manifest.json'), 'utf8'));
  assert.throws(() => crypto.privateDecrypt({ key: other.pair.privateKey, oaepHash: 'sha256' }, Buffer.from(manifest.wrappedKeys[0].wrappedKey, 'base64url')));
  assert.doesNotMatch(JSON.stringify(manifest), /private/i);
});

test('source pull signs every HMAC request and accepts gzip/plain in-memory pages only', async () => {
  const input = source(2); const secret = 's'.repeat(48); const seen = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url); const headers = options.headers; const canonical = `GET\n${parsed.pathname}${parsed.search}\n${headers['x-app-report-full52-timestamp']}\n${headers['x-app-report-full52-nonce']}`;
    assert.equal(headers['x-app-report-full52-signature'], crypto.createHmac('sha256', secret).update(canonical).digest('hex'));
    seen.push(parsed.pathname);
    return new Response(JSON.stringify(input.manifest), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const pageBody = Buffer.from(JSON.stringify({ ...input.manifest, page: 1, pageRowsChecksum: input.manifest.pages[0].rowsChecksum, finalPage: true, rows: input.rows }));
  const compressed = require('node:zlib').gzipSync(pageBody);
  input.manifest.pages[0].bytes = compressed.length; input.manifest.pages[0].fileChecksum = bridge.sha256(compressed);
  const rawFetchImpl = async (_base, client, signedSecret, requestPath) => {
    assert.equal(client, 'report'); assert.equal(signedSecret, secret); seen.push(requestPath);
    return { status: 200, headers: { 'x-full52-package-checksum': input.manifest.packageChecksum, 'x-full52-page-checksum': input.manifest.pages[0].rowsChecksum, 'x-full52-final-page': '1', 'content-length': String(compressed.length) }, bytes: compressed };
  };
  const pulled = await bridge.pullSource({ period: '2026-08', baseUrl: 'https://datahub.invalid', client: 'report', secret, fetchImpl, rawFetchImpl });
  assert.deepEqual(pulled.rows, input.rows); assert.equal(seen.length, 2);
  const corruptedRaw = async (...args) => {
    const response = await rawFetchImpl(...args); response.bytes = Buffer.from(response.bytes); response.bytes[0] ^= 1; return response;
  };
  await assert.rejects(() => bridge.pullSource({ period: '2026-08', baseUrl: 'https://datahub.invalid', client: 'report', secret, fetchImpl, rawFetchImpl: corruptedRaw }), { code: 'CATALOG52_SOURCE_FILE_CHECKSUM_INVALID' });
});
