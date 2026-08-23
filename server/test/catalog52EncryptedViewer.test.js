'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createViewer, validateManifest, canonical } = require('../src/catalog52EncryptedViewer');
function sealManifest(value) {
  const identity = { ...value }; delete identity.packageChecksum;
  return { ...identity, packageChecksum: crypto.createHash('sha256').update(canonical(identity)).digest('hex') };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog52-encrypted-'));
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 0x10001 });
  const exported = pair.publicKey.export({ format: 'jwk' });
  const publicJwk = { kty: 'RSA', n: exported.n, e: exported.e, alg: 'RSA-OAEP-256', ext: true, key_ops: ['encrypt'] };
  return { root, pair, publicJwk };
}
test('custody registers only public key with 0700/0600 and forget revokes device', () => {
  const value = fixture(); const viewer = createViewer({ root: value.root });
  const registered = viewer.registerDevice('device-1', value.publicJwk, 'CEO');
  const file = path.join(value.root, 'devices', 'device-1.json');
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(stored.publicJwk).sort(), ['alg', 'e', 'ext', 'key_ops', 'kty', 'n']);
  assert.equal('privateKey' in stored, false);
  assert.deepEqual(viewer.device('device-1'), { registered: true, keyId: registered.keyId });
  viewer.forgetDevice('device-1'); assert.equal(viewer.device('device-1').registered, false);
});
test('server serves ciphertext bytes and only the requesting device wrapped key', () => {
  const value = fixture(); const viewer = createViewer({ root: value.root });
  const registered = viewer.registerDevice('device-1', value.publicJwk, 'CEO');
  const packageDir = path.join(value.root, 'packages', '2026-08'); fs.mkdirSync(packageDir, { recursive: true, mode: 0o700 });
  const bytes = crypto.randomBytes(512); fs.writeFileSync(path.join(packageDir, 'page-00001.bin'), bytes, { mode: 0o600 });
  const manifest = sealManifest({
    schemaVersion: 1, kind: 'catalog52-encrypted-pages', period: '2026-08', asOf: '2026-08-22T08:30:00+07:00',
    sourceVersion: 'sample', algorithm: 'AES-256-GCM+RSA-OAEP-256', pageSize: 50, rowCount: 1, pageCount: 1,
    sourcePackageChecksum: 'a'.repeat(64),
    sparseCounts: { c44: 0 }, wrappedKeys: [{ keyId: registered.keyId, wrappedKey: crypto.randomBytes(384).toString('base64url') }, { keyId: 'o'.repeat(43), wrappedKey: crypto.randomBytes(384).toString('base64url') }],
    pages: [{ page: 1, file: 'page-00001.bin', iv: crypto.randomBytes(12).toString('base64url'), sha256: crypto.createHash('sha256').update(bytes).digest('hex') }],
  });
  fs.writeFileSync(path.join(packageDir, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  const safe = viewer.manifest('2026-08', 'device-1');
  assert.equal(safe.wrappedKeys, undefined); assert.equal(safe.deviceKeyId, registered.keyId); assert.equal(safe.wrappedKey, manifest.wrappedKeys[0].wrappedKey);
  assert.deepEqual(viewer.page('2026-08', 1).bytes, bytes);
  const tampered = { ...manifest, actor: 'OTHER' };
  assert.throws(() => validateManifest(tampered, '2026-08'), { code: 'CATALOG52_ENCRYPTED_MANIFEST_CHECKSUM_INVALID' });
});
test('missing as-of metadata fails closed', () => {
  assert.throws(() => validateManifest({ schemaVersion: 1, kind: 'catalog52-encrypted-pages', period: '2026-08', algorithm: 'AES-256-GCM+RSA-OAEP-256', pageSize: 50, rowCount: 1, pageCount: 1, sourcePackageChecksum: 'a'.repeat(64), packageChecksum: 'b'.repeat(64), wrappedKeys: [], pages: [{ page: 1, file: 'page-00001.bin', iv: 'A'.repeat(16), sha256: 'c'.repeat(64) }] }, '2026-08'), { code: 'CATALOG52_AS_OF_REQUIRED' });
});
