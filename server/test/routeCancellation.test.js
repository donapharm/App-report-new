const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-route-cancel-auth-'));
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-route-cancel-no-lkg.json');
const router = require('../src/routes');

const tick = () => new Promise((resolve) => setImmediate(resolve));

function pendingBuild() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('shared flight keeps work alive while one of two subscribers remains and cleans listeners', async () => {
  const flights = new Map();
  const firstReq = new EventEmitter();
  const secondReq = new EventEmitter();
  const work = pendingBuild();
  let builds = 0;
  let sharedSignal;
  const build = (signal) => { builds += 1; sharedSignal = signal; return work.promise; };

  const first = router.sharedCancellableFlight(flights, 'same', firstReq, build);
  const second = router.sharedCancellableFlight(flights, 'same', secondReq, build);
  await tick();
  firstReq.emit('close');
  await assert.rejects(first, (error) => error.code === 'REQUEST_ABORTED');
  assert.equal(builds, 1);
  assert.equal(sharedSignal.aborted, false, 'one remaining subscriber still needs the build');

  work.resolve({ ok: true });
  assert.deepEqual(await second, { ok: true });
  assert.equal(flights.size, 0);
  assert.equal(firstReq.listenerCount('close') + firstReq.listenerCount('aborted'), 0);
  assert.equal(secondReq.listenerCount('close') + secondReq.listenerCount('aborted'), 0);
});

test('shared flight aborts only after all subscribers leave, never publishes aborted work, and evicts', async () => {
  const flights = new Map();
  const firstReq = new EventEmitter();
  const secondReq = new EventEmitter();
  let builds = 0;
  let aborts = 0;
  const build = (signal) => new Promise((resolve, reject) => {
    builds += 1;
    signal.addEventListener('abort', () => {
      aborts += 1;
      reject(Object.assign(new Error('cancelled upstream'), { name: 'AbortError' }));
    }, { once: true });
  });

  const first = router.sharedCancellableFlight(flights, 'all-leave', firstReq, build);
  const second = router.sharedCancellableFlight(flights, 'all-leave', secondReq, build);
  await tick();
  firstReq.emit('aborted');
  await assert.rejects(first, (error) => error.code === 'REQUEST_ABORTED');
  assert.equal(aborts, 0);
  secondReq.emit('close');
  await assert.rejects(second, (error) => error.code === 'REQUEST_ABORTED');
  await tick();
  assert.equal(aborts, 1, 'shared controller aborts once, only after subscriber count reaches zero');
  assert.equal(flights.has('all-leave'), false, 'aborted flight is evicted instead of cached/published');

  const retryReq = new EventEmitter();
  const retry = router.sharedCancellableFlight(flights, 'all-leave', retryReq, async () => ({ fresh: true }));
  assert.deepEqual(await retry, { fresh: true });
  assert.equal(builds, 1, 'failed builder ran once; retry used a fresh independent builder');
});

test('overview/trend cancellation wiring is explicit and does not claim synchronous CPU interruption', () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(source, /req\.once\('close', onAbandoned\)/);
  assert.match(source, /req\.once\('aborted', onAbandoned\)/);
  assert.match(source, /entry\.subscribers\.size === 0[\s\S]*?entry\.controller\.abort\(\)/);
  assert.match(source, /overviewKpis hiện là CPU đồng bộ[\s\S]*?KHÔNG được tuyên bố/);
  assert.match(source, /for \(const p of store\.listPeriods\(\)\)[\s\S]*?throwIfAborted\(signal\)[\s\S]*?setImmediate/);
});
