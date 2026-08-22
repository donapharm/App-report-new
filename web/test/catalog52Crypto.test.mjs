import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { decryptCatalog52Page, exportedPublicJwk, generateDeviceKeyPair } from '../src/catalog52Crypto.js';

const b64 = (value) => Buffer.from(value).toString('base64url');
test('private key is non-extractable and a 52-column page decrypts only in browser crypto', async () => {
  globalThis.atob ||= (value) => Buffer.from(value, 'base64').toString('binary');
  const pair = await generateDeviceKeyPair(webcrypto.subtle);
  assert.equal(pair.privateKey.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey('jwk', pair.privateKey));
  const publicJwk = await exportedPublicJwk(pair.publicKey, webcrypto.subtle); assert.equal(publicJwk.key_ops[0], 'encrypt');
  const aes = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const raw = await webcrypto.subtle.exportKey('raw', aes);
  const wrapped = await webcrypto.subtle.encrypt({ name: 'RSA-OAEP' }, pair.publicKey, raw);
  const manifest = { period: '2026-08', asOf: '2026-08-22T08:30:00+07:00', wrappedKey: b64(wrapped) };
  const rows = [{ sourceLineId: 'L1', ...Object.fromEntries(Array.from({ length: 52 }, (_, i) => [`c${i + 1}`, i === 43 ? null : `v${i + 1}`])) }];
  const plain = new TextEncoder().encode(JSON.stringify({ period: manifest.period, asOf: manifest.asOf, rows }));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${manifest.period}|${manifest.asOf}`), tagLength: 128 }, aes, plain);
  const result = await decryptCatalog52Page({ manifest, ciphertext, iv: b64(iv), privateKey: pair.privateKey, subtle: webcrypto.subtle });
  assert.equal(result.rows[0].c44, null); assert.equal(result.rows[0].c52, 'v52');
});
