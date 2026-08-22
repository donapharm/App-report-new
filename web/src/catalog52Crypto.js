const DB_NAME = 'app-report-catalog52-keys';
const STORE_NAME = 'device-keys';
const KEY_NAME = 'rsa-oaep-256';

function openDb(indexedDBImpl = globalThis.indexedDB) {
  if (!indexedDBImpl) throw Object.assign(new Error('Trình duyệt không hỗ trợ khoá thiết bị.'), { code: 'CATALOG52_INDEXEDDB_UNAVAILABLE' });
  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact(mode, action, indexedDBImpl) {
  const db = await openDb(indexedDBImpl);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode); const store = tx.objectStore(STORE_NAME);
      const request = action(store); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export const readDeviceKey = (indexedDBImpl) => transact('readonly', (store) => store.get(KEY_NAME), indexedDBImpl);
export const forgetDeviceKey = (indexedDBImpl) => transact('readwrite', (store) => store.delete(KEY_NAME), indexedDBImpl);

export async function generateDeviceKeyPair(subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw Object.assign(new Error('Trình duyệt không hỗ trợ WebCrypto.'), { code: 'CATALOG52_WEBCRYPTO_UNAVAILABLE' });
  return subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
}

export async function ensureDeviceKey({ subtle = globalThis.crypto?.subtle, indexedDBImpl } = {}) {
  if (!subtle) throw Object.assign(new Error('Trình duyệt không hỗ trợ WebCrypto.'), { code: 'CATALOG52_WEBCRYPTO_UNAVAILABLE' });
  const existing = await readDeviceKey(indexedDBImpl);
  if (existing?.privateKey && existing?.publicKey) return existing;
  const pair = await generateDeviceKeyPair(subtle);
  // CryptoKey private is non-extractable by construction; IndexedDB stores the
  // structured-cloned handle, never raw PKCS/JWK material.
  const value = { privateKey: pair.privateKey, publicKey: pair.publicKey, createdAt: new Date().toISOString() };
  await transact('readwrite', (store) => store.put(value, KEY_NAME), indexedDBImpl);
  return value;
}
export async function exportedPublicJwk(publicKey, subtle = globalThis.crypto?.subtle) {
  const jwk = await subtle.exportKey('jwk', publicKey);
  return { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RSA-OAEP-256', ext: true, key_ops: ['encrypt'] };
}
function fromB64url(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const raw = globalThis.atob(`${base64}${'='.repeat((4 - base64.length % 4) % 4)}`);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
export async function decryptCatalog52Page({ manifest, ciphertext, iv, privateKey, subtle = globalThis.crypto?.subtle }) {
  if (!manifest?.asOf || !manifest?.period || !manifest?.wrappedKey) throw Object.assign(new Error('Gói 52 cột thiếu metadata bắt buộc.'), { code: 'CATALOG52_METADATA_INCOMPLETE' });
  const rawKey = await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromB64url(manifest.wrappedKey));
  const aesKey = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const aad = new TextEncoder().encode(`${manifest.period}|${manifest.asOf}`);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv), additionalData: aad, tagLength: 128 }, aesKey, ciphertext);
  const payload = JSON.parse(new TextDecoder().decode(plain));
  if (payload.period !== manifest.period || payload.asOf !== manifest.asOf || !Array.isArray(payload.rows) || payload.rows.length > 50) {
    throw Object.assign(new Error('Trang 52 cột không khớp manifest.'), { code: 'CATALOG52_PAGE_CONTRACT_INVALID' });
  }
  for (const row of payload.rows) for (let index = 1; index <= 52; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(row, `c${index}`)) throw Object.assign(new Error('Trang 52 cột thiếu trường.'), { code: 'CATALOG52_PAGE_CONTRACT_INVALID' });
  }
  return payload;
}
