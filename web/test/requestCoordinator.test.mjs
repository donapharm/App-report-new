import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestCoordinator, createLatestRequestGate, requestScopeKey } from '../src/requestCoordinator.js';

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

test('coalesces concurrent requests with the same authenticated scope key', async () => {
  const coordinator = new RequestCoordinator({ maxEntries: 4 });
  const pending = deferred();
  let loads = 0;
  const loader = () => { loads += 1; return pending.promise; };
  const one = coordinator.run('same', loader, { cacheMs: 1000 });
  const two = coordinator.run('same', loader, { cacheMs: 1000 });
  pending.resolve({ ok: true });
  assert.deepEqual(await Promise.all([one, two]), [{ ok: true }, { ok: true }]);
  assert.equal(loads, 1);
});

test('latest-request gate cancels old employee switch and rejects stale overwrite', () => {
  const gate = createLatestRequestGate();
  const old = gate.next();
  const latest = gate.next();
  assert.equal(old.signal.aborted, true);
  assert.equal(old.isLatest(), false);
  assert.equal(latest.signal.aborted, false);
  assert.equal(latest.isLatest(), true);
});

test('cache key isolates CEO/employee session, device, query and data generation', () => {
  const base = { method: 'GET', path: '/employee-cost?emp=ALL', token: 'ceo-token', deviceId: 'ceo-device', dataSignature: 'slot-a' };
  const key = requestScopeKey(base);
  for (const changed of [
    { token: 'employee-token' },
    { deviceId: 'employee-device' },
    { path: '/employee-cost?emp=DN016' },
    { dataSignature: 'slot-b' },
  ]) assert.notEqual(requestScopeKey({ ...base, ...changed }), key);
});

test('bounded LRU cache never retains more than configured entries', async () => {
  const coordinator = new RequestCoordinator({ maxEntries: 3 });
  for (let i = 0; i < 10; i += 1) await coordinator.run(`key-${i}`, async () => i, { cacheMs: 1000 });
  assert.equal(coordinator.cache.size, 3);
  assert.deepEqual([...coordinator.cache.keys()], ['key-7', 'key-8', 'key-9']);
});

test('one cancelled coalesced consumer does not abort a request still used by another', async () => {
  const coordinator = new RequestCoordinator();
  const pending = deferred();
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = coordinator.run('shared', () => pending.promise, { signal: firstController.signal });
  const second = coordinator.run('shared', () => pending.promise, { signal: secondController.signal });
  firstController.abort();
  await assert.rejects(first, (error) => error.name === 'AbortError');
  pending.resolve('fresh');
  assert.equal(await second, 'fresh');
});
