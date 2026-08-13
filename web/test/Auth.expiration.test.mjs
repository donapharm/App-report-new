import test from 'node:test';
import assert from 'node:assert/strict';
import { swrCacheKey, writeSwrCache } from '../src/swrCache.js';

class Storage {
  constructor() { this.map = new Map(); this.removed = []; }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.removed.push(key); this.map.delete(key); }
}

const payload = { revenue: 1, kys: ['07.2026'], privateRows: [] };

function installBrowser(storage) {
  globalThis.localStorage = storage;
  globalThis.document = {
    cookie: '',
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild() {} },
  };
  globalThis.window = { location: { protocol: 'https:' }, dispatchEvent() {} };
  globalThis.URL.createObjectURL ||= () => 'blob:test';
  globalThis.URL.revokeObjectURL ||= () => {};
}

function seedActors(storage, own = 'DN001', other = 'DN002') {
  const ownSpec = { actor: { emp_code: own }, screen: 'overview', period: { ky: '07.2026' } };
  const otherSpec = { actor: { emp_code: other }, screen: 'overview', period: { ky: '07.2026' } };
  writeSwrCache(storage, ownSpec, payload, Date.now());
  writeSwrCache(storage, otherSpec, payload, Date.now());
  return { ownSpec, otherSpec };
}

test('req 401 clears token and only the saved actor namespace once', async () => {
  const storage = new Storage();
  installBrowser(storage);
  globalThis.fetch = async () => ({
    ok: false, status: 401, headers: { get: () => '' },
    json: async () => ({ error: 'expired', credential: 'must-not-leak' }),
  });

  const apiModule = await import(`../src/api.js?auth-expiration=${Date.now()}`);
  apiModule.setToken('expired-token');
  apiModule.setAuthActor({ emp_code: 'DN001' });
  const { ownSpec, otherSpec } = seedActors(storage);

  const error = await apiModule.api.me().catch((caught) => caught);
  assert.equal(error.status, 401);
  assert.equal(error.message, 'expired');
  assert.equal(storage.getItem('rpt_token'), null);
  assert.equal(storage.getItem('rpt_auth_actor'), null);
  assert.equal(storage.getItem(swrCacheKey(ownSpec)), null);
  assert.notEqual(storage.getItem(swrCacheKey(otherSpec)), null);
  const ownRemovals = storage.removed.filter((key) => key === swrCacheKey(ownSpec)).length;
  await apiModule.recoverAfterMeRejection(error, async () => {});
  assert.equal(storage.removed.filter((key) => key === swrCacheKey(ownSpec)).length, ownRemovals,
    'App recovery must not clear a second/wrong actor after req already handled 401');
});

test('direct authenticated fetch 401 clears the saved actor namespace', async () => {
  const storage = new Storage();
  installBrowser(storage);
  globalThis.fetch = async () => ({
    ok: false, status: 401, headers: { get: () => '' },
    json: async () => ({ error: 'expired', token: 'must-not-leak' }),
  });
  const apiModule = await import(`../src/api.js?direct-expiration=${Date.now()}`);
  apiModule.setToken('expired-token');
  apiModule.setAuthActor({ emp_code: 'DN005' });
  const { ownSpec, otherSpec } = seedActors(storage, 'DN005', 'DN006');
  await assert.rejects(apiModule.downloadExport('revenue', {}), /Không xuất được file/);
  assert.equal(storage.getItem('rpt_token'), null);
  assert.equal(storage.getItem(swrCacheKey(ownSpec)), null);
  assert.notEqual(storage.getItem(swrCacheKey(otherSpec)), null);
});

test('/me 403 clears persisted actor before trusted-device recovery', async () => {
  const storage = new Storage();
  installBrowser(storage);
  const apiModule = await import(`../src/api.js?cold-expiration=${Date.now()}`);
  const { ownSpec, otherSpec } = seedActors(storage, 'DN003', 'DN004');
  storage.setItem('rpt_token', 'expired-token');
  storage.setItem('rpt_auth_actor', 'DN003');
  let recovered = false;
  await apiModule.recoverAfterMeRejection({ status: 403 }, async () => {
    assert.equal(storage.getItem('rpt_token'), null);
    assert.equal(storage.getItem(swrCacheKey(ownSpec)), null);
    assert.notEqual(storage.getItem(swrCacheKey(otherSpec)), null);
    recovered = true;
  }, storage);
  assert.equal(recovered, true);
});

test('network and 5xx paths keep token, actor and SWR cache intact', async () => {
  for (const scenario of ['network', '500']) {
    const storage = new Storage();
    installBrowser(storage);
    globalThis.fetch = scenario === 'network'
      ? async () => { throw new Error('offline'); }
      : async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({ error: 'server' }) });
    const apiModule = await import(`../src/api.js?keep-auth=${scenario}-${Date.now()}`);
    apiModule.setToken('live-token');
    apiModule.setAuthActor({ emp_code: 'DN007' });
    const { ownSpec } = seedActors(storage, 'DN007', 'DN008');
    await assert.rejects(apiModule.api.me());
    assert.equal(storage.getItem('rpt_token'), 'live-token');
    assert.notEqual(storage.getItem(swrCacheKey(ownSpec)), null);
  }
});


test('App preserves persisted actor during cold bootstrap until /me decides the session', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /useEffect\(\(\) => \{ if \(me\) setAuthActor\(me\); \}, \[me\]\)/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{ setAuthActor\(me\); \}, \[me\]\)/);
});
